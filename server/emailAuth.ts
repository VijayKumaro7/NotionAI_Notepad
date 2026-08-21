/**
 * Email and password sign-in.
 *
 * The rules that shape this file, in order of how much they cost to get wrong:
 *
 * 1. Nothing here tells a stranger whether an address has an account. Register,
 *    sign in and "forgot password" all answer the same way for an address that
 *    exists and one that does not — including how long they take, which is why
 *    sign-in hashes against a decoy when there is no account to check.
 * 2. An address is not proved until someone clicks the link sent to it. Until
 *    then the account cannot sign in and is never matched to any other account,
 *    so registering `someone-else@example.com` gains nothing at all.
 * 3. Tokens are single-use, expiring, and stored only as hashes. Setting a
 *    password retires every other outstanding reset link for that account.
 * 4. Sessions are minted by the same helper the OAuth callback uses, so the
 *    two-step verification gate applies identically however someone signed in.
 *    A second factor that only guards one door is not a second factor.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import * as db from "./db";
import { appUrl, isEmailConfigured, sendEmail } from "./email";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";
import {
  passwordResetLimiter,
  registerLimiter,
  signInByOriginLimiter,
  signInLimiter,
} from "./rateLimit";

export class EmailAuthError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "invalid_credentials"
      | "unverified"
      | "rate_limited"
      | "invalid_token"
      | "weak_password"
      | "unavailable"
  ) {
    super(message);
    this.name = "EmailAuthError";
  }
}

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * What sign-in says when it will not let someone in.
 *
 * One string for every cause — no such address, wrong password, an account that
 * only has Google attached. Saying which would turn the form into an oracle for
 * "does this person have an account here", which for a notes app is itself
 * worth protecting.
 */
const SIGN_IN_FAILED = "That email or password is not right.";

/**
 * A real scrypt hash of a value nobody knows, used when there is no account.
 *
 * Sign-in must take about as long whether or not the address exists; returning
 * early on "no such user" is a timing oracle that survives every other
 * precaution here. Hashing the supplied password against this makes the two
 * paths cost the same.
 */
let decoyHash: string | null = null;
async function getDecoyHash(): Promise<string> {
  if (!decoyHash) decoyHash = await hashPassword(randomBytes(32).toString("hex"));
  return decoyHash;
}

const tokenDigest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** 256 bits from the CSPRNG. Long enough that guessing is not a strategy. */
const newToken = () => randomBytes(32).toString("base64url");

export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new EmailAuthError(
      `Use at least ${MIN_PASSWORD_LENGTH} characters — length matters more than symbols.`,
      "weak_password"
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new EmailAuthError(
      `Keep it under ${MAX_PASSWORD_LENGTH} characters.`,
      "weak_password"
    );
  }
}

function limit(
  limiter: { check: (key: string) => { allowed: boolean; retryAfterMs?: number } },
  key: string
): void {
  const result = limiter.check(key);
  if (result.allowed) return;

  throw new EmailAuthError(
    `Too many attempts. Try again in ${Math.ceil((result.retryAfterMs ?? 60000) / 60000)} minutes.`,
    "rate_limited"
  );
}

/**
 * Start an account.
 *
 * Always reports the same thing. When the address is already taken the mail
 * that goes out says so to the person who owns it, rather than telling the
 * requester — which is both safer and more useful, since the common cause is
 * someone forgetting they already registered.
 */
export async function register(input: {
  email: string;
  password: string;
  name?: string;
  origin: string;
}): Promise<void> {
  assertPasswordAcceptable(input.password);
  limit(registerLimiter, `register:${input.origin}`);

  if (!isEmailConfigured()) {
    throw new EmailAuthError(
      "Email sign-up is not available on this server yet.",
      "unavailable"
    );
  }

  const email = db.normalizeEmail(input.email);
  const existing = await db.getUserByEmail(email);

  if (existing) {
    // Someone tried to take an address that is already in use. Tell the owner,
    // not the person at the keyboard.
    await sendEmail({
      to: email,
      subject: "Someone tried to sign up with your email",
      text: [
        "Somebody tried to create an account with this address.",
        "",
        "You already have one, so nothing has changed and no new account was made.",
        "If that was you, sign in instead — and use 'Forgot password' if you need to.",
        "",
        appUrl("/login"),
      ].join("\n"),
    }).catch(() => undefined);
    return;
  }

  const passwordHash = await hashPassword(input.password);
  const created = await db.insertUser({
    // Namespaced so the origin of an identity is legible, and random rather
    // than derived from the address so the identifier does not leak it.
    openId: `email:${randomUUID()}`,
    email,
    name: input.name?.trim() || null,
    passwordHash,
    loginMethod: "email",
    lastSignedIn: new Date(),
  });

  // Lost the race against a simultaneous registration for the same address.
  // The unique index decided; say nothing different.
  if (!created) return;

  await issueVerificationEmail(created.id, email);
}

async function issueVerificationEmail(userId: number, email: string): Promise<void> {
  const token = newToken();
  await db.createEmailAuthToken({
    userId,
    purpose: "verify_email",
    tokenHash: tokenDigest(token),
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });

  await sendEmail({
    to: email,
    subject: "Confirm your email",
    text: [
      "Confirm this address to finish setting up your notes account:",
      "",
      appUrl(`/verify-email?token=${encodeURIComponent(token)}`),
      "",
      "The link works once and expires in 24 hours.",
      "If you did not sign up, ignore this — no account can be used until it is confirmed.",
    ].join("\n"),
  });
}

/** Spend a verification link. Returns the user id it belonged to. */
export async function verifyEmail(token: string): Promise<number> {
  const record = await db.consumeEmailAuthToken(tokenDigest(token), "verify_email");
  if (!record) {
    throw new EmailAuthError(
      "That confirmation link is invalid or has already been used.",
      "invalid_token"
    );
  }

  await db.markEmailVerified(record.userId);
  return record.userId;
}

/**
 * Check an email and password.
 *
 * Returns the account on success. Minting the session is the caller's job, so
 * that every sign-in path goes through the same two-step gate.
 */
export async function signIn(input: {
  email: string;
  password: string;
  origin: string;
}): Promise<{ id: number; openId: string; name: string | null }> {
  limit(signInByOriginLimiter, `signin-origin:${input.origin}`);

  const email = db.normalizeEmail(input.email);
  limit(signInLimiter, `signin:${email}`);

  const user = await db.getUserByEmail(email);

  // No account, or an account with no password — a Google-only or portal user.
  // Both still pay for a hash, so the response time says nothing.
  const storedHash = user?.passwordHash ?? (await getDecoyHash());
  const ok = await verifyPassword(input.password, storedHash);

  if (!ok || !user || !user.passwordHash) {
    throw new EmailAuthError(SIGN_IN_FAILED, "invalid_credentials");
  }

  if (!user.emailVerifiedAt) {
    // Deliberately distinguishable from a wrong password, and only reachable by
    // someone who already proved they know it — so it reveals nothing they did
    // not already know, and saying "check your email" is the only useful reply.
    throw new EmailAuthError(
      "Confirm your email address first — check your inbox for the link.",
      "unverified"
    );
  }

  // The password was right, so the plaintext is in hand: the one moment a
  // stored hash made with weaker parameters can be upgraded.
  if (needsRehash(user.passwordHash)) {
    await db.setPasswordHash(user.id, await hashPassword(input.password));
  }

  signInLimiter.reset(`signin:${email}`);
  await db.touchLastSignedIn(user.id);

  return { id: user.id, openId: user.openId, name: user.name };
}

/**
 * Send a reset link, if there is anything to send it to.
 *
 * Returns nothing either way. The caller says "if that address has an account,
 * a link is on its way" whatever happened here.
 */
export async function requestPasswordReset(input: {
  email: string;
}): Promise<void> {
  const email = db.normalizeEmail(input.email);
  limit(passwordResetLimiter, `reset:${email}`);

  if (!isEmailConfigured()) return;

  const user = await db.getUserByEmail(email);
  if (!user?.passwordHash) return;

  const token = newToken();
  await db.createEmailAuthToken({
    userId: user.id,
    purpose: "reset_password",
    tokenHash: tokenDigest(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  await sendEmail({
    to: email,
    subject: "Reset your password",
    text: [
      "Use this link to set a new password:",
      "",
      appUrl(`/reset-password?token=${encodeURIComponent(token)}`),
      "",
      "The link works once and expires in an hour.",
      "If you did not ask for this, ignore it — your password has not changed.",
    ].join("\n"),
  });
}

/** Spend a reset link and set the new password. */
export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<void> {
  assertPasswordAcceptable(input.password);

  const record = await db.consumeEmailAuthToken(
    tokenDigest(input.token),
    "reset_password"
  );
  if (!record) {
    throw new EmailAuthError(
      "That reset link is invalid or has already been used.",
      "invalid_token"
    );
  }

  await db.setPasswordHash(record.userId, await hashPassword(input.password));

  // Any other reset link already sitting in an inbox stops working now.
  await db.invalidateEmailAuthTokens(record.userId, "reset_password");

  // Completing a reset proves the address receives mail, which is the same
  // thing the confirmation link proves. An account that reset its password is
  // verified whether or not it ever clicked the original link.
  await db.markEmailVerified(record.userId);
}
