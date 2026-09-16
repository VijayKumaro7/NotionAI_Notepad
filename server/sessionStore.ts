/**
 * Sessions that can be taken away.
 *
 * The cookie is still a signed JWT and still proves it came from us. What it no
 * longer does is *be* the session. It carries a `sid` — 256 bits from the
 * CSPRNG — and this module decides, on every request, whether that sid still
 * stands for anything.
 *
 * Why the split rather than one or the other:
 *
 *   the signature  → a forged cookie is rejected without touching the database,
 *                    so an attacker cannot make us look up anything.
 *   the row        → a real cookie can be expired, idled out, or revoked, which
 *                    a signature alone can never express. A stateless token is
 *                    valid until it expires and there is no sentence you can
 *                    add to it that means "except now".
 *
 * Only the hash of the sid is stored. The database is the thing most likely to
 * leak, and a leaked table of live session ids is a leaked table of accounts —
 * the same reasoning that keeps reset tokens hashed in emailAuthTokens.
 *
 * Two clocks, not one:
 *
 *   idle      → thirty days since the session was last used. It is what makes a
 *               forgotten tab on a library machine stop mattering eventually
 *               without anyone having to notice it.
 *   absolute  → ninety days since sign-in, which no amount of activity moves.
 *               Without it "idle" means a session stolen from an active user
 *               lives as long as the thief keeps using it.
 *
 * The previous behaviour was a single one-year expiry with no way to end it
 * early, so both of these are new ceilings; a year-old cookie is no longer a
 * working session.
 */

import { createHash, createHmac, hkdfSync, randomBytes } from "crypto";
import type { Request } from "express";
import * as db from "./db";

/** How long a signed-in session lasts no matter how much it is used. */
export const SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;

/** How long a signed-in session survives without being used. */
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How stale `lastSeenAt` may get before a request writes it forward.
 *
 * Without a threshold every authenticated request is also a write, which on a
 * note app that polls is a great many writes to record something nobody reads
 * at that resolution. Five minutes is far below the thirty-day idle window, so
 * the timeout it feeds is not measurably affected.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type SessionScope = "full" | "pending_2fa";

/** Why a session stopped. Short, fixed strings — they reach the audit log. */
export type RevocationReason =
  | "signed_out"
  | "password_changed"
  | "password_reset"
  | "revoked_by_user"
  | "revoked_all"
  | "two_factor_disabled"
  | "rotated";

export type SessionCheck =
  | { ok: true; userId: number; scope: SessionScope; sessionId: number }
  | {
      ok: false;
      reason: "unknown" | "revoked" | "expired" | "idle_timeout";
    };

/** 256 bits, base64url. Long enough that guessing is not a strategy. */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export const sessionDigest = (sessionId: string) =>
  createHash("sha256").update(sessionId).digest("hex");

/**
 * A pseudonymous stand-in for the client address.
 *
 * The address itself is never stored. What goes in the row is an HMAC under a
 * key derived from JWT_SECRET, which cannot be reversed and cannot be matched
 * against a guessed address without the key — the same bargain demoLimit.ts
 * makes for visitor counting, and for the same reason: the question worth
 * answering is "is this the same origin as last time", not "where is this
 * person". Returns null when there is no secret to key it with, because an
 * unkeyed hash of an IPv4 address is a lookup table, not a pseudonym.
 */
export function hashAddress(address: string): string | null {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret || !address) return null;

  const key = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.alloc(0),
      "session-ip",
      32
    )
  );

  return createHmac("sha256", key).update(address).digest("hex");
}

/**
 * A label a person can recognise, from a string that would otherwise be a
 * fingerprint.
 *
 * "Chrome on macOS" is enough to answer the only question the session list
 * exists to answer — is one of these not me? The full user agent would answer
 * it very slightly better and would mean keeping a high-entropy identifier for
 * every session of every account, which is more than the job needs.
 *
 * Deliberately crude: matching is by well-known substrings, order matters
 * (Edge and Chrome both say "Chrome"), and anything unrecognised is "Unknown
 * browser" rather than a guess built from the string itself.
 */
export function describeDevice(userAgent: string | undefined): string | null {
  if (!userAgent) return null;

  const ua = userAgent.slice(0, 400);

  const browser = /\bEdg\//.test(ua)
    ? "Edge"
    : /\bOPR\/|\bOpera\b/.test(ua)
      ? "Opera"
      : /\bFirefox\//.test(ua)
        ? "Firefox"
        : /\bChrome\//.test(ua)
          ? "Chrome"
          : /\bSafari\//.test(ua)
            ? "Safari"
            : null;

  const platform = /\biPhone\b|\biPad\b|\biPod\b/.test(ua)
    ? "iOS"
    : /\bAndroid\b/.test(ua)
      ? "Android"
      : /\bMac OS X\b|\bMacintosh\b/.test(ua)
        ? "macOS"
        : /\bWindows\b/.test(ua)
          ? "Windows"
          : /\bCrOS\b/.test(ua)
            ? "ChromeOS"
            : /\bLinux\b/.test(ua)
              ? "Linux"
              : null;

  if (!browser && !platform) return "Unknown browser";
  if (!platform) return browser;
  if (!browser) return platform;

  return `${browser} on ${platform}`;
}

/** How long a session of this scope gets. */
export function lifetimeFor(scope: SessionScope, pendingMs: number): number {
  return scope === "full" ? SESSION_ABSOLUTE_MS : pendingMs;
}

/**
 * Start a session and return the secret that names it.
 *
 * The secret is returned once, here, and never read back out of the database —
 * only its hash is stored. Returns null when there is no database, which is the
 * honest answer: without somewhere to record the session there is nothing that
 * could later revoke it, and issuing an unrevocable cookie instead would be
 * exactly the behaviour this module exists to replace.
 */
export async function startSession(input: {
  userId: number;
  scope: SessionScope;
  lifetimeMs: number;
  req: Pick<Request, "headers"> & { socket?: unknown };
  address: string;
}): Promise<{ sessionId: string; expiresAt: Date } | null> {
  const sessionId = newSessionId();
  const expiresAt = new Date(Date.now() + input.lifetimeMs);

  const created = await db.createSession({
    userId: input.userId,
    tokenHash: sessionDigest(sessionId),
    scope: input.scope,
    device: describeDevice(
      input.req.headers["user-agent"] as string | undefined
    ),
    ipHash: hashAddress(input.address),
    expiresAt,
  });

  if (!created) return null;

  return { sessionId, expiresAt };
}

/**
 * Is this sid still a session, and whose?
 *
 * Pure decision plus one conditional write. Everything that could refuse the
 * request is checked before `lastSeenAt` moves, so a request arriving after the
 * idle window cannot extend the window it just missed — checking the clock and
 * then touching unconditionally would make every expired session immortal, so
 * long as something kept poking it.
 */
export async function checkSession(
  sessionId: string,
  now = new Date()
): Promise<SessionCheck> {
  const tokenHash = sessionDigest(sessionId);
  const row = await db.findSessionByTokenHash(tokenHash);

  if (!row) return { ok: false, reason: "unknown" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  // Idle only bounds a full session. A pending one has an absolute deadline of
  // ten minutes, and measuring idleness inside that is measuring nothing.
  if (
    row.scope === "full" &&
    now.getTime() - row.lastSeenAt.getTime() > SESSION_IDLE_MS
  ) {
    await db.revokeSessionByTokenHash(tokenHash, "idle_timeout");
    return { ok: false, reason: "idle_timeout" };
  }

  if (now.getTime() - row.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    await db.touchSession(tokenHash, now);
  }

  return {
    ok: true,
    userId: row.userId,
    scope: row.scope,
    sessionId: row.id,
  };
}

/**
 * Give an existing session a new secret.
 *
 * Called when what the session is allowed to do changes — the second factor
 * clears, a new password is set. Both are moments where a copy of the old
 * cookie taken beforehand must stop working, and both are moments where the
 * person is right there and should not be signed out. Returns the new secret,
 * or null if the session was gone by the time we looked.
 */
export async function rotate(input: {
  currentSessionId: string;
  scope: SessionScope;
  lifetimeMs: number;
}): Promise<{ sessionId: string; expiresAt: Date } | null> {
  const sessionId = newSessionId();
  const expiresAt = new Date(Date.now() + input.lifetimeMs);

  const rotated = await db.rotateSession({
    currentTokenHash: sessionDigest(input.currentSessionId),
    nextTokenHash: sessionDigest(sessionId),
    scope: input.scope,
    expiresAt,
  });

  if (!rotated) return null;

  return { sessionId, expiresAt };
}

export async function revoke(
  sessionId: string,
  reason: RevocationReason
): Promise<void> {
  await db.revokeSessionByTokenHash(sessionDigest(sessionId), reason);
}

/**
 * End every session on the account, optionally sparing the one in hand.
 *
 * This is what a password reset means. A reset is the remedy for "somebody else
 * is in my account", and a remedy that leaves their session working is not one.
 */
export async function revokeAll(
  userId: number,
  reason: RevocationReason,
  exceptSessionId?: string
): Promise<number> {
  return db.revokeAllSessions(
    userId,
    reason,
    exceptSessionId ? sessionDigest(exceptSessionId) : undefined
  );
}
