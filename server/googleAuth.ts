/**
 * Sign in with Google, via OpenID Connect.
 *
 * The ID token is verified here rather than trusted. Google returns a signed
 * JWT from the token endpoint; `jose` (already a dependency, used for our own
 * sessions) checks its signature against Google's published keys and its
 * issuer, audience and expiry. Decoding the payload without verifying — which
 * is the common shortcut, because the payload is right there — accepts any JWT
 * anyone cares to send.
 *
 * Three separate values guard the round trip, and they guard different things:
 *
 *   state     ties the callback to the browser that started it. Without it,
 *             anyone can feed a victim a callback URL and sign them into the
 *             attacker's account — login CSRF.
 *   PKCE      ties the code to the client that requested it. An authorization
 *             code intercepted in a redirect or a log is useless without the
 *             verifier, which never leaves this server.
 *   nonce     ties the ID token to this request. It stops a token minted for
 *             some other session being replayed into this one.
 *
 * All three live in a short-lived signed cookie rather than server memory, so
 * the flow survives a restart and works with more than one instance.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";
import { ENV } from "./_core/env";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

/** The whole round trip should take a person seconds, not hours. */
export const FLOW_TTL_MS = 10 * 60 * 1000;

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_configured"
      | "bad_state"
      | "exchange_failed"
      | "bad_token"
      | "unverified_email"
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export function isGoogleConfigured(): boolean {
  return Boolean(
    ENV.googleClientId && ENV.googleClientSecret && ENV.publicOrigin
  );
}

function assertConfigured(): void {
  if (!isGoogleConfigured()) {
    throw new GoogleAuthError(
      "Google sign-in is not configured on this server.",
      "not_configured"
    );
  }
}

/**
 * Fixed, and derived from PUBLIC_ORIGIN rather than the request.
 *
 * Google requires an exact match against the console's registered list, which
 * is a real defence — but only if we send the same value every time. Building
 * it from a Host header would mean sending whatever an attacker put there.
 */
export function redirectUri(): string {
  return new URL("/api/auth/google/callback", ENV.publicOrigin).toString();
}

// Cached across calls: jose refetches on key rotation by itself, and building a
// new set per sign-in would fetch Google's keys on every attempt.
const googleKeys = createRemoteJWKSet(GOOGLE_JWKS_URL);

const base64url = (buffer: Buffer) => buffer.toString("base64url");

export type FlowSecrets = {
  state: string;
  nonce: string;
  codeVerifier: string;
};

export function createFlowSecrets(): FlowSecrets {
  return {
    state: base64url(randomBytes(32)),
    nonce: base64url(randomBytes(32)),
    // RFC 7636 allows 43-128 characters; 32 random bytes base64url is 43.
    codeVerifier: base64url(randomBytes(32)),
  };
}

/** S256, never `plain` — a plain verifier in the URL protects nothing. */
export function codeChallenge(codeVerifier: string): string {
  return base64url(createHash("sha256").update(codeVerifier).digest());
}

/**
 * Seal the flow secrets into a short-lived JWT for the browser to hold.
 *
 * Signed with the same secret as sessions, but it is not a session: it carries
 * no identity, only the three values the callback has to compare against.
 */
export async function sealFlow(
  secrets: FlowSecrets,
  key: Uint8Array
): Promise<string> {
  return new SignJWT({ ...secrets })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor((Date.now() + FLOW_TTL_MS) / 1000))
    .sign(key);
}

export async function openFlow(
  sealed: string | undefined,
  key: Uint8Array
): Promise<FlowSecrets> {
  if (!sealed) {
    throw new GoogleAuthError("Sign-in did not start here.", "bad_state");
  }

  try {
    const { payload } = await jwtVerify(sealed, key, { algorithms: ["HS256"] });
    const { state, nonce, codeVerifier } = payload as Record<string, unknown>;

    if (
      typeof state !== "string" ||
      typeof nonce !== "string" ||
      typeof codeVerifier !== "string"
    ) {
      throw new Error("missing fields");
    }

    return { state, nonce, codeVerifier };
  } catch {
    throw new GoogleAuthError(
      "That sign-in attempt expired. Try again.",
      "bad_state"
    );
  }
}

/**
 * Signing key for the flow cookie.
 *
 * The same JWT_SECRET the session cookie uses, derived the same way. Not a
 * shortcut: rotating that secret should invalidate half-finished sign-ins for
 * exactly the reason it invalidates sessions, and a second secret would be a
 * second thing to configure and forget.
 */
export function flowSecret(): Uint8Array {
  if (!ENV.cookieSecret) {
    throw new GoogleAuthError(
      "JWT_SECRET is not set, so the sign-in flow cannot be signed.",
      "not_configured"
    );
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

/** Constant-time, and length-safe: timingSafeEqual throws on a length mismatch. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authorizeUrl(secrets: FlowSecrets): string {
  assertConfigured();

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", ENV.googleClientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", secrets.state);
  url.searchParams.set("nonce", secrets.nonce);
  url.searchParams.set("code_challenge", codeChallenge(secrets.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  // Ask for an account each time rather than silently reusing whichever one the
  // browser is already signed into.
  url.searchParams.set("prompt", "select_account");

  return url.toString();
}

export type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

/**
 * Trade the code for an ID token and check it.
 *
 * Everything the caller gets back has been verified: signature against Google's
 * keys, issuer, audience, expiry, and the nonce this flow generated.
 */
export async function exchangeCode(input: {
  code: string;
  codeVerifier: string;
  nonce: string;
}): Promise<GoogleIdentity> {
  assertConfigured();

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: ENV.googleClientId,
        client_secret: ENV.googleClientSecret,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
        code_verifier: input.codeVerifier,
      }),
    });
  } catch (error) {
    throw new GoogleAuthError(
      `Could not reach Google: ${String(error)}`,
      "exchange_failed"
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GoogleAuthError(
      `Google refused the code exchange: ${response.status} ${detail}`.trim(),
      "exchange_failed"
    );
  }

  const body = (await response.json().catch(() => null)) as {
    id_token?: unknown;
  } | null;

  if (!body || typeof body.id_token !== "string") {
    throw new GoogleAuthError("Google returned no ID token.", "bad_token");
  }

  return verifyIdToken(body.id_token, input.nonce);
}

export async function verifyIdToken(
  idToken: string,
  expectedNonce: string
): Promise<GoogleIdentity> {
  let payload: Record<string, unknown>;
  try {
    // jwtVerify checks the signature against Google's published keys and
    // enforces issuer, audience and expiry. Reading the payload without this is
    // the same as trusting whatever was posted to the callback.
    const verified = await jwtVerify(idToken, googleKeys, {
      issuer: GOOGLE_ISSUERS,
      audience: ENV.googleClientId,
      algorithms: ["RS256"],
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (error) {
    throw new GoogleAuthError(
      `Google's ID token did not verify: ${String(error)}`,
      "bad_token"
    );
  }

  if (
    typeof payload.nonce !== "string" ||
    !sameSecret(payload.nonce, expectedNonce)
  ) {
    throw new GoogleAuthError(
      "That sign-in response does not match the request.",
      "bad_token"
    );
  }

  const sub = payload.sub;
  const email = payload.email;
  if (typeof sub !== "string" || !sub || typeof email !== "string" || !email) {
    throw new GoogleAuthError(
      "Google's ID token was missing fields.",
      "bad_token"
    );
  }

  // Google will happily assert an address it has not verified. Treating one as
  // proof of ownership would let someone attach an arbitrary address to their
  // Google account and inherit whatever it matches here.
  const emailVerified = payload.email_verified === true;
  if (!emailVerified) {
    throw new GoogleAuthError(
      "Google has not verified that email address.",
      "unverified_email"
    );
  }

  return {
    sub,
    email: email.toLowerCase(),
    emailVerified,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

/**
 * Find or make the account behind a verified Google identity.
 *
 * The linking rules, which are the part with teeth:
 *
 * - Matched on `sub` first. It is the only identifier Google promises is
 *   stable; an address can be changed or, on a workspace domain, handed to a
 *   different person entirely. Matching on email alone lets a recycled address
 *   inherit someone else's notes.
 * - An address that both sides have verified is the same person, so the Google
 *   identity is attached to the existing account.
 * - An address the local account never verified belongs to whoever just proved
 *   it. The account is claimed and its unproven password cleared — see
 *   db.claimAccountForGoogle for why leaving it would be the takeover.
 */
export async function resolveGoogleAccount(
  identity: GoogleIdentity,
  store: {
    getUserByGoogleSub: (
      sub: string
    ) => Promise<{ id: number; openId: string; name: string | null } | null>;
    getUserByEmail: (email: string) => Promise<{
      id: number;
      openId: string;
      name: string | null;
      emailVerifiedAt: Date | null;
    } | null>;
    linkGoogleSub: (userId: number, sub: string) => Promise<boolean>;
    claimAccountForGoogle: (userId: number, sub: string) => Promise<boolean>;
    insertUser: (user: {
      openId: string;
      googleSub: string;
      email: string;
      name: string | null;
      emailVerifiedAt: Date;
      loginMethod: string;
      lastSignedIn: Date;
    }) => Promise<{ id: number; openId: string; name: string | null } | null>;
    touchLastSignedIn: (userId: number) => Promise<void>;
  }
): Promise<{ id: number; openId: string; name: string | null }> {
  const bySub = await store.getUserByGoogleSub(identity.sub);
  if (bySub) {
    await store.touchLastSignedIn(bySub.id);
    return bySub;
  }

  const byEmail = await store.getUserByEmail(identity.email);
  if (byEmail) {
    // Both of these are conditional updates — they only apply when the account
    // has no Google identity attached yet — and both report whether they did.
    //
    // Discarding that answer is the bug this guard exists for. An account can
    // already carry a *different* sub: an address that moved between Google
    // accounts, or a workspace address reassigned to a new person. The update
    // then does nothing, and signing in anyway would hand the second identity
    // the first one's notes. Refusing is the only safe reading of "the account
    // is already spoken for".
    const attached = byEmail.emailVerifiedAt
      ? await store.linkGoogleSub(byEmail.id, identity.sub)
      : await store.claimAccountForGoogle(byEmail.id, identity.sub);

    if (!attached) {
      throw new GoogleAuthError(
        "That email is already linked to a different Google account.",
        "bad_state"
      );
    }

    await store.touchLastSignedIn(byEmail.id);
    return byEmail;
  }

  const created = await store.insertUser({
    openId: `google:${identity.sub}`,
    googleSub: identity.sub,
    email: identity.email,
    name: identity.name,
    emailVerifiedAt: new Date(),
    loginMethod: "google",
    lastSignedIn: new Date(),
  });

  if (!created) {
    // Lost a race with a simultaneous first sign-in for this identity; the
    // unique index refused the row, so read back the winner.
    const winner =
      (await store.getUserByGoogleSub(identity.sub)) ??
      (await store.getUserByEmail(identity.email));
    if (!winner) {
      throw new GoogleAuthError(
        "Could not create the account.",
        "exchange_failed"
      );
    }
    return winner;
  }

  return created;
}
