/**
 * In-memory attempt limiter.
 *
 * Six digits is a million possibilities, but a code lives for ninety seconds
 * with the drift window, so an unthrottled endpoint is guessable in a few hours
 * of steady requests. Capping attempts is not decoration; it is what makes six
 * digits enough.
 *
 * The counters live in this process. On one instance that is exactly right; run
 * several behind a load balancer and each keeps its own tally, so the effective
 * limit multiplies by the instance count. That is a real limit worth knowing
 * about rather than a bug — moving to Redis is the fix if this ever runs on more
 * than one box, and this module is small enough to swap out when that day comes.
 */

type Bucket = {
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

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private options: RateLimitOptions) {}

  /**
   * Count an attempt against `key`. Call before doing the work, not after — the
   * point is to refuse before spending anything on a guess.
   */
  check(key: string, now = Date.now()): RateLimitResult {
    this.evictExpired(now);

    const bucket = this.buckets.get(key);

    // The lockout is checked before the window, and the order matters. A
    // lockout is deliberately longer than the window it came from, so testing
    // the window first would hand out a clean bucket partway through the
    // lockout and undo it entirely.
    if (bucket && bucket.lockedUntil > now) {
      return { allowed: false, retryAfterMs: bucket.lockedUntil - now };
    }

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + this.options.windowMs,
        lockedUntil: 0,
      });
      return { allowed: true, remaining: this.options.limit - 1 };
    }

    if (bucket.count >= this.options.limit) {
      bucket.lockedUntil =
        now + (this.options.lockoutMs ?? this.options.windowMs);
      return { allowed: false, retryAfterMs: bucket.lockedUntil - now };
    }

    bucket.count += 1;
    return { allowed: true, remaining: this.options.limit - bucket.count };
  }

  /**
   * Forget a key's attempts. Called after a success, so someone who fumbles two
   * codes and then gets one right is not left one typo from a lockout.
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Drop finished buckets. Without this the map grows with every distinct key
   * seen, which on a public endpoint is every address that ever tried.
   */
  private evictExpired(now: number): void {
    for (const [key, bucket] of Array.from(this.buckets.entries())) {
      if (now >= bucket.resetAt && now >= bucket.lockedUntil) {
        this.buckets.delete(key);
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
  limit: 5,
  windowMs: 15 * 60 * 1000,
});

/**
 * Enrolment and disabling, for someone already signed in. Looser, because
 * getting here already required a session, and the failure mode is a person
 * scanning a QR code with a phone whose clock is off.
 */
export const twoFactorManageLimiter = new RateLimiter({
  limit: 10,
  windowMs: 10 * 60 * 1000,
});
