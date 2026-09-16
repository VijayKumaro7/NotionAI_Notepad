import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The session table, small enough to reason about.
 *
 * Keyed on the token hash exactly as the real one is, so a test that looks up a
 * session by the wrong thing fails here the same way it would fail in MySQL.
 */
const sessions = new Map<string, any>();
let nextId = 1;

vi.mock("./db", () => ({
  createSession: vi.fn(async (input: any) => {
    const row = {
      id: nextId++,
      revokedAt: null,
      revokedReason: null,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      ...input,
    };
    sessions.set(input.tokenHash, row);
    return row;
  }),
  findSessionByTokenHash: vi.fn(
    async (hash: string) => sessions.get(hash) ?? null
  ),
  touchSession: vi.fn(async (hash: string, at: Date) => {
    const row = sessions.get(hash);
    if (row) row.lastSeenAt = at;
  }),
  rotateSession: vi.fn(async (input: any) => {
    const row = sessions.get(input.currentTokenHash);
    if (!row || row.revokedAt) return null;
    sessions.delete(input.currentTokenHash);
    const next = {
      ...row,
      tokenHash: input.nextTokenHash,
      scope: input.scope,
      expiresAt: input.expiresAt,
      lastSeenAt: new Date(),
    };
    sessions.set(input.nextTokenHash, next);
    return next;
  }),
  revokeSessionByTokenHash: vi.fn(async (hash: string, reason: string) => {
    const row = sessions.get(hash);
    if (row && !row.revokedAt) {
      row.revokedAt = new Date();
      row.revokedReason = reason;
    }
  }),
  revokeAllSessions: vi.fn(
    async (userId: number, reason: string, except?: string) => {
      let count = 0;
      for (const [hash, row] of sessions) {
        if (row.userId !== userId || row.revokedAt) continue;
        if (except && hash === except) continue;
        row.revokedAt = new Date();
        row.revokedReason = reason;
        count += 1;
      }
      return count;
    }
  ),
}));

vi.stubEnv("JWT_SECRET", "test-secret-for-sessions");

const db = await import("./db");
const {
  SESSION_IDLE_MS,
  checkSession,
  describeDevice,
  hashAddress,
  newSessionId,
  revoke,
  revokeAll,
  rotate,
  sessionDigest,
  startSession,
} = await import("./sessionStore");

const request = (userAgent?: string) =>
  ({ headers: userAgent ? { "user-agent": userAgent } : {} }) as never;

const start = (
  overrides: Partial<{ userId: number; scope: any; lifetimeMs: number }> = {}
) =>
  startSession({
    userId: overrides.userId ?? 1,
    scope: overrides.scope ?? "full",
    lifetimeMs: overrides.lifetimeMs ?? 60_000,
    req: request("Mozilla/5.0 (Macintosh) Chrome/120 Safari/537"),
    address: "203.0.113.5",
  });

beforeEach(() => {
  sessions.clear();
  nextId = 1;
  vi.clearAllMocks();
});

describe("session ids", () => {
  it("are long, random and never repeat", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSessionId()));

    expect(ids.size).toBe(200);
    // 256 bits in base64url is 43 characters. Anything materially shorter
    // would mean the entropy was not what the comment claims.
    for (const id of ids) expect(id.length).toBeGreaterThanOrEqual(43);
  });

  it("are stored only as a hash", async () => {
    const started = await start();

    const stored = [...sessions.values()][0];
    expect(stored.tokenHash).toBe(sessionDigest(started!.sessionId));
    // The thing in the cookie must not be recoverable from the row. A dump of
    // this table should not be a pile of working sessions.
    expect(JSON.stringify(stored)).not.toContain(started!.sessionId);
  });
});

describe("checkSession", () => {
  it("accepts a live session and names its owner", async () => {
    const started = await start({ userId: 42 });

    const result = await checkSession(started!.sessionId);

    expect(result).toMatchObject({ ok: true, userId: 42, scope: "full" });
  });

  it("refuses a session id that was never issued", async () => {
    expect(await checkSession(newSessionId())).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("refuses a revoked session", async () => {
    const started = await start();
    await revoke(started!.sessionId, "signed_out");

    expect(await checkSession(started!.sessionId)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("refuses a session past its absolute deadline", async () => {
    const started = await start({ lifetimeMs: 1000 });

    const later = new Date(Date.now() + 5000);
    expect(await checkSession(started!.sessionId, later)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a session that has gone unused too long, and revokes it", async () => {
    const started = await start({ lifetimeMs: SESSION_IDLE_MS * 4 });

    const later = new Date(Date.now() + SESSION_IDLE_MS + 60_000);
    expect(await checkSession(started!.sessionId, later)).toEqual({
      ok: false,
      reason: "idle_timeout",
    });

    // Not merely refused for this request: the row is closed, so a later
    // request cannot find it usable again.
    const row = sessions.get(sessionDigest(started!.sessionId));
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedReason).toBe("idle_timeout");
  });

  it("does not let a request arriving after the idle window extend it", async () => {
    const started = await start({ lifetimeMs: SESSION_IDLE_MS * 4 });
    const hash = sessionDigest(started!.sessionId);
    const originalLastSeen = sessions.get(hash).lastSeenAt;

    await checkSession(
      started!.sessionId,
      new Date(Date.now() + SESSION_IDLE_MS + 60_000)
    );

    // The check has to come before the touch. The other order makes every
    // expired session immortal so long as something keeps poking it.
    expect(sessions.get(hash).lastSeenAt).toEqual(originalLastSeen);
    expect(db.touchSession).not.toHaveBeenCalled();
  });

  it("moves the idle clock forward on a session in regular use", async () => {
    const started = await start({ lifetimeMs: SESSION_IDLE_MS * 4 });

    const later = new Date(Date.now() + 10 * 60 * 1000);
    expect(await checkSession(started!.sessionId, later)).toMatchObject({
      ok: true,
    });

    expect(sessions.get(sessionDigest(started!.sessionId)).lastSeenAt).toEqual(
      later
    );
  });

  it("does not write on every request", async () => {
    const started = await start();

    // A minute later is well inside the five-minute threshold. Writing here
    // would make every authenticated request a write.
    await checkSession(started!.sessionId, new Date(Date.now() + 60_000));

    expect(db.touchSession).not.toHaveBeenCalled();
  });
});

describe("rotate", () => {
  it("replaces the secret, keeping the session", async () => {
    const started = await start({ scope: "pending_2fa", lifetimeMs: 600_000 });

    const rotated = await rotate({
      currentSessionId: started!.sessionId,
      scope: "full",
      lifetimeMs: 60_000,
    });

    expect(rotated!.sessionId).not.toBe(started!.sessionId);
    expect(await checkSession(rotated!.sessionId)).toMatchObject({
      ok: true,
      scope: "full",
    });
  });

  it("kills the old secret, which is the point of rotating", async () => {
    const started = await start({ scope: "pending_2fa", lifetimeMs: 600_000 });

    await rotate({
      currentSessionId: started!.sessionId,
      scope: "full",
      lifetimeMs: 60_000,
    });

    // Session fixation: a value planted in the browser before the second
    // factor cleared must not be the value that authenticates afterwards.
    expect(await checkSession(started!.sessionId)).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("refuses to rotate a revoked session", async () => {
    const started = await start();
    await revoke(started!.sessionId, "signed_out");

    expect(
      await rotate({
        currentSessionId: started!.sessionId,
        scope: "full",
        lifetimeMs: 60_000,
      })
    ).toBeNull();
  });
});

describe("revokeAll", () => {
  it("ends every session on the account", async () => {
    const a = await start({ userId: 7 });
    const b = await start({ userId: 7 });

    expect(await revokeAll(7, "password_reset")).toBe(2);

    expect(await checkSession(a!.sessionId)).toMatchObject({ ok: false });
    expect(await checkSession(b!.sessionId)).toMatchObject({ ok: false });
  });

  it("leaves other accounts alone", async () => {
    const mine = await start({ userId: 7 });
    const theirs = await start({ userId: 8 });

    await revokeAll(7, "password_reset");

    expect(await checkSession(theirs!.sessionId)).toMatchObject({ ok: true });
    expect(await checkSession(mine!.sessionId)).toMatchObject({ ok: false });
  });

  it("can spare the session in hand", async () => {
    const here = await start({ userId: 7 });
    const elsewhere = await start({ userId: 7 });

    expect(await revokeAll(7, "password_changed", here!.sessionId)).toBe(1);

    expect(await checkSession(here!.sessionId)).toMatchObject({ ok: true });
    expect(await checkSession(elsewhere!.sessionId)).toMatchObject({
      ok: false,
    });
  });
});

describe("hashAddress", () => {
  it("does not keep the address", () => {
    const hashed = hashAddress("203.0.113.5");

    expect(hashed).not.toBeNull();
    expect(hashed).not.toContain("203.0.113.5");
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable, so two visits from one place can be compared", () => {
    expect(hashAddress("203.0.113.5")).toBe(hashAddress("203.0.113.5"));
    expect(hashAddress("203.0.113.5")).not.toBe(hashAddress("203.0.113.6"));
  });

  it("returns nothing when there is no key to hash under", () => {
    vi.stubEnv("JWT_SECRET", "");
    // An unkeyed hash of an IPv4 address is a lookup table with four billion
    // rows, not a pseudonym. Better to store nothing.
    expect(hashAddress("203.0.113.5")).toBeNull();
    vi.stubEnv("JWT_SECRET", "test-secret-for-sessions");
  });
});

describe("describeDevice", () => {
  it("reduces a user agent to something a person recognises", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
      )
    ).toBe("Chrome on macOS");

    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 Version/17.0 Safari/604.1"
      )
    ).toBe("Safari on iOS");
  });

  it("prefers Edge over the Chrome its user agent also claims", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36 Edg/120.0"
      )
    ).toBe("Edge on Windows");
  });

  it("keeps none of the string it was given", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

    const label = describeDevice(ua)!;

    // The label is drawn from a fixed vocabulary rather than sliced out of the
    // input, so a session row cannot become a fingerprint.
    expect(label).toBe("Firefox on Windows");
    expect(ua).not.toContain(label);
  });

  it("says so rather than guessing when it does not recognise anything", () => {
    expect(describeDevice("curl/8.4.0")).toBe("Unknown browser");
    expect(describeDevice(undefined)).toBeNull();
  });
});
