import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two Google redirect endpoints, driven over real HTTP.
 *
 * googleAuth.test.ts covers the crypto and the account resolution. What is
 * asserted here is what the routes themselves own: the cap on how often a
 * stranger may run them, and the flags on the cookie carrying the unspent OAuth
 * state.
 *
 * A real express app rather than a captured handler, which is what this file
 * used to do. The limit is express-rate-limit middleware now, and middleware is
 * not something a fake `app.get` can exercise — calling the handler directly
 * would walk straight past the thing under test and pass regardless.
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

let server: Server;
let origin: string;

beforeEach(async () => {
  // One trusted hop, so clientAddress — and therefore the limiter's key —
  // reads the X-Forwarded-For entry each request sets below. Without it the
  // tests would all share 127.0.0.1 and one bucket.
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");

  const app: Express = express();
  registerGoogleRoutes(app);

  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });
});

/** One request from `address`, without following the redirect. */
function get(path: string, address: string): Promise<Response> {
  return fetch(`${origin}${path}`, {
    redirect: "manual",
    headers: {
      "x-forwarded-for": address,
      cookie: "google_oauth_flow=sealed-flow",
    },
  });
}

const START = "/api/auth/google/start";
const CALLBACK = "/api/auth/google/callback?code=auth-code&state=state-value";

describe("/api/auth/google/start", () => {
  it("sets an httpOnly cookie and sends the browser to Google", async () => {
    const response = await get(START, "198.51.100.1");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("accounts.google.com");

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("google_oauth_flow=");
    // The cookie carries an unspent OAuth state and PKCE verifier, so script
    // must never be able to read it.
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("refuses once one address has run the flow too often", async () => {
    const address = "198.51.100.2";

    for (let attempt = 0; attempt < 30; attempt++) {
      const allowed = await get(START, address);
      expect(allowed.headers.get("location")).toContain("accounts.google.com");
    }

    const refused = await get(START, address);
    expect(refused.headers.get("location")).toBe("/login?error=rate_limited");
  });

  // Otherwise one visitor exhausting the budget would lock out everyone behind
  // a different address, which is a denial of service rather than a limit.
  it("counts each address separately", async () => {
    for (let attempt = 0; attempt < 31; attempt++) {
      await get(START, "198.51.100.3");
    }

    const other = await get(START, "198.51.100.4");
    expect(other.headers.get("location")).toContain("accounts.google.com");
  });

  // The middleware answers with the standard headers, which the hand-rolled
  // check it replaced did not — a client can now tell how much budget is left.
  it("reports the remaining budget", async () => {
    const response = await get(START, "198.51.100.7");

    expect(response.headers.get("ratelimit")).toBe(
      "limit=30, remaining=29, reset=900"
    );
    expect(response.headers.get("ratelimit-policy")).toBe("30;w=900");
  });
});

describe("/api/auth/google/callback", () => {
  // The callback makes an outbound token exchange with Google, so it is worth
  // as much as the start route — and it is reachable without having gone
  // through that route at all.
  it("refuses once one address has returned too often", async () => {
    const address = "198.51.100.5";

    for (let attempt = 0; attempt < 30; attempt++) {
      const allowed = await get(CALLBACK, address);
      expect(allowed.headers.get("location")).toBe("/app");
    }

    const refused = await get(CALLBACK, address);
    expect(refused.headers.get("location")).toBe("/login?error=rate_limited");
  });

  // A refused request still drops the flow cookie. Leaving a live state and
  // verifier in the browser after refusing to spend them is the one thing this
  // path must not do.
  it("clears the flow cookie when it refuses", async () => {
    const address = "198.51.100.6";

    for (let attempt = 0; attempt < 30; attempt++) await get(CALLBACK, address);

    const refused = await get(CALLBACK, address);
    const cookie = refused.headers.get("set-cookie") ?? "";

    expect(cookie).toContain("google_oauth_flow=");
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });

  // Both routes draw on one budget, so a caller cannot get thirty more by
  // switching halves of the flow.
  it("shares its budget with the start route", async () => {
    const address = "198.51.100.8";

    for (let attempt = 0; attempt < 30; attempt++) await get(START, address);

    const refused = await get(CALLBACK, address);
    expect(refused.headers.get("location")).toBe("/login?error=rate_limited");
  });
});
