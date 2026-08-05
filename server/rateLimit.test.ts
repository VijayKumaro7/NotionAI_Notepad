import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rateLimit";

const options = { limit: 3, windowMs: 1000, lockoutMs: 5000 };

describe("RateLimiter", () => {
  it("allows attempts up to the limit and counts down what is left", () => {
    const limiter = new RateLimiter(options);

    expect(limiter.check("a", 0)).toEqual({ allowed: true, remaining: 2 });
    expect(limiter.check("a", 10)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.check("a", 20)).toEqual({ allowed: true, remaining: 0 });
  });

  it("locks out once the limit is hit", () => {
    const limiter = new RateLimiter(options);
    for (let i = 0; i < 3; i++) limiter.check("a", i);

    const result = limiter.check("a", 100);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.retryAfterMs).toBe(5000);
  });

  it("keeps refusing during the lockout, and the lockout does not extend itself", () => {
    const limiter = new RateLimiter(options);
    for (let i = 0; i < 3; i++) limiter.check("a", i);
    limiter.check("a", 100);

    // A locked-out attacker hammering the endpoint must not push their own
    // release further out — but neither should the wait shrink.
    const later = limiter.check("a", 4000);
    expect(later.allowed).toBe(false);
    expect(later.allowed === false && later.retryAfterMs).toBe(1100);
  });

  it("allows attempts again once the lockout passes", () => {
    const limiter = new RateLimiter(options);
    for (let i = 0; i < 3; i++) limiter.check("a", i);
    limiter.check("a", 100);

    expect(limiter.check("a", 6000).allowed).toBe(true);
  });

  it("starts a fresh window once the old one has elapsed", () => {
    const limiter = new RateLimiter(options);
    limiter.check("a", 0);
    limiter.check("a", 10);

    expect(limiter.check("a", 2000)).toEqual({ allowed: true, remaining: 2 });
  });

  it("tracks keys independently, so one person cannot lock out another", () => {
    const limiter = new RateLimiter(options);
    for (let i = 0; i < 4; i++) limiter.check("a", i);

    expect(limiter.check("b", 100).allowed).toBe(true);
  });

  it("clears a key's attempts on reset, so a success wipes earlier fumbles", () => {
    const limiter = new RateLimiter(options);
    limiter.check("a", 0);
    limiter.check("a", 10);
    limiter.reset("a");

    expect(limiter.check("a", 20)).toEqual({ allowed: true, remaining: 2 });
  });

  it("does not grow without bound as keys go quiet", () => {
    const limiter = new RateLimiter(options);
    for (let i = 0; i < 500; i++) limiter.check(`visitor-${i}`, i);

    // One call well past every window sweeps the finished buckets. Reaching
    // into the private map is the only way to observe this, and the leak it
    // guards against is the reason the sweep exists.
    limiter.check("later", 100_000);
    expect(
      (limiter as unknown as { buckets: Map<string, unknown> }).buckets.size
    ).toBe(1);
  });

  it("keeps locked-out buckets through the sweep", () => {
    const limiter = new RateLimiter(options);
    for (let i = 0; i < 3; i++) limiter.check("a", i);
    limiter.check("a", 100);

    // The window has passed but the lockout has not. Evicting here would hand
    // the attacker a clean slate — the sweep must not become the bypass.
    limiter.check("unrelated", 2000);
    expect(limiter.check("a", 2000).allowed).toBe(false);
  });
});
