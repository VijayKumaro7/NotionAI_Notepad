import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME, UNAUTHED_ERR_MSG } from "../shared/const";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  getUserByOpenId: vi.fn(),
  getTwoFactor: vi.fn(),
  recordTwoFactorStep: vi.fn(async () => undefined),
  consumeRecoveryCode: vi.fn(async () => false),
  countUnusedRecoveryCodes: vi.fn(async () => 10),
}));

// ENV is a module-level const read at import time, so the secret has to be in
// place before routers.ts (and the sdk it pulls in) is loaded.
vi.stubEnv("JWT_SECRET", "test-secret-for-session-signing");
vi.stubEnv("VITE_APP_ID", "test-app");

const db = await import("./db");
const { appRouter } = await import("./routers");
const { sdk, PENDING_SESSION_MS } = await import("./_core/sdk");
const { encryptSecret, generateSecret, totp } = await import("./totp");

type SetCookie = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

const OPEN_ID = "sample-user";

/** A distinct id per test keeps the module-level rate limiters from bleeding. */
let nextUserId = 5000;
let userId: number;
let secret: string;

function createContext(cookie?: string): {
  ctx: TrpcContext;
  cookies: SetCookie[];
} {
  const cookies: SetCookie[] = [];

  const ctx: TrpcContext = {
    // Null on purpose: a pending session is not an authenticated one, and the
    // context is what every protected procedure reads.
    user: null,
    req: {
      protocol: "https",
      headers: cookie ? { cookie: `${COOKIE_NAME}=${cookie}` } : {},
    } as TrpcContext["req"],
    res: {
      cookie: (
        name: string,
        value: string,
        options: Record<string, unknown>
      ) => {
        cookies.push({ name, value, options });
      },
    } as unknown as TrpcContext["res"],
  };

  return { ctx, cookies };
}

const pendingToken = () =>
  sdk.createSessionToken(OPEN_ID, {
    name: "Sample User",
    expiresInMs: PENDING_SESSION_MS,
    scope: "pending_2fa",
  });

beforeEach(() => {
  vi.clearAllMocks();
  userId = nextUserId++;
  secret = generateSecret();

  vi.mocked(db.getUserByOpenId).mockResolvedValue({
    id: userId,
    openId: OPEN_ID,
  } as Awaited<ReturnType<typeof db.getUserByOpenId>>);

  vi.mocked(db.getTwoFactor).mockResolvedValue({
    userId,
    secret: encryptSecret(secret),
    confirmedAt: new Date(),
    lastUsedStep: null,
  } as Awaited<ReturnType<typeof db.getTwoFactor>>);

  vi.mocked(db.countUnusedRecoveryCodes).mockResolvedValue(10);
});

describe("auth.loginState", () => {
  it("reports the half-signed-in state without an authenticated session", async () => {
    const { ctx } = createContext(await pendingToken());

    await expect(
      appRouter.createCaller(ctx).auth.loginState()
    ).resolves.toEqual({
      status: "pending_2fa",
      name: "Sample User",
    });
  });

  it("reports signed out when there is no cookie", async () => {
    const { ctx } = createContext();

    await expect(
      appRouter.createCaller(ctx).auth.loginState()
    ).resolves.toEqual({
      status: "signed_out",
      name: null,
    });
  });
});

describe("auth.twoFactor.verifyLogin", () => {
  it("upgrades the pending cookie to a full session on a correct code", async () => {
    const { ctx, cookies } = createContext(await pendingToken());

    const result = await appRouter
      .createCaller(ctx)
      .auth.twoFactor.verifyLogin({ code: totp(secret) });

    expect(result).toMatchObject({ success: true, usedRecoveryCode: false });
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(COOKIE_NAME);

    const issued = await sdk.verifySession(cookies[0].value);
    expect(issued).toMatchObject({ openId: OPEN_ID, scope: "full" });
  });

  it("sets no cookie when the code is wrong", async () => {
    const { ctx, cookies } = createContext(await pendingToken());

    await expect(
      appRouter.createCaller(ctx).auth.twoFactor.verifyLogin({ code: "000000" })
    ).rejects.toThrow(/not right/i);
    expect(cookies).toHaveLength(0);
  });

  it("refuses without a pending cookie, so a code alone signs nobody in", async () => {
    const { ctx, cookies } = createContext();

    await expect(
      appRouter
        .createCaller(ctx)
        .auth.twoFactor.verifyLogin({ code: totp(secret) })
    ).rejects.toThrow(/expired/i);
    expect(cookies).toHaveLength(0);
  });

  it("refuses a full session cookie — there is no second step left to take", async () => {
    const full = await sdk.createSessionToken(OPEN_ID, {
      name: "Sample User",
      scope: "full",
    });
    const { ctx, cookies } = createContext(full);

    await expect(
      appRouter
        .createCaller(ctx)
        .auth.twoFactor.verifyLogin({ code: totp(secret) })
    ).rejects.toThrow(/expired/i);
    expect(cookies).toHaveLength(0);
  });

  // main.tsx sends the browser to the login page whenever a tRPC error carries
  // this exact message. A wrong code doing that would reload the page out from
  // under someone mid-typo instead of showing them the error.
  it("does not report a wrong code with the message that triggers a redirect", async () => {
    const { ctx } = createContext(await pendingToken());

    const error = await appRouter
      .createCaller(ctx)
      .auth.twoFactor.verifyLogin({ code: "000000" })
      .catch((thrown: TRPCError) => thrown);

    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).message).not.toBe(UNAUTHED_ERR_MSG);
    expect((error as TRPCError).code).toBe("BAD_REQUEST");
  });

  it("reports a lockout separately, so the UI can stop asking", async () => {
    const { ctx } = createContext(await pendingToken());
    const caller = appRouter.createCaller(ctx);

    for (let attempt = 0; attempt < 5; attempt++) {
      await caller.auth.twoFactor
        .verifyLogin({ code: "000000" })
        .catch(() => undefined);
    }

    const error = await caller.auth.twoFactor
      .verifyLogin({ code: "000000" })
      .catch((thrown: TRPCError) => thrown);

    expect((error as TRPCError).code).toBe("TOO_MANY_REQUESTS");
  });
});

describe("a pending session reaching the rest of the app", () => {
  it("is refused by authenticateRequest, so no protected procedure sees it", async () => {
    const req = {
      headers: { cookie: `${COOKIE_NAME}=${await pendingToken()}` },
    } as Parameters<typeof sdk.authenticateRequest>[0];

    await expect(sdk.authenticateRequest(req)).rejects.toThrow(
      /two-step verification is not complete/i
    );
  });

  it("stops protected procedures at the middleware", async () => {
    const { ctx } = createContext(await pendingToken());

    await expect(
      appRouter.createCaller(ctx).auth.twoFactor.status()
    ).rejects.toThrow(UNAUTHED_ERR_MSG);
  });
});

describe("session scopes", () => {
  it("reads a token issued before scopes existed as a full session", async () => {
    // Signing without the claim, the way the old code did. Reading these as
    // pending would have signed out everyone holding a live cookie on deploy.
    const legacy = await sdk.signSession({
      openId: OPEN_ID,
      appId: "test-app",
      name: "Sample User",
    });

    expect(await sdk.verifySession(legacy)).toMatchObject({ scope: "full" });
  });

  it("treats an unrecognised scope as pending rather than full", async () => {
    const odd = await sdk.signSession({
      openId: OPEN_ID,
      appId: "test-app",
      name: "Sample User",
      scope: "something-else" as never,
    });

    expect(await sdk.verifySession(odd)).toMatchObject({
      scope: "pending_2fa",
    });
  });
});
