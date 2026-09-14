import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

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
      confirmationPhrase: accountDeletion.CONFIRMATION_PHRASE,
    });
    expect(accountDeletion.requiredProof).toHaveBeenCalledWith(ctx.user);
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
