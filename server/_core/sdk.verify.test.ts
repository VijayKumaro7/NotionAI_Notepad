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

describe("verifySession and a user with no name", () => {
  const signWith = async (claims: Record<string, unknown>) => {
    const { SignJWT } = await import("jose");
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("test-secret-for-verify"));
  };
  const base = {
    openId: "email:someone",
    appId: "test-app",
    scope: "full",
    sid: "sid-1",
  };

  it("accepts the token minted for an account that never gave a name", async () => {
    // What session.ts mints for a user whose name is null: `user.name || ""`.
    const token = await sdk.createSessionToken("email:someone", {
      name: "",
      sid: "sid-1",
    });
    const session = await sdk.verifySession(token, { quiet: true });
    expect(session).toMatchObject({
      openId: "email:someone",
      name: "",
      scope: "full",
      sid: "sid-1",
    });
  });

  it("accepts a half-signed-in token for a nameless account, so the second step can be reached", async () => {
    const token = await sdk.createSessionToken("email:someone", {
      scope: "pending_2fa",
      sid: "sid-1",
    });
    expect((await sdk.verifySession(token, { quiet: true }))?.scope).toBe(
      "pending_2fa"
    );
  });

  it("still returns a name when there is one", async () => {
    const token = await sdk.createSessionToken("email:someone", {
      name: "Ada",
      sid: "sid-1",
    });
    expect((await sdk.verifySession(token, { quiet: true }))?.name).toBe("Ada");
  });

  it("still refuses a token with no name claim at all, which this server never signs", async () => {
    const token = await signWith({ ...base });
    expect(await sdk.verifySession(token, { quiet: true })).toBeNull();
  });

  it("still refuses a name that is not a string", async () => {
    for (const name of [42, null, ["Ada"]]) {
      const token = await signWith({ ...base, name });
      expect(await sdk.verifySession(token, { quiet: true })).toBeNull();
    }
  });

  it("still requires an account and an app id", async () => {
    for (const claims of [
      { ...base, name: "", openId: "" },
      { ...base, name: "", appId: "" },
      { ...base, name: "", openId: undefined },
    ]) {
      const token = await signWith(claims);
      expect(await sdk.verifySession(token, { quiet: true })).toBeNull();
    }
  });
});
