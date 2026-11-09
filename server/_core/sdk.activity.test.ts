import { describe, expect, it } from "vitest";
import { ACTIVITY_WRITE_INTERVAL_MS, needsActivityWrite } from "./sdk";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);
const user = (over: Record<string, unknown> = {}) => ({
  openId: "email:someone",
  role: "user" as const,
  lastSignedIn: ago(1000),
  ...over,
});

describe("needsActivityWrite", () => {
  it("skips the write when the timestamp is recent", () => {
    expect(needsActivityWrite(user(), "", NOW)).toBe(false);
    expect(
      needsActivityWrite(
        user({ lastSignedIn: ago(ACTIVITY_WRITE_INTERVAL_MS - 1) }),
        "",
        NOW
      )
    ).toBe(false);
  });

  it("writes once the timestamp is older than the interval", () => {
    expect(
      needsActivityWrite(
        user({ lastSignedIn: ago(ACTIVITY_WRITE_INTERVAL_MS) }),
        "",
        NOW
      )
    ).toBe(true);
  });

  it("writes when the stored time is in the future, so it gets corrected", () => {
    expect(
      needsActivityWrite(user({ lastSignedIn: ago(-60_000) }), "", NOW)
    ).toBe(true);
  });

  it("still promotes the owner straight away, however recent the stamp", () => {
    // The upsert is also what grants the admin role; a recent timestamp must
    // not delay that.
    expect(needsActivityWrite(user(), "email:someone", NOW)).toBe(true);
  });

  it("leaves an owner who is already an admin alone", () => {
    expect(
      needsActivityWrite(user({ role: "admin" }), "email:someone", NOW)
    ).toBe(false);
  });

  it("does not treat an unset owner id as matching anyone", () => {
    expect(needsActivityWrite(user({ openId: "" }), "", NOW)).toBe(false);
  });
});
