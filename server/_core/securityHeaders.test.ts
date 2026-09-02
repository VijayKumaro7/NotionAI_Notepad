import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requireHttps, safePath, securityHeaders } from "./securityHeaders";

const request = (over: Partial<Request> = {}) =>
  ({
    protocol: "http",
    method: "GET",
    originalUrl: "/app",
    headers: {},
    // Something remote, unless a case says otherwise: the loopback exemption
    // must not be what every other test is accidentally exercising.
    socket: { remoteAddress: "203.0.113.7" },
    ...over,
  }) as Request;

const response = () => {
  const headers = new Map<string, string>();
  const res = {
    setHeader: (name: string, value: string) => headers.set(name, value),
    redirect: vi.fn(),
    status: vi.fn(() => res),
    json: vi.fn(),
    headers,
  };
  return res as unknown as Response & { headers: Map<string, string> };
};

const run = (req: Request, res: Response) => {
  const next = vi.fn() as unknown as NextFunction;
  securityHeaders(req, res, next);
  return next;
};

const policy = (res: Response & { headers: Map<string, string> }) =>
  res.headers.get("Content-Security-Policy") ?? "";

describe("securityHeaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to be framed, in both the modern and the legacy way", () => {
    const res = response();
    run(request(), res);

    expect(policy(res)).toContain("frame-ancestors 'none'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("keeps a reset token out of cross-origin requests", () => {
    // The token rides in the query string, and the reset page loads a font
    // from Google.
    const res = response();
    run(request({ originalUrl: "/reset-password?token=secret" }), res);

    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
  });

  it("leaves the microphone available and refuses the rest", () => {
    const res = response();
    run(request(), res);

    const permissions = res.headers.get("Permissions-Policy") ?? "";
    expect(permissions).toContain("microphone=(self)");
    expect(permissions).toContain("camera=()");
    expect(permissions).toContain("geolocation=()");
  });

  it("allows what the app actually loads", () => {
    const res = response();
    run(request(), res);

    // reCAPTCHA's script and its challenge frame, Google's fonts, the landing
    // page's screenshots, the QR code, a recorded memo.
    expect(policy(res)).toContain("https://www.google.com");
    expect(policy(res)).toContain("https://fonts.gstatic.com");
    expect(policy(res)).toContain("https://d2xsxph8kpxj0f.cloudfront.net");
    expect(policy(res)).toMatch(/img-src[^;]*data:/);
    expect(policy(res)).toMatch(/media-src[^;]*blob:/);
  });

  it("does not send HSTS over a plain connection", () => {
    const res = response();
    run(request(), res);

    // Meaningless on http, and on a laptop it pins localhost to https for a
    // year.
    expect(res.headers.has("Strict-Transport-Security")).toBe(false);
  });

  it("sends HSTS when a proxy reports TLS", () => {
    const res = response();
    run(request({ headers: { "x-forwarded-proto": "https, http" } }), res);

    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
  });

  it("keeps the dev server working, and does not ship its allowances", () => {
    const dev = response();
    run(request(), dev);
    expect(policy(dev)).toContain("'unsafe-eval'");
    expect(policy(dev)).toContain("ws:");

    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    // ENV is read at import time, so production needs a fresh module graph.
    return import("./securityHeaders").then(fresh => {
      const prod = response();
      fresh.securityHeaders(
        request(),
        prod,
        vi.fn() as unknown as NextFunction
      );

      expect(policy(prod)).not.toContain("'unsafe-eval'");
      expect(policy(prod)).not.toContain("'unsafe-inline' https://www.google");
      expect(policy(prod)).toContain("upgrade-insecure-requests");
    });
  });
});

describe("safePath", () => {
  it("leaves an ordinary path alone", () => {
    expect(safePath("/app?note=3")).toBe("/app?note=3");
  });

  it("refuses to resolve to another origin", () => {
    // //evil.example is protocol-relative, and a browser reads \\ the same way.
    expect(safePath("//evil.example/x")).toBe("/evil.example/x");
    expect(safePath("\\\\evil.example/x")).toBe("/evil.example/x");
    expect(safePath("/\\evil.example")).toBe("/evil.example");
  });
});

describe("requireHttps", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing in development", () => {
    const res = response();
    const next = vi.fn() as unknown as NextFunction;
    requireHttps(request(), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("redirects a plain-http page request in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_ORIGIN", "https://notes.example.com");
    const fresh = await import("./securityHeaders");

    const res = response();
    fresh.requireHttps(
      request({ originalUrl: "/login" }),
      res,
      vi.fn() as unknown as NextFunction
    );

    expect(res.redirect).toHaveBeenCalledWith(
      308,
      "https://notes.example.com/login"
    );
  });

  it("cannot be pointed at another origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_ORIGIN", "https://notes.example.com");
    const fresh = await import("./securityHeaders");

    const res = response();
    fresh.requireHttps(
      request({ originalUrl: "//evil.example/steal" }),
      res,
      vi.fn() as unknown as NextFunction
    );

    expect(res.redirect).toHaveBeenCalledWith(
      308,
      "https://notes.example.com/evil.example/steal"
    );
  });

  it("refuses rather than redirects a request with a body", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fresh = await import("./securityHeaders");

    const res = response();
    fresh.requireHttps(
      request({ method: "POST", originalUrl: "/api/trpc/auth.signIn" }),
      res,
      vi.fn() as unknown as NextFunction
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("lets the production build be checked over http on this machine", async () => {
    // `pnpm start` and scripts/smoke.sh both do exactly this.
    vi.stubEnv("NODE_ENV", "production");
    const fresh = await import("./securityHeaders");

    const res = response();
    const next = vi.fn() as unknown as NextFunction;
    fresh.requireHttps(
      request({ socket: { remoteAddress: "127.0.0.1" } as never }),
      res,
      next
    );

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("still redirects a proxied request that merely looks local", async () => {
    // A forwarding header means something is in front of this server, whatever
    // the socket says — so the exemption does not apply.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_ORIGIN", "https://notes.example.com");
    const fresh = await import("./securityHeaders");

    const res = response();
    fresh.requireHttps(
      request({
        socket: { remoteAddress: "127.0.0.1" } as never,
        headers: { "x-forwarded-proto": "http" },
      }),
      res,
      vi.fn() as unknown as NextFunction
    );

    expect(res.redirect).toHaveBeenCalledWith(
      308,
      "https://notes.example.com/app"
    );
  });

  it("lets a request through when a proxy reports TLS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fresh = await import("./securityHeaders");

    const res = response();
    const next = vi.fn() as unknown as NextFunction;
    fresh.requireHttps(
      request({ headers: { "x-forwarded-proto": "https" } }),
      res,
      next
    );

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
