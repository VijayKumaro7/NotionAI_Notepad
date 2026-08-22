import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV = vi.hoisted(() => ({
  recaptchaSiteKey: "",
  recaptchaSecretKey: "",
  publicOrigin: "https://notes.example.test",
  isProduction: false,
}));

vi.mock("./_core/env", () => ({ ENV }));

import {
  isRecaptchaConfigured,
  recaptchaSiteKey,
  verifyRecaptcha,
  RecaptchaError,
} from "./recaptcha";

const fetchMock = vi.fn();

const configure = () => {
  ENV.recaptchaSiteKey = "site-key-public";
  ENV.recaptchaSecretKey = "secret-key-private";
};

const reply = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
});

beforeEach(() => {
  ENV.recaptchaSiteKey = "";
  ENV.recaptchaSecretKey = "";
  ENV.isProduction = false;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("configuration", () => {
  it("is off until both keys are present", () => {
    expect(isRecaptchaConfigured()).toBe(false);
    ENV.recaptchaSiteKey = "site-key-public";
    expect(isRecaptchaConfigured()).toBe(false);
    ENV.recaptchaSecretKey = "secret-key-private";
    expect(isRecaptchaConfigured()).toBe(true);
  });

  it("hands out only the public half", () => {
    configure();
    expect(recaptchaSiteKey()).toBe("site-key-public");
    expect(recaptchaSiteKey()).not.toBe(ENV.recaptchaSecretKey);
  });

  it("reports no site key when switched off", () => {
    expect(recaptchaSiteKey()).toBeNull();
  });
});

describe("verifyRecaptcha when switched off", () => {
  it("passes everything through without calling Google", async () => {
    await expect(verifyRecaptcha("")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifyRecaptcha when switched on", () => {
  beforeEach(configure);

  it("accepts a token Google confirms", async () => {
    fetchMock.mockResolvedValue(reply({ success: true, hostname: "notes.example.test" }));
    await expect(verifyRecaptcha("a-token")).resolves.toBeUndefined();
  });

  it("sends the secret to Google and never the other way round", async () => {
    fetchMock.mockResolvedValue(reply({ success: true }));
    await verifyRecaptcha("a-token", "203.0.113.9");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.google.com/recaptcha/api/siteverify");
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get("secret")).toBe("secret-key-private");
    expect(sent.get("response")).toBe("a-token");
    expect(sent.get("remoteip")).toBe("203.0.113.9");
  });

  it("omits remoteip rather than sending an empty one", async () => {
    fetchMock.mockResolvedValue(reply({ success: true }));
    await verifyRecaptcha("a-token");
    const sent = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(sent.has("remoteip")).toBe(false);
  });

  it("refuses an empty token without asking Google", async () => {
    await expect(verifyRecaptcha("")).rejects.toMatchObject({ reason: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a token Google rejects", async () => {
    fetchMock.mockResolvedValue(
      reply({ success: false, "error-codes": ["timeout-or-duplicate"] })
    );
    await expect(verifyRecaptcha("stale")).rejects.toMatchObject({ reason: "failed" });
  });

  it("keeps Google's error codes out of the message shown to people", async () => {
    // invalid-input-secret means our configuration is wrong, not their answer.
    fetchMock.mockResolvedValue(
      reply({ success: false, "error-codes": ["invalid-input-secret"] })
    );

    const error = await verifyRecaptcha("t").catch(e => e as RecaptchaError);
    expect(error.message).not.toContain("secret");
    expect(error.message).not.toContain("invalid-input");
  });

  it("fails closed when Google cannot be reached", async () => {
    // Letting people through here would make the check switchable off by
    // anyone who can interfere with this server's outbound traffic.
    fetchMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(verifyRecaptcha("t")).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("fails closed on a non-200 from Google", async () => {
    fetchMock.mockResolvedValue(reply({}, false));
    await expect(verifyRecaptcha("t")).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("fails closed on a body that is not JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(verifyRecaptcha("t")).rejects.toMatchObject({ reason: "failed" });
  });

  describe("v3 scores", () => {
    it("accepts a score at or above the threshold", async () => {
      fetchMock.mockResolvedValue(reply({ success: true, score: 0.5 }));
      await expect(verifyRecaptcha("t")).resolves.toBeUndefined();
    });

    it("refuses a score below the threshold", async () => {
      fetchMock.mockResolvedValue(reply({ success: true, score: 0.1 }));
      await expect(verifyRecaptcha("t")).rejects.toMatchObject({ reason: "failed" });
    });

    it("refuses a score of exactly zero", async () => {
      // The most bot-like answer there is, and falsy — a truthiness check would
      // wave it straight through.
      fetchMock.mockResolvedValue(reply({ success: true, score: 0 }));
      await expect(verifyRecaptcha("t")).rejects.toMatchObject({ reason: "failed" });
    });

    it("accepts a v2 response, which carries no score at all", async () => {
      fetchMock.mockResolvedValue(reply({ success: true }));
      await expect(verifyRecaptcha("t")).resolves.toBeUndefined();
    });
  });

  describe("hostname", () => {
    it("refuses a token minted on another domain in production", async () => {
      ENV.isProduction = true;
      fetchMock.mockResolvedValue(
        reply({ success: true, hostname: "phishing.example.invalid" })
      );
      await expect(verifyRecaptcha("t")).rejects.toMatchObject({ reason: "failed" });
    });

    it("accepts our own domain in production", async () => {
      ENV.isProduction = true;
      fetchMock.mockResolvedValue(
        reply({ success: true, hostname: "notes.example.test" })
      );
      await expect(verifyRecaptcha("t")).resolves.toBeUndefined();
    });

    it("does not enforce it in development, where the host varies", async () => {
      // localhost, an IP, a tunnel — Google reports whichever the browser used.
      fetchMock.mockResolvedValue(reply({ success: true, hostname: "localhost" }));
      await expect(verifyRecaptcha("t")).resolves.toBeUndefined();
    });
  });
});
