import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  exportChats: vi.fn(async () => []),
}));

vi.mock("./accountDeletion", async () => {
  const actual =
    await vi.importActual<typeof import("./accountDeletion")>(
      "./accountDeletion"
    );
  return {
    ...actual,
    requiredProof: vi.fn(async () => "password" as const),
    deleteAccount: vi.fn(async () => ({
      notes: 4,
      conversations: 1,
      backups: 2,
    })),
  };
});

const accountDeletion = await import("./accountDeletion");
const db = await import("./db");
const { accountExportLimiter } = await import("./rateLimit");
const { appRouter } = await import("./routers");

type CookieCall = { name: string; options: Record<string, unknown> };

function createCaller() {
  const clearedCookies: CookieCall[] = [];

  const ctx = {
    user: {
      id: 7,
      openId: "email:abc",
      email: "sample@example.com",
      name: "Sample User",
      passwordHash: "scrypt$…",
      loginMethod: "email",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    },
  } as unknown as TrpcContext;

  return { caller: appRouter.createCaller(ctx), clearedCookies, ctx };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The limiter is module state shared by every test in this file, and the
  // export tests spend from the same bucket.
  accountExportLimiter.reset("account-export:7");
  vi.mocked(accountDeletion.deleteAccount).mockResolvedValue({
    notes: 4,
    conversations: 1,
    backups: 2,
  });
  vi.mocked(accountDeletion.requiredProof).mockResolvedValue("password");
});

describe("account.requirements", () => {
  it("tells the dialog what to ask for, and the exact phrase", async () => {
    const { caller, ctx } = createCaller();

    await expect(caller.account.requirements()).resolves.toEqual({
      proof: "password",
      hasPassword: true,
      confirmationPhrase: accountDeletion.CONFIRMATION_PHRASE,
    });
    expect(accountDeletion.requiredProof).toHaveBeenCalledWith(ctx.user);
  });
});

describe("account.export", () => {
  // The only id that can reach the query is the session's own. There is no
  // input to carry someone else's, which is the point: ownership is a shape,
  // not a check that could be forgotten.
  it("reads the chats of the signed-in account and no one else's", async () => {
    const { caller, ctx } = createCaller();
    vi.mocked(db.exportChats).mockResolvedValue([
      {
        id: 1,
        title: "Kept",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        messages: [
          {
            role: "user",
            content: "hello",
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
          },
        ],
      },
    ]);

    const result = await caller.account.export();

    expect(db.exportChats).toHaveBeenCalledWith(ctx.user.id);
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].messages[0].content).toBe("hello");
  });

  it("refuses once the exports are spent, rather than reading it all again", async () => {
    const { caller } = createCaller();
    vi.mocked(db.exportChats).mockResolvedValue([]);

    for (let i = 0; i < 10; i++) {
      await caller.account.export();
    }

    await expect(caller.account.export()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
});

describe("account.delete", () => {
  it("passes the confirmation and the proof through, and reports what went", async () => {
    const { caller, ctx } = createCaller();

    await expect(
      caller.account.delete({
        confirmation: accountDeletion.CONFIRMATION_PHRASE,
        password: "correct horse battery staple",
      })
    ).resolves.toEqual({ notes: 4, conversations: 1, backups: 2 });

    expect(accountDeletion.deleteAccount).toHaveBeenCalledWith(ctx.user, {
      confirmation: accountDeletion.CONFIRMATION_PHRASE,
      password: "correct horse battery staple",
    });
  });

  // The row this session authenticates against has just been deleted. A cookie
  // left in place is a browser that still believes it is signed in.
  it("clears the session cookie the way logout does", async () => {
    const { caller, clearedCookies } = createCaller();

    await caller.account.delete({
      confirmation: accountDeletion.CONFIRMATION_PHRASE,
      password: "correct horse battery staple",
    });

    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    });
  });

  it("leaves the cookie alone when the deletion was refused", async () => {
    const { caller, clearedCookies } = createCaller();
    vi.mocked(accountDeletion.deleteAccount).mockRejectedValue(
      new accountDeletion.AccountDeletionError(
        "That password is not right.",
        "invalid_password"
      )
    );

    await expect(
      caller.account.delete({
        confirmation: accountDeletion.CONFIRMATION_PHRASE,
        password: "wrong",
      })
    ).rejects.toThrow("That password is not right.");

    expect(clearedCookies).toHaveLength(0);
  });

  it("answers a spent rate limit with TOO_MANY_REQUESTS, not a server error", async () => {
    const { caller } = createCaller();
    vi.mocked(accountDeletion.deleteAccount).mockRejectedValue(
      new accountDeletion.AccountDeletionError(
        "Too many attempts. Try again later.",
        "rate_limited",
        60_000
      )
    );

    await expect(
      caller.account.delete({
        confirmation: accountDeletion.CONFIRMATION_PHRASE,
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("answers an unreachable store with SERVICE_UNAVAILABLE", async () => {
    const { caller } = createCaller();
    vi.mocked(accountDeletion.deleteAccount).mockRejectedValue(
      new accountDeletion.AccountDeletionError("No database.", "unavailable")
    );

    await expect(
      caller.account.delete({
        confirmation: accountDeletion.CONFIRMATION_PHRASE,
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
