/**
 * Where a limiter keeps its counts, and the one rule for what a count means.
 *
 * `decide` is the whole policy — window, lockout, remaining — as a pure function
 * of a bucket and the clock. Both stores below call it, so a count held in this
 * process's memory and a count held in the database cannot disagree about what
 * a count means. Only where the bucket lives differs.
 */

import { createHash, createHmac, hkdfSync } from "crypto";

export type Bucket = {
  count: number;
  /** When the current window ends. */
  resetAt: number;
  /** Set once the cap is hit; attempts are refused until this passes. */
  lockedUntil: number;
};

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number };

export type RateLimitOptions = {
  /** Attempts permitted per window. */
  limit: number;
  /** Window length. */
  windowMs: number;
  /** How long to refuse everything once the cap is hit. Defaults to windowMs. */
  lockoutMs?: number;
};

/** What a key that has never been seen looks like. */
export const EMPTY_BUCKET: Bucket = { count: 0, resetAt: 0, lockedUntil: 0 };

/**
 * Count one attempt. Returns the answer and the bucket to keep.
 *
 * The lockout is checked before the window, and the order matters. A lockout is
 * deliberately longer than the window it came from, so testing the window first
 * would hand out a clean bucket partway through the lockout and undo it
 * entirely.
 */
export function decide(
  bucket: Bucket | undefined,
  options: RateLimitOptions,
  now: number
): { result: RateLimitResult; bucket: Bucket } {
  const current = bucket ?? EMPTY_BUCKET;

  if (current.lockedUntil > now) {
    return {
      result: { allowed: false, retryAfterMs: current.lockedUntil - now },
      bucket: current,
    };
  }

  if (now >= current.resetAt) {
    return {
      result: { allowed: true, remaining: options.limit - 1 },
      bucket: { count: 1, resetAt: now + options.windowMs, lockedUntil: 0 },
    };
  }

  if (current.count >= options.limit) {
    const lockedUntil = now + (options.lockoutMs ?? options.windowMs);
    return {
      result: { allowed: false, retryAfterMs: lockedUntil - now },
      bucket: { ...current, lockedUntil },
    };
  }

  const count = current.count + 1;
  return {
    result: { allowed: true, remaining: options.limit - count },
    bucket: { ...current, count },
  };
}

/** True once a bucket can no longer affect any answer. */
export const isFinished = (bucket: Bucket, now: number) =>
  now >= bucket.resetAt && now >= bucket.lockedUntil;

/* -------------------------------------------------------------------------- *
 * This process's memory
 * -------------------------------------------------------------------------- */

export class MemoryStore {
  private buckets = new Map<string, Bucket>();

  hit(key: string, options: RateLimitOptions, now: number): RateLimitResult {
    this.evictExpired(now);

    const { result, bucket } = decide(this.buckets.get(key), options, now);
    this.buckets.set(key, bucket);
    return result;
  }

  delete(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Drop finished buckets. Without this the map grows with every distinct key
   * seen, which on a public endpoint is every address that ever tried.
   */
  private evictExpired(now: number): void {
    for (const [key, bucket] of Array.from(this.buckets.entries())) {
      if (isFinished(bucket, now)) this.buckets.delete(key);
    }
  }
}

/* -------------------------------------------------------------------------- *
 * Shared storage
 * -------------------------------------------------------------------------- */

/** One row, locked for the length of a transaction. */
export interface RateLimitTx {
  /** The row for this key, created empty if it is not there, and locked. */
  lock(keyHash: string): Promise<Bucket>;
  save(keyHash: string, bucket: Bucket): Promise<void>;
  remove(keyHash: string): Promise<void>;
}

export interface RateLimitRows {
  transact<T>(work: (tx: RateLimitTx) => Promise<T>): Promise<T>;
}

/**
 * Count an attempt against the shared table.
 *
 * Read, decide and write happen under one row lock, so two processes counting
 * the same key at once take turns instead of both reading "9 of 10" and both
 * being let through.
 */
export function sharedHit(
  rows: RateLimitRows,
  keyHash: string,
  options: RateLimitOptions,
  now: number
): Promise<RateLimitResult> {
  return rows.transact(async tx => {
    const { result, bucket } = decide(await tx.lock(keyHash), options, now);
    await tx.save(keyHash, bucket);
    return result;
  });
}

export function sharedReset(
  rows: RateLimitRows,
  keyHash: string
): Promise<void> {
  return rows.transact(tx => tx.remove(keyHash));
}

/**
 * What goes in the table instead of the key.
 *
 * Keys name an email address or a client address, and a table of those is a
 * list of who has been trying to sign in to what. A keyed hash keeps the table
 * useful (the same key finds the same row) without it being readable. The limiter's
 * name is part of the input, so two limiters that happen to be handed the same
 * key do not share a count.
 */
export function hashKey(name: string, key: string): string {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret) {
    return createHash("sha256").update(`${name}\0${key}`).digest("hex");
  }

  const derived = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.alloc(0),
      "rate-limit-key",
      32
    )
  );
  return createHmac("sha256", derived).update(`${name}\0${key}`).digest("hex");
}
