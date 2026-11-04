/**
 * Attempt limiter.
 *
 * Six digits is a million possibilities, but a code lives for ninety seconds
 * with the drift window, so an unthrottled endpoint is guessable in a few hours
 * of steady requests. Capping attempts is not decoration; it is what makes six
 * digits enough.
 *
 * Counts are kept in the database, so they survive a restart and are shared by
 * every process serving the app. They used to live in this process's memory, which
 * meant each restart handed every address a fresh set of guesses and each extra
 * process multiplied every limit by the process count — including the five
 * guesses at a two-step code.
 *
 * Without a database there is nobody to sign in and nothing to share, so the
 * count stays in memory. The same happens for a single call if the database
 * cannot answer it (the table not migrated yet, a dropped connection): the
 * attempt is counted in memory instead and the problem is logged. A limiter
 * that threw would turn a database hiccup into nobody being able to sign in,
 * and one that let everything through would turn it into no limit at all; this
 * keeps the old per-process limit for exactly as long as the shared one is out.
 *
 * Two limiters are deliberately not shared: the per-address flood limit on every
 * API request (apiRateLimit.ts) and on WebSocket handshakes. They run before a
 * caller has been identified, so a database write per request would give an
 * anonymous flood a way to hit the database, which is what they exist to stop.
 */

import { getRateLimitRows } from "./db";
import { createLogThrottle } from "./_core/logThrottle";
import {
  MemoryStore,
  hashKey,
  sharedHit,
  sharedReset,
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitRows,
} from "./rateLimitStore";

export type { RateLimitOptions, RateLimitResult } from "./rateLimitStore";

export type RateLimiterConfig = RateLimitOptions & {
  /**
   * Names the limiter in the shared table, so two limiters given the same key
   * do not share a count. Must be unique and must not change: renaming one
   * starts every key it holds from zero.
   */
  name: string;
  /** False keeps the count in this process only. See the note above. */
  shared?: boolean;
  /** Where the shared table is found; the database unless a test says so. */
  rows?: () => Promise<RateLimitRows | null | undefined>;
};

const fallbackLog = createLogThrottle({
  limit: 1,
  windowMs: 60_000,
  onSuppressed: (_key, count) =>
    console.error(
      `[RateLimit] ${count} more attempts were counted in memory while the shared table was unavailable`
    ),
});

export class RateLimiter {
  private memory = new MemoryStore();

  constructor(private config: RateLimiterConfig) {}

  private async rows(): Promise<RateLimitRows | null> {
    if (this.config.shared === false) return null;
    return (await (this.config.rows ?? getRateLimitRows)()) ?? null;
  }

  /**
   * Count an attempt against `key`. Call before doing the work, not after — the
   * point is to refuse before spending anything on a guess.
   */
  async check(key: string, now = Date.now()): Promise<RateLimitResult> {
    try {
      const rows = await this.rows();
      if (rows) {
        return await sharedHit(
          rows,
          hashKey(this.config.name, key),
          this.config,
          now
        );
      }
    } catch (error) {
      if (fallbackLog.allow("fallback")) {
        console.error(
          `[RateLimit] Shared counts unavailable for ${this.config.name}; counting in memory`,
          error
        );
      }
    }

    return this.memory.hit(key, this.config, now);
  }

  /**
   * Forget a key's attempts. Called after a success, so someone who fumbles two
   * codes and then gets one right is not left one typo from a lockout.
   */
  async reset(key: string): Promise<void> {
    this.memory.delete(key);

    try {
      const rows = await this.rows();
      if (rows) await sharedReset(rows, hashKey(this.config.name, key));
    } catch (error) {
      if (fallbackLog.allow("fallback")) {
        console.error(
          `[RateLimit] Could not clear shared counts for ${this.config.name}`,
          error
        );
      }
    }
  }
}

/**
 * Code submissions during sign-in. Five wrong codes buys a fifteen-minute wait,
 * which leaves a brute force needing centuries and a person who mistyped one
 * digit merely trying again.
 */
export const twoFactorVerifyLimiter = new RateLimiter({
  name: "twoFactorVerifyLimiter",
  limit: 5,
  windowMs: 15 * 60 * 1000,
});

/**
 * Enrolment and disabling, for someone already signed in. Looser, because
 * getting here already required a session, and the failure mode is a person
 * scanning a QR code with a phone whose clock is off.
 */
export const twoFactorManageLimiter = new RateLimiter({
  name: "twoFactorManageLimiter",
  limit: 10,
  windowMs: 10 * 60 * 1000,
});

/**
 * AI drafting of template blanks.
 *
 * Nothing is being guessed at here, so this is not a security cap — it is a
 * spending cap. Every call is a billed LLM round trip started by one click, and
 * a held-down button or a retry loop in a flaky network would otherwise bill
 * once per attempt. Twenty in ten minutes is far more drafting than a person
 * filling in one note will do, and it puts a ceiling on what a single signed-in
 * account can cost while a runaway client is being noticed.
 */
export const aiDraftLimiter = new RateLimiter({
  name: "aiDraftLimiter",
  limit: 20,
  windowMs: 10 * 60 * 1000,
});

/**
 * The writing assistant. Looser than drafting because using it heavily is the
 * normal way to use it — summarise, adjust the tone, try another tone — but
 * still bounded, for the same reason: every press is a billed call.
 */
export const aiAssistLimiter = new RateLimiter({
  name: "aiAssistLimiter",
  limit: 60,
  windowMs: 10 * 60 * 1000,
});

/**
 * The chat assistant.
 *
 * Tighter than the writing assistant even though both are one press of a
 * button, because a chat turn is not one message: the whole conversation is
 * resent every time, so the tenth turn costs several times what the first did.
 * Thirty in ten minutes is more back-and-forth than a person has while writing
 * a note, and it bounds what a runaway client can spend before anyone notices.
 */
export const chatLimiter = new RateLimiter({
  name: "chatLimiter",
  limit: 30,
  windowMs: 10 * 60 * 1000,
});

/**
 * Voice transcription. Each call ships up to 16MB of audio to a paid service,
 * so this is the tightest of the three.
 */
export const voiceTranscribeLimiter = new RateLimiter({
  name: "voiceTranscribeLimiter",
  limit: 15,
  windowMs: 10 * 60 * 1000,
});

/**
 * Password sign-in attempts, keyed per account.
 *
 * Ten in fifteen minutes. Tighter than it looks: a password is not six digits,
 * so this is not the thing standing between an attacker and the account — the
 * hash cost is. What this stops is someone working through a credential-stuffing
 * list against one address, and it caps the memory a single account can make the
 * server spend, since each attempt costs a 64MB scrypt.
 */
export const signInLimiter = new RateLimiter({
  name: "signInLimiter",
  limit: 10,
  windowMs: 15 * 60 * 1000,
});

/**
 * Sign-in attempts from one address, whatever account they name.
 *
 * The per-account limit above does nothing against spraying one common password
 * across many accounts, because each account sees a single attempt. This is the
 * limit that notices.
 */
export const signInByOriginLimiter = new RateLimiter({
  name: "signInByOriginLimiter",
  limit: 30,
  windowMs: 15 * 60 * 1000,
});

/**
 * Registrations from one address. Low, because the cost of a registration is
 * an email someone else receives.
 */
export const registerLimiter = new RateLimiter({
  name: "registerLimiter",
  limit: 5,
  windowMs: 60 * 60 * 1000,
});

/**
 * Reset requests, per account. Keyed on the address rather than the requester,
 * so nobody can be flooded with reset email by an attacker cycling IPs.
 */
export const passwordResetLimiter = new RateLimiter({
  name: "passwordResetLimiter",
  limit: 5,
  windowMs: 60 * 60 * 1000,
});

/**
 * Whole-account exports, per account.
 *
 * Not a guess to be blocked — the caller is already signed in and asking for
 * their own data. It is a cost cap: one call reads every conversation and
 * every turn an account has, so a held-down button or a retry loop should not
 * be able to do that continuously.
 */
export const accountExportLimiter = new RateLimiter({
  name: "accountExportLimiter",
  limit: 10,
  windowMs: 10 * 60 * 1000,
});

/**
 * Attempts to delete an account, per account.
 *
 * The endpoint asks for a password or a current code, which makes it one more
 * place those can be guessed at — by someone holding a session they should not
 * have, which is exactly the case the second proof exists for. Five attempts an
 * hour is generous for a person who typed the confirmation phrase wrong and
 * nowhere near enough to guess anything.
 */
export const accountDeleteLimiter = new RateLimiter({
  name: "accountDeleteLimiter",
  limit: 5,
  windowMs: 60 * 60 * 1000,
});

/**
 * Password changes, per account.
 *
 * The endpoint asks for the current password, which makes it one more place a
 * password can be guessed at — by someone holding a session they should not
 * have, which is exactly the case asking for it exists to cover. Five an hour
 * is generous for a person who mistyped the one they use every day and nowhere
 * near enough to work through a list.
 */
export const passwordChangeLimiter = new RateLimiter({
  name: "passwordChangeLimiter",
  limit: 5,
  windowMs: 60 * 60 * 1000,
});

/**
 * Listing and revoking sessions, per account.
 *
 * Not a guess to be blocked — the caller is signed in and acting on their own
 * rows. It is a cost cap, and a small guard on the one endpoint whose whole job
 * is to sign people out: a runaway client should not be able to hammer it.
 */
export const sessionManageLimiter = new RateLimiter({
  name: "sessionManageLimiter",
  limit: 60,
  windowMs: 10 * 60 * 1000,
});

/**
 * Cloud backups. Each one is up to 20MB and the account may keep a limited
 * number (see quota.ts), so ten an hour is more than the schedule ever asks
 * for and stops a loop from turning into a bill.
 */
export const backupLimiter = new RateLimiter({
  name: "backupLimiter",
  limit: 10,
  windowMs: 60 * 60 * 1000,
});

/**
 * Inviting by email says whether an address has an account, so it is the one
 * place left that can be used to ask. Twenty an hour is plenty for sharing a
 * note and not enough to sweep a list.
 */
export const inviteLimiter = new RateLimiter({
  name: "inviteLimiter",
  limit: 20,
  windowMs: 60 * 60 * 1000,
});

/**
 * The ceiling on failed password attempts for one email from anywhere.
 * `signInLimiter` counts an email together with the address it came from, so
 * a stranger who knows the email cannot lock its owner out; this one is far
 * higher and exists only so a distributed guesser still runs out of attempts.
 */
export const signInByEmailLimiter = new RateLimiter({
  name: "signInByEmailLimiter",
  limit: 60,
  windowMs: 60 * 60 * 1000,
});
