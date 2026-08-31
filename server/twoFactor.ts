/**
 * Two-step verification, the part with the rules in it.
 *
 * server/totp.ts does the arithmetic; this decides who is allowed to do what.
 * It lives outside routers.ts so the procedures stay thin, and so the decisions
 * that matter — when a code counts, when to lock someone out, what a failure is
 * allowed to reveal — are in one file rather than scattered across a router.
 *
 * The shape of the flow:
 *
 *   setup    → a secret exists but is unconfirmed. Sign-in is unaffected.
 *   enable   → a code proves the secret made it onto a phone. Now sign-in asks.
 *   verify   → at sign-in, a code or a recovery code clears the second factor.
 *   disable  → needs a current code, so a stolen session cannot switch it off.
 *
 * The gap between setup and enable is the point. Storing a secret is not the
 * same as being able to generate codes from it, and treating them as the same
 * locks people out of their own accounts when a QR code fails to scan.
 */

import * as db from "./db";
import { twoFactorManageLimiter, twoFactorVerifyLimiter } from "./rateLimit";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from "./totp";

export const ISSUER = "Notepad AI";

export class TwoFactorError extends Error {
  constructor(
    message: string,
    readonly reason:
      "not_enrolled" | "already_enabled" | "invalid_code" | "rate_limited",
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "TwoFactorError";
  }
}

export type TwoFactorStatus = {
  enabled: boolean;
  /** A secret exists but no code has proved it yet. */
  pendingSetup: boolean;
  recoveryCodesRemaining: number;
};

export async function getStatus(userId: number): Promise<TwoFactorStatus> {
  const record = await db.getTwoFactor(userId);

  if (!record) {
    return { enabled: false, pendingSetup: false, recoveryCodesRemaining: 0 };
  }

  const enabled = record.confirmedAt !== null;

  return {
    enabled,
    pendingSetup: !enabled,
    recoveryCodesRemaining: enabled
      ? await db.countUnusedRecoveryCodes(userId)
      : 0,
  };
}

/**
 * Hand out a secret to scan.
 *
 * Refuses when two-step verification is already on: the way to change the
 * secret is to disable it first, which requires a current code. Otherwise a
 * session someone else had hold of could quietly swap the second factor for
 * their own.
 */
export async function beginEnrollment(user: {
  id: number;
  email: string | null;
  name: string | null;
}): Promise<{ secret: string; otpauthUrl: string }> {
  const existing = await db.getTwoFactor(user.id);
  if (existing?.confirmedAt) {
    throw new TwoFactorError(
      "Two-step verification is already on. Turn it off first to set up a new device.",
      "already_enabled"
    );
  }

  const secret = generateSecret();
  await db.upsertTwoFactorSecret(user.id, encryptSecret(secret));

  return {
    secret,
    otpauthUrl: otpauthUrl({
      secret,
      account: user.email || user.name || `user-${user.id}`,
      issuer: ISSUER,
    }),
  };
}

/**
 * Confirm the secret arrived, switch it on, and issue recovery codes.
 *
 * The codes are returned here and nowhere else — only their hashes are stored,
 * so this is genuinely the one chance to write them down.
 */
export async function completeEnrollment(
  userId: number,
  code: string
): Promise<{ recoveryCodes: string[] }> {
  limitManagement(userId);

  const record = await db.getTwoFactor(userId);
  if (!record) {
    throw new TwoFactorError(
      "Start the setup again — there is no secret to confirm.",
      "not_enrolled"
    );
  }
  if (record.confirmedAt) {
    throw new TwoFactorError(
      "Two-step verification is already on.",
      "already_enabled"
    );
  }

  const result = verifyTotp(decryptSecret(record.secret), code, {
    lastUsedStep: record.lastUsedStep,
  });
  if (!result.valid) {
    throw new TwoFactorError(
      "That code is not right. Check your authenticator app and try again.",
      "invalid_code"
    );
  }

  await db.confirmTwoFactor(userId, result.step);
  twoFactorManageLimiter.reset(manageKey(userId));

  return { recoveryCodes: await issueRecoveryCodes(userId) };
}

/**
 * The check at sign-in. Accepts a TOTP code or a recovery code.
 *
 * Returns quietly on failure rather than saying which of the two was wrong.
 * "That is not a valid recovery code" would confirm to someone holding a
 * captured code that the account has recovery codes left to guess at.
 */
export async function verifySecondFactor(
  userId: number,
  code: string
): Promise<{ usedRecoveryCode: boolean }> {
  limitVerification(userId);

  const record = await db.getTwoFactor(userId);
  if (!record?.confirmedAt) {
    throw new TwoFactorError(
      "Two-step verification is not set up for this account.",
      "not_enrolled"
    );
  }

  const totpResult = verifyTotp(decryptSecret(record.secret), code, {
    lastUsedStep: record.lastUsedStep,
  });

  if (totpResult.valid) {
    // Claiming the step is the check, not a note taken afterwards. The claim is
    // a conditional UPDATE, so if two requests arrive carrying the same code
    // exactly one of them can win it; the loser is told the code is wrong,
    // which by then it is.
    const claimed = await db.claimTwoFactorStep(userId, totpResult.step);
    if (!claimed) {
      throw new TwoFactorError(
        "That code is not right. Try again, or use a recovery code.",
        "invalid_code"
      );
    }

    twoFactorVerifyLimiter.reset(verifyKey(userId));
    return { usedRecoveryCode: false };
  }

  const normalized = normalizeRecoveryCode(code);
  if (normalized.length === 10) {
    const consumed = await db.consumeRecoveryCode(
      userId,
      hashRecoveryCode(code)
    );
    if (consumed) {
      twoFactorVerifyLimiter.reset(verifyKey(userId));
      return { usedRecoveryCode: true };
    }
  }

  throw new TwoFactorError(
    "That code is not right. Try again, or use a recovery code.",
    "invalid_code"
  );
}

/**
 * Turn it off. Requires a current code — a session alone is not enough, because
 * a session alone is exactly what an attacker who got past the first factor
 * would have.
 */
export async function disable(userId: number, code: string): Promise<void> {
  limitManagement(userId);
  await requireCurrentCode(userId, code);
  await db.disableTwoFactor(userId);
  twoFactorManageLimiter.reset(manageKey(userId));
}

/** Replace the recovery codes, invalidating whatever was issued before. */
export async function regenerateRecoveryCodes(
  userId: number,
  code: string
): Promise<{ recoveryCodes: string[] }> {
  limitManagement(userId);
  await requireCurrentCode(userId, code);
  twoFactorManageLimiter.reset(manageKey(userId));

  return { recoveryCodes: await issueRecoveryCodes(userId) };
}

async function requireCurrentCode(userId: number, code: string): Promise<void> {
  const record = await db.getTwoFactor(userId);
  if (!record?.confirmedAt) {
    throw new TwoFactorError(
      "Two-step verification is not on for this account.",
      "not_enrolled"
    );
  }

  const result = verifyTotp(decryptSecret(record.secret), code, {
    lastUsedStep: record.lastUsedStep,
  });

  if (result.valid) {
    // Same conditional claim as the sign-in path: a code that another request
    // already spent must not also authorise this one.
    if (await db.claimTwoFactorStep(userId, result.step)) return;
    throw new TwoFactorError("That code is not right.", "invalid_code");
  }

  const normalized = normalizeRecoveryCode(code);
  if (normalized.length === 10) {
    const consumed = await db.consumeRecoveryCode(
      userId,
      hashRecoveryCode(code)
    );
    if (consumed) return;
  }

  throw new TwoFactorError("That code is not right.", "invalid_code");
}

async function issueRecoveryCodes(userId: number): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await db.replaceRecoveryCodes(userId, codes.map(hashRecoveryCode));
  return codes;
}

const verifyKey = (userId: number) => `2fa-verify:${userId}`;
const manageKey = (userId: number) => `2fa-manage:${userId}`;

function limitVerification(userId: number): void {
  const result = twoFactorVerifyLimiter.check(verifyKey(userId));
  if (result.allowed) return;

  throw new TwoFactorError(
    `Too many attempts. Try again in ${Math.ceil(result.retryAfterMs / 60000)} minutes.`,
    "rate_limited",
    result.retryAfterMs
  );
}

function limitManagement(userId: number): void {
  const result = twoFactorManageLimiter.check(manageKey(userId));
  if (result.allowed) return;

  throw new TwoFactorError(
    `Too many attempts. Try again in ${Math.ceil(result.retryAfterMs / 60000)} minutes.`,
    "rate_limited",
    result.retryAfterMs
  );
}
