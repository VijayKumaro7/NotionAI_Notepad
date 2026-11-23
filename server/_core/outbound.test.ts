import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV = vi.hoisted(() => ({
  emailApiUrl: "https://mail.example.test/send",
  emailApiKey: "k",
  emailFrom: "Notes <no-reply@example.test>",
  publicOrigin: "https://notes.example.test",
  recaptchaSiteKey: "site",
  recaptchaSecretKey: "secret",
  isProduction: false,
  forgeApiUrl: "https://forge.example.test",
  forgeApiKey: "k",
  googleClientId: "id.apps.googleusercontent.com",
  googleClientSecret: "GOCSPX-secret",
  jwtSecret: "x".repeat(40),
}));

vi.mock("./env", () => ({ ENV }));
vi.mock("./env.js", () => ({ ENV }));
vi.mock("../_core/env", () => ({ ENV }));

// A short limit so the callers' real code runs against a server that never
// answers, in milliseconds instead of ten seconds.
vi.mock("./outbound", async importOriginal => {
  const real = await importOriginal<typeof import("./outbound")>();
  return { ...real, outboundSignal: () => AbortSignal.timeout(40) };
});

import { OUTBOUND_TIMEOUT_MS, outboundSignal } from "./outbound";
import { sendEmail, EmailError } from "../email";
import { verifyRecaptcha, RecaptchaError } from "../recaptcha";
import { exchangeCode, GoogleAuthError } from "../googleAuth";
import { notifyOwner } from "./notification";

// What a provider that accepts the connection and then says nothing looks like
// to fetch: it settles only when its signal does.
const stalled = vi.fn((_url: unknown, init?: RequestInit) => {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // no signal: waits for ever, like the real thing
    signal.addEventListener("abort", () => reject(signal.reason));
  });
});

beforeEach(() => {
  stalled.mockClear();
  vi.stubGlobal("fetch", stalled);
});
afterEach(() => vi.unstubAllGlobals());

const settles = async (promise: Promise<unknown>) => {
  const pending = Symbol("pending");
  const result = await Promise.race([
    promise.then(
      v => ({ ok: v }),
      e => ({ error: e })
    ),
    new Promise(r => setTimeout(() => r(pending), 2000)),
  ]);
  return result === pending ? "hung" : result;
};

describe("outboundSignal", () => {
  it("is a ten second limit by default and starts un-aborted", async () => {
    const real =
      await vi.importActual<typeof import("./outbound")>("./outbound");
    expect(OUTBOUND_TIMEOUT_MS).toBe(10_000);
    const signal = real.outboundSignal();
    expect(signal.aborted).toBe(false);
    expect(typeof outboundSignal).toBe("function");
  });
});

describe("a provider that never answers", () => {
  it("fails the email send instead of hanging", async () => {
    const result = (await settles(
      sendEmail({ to: "a@b.test", subject: "s", text: "t" })
    )) as { error?: unknown };
    expect(result.error).toBeInstanceOf(EmailError);
    expect(stalled).toHaveBeenCalledTimes(1);
  });

  it("fails the reCAPTCHA check closed instead of hanging", async () => {
    const result = (await settles(verifyRecaptcha("tok", "1.2.3.4"))) as {
      error?: unknown;
    };
    expect(result.error).toBeInstanceOf(RecaptchaError);
  });

  it("fails the Google code exchange instead of hanging", async () => {
    const result = (await settles(
      exchangeCode({ code: "c", codeVerifier: "v", nonce: "n" })
    )) as { error?: unknown };
    expect(result.error).toBeInstanceOf(GoogleAuthError);
  });

  it("makes the owner notification report false instead of hanging", async () => {
    const result = (await settles(
      notifyOwner({ title: "t", content: "c" })
    )) as { ok?: unknown };
    expect(result.ok).toBe(false);
  });
});
