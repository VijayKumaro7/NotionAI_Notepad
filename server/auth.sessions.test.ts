/**
 * The session endpoints, exercised through the router.
 *
 * These are the tests for the claims the rest of the auth code makes and cannot
 * demonstrate on its own: that signing out ends the session rather than asking a
 * browser to forget it, that changing a password signs the other devices out,
 * and that one account cannot reach another's sessions.
 */

import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

const sessions = new Map<string, any>();
let nextSessionId = 1;

const users = new Map<number, any>();

vi.mock("./db", () => ({
  getUserByOpenId: vi.fn(
    async (openId: string) =>
      [...users.values()].find(u => u.openId === openId) ?? null
  ),
  getUserById: vi.fn(async (id: number) => users.get(id) ?? null),
  setPasswordHash: vi.fn(async (id: number, hash: string) => {
    const user = users.get(id);
    if (user) user.passwordHash = hash;
  }),
  invalidateEmailAuthTokens: vi.fn(async () => undefined),
  recordSecurityEvent: vi.fn(async () => undefined),
  listSecurityEvents: vi.fn(async () => []),

  createSession: vi.fn(async (input: any) => {
    const row = {
      id: nextSessionId++,
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
  touchSession: vi.fn(async () => undefined),
  rotateSession: vi.fn(async (input: any) => {
    const row = sessions.get(input.currentTokenHash);
    if (!row || row.revokedAt) return null;
    sessions.delete(input.currentTokenHash);
    const next = { ...row, tokenHash: input.nextTokenHash, scope: input.scope };
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
  revokeSessionForUser: vi.fn(
    async (userId: number, sessionId: number, reason: string) => {
      // The ownership check is inside the lookup, exactly as the real query
      // puts it inside the WHERE clause.
      for (const row of sessions.values()) {
        if (row.id !== sessionId || row.userId !== userId || row.revokedAt) {
          continue;
        }
        row.revokedAt = new Date();
        row.revokedReason = reason;
        return 1;
      }
      return 0;
    }
  ),
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
  listActiveSessions: vi.fn(async (userId: number) =>
    [...sessions.values()]
      .filter(row => row.userId === userId && !row.revokedAt)
      .map(row => ({
        id: row.id,
        scope: row.scope,
        device: row.device,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        expiresAt: row.expiresAt,
      }))
  ),
}));

vi.mock("./email", () => ({
  isEmailConfigured: vi.fn(() => true),
  sendEmail: vi.fn(async () => undefined),
  appUrl: (path: string) => `https://notes.test${path}`,
}));

vi.stubEnv("JWT_SECRET", "test-secret-for-session-endpoints");
vi.stubEnv("VITE_APP_ID", "test-app");

const db = await import("./db");
const { sendEmail } = await import("./email");
const { appRouter } = await import("./routers");
const { sdk } = await import("./_core/sdk");
const { hashPassword } = await import("./password");
const { SESSION_ABSOLUTE_MS, newSessionId, sessionDigest } =
  await import("./sessionStore");

const PASSWORD = "a-sufficiently-long-password";
const NEW_PASSWORD = "an-even-longer-replacement-password";

/** Distinct ids per test keep the module-level rate limiters from bleeding. */
let nextUserId = 900;

type Harness = {
  ctx: TrpcContext;
  caller: ReturnType<typeof appRouter.createCaller>;
  cookies: { name: string; value: string; options: Record<string, unknown> }[];
  cleared: { name: string; options: Record<string, unknown> }[];
};

/** An account with one live session, and a context holding its cookie. */
async function signedIn(user: any, sid: string): Promise<Harness> {
  const token = await sdk.createSessionToken(user.openId, {
    name: user.name ?? "",
    expiresInMs: SESSION_ABSOLUTE_MS,
    scope: "full",
    sid,
  });

  const cookies: Harness["cookies"] = [];
  const cleared: Harness["cleared"] = [];

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: { cookie: `${COOKIE_NAME}=${token}`, host: "notes.test" },
      socket: {},
    } as unknown as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) =>
        cookies.push({ name, value, options }),
      clearCookie: (name: string, options: Record<string, unknown>) =>
        cleared.push({ name, options }),
    } as unknown as TrpcContext["res"],
  };

  return { ctx, caller: appRouter.createCaller(ctx), cookies, cleared };
}

/** A user row plus a live session, returning both. */
async function account(
  overrides: { passwordHash?: string | null; device?: string } = {}
) {
  const id = nextUserId++;
  const user = {
    id,
    openId: `email:user-${id}`,
    name: `User ${id}`,
    email: `user-${id}@example.test`,
    passwordHash:
      overrides.passwordHash === undefined
        ? await hashPassword(PASSWORD)
        : overrides.passwordHash,
    loginMethod: "email",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  users.set(id, user);

  const sid = newSessionId();
  await db.createSession({
    userId: id,
    tokenHash: sessionDigest(sid),
    scope: "full",
    device: overrides.device ?? "Chrome on macOS",
    ipHash: null,
    expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
  });

  return { user, sid };
}

/** A second device on an existing account. */
async function extraSession(userId: number, device = "Firefox on Linux") {
  const sid = newSessionId();
  const row = await db.createSession({
    userId,
    tokenHash: sessionDigest(sid),
    scope: "full",
    device,
    ipHash: null,
    expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
  });

  return { sid, id: row!.id };
}

const live = (sid: string) => {
  const row = sessions.get(sessionDigest(sid));
  return Boolean(row) && !row.revokedAt;
};

beforeEach(() => {
  sessions.clear();
  users.clear();
  nextSessionId = 1;
  vi.clearAllMocks();
});

describe("auth.logout", () => {
  it("revokes the session, not just the cookie", async () => {
    const { user, sid } = await account();
    const { caller } = await signedIn(user, sid);

    await caller.auth.logout();

    // The difference this whole change is about: a cleared cookie asks the
    // browser in front of us to forget a token that still works everywhere
    // else. Revoking means the token is dead.
    expect(live(sid)).toBe(false);
    expect(sessions.get(sessionDigest(sid)).revokedReason).toBe("signed_out");
  });

  it("clears the cookie with the attributes it was set with", async () => {
    const { user, sid } = await account();
    const { caller, cleared } = await signedIn(user, sid);

    await caller.auth.logout();

    expect(cleared).toHaveLength(1);
    expect(cleared[0].name).toBe(COOKIE_NAME);
    // A mismatch here leaves the old cookie in place beside the cleared one,
    // and signing out does nothing visible.
    expect(cleared[0].options).toMatchObject({
      maxAge: -1,
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
  });

  it("leaves the account's other devices signed in", async () => {
    const { user, sid } = await account();
    const other = await extraSession(user.id);
    const { caller } = await signedIn(user, sid);

    await caller.auth.logout();

    // Signing out here is not signing out everywhere. There is a separate
    // button for that, and it says so.
    expect(live(other.sid)).toBe(true);
  });

  it("succeeds without a session rather than failing", async () => {
    const cleared: { name: string; options: Record<string, unknown> }[] = [];
    const caller = appRouter.createCaller({
      user: null,
      req: {
        protocol: "https",
        headers: {},
        socket: {},
      } as unknown as TrpcContext["req"],
      res: {
        clearCookie: (name: string, options: Record<string, unknown>) =>
          cleared.push({ name, options }),
      } as unknown as TrpcContext["res"],
    });

    // Signing out is public on purpose: a session that has gone bad is exactly
    // the one someone needs to end.
    await expect(caller.auth.logout()).resolves.toEqual({ success: true });
    expect(cleared).toHaveLength(1);
  });
});

describe("auth.me", () => {
  it("sends only the four fields the page renders", async () => {
    const { user, sid } = await account();
    const { caller } = await signedIn(user, sid);

    const me = await caller.auth.me();

    expect(Object.keys(me!).sort()).toEqual([
      "email",
      "id",
      "loginMethod",
      "name",
    ]);
  });

  it("never sends the password hash to the browser", async () => {
    const { user, sid } = await account();
    const { caller } = await signedIn(user, sid);

    const me = await caller.auth.me();

    // This returned `ctx.user` whole once, which is the users row — so every
    // page load shipped the account's scrypt hash to any script on the page.
    // Nothing rendered it; it came along because the row did.
    expect(me).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(me)).not.toContain("scrypt$");
    expect(JSON.stringify(me)).not.toContain(user.passwordHash);
  });

  it("never sends the Google subject or the openId", async () => {
    const { user, sid } = await account();
    const { caller } = await signedIn(user, sid);

    const me = await caller.auth.me();

    expect(me).not.toHaveProperty("googleSub");
    expect(me).not.toHaveProperty("openId");
  });

  it("answers null when nobody is signed in", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: { headers: {}, socket: {} } as unknown as TrpcContext["req"],
      res: {} as unknown as TrpcContext["res"],
    });

    await expect(caller.auth.me()).resolves.toBeNull();
  });
});

describe("auth.sessions.list", () => {
  it("shows this account's sessions and marks the current one", async () => {
    const { user, sid } = await account({ device: "Chrome on macOS" });
    await extraSession(user.id, "Safari on iOS");
    const { caller } = await signedIn(user, sid);

    const rows = await caller.auth.sessions.list();

    expect(rows).toHaveLength(2);
    expect(rows.filter(row => row.current)).toHaveLength(1);
    expect(rows.find(row => row.current)!.device).toBe("Chrome on macOS");
  });

  it("never sends the value that would open a session", async () => {
    const { user, sid } = await account();
    const { caller } = await signedIn(user, sid);

    const rows = await caller.auth.sessions.list();

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(sid);
    expect(serialized).not.toContain(sessionDigest(sid));
  });

  it("does not show another account's sessions", async () => {
    const mine = await account();
    const theirs = await account();
    await extraSession(theirs.user.id, "Edge on Windows");

    const { caller } = await signedIn(mine.user, mine.sid);
    const rows = await caller.auth.sessions.list();

    expect(rows).toHaveLength(1);
    expect(rows[0].device).toBe("Chrome on macOS");
  });

  it("leaves revoked sessions out", async () => {
    const { user, sid } = await account();
    const other = await extraSession(user.id);
    const { caller } = await signedIn(user, sid);

    await caller.auth.sessions.revoke({ sessionId: other.id });

    expect(await caller.auth.sessions.list()).toHaveLength(1);
  });
});

describe("auth.sessions.revoke", () => {
  it("ends the named session", async () => {
    const { user, sid } = await account();
    const other = await extraSession(user.id);
    const { caller } = await signedIn(user, sid);

    await expect(
      caller.auth.sessions.revoke({ sessionId: other.id })
    ).resolves.toEqual({ revoked: 1 });

    expect(live(other.sid)).toBe(false);
    expect(live(sid)).toBe(true);
  });

  it("refuses to revoke a session belonging to someone else", async () => {
    const mine = await account();
    const theirs = await account();
    const victim = await extraSession(theirs.user.id);

    const { caller } = await signedIn(mine.user, mine.sid);

    // The id is a plain integer in the request. Without the owner inside the
    // WHERE clause this is the shape of every IDOR that has ever shipped.
    await expect(
      caller.auth.sessions.revoke({ sessionId: victim.id })
    ).rejects.toThrow(TRPCError);

    expect(live(victim.sid)).toBe(true);
  });

  it("answers the same way for a session that is not yours and one that does not exist", async () => {
    const mine = await account();
    const theirs = await account();
    const victim = await extraSession(theirs.user.id);
    const { caller } = await signedIn(mine.user, mine.sid);

    const notMine = await caller.auth.sessions
      .revoke({ sessionId: victim.id })
      .catch((error: TRPCError) => error);
    const notReal = await caller.auth.sessions
      .revoke({ sessionId: 999_999 })
      .catch((error: TRPCError) => error);

    // Different answers here would turn the endpoint into a way of asking
    // which session ids exist on other accounts.
    expect((notMine as TRPCError).code).toBe((notReal as TRPCError).code);
    expect((notMine as TRPCError).message).toBe((notReal as TRPCError).message);
  });

  it("refuses an unauthenticated caller", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: { headers: {}, socket: {} } as unknown as TrpcContext["req"],
      res: {} as unknown as TrpcContext["res"],
    });

    await expect(caller.auth.sessions.revoke({ sessionId: 1 })).rejects.toThrow(
      TRPCError
    );
  });
});

describe("auth.sessions.revokeOthers", () => {
  it("signs out everywhere else and keeps this one", async () => {
    const { user, sid } = await account();
    const a = await extraSession(user.id);
    const b = await extraSession(user.id);
    const { caller } = await signedIn(user, sid);

    await expect(caller.auth.sessions.revokeOthers()).resolves.toEqual({
      revoked: 2,
    });

    expect(live(sid)).toBe(true);
    expect(live(a.sid)).toBe(false);
    expect(live(b.sid)).toBe(false);
  });

  it("leaves other accounts alone", async () => {
    const mine = await account();
    const theirs = await account();
    const { caller } = await signedIn(mine.user, mine.sid);

    await caller.auth.sessions.revokeOthers();

    expect(live(theirs.sid)).toBe(true);
  });
});

describe("account.changePassword", () => {
  it("sets the new password", async () => {
    const { user, sid } = await account();
    const { caller } = await signedIn(user, sid);

    await caller.account.changePassword({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const { verifyPassword } = await import("./password");
    expect(
      await verifyPassword(NEW_PASSWORD, users.get(user.id).passwordHash)
    ).toBe(true);
    expect(
      await verifyPassword(PASSWORD, users.get(user.id).passwordHash)
    ).toBe(false);
  });

  it("refuses without the current password", async () => {
    const { user, sid } = await account();
    const { caller } = await signedIn(user, sid);

    await expect(
      caller.account.changePassword({
        currentPassword: "not-the-right-password",
        newPassword: NEW_PASSWORD,
      })
    ).rejects.toThrow(TRPCError);

    // A session is the thing that gets stolen. If holding one were enough to
    // change the password, a stolen session would become a kept account.
    const { verifyPassword } = await import("./password");
    expect(
      await verifyPassword(PASSWORD, users.get(user.id).passwordHash)
    ).toBe(true);
  });

  it("refuses a new password that is too short", async () => {
    const { user, sid } = await account();
    const { caller } = await signedIn(user, sid);

    await expect(
      caller.account.changePassword({
        currentPassword: PASSWORD,
        newPassword: "short",
      })
    ).rejects.toThrow(TRPCError);
  });

  it("refuses the password the account already has", async () => {
    const { user, sid } = await account();
    const other = await extraSession(user.id);
    const { caller } = await signedIn(user, sid);

    await expect(
      caller.account.changePassword({
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
      })
    ).rejects.toThrow(TRPCError);

    // A no-op change would sign every other device out for nothing and report
    // success for a change that did not happen.
    expect(live(other.sid)).toBe(true);
  });

  it("signs out every other device", async () => {
    const { user, sid } = await account();
    const a = await extraSession(user.id);
    const b = await extraSession(user.id);
    const { caller } = await signedIn(user, sid);

    const result = await caller.account.changePassword({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(result.otherSessionsRevoked).toBe(2);
    expect(live(a.sid)).toBe(false);
    expect(live(b.sid)).toBe(false);
  });

  it("rotates this session rather than ending it", async () => {
    const { user, sid } = await account();
    const { caller, cookies } = await signedIn(user, sid);

    await caller.account.changePassword({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    // The old secret stops working — a copy of this very cookie taken before
    // the change is dead too — while the person who made the change stays
    // signed in under a new one.
    expect(sessions.has(sessionDigest(sid))).toBe(false);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(COOKIE_NAME);
    expect(cookies[0].options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
  });

  it("tells the account holder by email, without quoting anything secret", async () => {
    const { user, sid } = await account();
    const { caller } = await signedIn(user, sid);

    await caller.account.changePassword({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.to).toBe(user.email);
    expect(mail.text).not.toContain(PASSWORD);
    expect(mail.text).not.toContain(NEW_PASSWORD);
    expect(mail.text).not.toContain(sid);
  });

  it("refuses an account that has no password to change", async () => {
    const { user, sid } = await account({ passwordHash: null });
    const { caller } = await signedIn(user, sid);

    // Inventing one here would create a second way into an account whose owner
    // never asked for one.
    await expect(
      caller.account.changePassword({
        currentPassword: "",
        newPassword: NEW_PASSWORD,
      })
    ).rejects.toThrow(TRPCError);
  });

  it("refuses an unauthenticated caller", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: { headers: {}, socket: {} } as unknown as TrpcContext["req"],
      res: {} as unknown as TrpcContext["res"],
    });

    await expect(
      caller.account.changePassword({
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      })
    ).rejects.toThrow(TRPCError);
  });

  it("says nothing about the password in what it returns", async () => {
    const { user, sid } = await account();
    const { caller } = await signedIn(user, sid);

    const result = await caller.account.changePassword({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain("scrypt$");
  });
});
