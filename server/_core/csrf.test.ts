import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({ ENV: { publicOrigin: "" } }));

const { ENV } = await import("./env");
const { isAllowedRequestOrigin, requireSameOrigin } = await import("./csrf");

function request(
  overrides: {
    method?: string;
    origin?: string;
    referer?: string;
    host?: string;
  } = {}
): Request {
  const headers: Record<string, string> = {};
  if (overrides.origin !== undefined) headers.origin = overrides.origin;
  if (overrides.referer !== undefined) headers.referer = overrides.referer;
  headers.host = overrides.host ?? "notes.example.com";

  return { method: overrides.method ?? "POST", headers } as unknown as Request;
}

function response() {
  const sent: { status: number; body: unknown }[] = [];
  const res = {
    status: (code: number) => ({
      json: (body: unknown) => sent.push({ status: code, body }),
    }),
  } as unknown as Response;

  return { res, sent };
}

beforeEach(() => {
  (ENV as { publicOrigin: string }).publicOrigin = "";
});

describe("isAllowedRequestOrigin", () => {
  it("allows a request our own page made", () => {
    expect(
      isAllowedRequestOrigin(request({ origin: "https://notes.example.com" }))
    ).toBe(true);
  });

  it("refuses a request another site made", () => {
    expect(
      isAllowedRequestOrigin(request({ origin: "https://evil.example" }))
    ).toBe(false);
  });

  it("is not fooled by a host that merely starts the same way", () => {
    expect(
      isAllowedRequestOrigin(
        request({ origin: "https://notes.example.com.evil.example" })
      )
    ).toBe(false);
  });

  it("refuses a sandboxed frame's opaque origin", () => {
    // `Origin: null` is what a sandboxed iframe or a data: document sends. It
    // matches nothing, and treating it as "no origin" would wave it through.
    expect(isAllowedRequestOrigin(request({ origin: "null" }))).toBe(false);
  });

  it("refuses an origin that is not a URL at all", () => {
    expect(isAllowedRequestOrigin(request({ origin: "not a url" }))).toBe(
      false
    );
  });

  it("prefers the configured origin over the Host header", () => {
    (ENV as { publicOrigin: string }).publicOrigin =
      "https://notes.example.com";

    // A caller who sets Host to match its own Origin gains nothing: the
    // deployment's own statement of what it is decides.
    expect(
      isAllowedRequestOrigin(
        request({ origin: "https://evil.example", host: "evil.example" })
      )
    ).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    expect(
      isAllowedRequestOrigin(
        request({ referer: "https://notes.example.com/app/notes" })
      )
    ).toBe(true);

    expect(
      isAllowedRequestOrigin(
        request({ referer: "https://evil.example/attack" })
      )
    ).toBe(false);
  });

  it("allows a request with neither header", () => {
    // curl, a health check, a test. No ambient cookie, so nothing to abuse —
    // and every browser sends one of the two on a cross-site POST.
    expect(isAllowedRequestOrigin(request({}))).toBe(true);
  });
});

describe("requireSameOrigin", () => {
  it("refuses a cross-site mutation with 403 and no detail", () => {
    const { res, sent } = response();
    const next = vi.fn();

    requireSameOrigin(
      request({ origin: "https://evil.example" }),
      res,
      next as unknown as NextFunction
    );

    expect(next).not.toHaveBeenCalled();
    expect(sent).toEqual([
      { status: 403, body: { error: "Cross-origin request refused." } },
    ]);
    // Naming the origin we expected would help someone mapping the deployment
    // and nobody fixing a real problem.
    expect(JSON.stringify(sent)).not.toContain("notes.example.com");
  });

  it("lets our own page through", () => {
    const { res, sent } = response();
    const next = vi.fn();

    requireSameOrigin(
      request({ origin: "https://notes.example.com" }),
      res,
      next as unknown as NextFunction
    );

    expect(next).toHaveBeenCalledOnce();
    expect(sent).toEqual([]);
  });

  it("does not stand in the way of reads", () => {
    const { res } = response();
    const next = vi.fn();

    requireSameOrigin(
      request({ method: "GET", origin: "https://evil.example" }),
      res,
      next as unknown as NextFunction
    );

    // A tRPC query is a GET and changes nothing; the same-origin policy already
    // stops another page from reading the answer.
    expect(next).toHaveBeenCalledOnce();
  });
});
