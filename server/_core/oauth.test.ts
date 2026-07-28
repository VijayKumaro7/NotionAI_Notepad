import type { Express, Request, RequestHandler, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  upsertUser: vi.fn(async () => undefined),
}));

vi.mock("./sdk", () => ({
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

describe("GET /api/oauth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends signed-in users to the workspace, not the landing page", async () => {
    const handler = captureCallbackHandler();
    const { res, redirects } = createResponse();
    const req = {
      query: { code: "auth-code", state: "state-value" },
      protocol: "https",
      headers: {},
    } as unknown as Request;

    await handler(req, res, vi.fn());

    expect(redirects).toEqual([{ status: 302, location: "/app" }]);
  });

  // A browser follows this route, so every failure has to land somewhere the
  // person can act on rather than rendering raw JSON.
  it("redirects home with a reason when code or state is missing", async () => {
    const handler = captureCallbackHandler();
    const { res, redirects } = createResponse();
    const req = { query: {}, protocol: "https", headers: {} } as unknown as Request;

    await handler(req, res, vi.fn());

    expect(redirects).toEqual([
      { status: 302, location: "/?auth_error=missing_code" },
    ]);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("redirects home with a reason when user info has no openId", async () => {
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
      { status: 302, location: "/?auth_error=no_account" },
    ]);
  });

  it("redirects home with a reason when the token exchange throws", async () => {
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
      { status: 302, location: "/?auth_error=callback_failed" },
    ]);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
