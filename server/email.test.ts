import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted, because vi.mock is lifted above ordinary declarations and its
// factory cannot close over a plain const declared below it.
const ENV = vi.hoisted(() => ({
  emailApiUrl: "",
  emailApiKey: "",
  emailFrom: "",
  publicOrigin: "",
}));

vi.mock("./_core/env", () => ({ ENV }));

import { sendEmail, isEmailConfigured, appUrl, EmailError } from "./email";

const configure = () => {
  ENV.emailApiUrl = "https://mail.example.test/send";
  ENV.emailApiKey = "test-key";
  ENV.emailFrom = "Notes <no-reply@example.test>";
  ENV.publicOrigin = "https://notes.example.test";
};

const clear = () => {
  ENV.emailApiUrl = "";
  ENV.emailApiKey = "";
  ENV.emailFrom = "";
  ENV.publicOrigin = "";
};

describe("isEmailConfigured", () => {
  beforeEach(clear);

  it("is false when nothing is set", () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it("is false when only some of it is set", () => {
    ENV.emailApiUrl = "https://mail.example.test/send";
    expect(isEmailConfigured()).toBe(false);
    ENV.emailApiKey = "k";
    expect(isEmailConfigured()).toBe(false);
  });

  it("is true once url, key and from are all present", () => {
    configure();
    expect(isEmailConfigured()).toBe(true);
  });
});

describe("sendEmail", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    configure();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refuses to send when unconfigured instead of pretending", async () => {
    clear();
    await expect(
      sendEmail({ to: "a@b.test", subject: "s", text: "t" })
    ).rejects.toMatchObject({ reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the message to the configured provider", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await sendEmail({ to: "person@example.test", subject: "Hello", text: "Body" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://mail.example.test/send");
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toEqual({
      from: "Notes <no-reply@example.test>",
      to: ["person@example.test"],
      subject: "Hello",
      text: "Body",
    });
  });

  it.each([
    ["recipient", { to: "a@b.test\nbcc: victim@example.test", subject: "s", text: "t" }],
    ["subject", { to: "a@b.test", subject: "s\r\nbcc: victim@example.test", text: "t" }],
  ])("refuses a newline in the %s", async (_field, message) => {
    await expect(sendEmail(message)).rejects.toBeInstanceOf(EmailError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a provider rejection rather than resolving", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable",
      text: async () => "bad recipient",
    });

    await expect(
      sendEmail({ to: "a@b.test", subject: "s", text: "t" })
    ).rejects.toMatchObject({ reason: "send_failed" });
  });

  it("reports a network failure rather than hanging or resolving", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      sendEmail({ to: "a@b.test", subject: "s", text: "t" })
    ).rejects.toMatchObject({ reason: "send_failed" });
  });
});

describe("appUrl", () => {
  beforeEach(configure);

  it("builds an absolute link from the configured origin", () => {
    expect(appUrl("/verify?token=abc")).toBe(
      "https://notes.example.test/verify?token=abc"
    );
  });

  it("refuses to build a link when the origin is unset", () => {
    clear();
    expect(() => appUrl("/verify")).toThrow(EmailError);
  });

  it("cannot be talked into pointing at another host", () => {
    // The path is ours, but this pins the behaviour: whatever is passed
    // resolves against PUBLIC_ORIGIN, so a link in an email can only ever
    // point at this app — never at a host taken from a request header.
    expect(appUrl("/reset?token=x").startsWith("https://notes.example.test/")).toBe(true);
  });
});
