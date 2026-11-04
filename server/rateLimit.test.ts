import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./rateLimit";
import type { Bucket, RateLimitRows } from "./rateLimitStore";

const options = { limit: 3, windowMs: 1000, lockoutMs: 5000 };

/**
 * The shared table, with one difference from MySQL that does not matter here:
 * transactions take turns as a whole instead of locking a row. That is the
 * property the real one provides for a single key, which is all these tests
 * rely on.
 */
function fakeTable() {
  const rows = new Map<string, Bucket>();
  let tail: Promise<unknown> = Promise.resolve();
  let transactions = 0;

  const table: RateLimitRows = {
    transact(work) {
      transactions += 1;
      const run = tail.then(async () => {
        // A yield between read and write is what makes two unserialised
        // callers read the same count.
        const result = await work({
          async lock(keyHash) {
            await Promise.resolve();
            return {
              ...(rows.get(keyHash) ?? {
                count: 0,
                resetAt: 0,
                lockedUntil: 0,
              }),
            };
          },
          async save(keyHash, bucket) {
            await Promise.resolve();
            rows.set(keyHash, { ...bucket });
          },
          async remove(keyHash) {
            rows.delete(keyHash);
          },
        });
        return result;
      });
      tail = run.catch(() => undefined);
      return run as never;
    },
  };

  return { table, rows, transactions: () => transactions };
}

const memory = () => new RateLimiter({ name: "t", ...options, shared: false });

const inTable = (table: RateLimitRows, name = "t") =>
  new RateLimiter({ name, ...options, rows: async () => table });

// The same behaviour, whichever store holds the count.
describe.each([
  ["in this process's memory", () => memory()],
  ["in the shared table", () => inTable(fakeTable().table)],
])("RateLimiter, counted %s", (_where, make) => {
  it("allows attempts up to the limit and counts down what is left", async () => {
    const limiter = make();

    expect(await limiter.check("a", 0)).toEqual({
      allowed: true,
      remaining: 2,
    });
    expect(await limiter.check("a", 10)).toEqual({
      allowed: true,
      remaining: 1,
    });
    expect(await limiter.check("a", 20)).toEqual({
      allowed: true,
      remaining: 0,
    });
  });

  it("locks out once the limit is hit", async () => {
    const limiter = make();
    for (let i = 0; i < 3; i++) await limiter.check("a", i);

    const result = await limiter.check("a", 100);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.retryAfterMs).toBe(5000);
  });

  it("keeps refusing during the lockout, and the lockout does not extend itself", async () => {
    const limiter = make();
    for (let i = 0; i < 3; i++) await limiter.check("a", i);
    await limiter.check("a", 100);

    // A locked-out attacker hammering the endpoint must not push their own
    // release further out — but neither should the wait shrink.
    const later = await limiter.check("a", 4000);
    expect(later.allowed).toBe(false);
    expect(later.allowed === false && later.retryAfterMs).toBe(1100);
  });

  it("allows attempts again once the lockout passes", async () => {
    const limiter = make();
    for (let i = 0; i < 3; i++) await limiter.check("a", i);
    await limiter.check("a", 100);

    expect((await limiter.check("a", 5200)).allowed).toBe(true);
  });

  it("starts a fresh window once the old one has elapsed", async () => {
    const limiter = make();
    await limiter.check("a", 0);
    await limiter.check("a", 10);

    expect(await limiter.check("a", 2000)).toEqual({
      allowed: true,
      remaining: 2,
    });
  });

  it("tracks keys independently, so one person cannot lock out another", async () => {
    const limiter = make();
    for (let i = 0; i < 4; i++) await limiter.check("a", i);

    expect((await limiter.check("b", 100)).allowed).toBe(true);
  });

  it("clears a key's attempts on reset, so a success wipes earlier fumbles", async () => {
    const limiter = make();
    await limiter.check("a", 0);
    await limiter.check("a", 10);
    await limiter.reset("a");

    expect(await limiter.check("a", 20)).toEqual({
      allowed: true,
      remaining: 2,
    });
  });

  it("keeps a locked-out key locked after the window passes", async () => {
    const limiter = make();
    for (let i = 0; i < 3; i++) await limiter.check("a", i);
    await limiter.check("a", 100);

    // The window has passed but the lockout has not. Treating the key as fresh
    // here would hand the attacker a clean slate.
    await limiter.check("unrelated", 2000);
    expect((await limiter.check("a", 2000)).allowed).toBe(false);
  });
});

describe("RateLimiter memory", () => {
  it("does not grow without bound as keys go quiet", async () => {
    const limiter = memory();
    for (let i = 0; i < 500; i++) await limiter.check(`visitor-${i}`, i);

    // One call well past every window sweeps the finished buckets. Reaching
    // into the private store is the only way to observe this, and the leak it
    // guards against is the reason the sweep exists.
    await limiter.check("later", 100_000);
    const store = (
      limiter as unknown as {
        memory: { buckets: Map<string, unknown> };
      }
    ).memory;
    expect(store.buckets.size).toBe(1);
  });
});

// What this exists for: the counts used to belong to one process.
describe("RateLimiter shared between processes", () => {
  it("counts attempts made through different instances together", async () => {
    const { table } = fakeTable();
    const first = inTable(table);
    const second = inTable(table);

    await first.check("a", 0);
    await second.check("a", 1);
    await first.check("a", 2);

    // Three attempts, spread across two "processes": the fourth is refused.
    expect((await second.check("a", 3)).allowed).toBe(false);
  });

  it("does not hand out a fresh set of attempts after a restart", async () => {
    const { table } = fakeTable();
    const before = inTable(table);
    for (let i = 0; i < 3; i++) await before.check("a", i);
    await before.check("a", 100);

    const afterRestart = inTable(table);

    expect((await afterRestart.check("a", 200)).allowed).toBe(false);
  });

  it("lets only the permitted number through when attempts arrive together", async () => {
    const { table } = fakeTable();
    const limiter = new RateLimiter({
      name: "t",
      limit: 10,
      windowMs: 60_000,
      rows: async () => table,
    });

    const results = await Promise.all(
      Array.from({ length: 25 }, () => limiter.check("a", 0))
    );

    expect(results.filter(r => r.allowed)).toHaveLength(10);
  });

  it("sees a reset made through another instance", async () => {
    const { table } = fakeTable();
    const first = inTable(table);
    const second = inTable(table);
    await first.check("a", 0);
    await first.check("a", 1);

    await second.reset("a");

    expect(await first.check("a", 2)).toEqual({ allowed: true, remaining: 2 });
  });

  it("keeps two limiters apart even when handed the same key", async () => {
    const { table } = fakeTable();
    const signIn = inTable(table, "sign-in");
    const reset = inTable(table, "reset");
    for (let i = 0; i < 3; i++) await signIn.check("a@example.com", i);
    await signIn.check("a@example.com", 10);

    expect((await reset.check("a@example.com", 20)).allowed).toBe(true);
  });

  // The table should not be a readable list of who has tried to sign in.
  it("stores a hash of the key, never the key", async () => {
    const { table, rows } = fakeTable();
    await inTable(table).check("victim@example.com|203.0.113.9", 0);

    const stored = [...rows.keys()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.join()).not.toContain("victim");
    expect(stored.join()).not.toContain("203.0.113.9");
  });

  it("keeps the same key on the same row", async () => {
    const { table, rows } = fakeTable();
    const limiter = inTable(table);
    await limiter.check("a", 0);
    await limiter.check("a", 1);

    expect(rows.size).toBe(1);
  });

  it("never touches the table for a limiter marked as per-process", async () => {
    const rows = vi.fn(async () => fakeTable().table);
    const limiter = new RateLimiter({
      name: "t",
      ...options,
      shared: false,
      rows,
    });

    await limiter.check("a", 0);
    await limiter.reset("a");

    expect(rows).not.toHaveBeenCalled();
  });
});

describe("RateLimiter when the shared table cannot answer", () => {
  afterEach(() => vi.restoreAllMocks());

  // A limiter that threw would turn a database hiccup into nobody being able
  // to sign in; one that let everything through would turn it into no limit.
  it("falls back to counting in memory, and still enforces the limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const limiter = new RateLimiter({
      name: "t",
      ...options,
      rows: async () => ({
        transact: async () => {
          throw new Error("Table 'rateLimits' doesn't exist");
        },
      }),
    });

    const results = [];
    for (let i = 0; i < 5; i++) results.push(await limiter.check("a", i));

    expect(results.map(r => r.allowed)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("says so, once, rather than on every attempt", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const limiter = new RateLimiter({
      name: "noisy",
      limit: 1000,
      windowMs: 1000,
      rows: async () => {
        throw new Error("connection lost");
      },
    });

    for (let i = 0; i < 20; i++) await limiter.check("a", i);

    expect(log.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("counts in memory when there is no database at all", async () => {
    const limiter = new RateLimiter({
      name: "t",
      ...options,
      rows: async () => null,
    });
    for (let i = 0; i < 3; i++) await limiter.check("a", i);

    expect((await limiter.check("a", 10)).allowed).toBe(false);
  });

  it("does not let a failed reset break the sign-in that triggered it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const limiter = new RateLimiter({
      name: "t",
      ...options,
      rows: async () => {
        throw new Error("connection lost");
      },
    });

    await expect(limiter.reset("a")).resolves.toBeUndefined();
  });
});
