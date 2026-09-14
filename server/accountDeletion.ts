/**
 * Deleting an account, and what it takes to be allowed to.
 *
 * The rules live here rather than in routers.ts for the same reason the
 * two-step verification rules do: the decisions that matter — what counts as
 * proof, what order things are erased in, what a half-finished deletion leaves
 * behind — are worth reading in one place.
 *
 * Two things are asked for, and they answer different questions:
 *
 *   the phrase   → did you mean this? It is typed out, so a stray click cannot
 *                  produce it, and it is checked first so a typo costs nothing
 *                  but a retry.
 *   the proof    → are you still the person whose account this is? A session
 *                  alone is not, because a stolen session is precisely what
 *                  the strongest thing on the account is there to outrank.
 *
 * What the proof is depends on what the account actually has. Asking a Google
 * user for a password they never set is not security, it is a locked door with
 * no key — so the rule is "the strongest factor this account has", and for an
 * account whose only factor is the session, the session is what is asked.
 */

import { CONFIRMATION_PHRASE, matchesConfirmation } from "@shared/account";
import * as db from "./db";
import { accountDeleteLimiter } from "./rateLimit";
import { verifyPassword } from "./password";
import * as backups from "./storage";
import * as twoFactor from "./twoFactor";

export { CONFIRMATION_PHRASE, matchesConfirmation };

export type DeletionProof = "two_factor_code" | "password" | "session";

export class AccountDeletionError extends Error {
  constructor(
    message: string,
    readonly reason:
      "not_confirmed" | "invalid_password" | "rate_limited" | "unavailable",
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

export type DeletionSummary = {
  notes: number;
  conversations: number;
  backups: number;
};

/**
 * What this account will be asked for, so the dialog can ask for it up front
 * rather than refusing once and then explaining.
 */
export async function requiredProof(user: {
  id: number;
  passwordHash: string | null;
}): Promise<DeletionProof> {
  const status = await twoFactor.getStatus(user.id);
  if (status.enabled) return "two_factor_code";
  if (user.passwordHash) return "password";
  return "session";
}

/**
 * Erase the account.
 *
 * Order is deliberate. The backups go first: they live in S3 under a key
 * prefixed with the user id, and the only thing that can name them afterwards
 * is the row that is about to be deleted. A failure there stops the deletion
 * and can be retried; the other order would leave objects nobody can reach and
 * nobody can remove.
 *
 * Note what this does not claim to do. The data is gone, but the identity is
 * not banned — signing in again with the same Google account or the same
 * address creates a new, empty account, exactly as signing up afresh would.
 * Nothing deleted comes back with it.
 */
export async function deleteAccount(
  user: { id: number; passwordHash: string | null },
  input: { confirmation: string; code?: string; password?: string }
): Promise<DeletionSummary> {
  // Before the limiter, not after: the phrase is printed on the screen next to
  // the box it goes in, so there is nothing to guess and nothing to protect.
  // Counting typos against the cap would only lock someone out of deleting
  // their own account for an hour.
  if (!matchesConfirmation(input.confirmation)) {
    throw new AccountDeletionError(
      `Type "${CONFIRMATION_PHRASE}" to confirm.`,
      "not_confirmed"
    );
  }

  limit(user.id);

  const proof = await requiredProof(user);

  if (proof === "two_factor_code") {
    // Throws TwoFactorError, which already says the right thing about a wrong
    // code and about being locked out. Rewrapping it would lose the difference.
    await twoFactor.verifySecondFactor(user.id, input.code ?? "");
  } else if (proof === "password") {
    const ok = await verifyPassword(
      input.password ?? "",
      user.passwordHash ?? ""
    );
    if (!ok) {
      throw new AccountDeletionError(
        "That password is not right.",
        "invalid_password"
      );
    }
  }

  const backupsDeleted = await backups.deleteAllBackups(user.id);

  const erased = await db.deleteAccountData(user.id);
  if (!erased) {
    throw new AccountDeletionError(
      "The account store is unavailable, so nothing was deleted. Try again shortly.",
      "unavailable"
    );
  }

  accountDeleteLimiter.reset(key(user.id));

  return { ...erased, backups: backupsDeleted };
}

const key = (userId: number) => `account-delete:${userId}`;

function limit(userId: number): void {
  const result = accountDeleteLimiter.check(key(userId));
  if (!result.allowed) {
    throw new AccountDeletionError(
      "Too many attempts. Try again later.",
      "rate_limited",
      result.retryAfterMs
    );
  }
}
