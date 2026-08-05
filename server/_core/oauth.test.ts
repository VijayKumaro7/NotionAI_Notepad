import type { Express, Request, RequestHandler, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  upsertUser: vi.fn(async () => undefined),
  getUserByOpenId: vi.fn(async () => ({ id: 7, openId: "sample-user" })),
  getTwoFactor: vi.fn(async () => null),
}));

vi.mock("./sdk", () => ({
  PENDING_SESSION_MS: 10 * 60 * 1000,
  sdk: {
    exchangeCodeForToken: vi.fn(async () => ({ accessToken: "access-token" })),
    getUserInfo: vi.fn(async () => ({
      openId: "sample-user",
      name: "Sample User",
      email: "sample@example.com",
      loginMethod: "manus",
    })),
    createSessionToken: vi.fn(async () => "session-token"),
  },
}));

const db = await import("../db");
const { sdk } = await import("./sdk");
const { registerOAuthRoutes } = await import("./oauth");

function captureCallbackHandler(): RequestHandler {
  let handler: RequestHandler | undefined;

  const app = {
    get: (path: string, routeHandler: RequestHandler) => {
      if (path === "/api/oauth/callback") handler = routeHandler;
    },
  } as unknown as Express;

  registerOAuthRoutes(app);

  if (!handler) throw new Error("callback route was not registered");
  return handler;
}

function createResponse() {
  const redirects: { status: number; location: string }[] = [];

  const res = {
    cookie: vi.fn(),
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    redirect: (status: number, location: string) => {
      redirects.push({ status, location });
    },
  } as unknown as Response & { redirects: typeof redirects };

  return { res, redirects };
}

function callbackRequest(): Request {
  return {
    query: { code: "auth-code", state: "state-value" },
    protocol: "https",
    headers: {},
  } as unknown as Request;
}

describe("GET /api/oauth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getUserByOpenId).mockResolvedValue({
      id: 7,
      openId: "sample-user",
    } as Awaited<ReturnType<typeof db.getUserByOpenId>>);
    vi.mocked(db.getTwoFactor).mockResolvedValue(null);
  });

  it("sends signed-in users to the workspace, not the landing page", async () => {
    const handler = captureCallbackHandler();
    const { res, redirects } = createResponse();

    await handler(callbackRequest(), res, vi.fn());

    expect(redirects).toEqual([{ status: 302, location: "/app" }]);
  });

  it("issues a full-scope session when the account has no second factor", async () => {
    const handler = captureCallbackHandler();
    const { res } = createResponse();

    await handler(callbackRequest(), res, vi.fn());

    expect(sdk.createSessionToken).toHaveBeenCalledWith(
      "sample-user",
      expect.objectContaining({ scope: "full" })
    );
  });

  it("stops at /login with a pending session when two-step verification is on", async () => {
    vi.mocked(db.getTwoFactor).mockResolvedValue({
      confirmedAt: new Date(),
    } as Awaited<ReturnType<typeof db.getTwoFactor>>);

    const handler = captureCallbackHandler();
    const { res, redirects } = createResponse();

    await handler(callbackRequest(), res, vi.fn());

    expect(sdk.createSessionToken).toHaveBeenCalledWith(
      "sample-user",
      expect.objectContaining({
        scope: "pending_2fa",
        expiresInMs: 10 * 60 * 1000,
      })
    );
    expect(redirects).toEqual([{ status: 302, location: "/login" }]);
  });

  // Scanning the QR code is not the same as proving you can generate a code.
  // Gating on an unconfirmed enrolment would lock people out of their own
  // account halfway through setting it up.
  it("ignores an enrolment that was never confirmed", async () => {
    vi.mocked(db.getTwoFactor).mockResolvedValue({
      confirmedAt: null,
    } as Awaited<ReturnType<typeof db.getTwoFactor>>);

    const handler = captureCallbackHandler();
    const { res, redirects } = createResponse();

    await handler(callbackRequest(), res, vi.fn());

    expect(redirects).toEqual([{ status: 302, location: "/app" }]);
  });

  // A database that answers "no second factor" because it is broken would be a
  // way straight past one. The lookup is allowed to throw, and the throw lands
  // on the failure path rather than in the workspace.
  it("fails sign-in rather than skipping the second factor when the lookup throws", async () => {
    vi.mocked(db.getTwoFactor).mockRejectedValueOnce(
      new Error("connection lost")
    );

    const handler = captureCallbackHandler();
    const { res, redirects } = createResponse();

    await handler(callbackRequest(), res, vi.fn());

    expect(redirects).toEqual([
      { status: 302, location: "/login?auth_error=callback_failed" },
    ]);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  // A browser follows this route, so every failure has to land somewhere the
  // person can act on rather than rendering raw JSON.
  it("redirects to the login page with a reason when code or state is missing", async () => {
    const handler = captureCallbackHandler();
    const { res, redirects } = createResponse();
    const req = {
      query: {},
      protocol: "https",
      headers: {},
    } as unknown as Request;

    await handler(req, res, vi.fn());

    expect(redirects).toEqual([
      { status: 302, location: "/login?auth_error=missing_code" },
    ]);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("redirects to the login page with a reason when user info has no openId", async () => {
    vi.mocked(sdk.getUserInfo).mockResolvedValueOnce({
      openId: "",
    } as Awaited<ReturnType<typeof sdk.getUserInfo>>);

    const handler = captureCallbackHandler();
    const { res, redirects } = createResponse();
    const req = {
      query: { code: "auth-code", state: "state-value" },
      protocol: "https",
      headers: {},
    } as unknown as Request;

    await handler(req, res, vi.fn());

    expect(redirects).toEqual([
      { status: 302, location: "/login?auth_error=no_account" },
    ]);
  });

  it("redirects to the login page with a reason when the token exchange throws", async () => {
    vi.mocked(sdk.exchangeCodeForToken).mockRejectedValueOnce(
      new Error("upstream is down")
    );

    const handler = captureCallbackHandler();
    const { res, redirects } = createResponse();
    const req = {
      query: { code: "auth-code", state: "state-value" },
      protocol: "https",
      headers: {},
    } as unknown as Request;

    await handler(req, res, vi.fn());

    expect(redirects).toEqual([
      { status: 302, location: "/login?auth_error=callback_failed" },
    ]);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
