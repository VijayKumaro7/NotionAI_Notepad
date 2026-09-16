/**
 * Minting a signed-in session, in one place.
 *
 * Every way into the app ends here: the Manus portal callback, email and
 * password, and Google. That is deliberate. The two-step verification gate is
 * one `if`, and if each sign-in path had its own copy, adding a fourth would
 * mean remembering to write it again — a second factor that guards two doors
 * out of three is not a second factor.
 *
 * The same argument now covers two more things this file does for everyone:
 * the session is recorded in the store, so it can be listed and revoked, and
 * the sign-in is written to the audit log. Both are one line here and would be
 * three copies of one line anywhere else.
 */

import type { Request, Response } from "express";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { PENDING_SESSION_MS, sdk } from "./_core/sdk";
import * as db from "./db";
import { clientAddress } from "./demoLimit";
import { record } from "./securityLog";
import {
  SESSION_ABSOLUTE_MS,
  revoke,
  rotate,
  sessionDigest,
  startSession,
  type RevocationReason,
} from "./sessionStore";

export type SignedInUser = {
  id: number;
  openId: string;
  name: string | null;
};

/**
 * Raised when a session cannot be recorded.
 *
 * Signing in already needs the database — the account is read from it — so
 * this is not a new dependency, but it is a new reason to refuse. The
 * alternative would be issuing a cookie with no row behind it, which
 * authenticateRequest refuses anyway and which nothing could ever revoke.
 * Failing at the door beats handing out a key to a lock that is not there.
 */
export class SessionUnavailableError extends Error {
  constructor() {
    super("Sessions are unavailable on this server right now.");
    this.name = "SessionUnavailableError";
  }
}

/**
 * Put a session cookie on the response and say where the browser should land.
 *
 * Returns the destination rather than redirecting, because the tRPC procedures
 * need the same decision without an HTTP redirect.
 */
export async function establishSession(
  req: Request,
  res: Response,
  user: SignedInUser
): Promise<{ needsSecondFactor: boolean; destination: string }> {
  const twoFactor = await db.getTwoFactor(user.id);
  const needsSecondFactor = Boolean(twoFactor?.confirmedAt);

  const expiresInMs = needsSecondFactor
    ? PENDING_SESSION_MS
    : SESSION_ABSOLUTE_MS;

  const started = await startSession({
    userId: user.id,
    scope: needsSecondFactor ? "pending_2fa" : "full",
    lifetimeMs: expiresInMs,
    req,
    address: clientAddress(req),
  });

  if (!started) throw new SessionUnavailableError();

  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name || "",
    expiresInMs,
    scope: needsSecondFactor ? "pending_2fa" : "full",
    sid: started.sessionId,
  });

  res.cookie(COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge: expiresInMs,
  });

  await record(req, {
    userId: user.id,
    // A sign-in that still owes a code is not a sign-in yet, and logging it as
    // one would make the log say someone got in when they did not.
    type: needsSecondFactor ? "sign_in_first_factor" : "sign_in_succeeded",
  });

  // Anyone still owing a code goes to /login, which reads the pending cookie
  // and asks for it. Everyone else lands in the workspace.
  return {
    needsSecondFactor,
    destination: needsSecondFactor ? "/login" : "/app",
  };
}

/**
 * Promote a half-signed-in session to a real one, with a new secret.
 *
 * Rotating rather than reusing is what stops session fixation: the value that
 * was in the browser while the second factor was outstanding — which may have
 * been planted there, or read off a shared machine — is not the value that ends
 * up authenticating anything.
 */
export async function completeSecondFactor(
  req: Request,
  res: Response,
  input: { sid: string; openId: string; name: string }
): Promise<void> {
  const rotated = await rotate({
    currentSessionId: input.sid,
    scope: "full",
    lifetimeMs: SESSION_ABSOLUTE_MS,
  });

  if (!rotated) throw new SessionUnavailableError();

  const token = await sdk.createSessionToken(input.openId, {
    name: input.name,
    expiresInMs: SESSION_ABSOLUTE_MS,
    scope: "full",
    sid: rotated.sessionId,
  });

  res.cookie(COOKIE_NAME, token, {
    ...getSessionCookieOptions(req),
    maxAge: SESSION_ABSOLUTE_MS,
  });
}

/**
 * Replace the cookie on the response with a freshly rotated session.
 *
 * Used after a password change: every other session on the account is revoked,
 * and the one in hand gets a new secret so that even a copy of this cookie
 * taken beforehand stops working. Silently does nothing when there is no live
 * session to rotate — the caller has already changed the password by then, and
 * failing at this point would report a change that did happen as one that did
 * not.
 */
export async function rotateCurrentSession(
  req: Request,
  res: Response,
  input: { sid: string; openId: string; name: string | null }
): Promise<void> {
  const rotated = await rotate({
    currentSessionId: input.sid,
    scope: "full",
    lifetimeMs: SESSION_ABSOLUTE_MS,
  });

  if (!rotated) return;

  const token = await sdk.createSessionToken(input.openId, {
    name: input.name || "",
    expiresInMs: SESSION_ABSOLUTE_MS,
    scope: "full",
    sid: rotated.sessionId,
  });

  res.cookie(COOKIE_NAME, token, {
    ...getSessionCookieOptions(req),
    maxAge: SESSION_ABSOLUTE_MS,
  });
}

/**
 * End the session this request arrived on, and clear the cookie.
 *
 * Both halves, in that order. Clearing the cookie alone was what signing out
 * used to mean: it asks the browser in front of us to forget the token and does
 * nothing whatsoever about a copy of it anywhere else. Revoking first means the
 * token is dead even if the clear is ignored, lost, or arrives at a browser
 * that is not the one holding the copy that matters.
 */
export async function endSession(
  req: Request,
  res: Response,
  reason: RevocationReason = "signed_out"
): Promise<{ userId: number | null }> {
  const session = await sdk.verifySession(sdk.readSessionCookie(req));

  if (session?.sid) {
    await revoke(session.sid, reason);
  }

  res.clearCookie(COOKIE_NAME, {
    ...getSessionCookieOptions(req),
    maxAge: -1,
  });

  if (!session) return { userId: null };

  const user = await db.getUserByOpenId(session.openId);
  return { userId: user?.id ?? null };
}

/** The sid on this request, if it carries a session cookie we minted. */
export async function currentSessionId(req: Request): Promise<string | null> {
  const session = await sdk.verifySession(sdk.readSessionCookie(req));
  return session?.sid ?? null;
}

/**
 * The row id of the session this request arrived on.
 *
 * What the session list needs in order to mark one entry "this device". It is
 * the row id rather than the sid, because the row id is the only one of the two
 * that is safe to send to a browser: it names a session without being the
 * secret that opens it.
 */
export async function currentSessionRowId(
  req: Request
): Promise<number | null> {
  const sid = await currentSessionId(req);
  if (!sid) return null;

  const row = await db.findSessionByTokenHash(sessionDigest(sid));
  return row?.id ?? null;
}
