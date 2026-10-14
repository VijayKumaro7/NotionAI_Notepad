import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let sdk: (typeof import("./sdk"))["sdk"];

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "test-secret-for-verify");
  vi.stubEnv("VITE_APP_ID", "test-app");
  vi.resetModules();
  sdk = (await import("./sdk")).sdk;
});

afterEach(() => vi.restoreAllMocks());

describe("verifySession logging", () => {
  it("says why a cookie was refused by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await sdk.verifySession(undefined)).toBeNull();
    expect(await sdk.verifySession("forged")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("stays silent when asked to, for a caller that asks on every request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await sdk.verifySession(undefined, { quiet: true })).toBeNull();
    expect(await sdk.verifySession("forged", { quiet: true })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("still returns the session for a good token, quiet or not", async () => {
    const token = await sdk.createSessionToken("email:someone", {
      name: "Someone",
      sid: "sid-1",
    });
    const loud = await sdk.verifySession(token);
    const quiet = await sdk.verifySession(token, { quiet: true });
    expect(quiet).toEqual(loud);
    expect(quiet?.openId).toBe("email:someone");
  });
});
