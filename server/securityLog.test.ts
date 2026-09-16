/**
 * The audit log, tested for what it does not write down.
 *
 * The useful assertions here are all negative. An audit log that records the
 * right events and also records the password that was tried has made the
 * problem worse, and the only way to know which one this is, is to hand it the
 * dangerous values and check they did not land anywhere.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const written: any[] = [];

vi.mock("./db", () => ({
  recordSecurityEvent: vi.fn(async (event: any) => {
    written.push(event);
  }),
}));

vi.stubEnv("JWT_SECRET", "test-secret-for-audit");

const db = await import("./db");
const { record, recordForUser } = await import("./securityLog");

const request = (overrides: { ip?: string; userAgent?: string } = {}) =>
  ({
    ip: overrides.ip ?? "203.0.113.9",
    socket: { remoteAddress: overrides.ip ?? "203.0.113.9" },
    headers: {
      "user-agent":
        overrides.userAgent ??
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36",
    },
  }) as never;

beforeEach(() => {
  written.length = 0;
  vi.clearAllMocks();
});

describe("record", () => {
  it("writes the event with a pseudonymous origin", async () => {
    await record(request(), { userId: 12, type: "sign_in_succeeded" });

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      userId: 12,
      type: "sign_in_succeeded",
      device: "Chrome on macOS",
      detail: null,
    });
    expect(written[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not keep the address it hashed", async () => {
    await record(request({ ip: "198.51.100.23" }), {
      userId: 12,
      type: "sign_in_succeeded",
    });

    expect(JSON.stringify(written)).not.toContain("198.51.100.23");
  });

  it("does not keep the user agent it summarised", async () => {
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

    await record(request({ userAgent }), {
      userId: 12,
      type: "sign_in_succeeded",
    });

    // The label is drawn from a fixed vocabulary; the high-entropy string that
    // produced it is not stored, so a log row cannot become a fingerprint.
    expect(written[0].device).toBe("Firefox on Windows");
    expect(JSON.stringify(written)).not.toContain("rv:109.0");
  });

  it("records a failed sign-in against no account at all", async () => {
    await record(request(), {
      userId: null,
      type: "sign_in_failed",
      detail: "wrong_password",
    });

    // Writing the address down would assemble, out of failed guesses, exactly
    // the list of addresses the identical error messages refuse to confirm.
    expect(written[0].userId).toBeNull();
  });

  it("has nowhere to put a password, a token or an address", async () => {
    await record(request(), {
      userId: 12,
      type: "password_changed",
    });

    // The row's shape is the control. Every field is either an id, a fixed
    // string from a closed union, or a keyed hash — there is no free-text
    // column for a call site written in a hurry to fill in.
    expect(Object.keys(written[0]).sort()).toEqual([
      "detail",
      "device",
      "ipHash",
      "type",
      "userId",
    ]);
  });

  it("never throws when the store is unavailable", async () => {
    vi.mocked(db.recordSecurityEvent).mockRejectedValueOnce(
      new Error("database is down")
    );

    // An audit write that can fail a request turns a brief database hiccup
    // into a sign-in outage. A missing line is worth much less than that.
    await expect(
      record(request(), { userId: 12, type: "sign_in_succeeded" })
    ).resolves.toBeUndefined();
  });
});

describe("recordForUser", () => {
  it("records nothing about an origin it was not given", async () => {
    await recordForUser({
      userId: 12,
      type: "password_reset_completed",
    });

    // The reset path runs from a link click whose request belongs to whoever
    // clicked, which is not necessarily the person the event is about.
    expect(written[0]).toMatchObject({
      userId: 12,
      type: "password_reset_completed",
      ipHash: null,
      device: null,
    });
  });
});
