import type { Express, Request, RequestHandler, Response } from "express";
import { describe, expect, it, vi } from "vitest";

/**
 * The two Google redirect endpoints, at the route level.
 *
 * googleAuth.test.ts already covers the crypto and the account resolution; what
 * is asserted here is what the routes themselves are responsible for — the cap
 * on how often a stranger may run them, and the flags on the cookie that
 * carries the unspent OAuth state.
 *
 * Each test uses its own client address. The limiter is module state shared
 * across the file, so distinct addresses keep one case from spending another's
 * budget.
 */

vi.mock("./db", () => ({}));

vi.mock("./session", () => ({
  establishSession: vi.fn(async () => ({
    needsSecondFactor: false,
    destination: "/app",
  })),
}));

vi.mock("./googleAuth", () => {
  class GoogleAuthError extends Error {
    constructor(
      message: string,
      readonly reason: string
    ) {
      super(message);
    }
  }

  return {
    GoogleAuthError,
    FLOW_TTL_MS: 10 * 60 * 1000,
    isGoogleConfigured: vi.fn(() => true),
    createFlowSecrets: vi.fn(() => ({
      state: "state-value",
      nonce: "nonce-value",
      codeVerifier: "verifier-value",
    })),
    sealFlow: vi.fn(async () => "sealed-flow"),
    flowSecret: vi.fn(() => "flow-secret"),
    authorizeUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth"),
    openFlow: vi.fn(async () => ({
      state: "state-value",
      nonce: "nonce-value",
      codeVerifier: "verifier-value",
    })),
    sameSecret: vi.fn(() => true),
    exchangeCode: vi.fn(async () => ({ sub: "google-sub", email: "a@b.test" })),
    resolveGoogleAccount: vi.fn(async () => ({
      id: 1,
      openId: "google:google-sub",
      name: null,
    })),
  };
});

const { registerGoogleRoutes } = await import("./googleRoutes");

/** Pull one registered handler out without standing up a real express app. */
function handlerFor(routePath: string): RequestHandler {
  let handler: RequestHandler | undefined;

  const app = {
    get: (path: string, routeHandler: RequestHandler) => {
      if (path === routePath) handler = routeHandler;
    },
  } as unknown as Express;

  registerGoogleRoutes(app);

  if (!handler) throw new Error(`${routePath} was not registered`);
  return handler;
}

type CookieCall = { name: string; options: Record<string, unknown> };

function createResponse() {
  const redirects: string[] = [];
  const cookies: CookieCall[] = [];

  const res = {
    cookie: (
      name: string,
      _value: string,
      options: Record<string, unknown>
    ) => {
      cookies.push({ name, options });
    },
    clearCookie: vi.fn(),
    redirect: (_status: number, location: string) => {
      redirects.push(location);
    },
  } as unknown as Response;

  return { res, redirects, cookies };
}

function request(address: string, query: Record<string, string> = {}): Request {
  return {
    query,
    protocol: "https",
    ip: address,
    socket: { remoteAddress: address },
    headers: { cookie: "google_oauth_flow=sealed-flow" },
  } as unknown as Request;
}

describe("/api/auth/google/start", () => {
  it("puts an httpOnly cookie on the response and sends the browser to Google", async () => {
    const start = handlerFor("/api/auth/google/start");
    const { res, redirects, cookies } = createResponse();

    await start(request("198.51.100.1"), res, vi.fn());

    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe("google_oauth_flow");
    // The cookie carries an unspent OAuth state and PKCE verifier, so script
    // must never be able to read it.
    expect(cookies[0].options.httpOnly).toBe(true);
    expect(redirects[0]).toContain("accounts.google.com");
  });

  // Nothing else about the app is a useful limit here: this route is public and
  // spends real work per call, so the address it came from is what caps it.
  it("refuses once one address has run the flow too often", async () => {
    const start = handlerFor("/api/auth/google/start");
    const address = "198.51.100.2";

    for (let attempt = 0; attempt < 30; attempt++) {
      const { res, redirects } = createResponse();
      await start(request(address), res, vi.fn());
      expect(redirects[0]).toContain("accounts.google.com");
    }

    const { res, redirects } = createResponse();
    await start(request(address), res, vi.fn());

    expect(redirects[0]).toBe("/login?error=rate_limited");
  });

  it("counts each address separately", async () => {
    const start = handlerFor("/api/auth/google/start");

    for (let attempt = 0; attempt < 30; attempt++) {
      const { res } = createResponse();
      await start(request("198.51.100.3"), res, vi.fn());
    }

    const { res, redirects } = createResponse();
    await start(request("198.51.100.4"), res, vi.fn());

    expect(redirects[0]).toContain("accounts.google.com");
  });
});

describe("/api/auth/google/callback", () => {
  // The callback makes an outbound token exchange with Google, so it is worth
  // as much as the start route is — and it is reachable without having gone
  // through that route at all.
  it("refuses once one address has returned too often", async () => {
    const callback = handlerFor("/api/auth/google/callback");
    const address = "198.51.100.5";
    const query = { code: "auth-code", state: "state-value" };

    for (let attempt = 0; attempt < 30; attempt++) {
      const { res, redirects } = createResponse();
      await callback(request(address, query), res, vi.fn());
      expect(redirects[0]).toBe("/app");
    }

    const { res, redirects } = createResponse();
    await callback(request(address, query), res, vi.fn());

    expect(redirects[0]).toBe("/login?error=rate_limited");
  });

  // A refused callback still drops the flow cookie. Leaving a live state and
  // verifier in the browser after refusing to use them is the one thing this
  // path must not do.
  it("clears the flow cookie when it refuses", async () => {
    const callback = handlerFor("/api/auth/google/callback");
    const address = "198.51.100.6";
    const query = { code: "auth-code", state: "state-value" };

    for (let attempt = 0; attempt < 30; attempt++) {
      const { res } = createResponse();
      await callback(request(address, query), res, vi.fn());
    }

    const { res } = createResponse();
    await callback(request(address, query), res, vi.fn());

    expect(res.clearCookie).toHaveBeenCalledWith(
      "google_oauth_flow",
      expect.objectContaining({ httpOnly: true })
    );
  });
});
