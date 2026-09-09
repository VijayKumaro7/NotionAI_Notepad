import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  COOKIE_NOTICE_VERSION,
  acknowledgeCookieNotice,
  acknowledgedVersion,
  shouldShowCookieNotice,
} from "./cookieNotice";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shouldShowCookieNotice", () => {
  it("shows the notice to a browser that has not seen it", () => {
    expect(shouldShowCookieNotice()).toBe(true);
  });

  it("stops showing it once acknowledged", () => {
    expect(acknowledgeCookieNotice()).toBe(true);

    expect(acknowledgedVersion()).toBe(COOKIE_NOTICE_VERSION);
    expect(shouldShowCookieNotice()).toBe(false);
  });

  it("asks again when the cookies described have changed", () => {
    // The point of the version. Someone who acknowledged a notice about two
    // strictly necessary cookies has not thereby agreed to an analytics one,
    // and must be told rather than counted.
    localStorage.setItem("cookie-notice-acknowledged", "an-older-notice");

    expect(shouldShowCookieNotice()).toBe(true);
  });
});

describe("when storage is unavailable", () => {
  /** Private-mode browsers throw on both reads and writes. */
  const denyStorage = () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
  };

  it("errs towards telling people rather than crashing", () => {
    denyStorage();

    expect(acknowledgedVersion()).toBeNull();
    expect(shouldShowCookieNotice()).toBe(true);
  });

  it("says the acknowledgement could not be kept", () => {
    // The caller hides the banner for this page load either way; this is how
    // it learns not to promise the dismissal will stick.
    denyStorage();

    expect(acknowledgeCookieNotice()).toBe(false);
  });
});
