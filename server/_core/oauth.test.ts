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
});
