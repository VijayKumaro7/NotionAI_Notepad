import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";

const request = (
  over: {
    protocol?: string;
    forwardedProto?: string | string[];
  } = {}
): Request =>
  ({
    protocol: over.protocol ?? "http",
    headers:
      over.forwardedProto !== undefined
        ? { "x-forwarded-proto": over.forwardedProto }
        : {},
  }) as unknown as Request;

describe("getSessionCookieOptions", () => {
  it("keeps the session cookie out of reach of scripts", () => {
    expect(getSessionCookieOptions(request()).httpOnly).toBe(true);
  });

  // SameSite=None would attach the session cookie to requests other sites make
  // to this one, which is what CSRF needs to work. Nothing in this app requires
  // it — the OAuth portal returns by top-level navigation, which Lax allows.
  it("does not send the session cookie on other sites' requests", () => {
    expect(getSessionCookieOptions(request()).sameSite).toBe("lax");
  });

  it("marks the cookie secure over https", () => {
    expect(getSessionCookieOptions(request({ protocol: "https" })).secure).toBe(
      true
    );
  });

  it("trusts x-forwarded-proto, since TLS terminates at the proxy in production", () => {
    expect(
      getSessionCookieOptions(request({ forwardedProto: "https" })).secure
    ).toBe(true);
    expect(
      getSessionCookieOptions(request({ forwardedProto: "https, http" })).secure
    ).toBe(true);
  });

  // Marking it secure over plain http would have the browser drop the cookie,
  // which is how local development ends up unable to stay signed in.
  it("does not mark the cookie secure over plain http", () => {
    expect(getSessionCookieOptions(request()).secure).toBe(false);
    expect(
      getSessionCookieOptions(request({ forwardedProto: "http" })).secure
    ).toBe(false);
  });

  it("scopes the cookie to the whole app", () => {
    expect(getSessionCookieOptions(request()).path).toBe("/");
  });
});

describe("the Secure flag", () => {
  const asProduction = <T>(run: () => T): T => {
    const was = ENV.isProduction;
    // ENV is a plain object read at call time, so this flips cleanly.
    (ENV as { isProduction: boolean }).isProduction = true;
    try {
      return run();
    } finally {
      (ENV as { isProduction: boolean }).isProduction = was;
    }
  };

  it("is set in production even when the request looks like plain http", () => {
    // The failure this guards: a proxy that forgets x-forwarded-proto makes an
    // HTTPS site look like http here, and the cookie would go out without
    // Secure — in clear text on any http request an attacker can provoke.
    // CodeQL flagged exactly that on the Google flow cookie.
    expect(asProduction(() => getSessionCookieOptions(request()).secure)).toBe(true);
  });

  it("is not set in development over plain http", () => {
    // Forcing it everywhere is the tempting fix and it breaks local sign-in:
    // browsers drop a Secure cookie on http, and the flow then fails with a
    // state mismatch that says nothing about why.
    expect(getSessionCookieOptions(request()).secure).toBe(false);
  });

  it("is set in development once the request is actually https", () => {
    expect(getSessionCookieOptions(request({ protocol: "https" })).secure).toBe(true);
    expect(
      getSessionCookieOptions(request({ forwardedProto: "https" })).secure
    ).toBe(true);
  });
});
