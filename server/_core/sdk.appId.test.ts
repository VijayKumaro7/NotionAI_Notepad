import { afterEach, describe, expect, it, vi } from "vitest";

describe("session minting without VITE_APP_ID", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const load = async (appId: string) => {
    vi.stubEnv("JWT_SECRET", "test-secret-for-app-id-check");
    vi.stubEnv("VITE_APP_ID", appId);
    vi.resetModules();
    return (await import("./sdk")).sdk;
  };

  it("refuses to issue a token the server would reject on every request", async () => {
    const sdk = await load("");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sdk.createSessionToken("email:abc")).rejects.toThrow(
      /misconfigured/
    );
    log.mockRestore();
  });

  it("names the setting in the log, not in the error the browser sees", async () => {
    const sdk = await load("");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await sdk.createSessionToken("email:abc").catch(e => e);
    expect(error.message).not.toMatch(/VITE_APP_ID/);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/VITE_APP_ID/));
    log.mockRestore();
  });

  it("issues a token that verifies once it is set", async () => {
    const sdk = await load("test-app");
    const token = await sdk.createSessionToken("email:abc", { name: "A" });
    expect(token.split(".")).toHaveLength(3);
  });
});
