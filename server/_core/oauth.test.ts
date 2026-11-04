import type { Express, Request, RequestHandler, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  upsertUser: vi.fn(async () => undefined),
  getUserByOpenId: vi.fn(async () => ({ id: 7, openId: "sample-user" })),
  getTwoFactor: vi.fn(async () => null),
  // Signing in now writes a session row, so the callback cannot complete
  // without a store that accepts one. Returning a row is what "the session was
  // recorded" looks like to establishSession.
  createSession: vi.fn(async (input: Record<string, unknown>) => ({
    id: 1,
    ...input,
  })),
  recordSecurityEvent: vi.fn(async () => undefined),
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

// The flow cookie is signed with JWT_SECRET, read when the modules load.
process.env.JWT_SECRET = "oauth-test-secret-0123456789abcdef0123456789abcdef";
process.env.VITE_APP_ID = "test-app";
process.env.VITE_OAUTH_PORTAL_URL = "https://portal.example.com";
process.env.PUBLIC_ORIGIN = "https://app.example.com";

const db = await import("../db");
const { sdk } = await import("./sdk");
const { registerOAuthRoutes } = await import("./oauth");

function captureHandlers(): {
  start: RequestHandler;
  callback: RequestHandler;
} {
  const handlers: Record<string, RequestHandler> = {};

  const app = {
    get: (path: string, routeHandler: RequestHandler) => {
      handlers[path] = routeHandler;
    },
  } as unknown as Express;

  registerOAuthRoutes(app);

  if (!handlers["/api/oauth/callback"] || !handlers["/api/oauth/start"]) {
    throw new Error("OAuth routes were not registered");
  }
  return {
    start: handlers["/api/oauth/start"],
    callback: handlers["/api/oauth/callback"],
  };
}

function captureCallbackHandler(): RequestHandler {
  return captureHandlers().callback;
}

/** Runs the start route and returns what the browser would keep and follow. */
async function startFlow() {
  const { res, redirects } = createResponse();
  await captureHandlers().start(
    { protocol: "https", headers: {}, query: {} } as unknown as Request,
    res,
    vi.fn()
  );
  const cookie = vi.mocked(res.cookie).mock.calls[0];
  const portal = new URL(redirects[0].location);
  return {
    cookieName: cookie[0] as string,
    cookieValue: cookie[1] as string,
    state: portal.searchParams.get("state") as string,
    portal,
  };
}

function createResponse() {
  const redirects: { status: number; location: string }[] = [];

  const res = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    redirect: (status: number, location: string) => {
      redirects.push({ status, location });
    },
  } as unknown as Response & { redirects: typeof redirects };

  return { res, redirects };
}

let flow: Awaited<ReturnType<typeof startFlow>>;

function requestWith(
  query: Record<string, string>,
  cookie: string | null = `${flow.cookieName}=${flow.cookieValue}`
): Request {
  return {
    query,
    protocol: "https",
    headers: cookie ? { cookie } : {},
  } as unknown as Request;
}

function callbackRequest(): Request {
  return requestWith({ code: "auth-code", state: flow.state });
}

describe("GET /api/oauth/callback", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    flow = await startFlow();
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
    const req = requestWith({});

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
    const req = callbackRequest();

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
    const req = callbackRequest();

    await handler(req, res, vi.fn());

    expect(redirects).toEqual([
      { status: 302, location: "/login?auth_error=callback_failed" },
    ]);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("sends the browser to the portal with a server-issued state kept in an HttpOnly cookie", async () => {
    expect(flow.portal.origin + flow.portal.pathname).toBe(
      "https://portal.example.com/app-auth"
    );
    expect(flow.portal.searchParams.get("redirectUri")).toBe(
      "https://app.example.com/api/oauth/callback"
    );
    expect(flow.state.length).toBeGreaterThanOrEqual(43);

    const { res, redirects } = createResponse();
    await captureHandlers().start(
      { protocol: "https", headers: {}, query: {} } as unknown as Request,
      res,
      vi.fn()
    );
    const options = vi.mocked(res.cookie).mock.calls[0][2];
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax" });
    // A different state every time: it is not derivable from the origin.
    expect(new URL(redirects[0].location).searchParams.get("state")).not.toBe(
      flow.state
    );
  });

  // Pinning Secure to a literal true would settle a scanner alert and break
  // sign-in over plain http, where the browser drops the cookie. The flag is
  // the request's own (and always true in production, see cookies.ts).
  it("marks the flow cookie Secure only when the request arrived over https", async () => {
    const cookieFor = async (protocol: string) => {
      const { res } = createResponse();
      await captureHandlers().start(
        { protocol, headers: {}, query: {} } as unknown as Request,
        res,
        vi.fn()
      );
      return vi.mocked(res.cookie).mock.calls[0][2] as { secure: boolean };
    };

    expect((await cookieFor("https")).secure).toBe(true);
    expect((await cookieFor("http")).secure).toBe(false);
  });

  // The attack this closes: a callback link carrying the attacker's own code,
  // opened in a browser that never started a sign-in.
  it("refuses a callback from a browser that did not start the flow", async () => {
    const { res, redirects } = createResponse();

    await captureCallbackHandler()(
      requestWith({ code: "attackers-code", state: flow.state }, null),
      res,
      vi.fn()
    );

    expect(redirects).toEqual([
      { status: 302, location: "/login?auth_error=bad_state" },
    ]);
    expect(sdk.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("refuses a callback whose state does not match the cookie", async () => {
    const { res, redirects } = createResponse();

    await captureCallbackHandler()(
      requestWith({ code: "auth-code", state: "btoa-of-the-origin" }),
      res,
      vi.fn()
    );

    expect(redirects).toEqual([
      { status: 302, location: "/login?auth_error=bad_state" },
    ]);
    expect(sdk.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it("uses the redirect URI the server sealed, not one carried in the request", async () => {
    const { res } = createResponse();

    await captureCallbackHandler()(callbackRequest(), res, vi.fn());

    expect(sdk.exchangeCodeForToken).toHaveBeenCalledWith(
      "auth-code",
      "https://app.example.com/api/oauth/callback"
    );
  });

  it("clears the flow cookie so a state is used once", async () => {
    const { res } = createResponse();
    await captureCallbackHandler()(callbackRequest(), res, vi.fn());

    expect(res.clearCookie).toHaveBeenCalledWith(
      flow.cookieName,
      expect.any(Object)
    );
  });
});
