import { beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_SESSION_MS,
  demoTimeRemaining,
  endDemoSession,
  formatTimeRemaining,
  isDemoSessionActive,
  isDemoSessionExpired,
  startDemoSession,
} from "./demoSession";

const T0 = 1_700_000_000_000;

beforeEach(() => {
  localStorage.clear();
});

describe("starting a demo", () => {
  it("allocates thirty minutes", () => {
    expect(DEMO_SESSION_MS).toBe(30 * 60 * 1000);
    expect(startDemoSession(T0)).toBe(T0 + DEMO_SESSION_MS);
  });

  it("is active immediately", () => {
    startDemoSession(T0);
    expect(isDemoSessionActive(T0)).toBe(true);
    expect(isDemoSessionExpired(T0)).toBe(false);
  });

  // Otherwise picking a second template would hand out another half hour.
  it("does not extend a session that is already running", () => {
    const first = startDemoSession(T0);
    const second = startDemoSession(T0 + 10 * 60 * 1000);

    expect(second).toBe(first);
  });

  it("starts a fresh window once the previous one has expired", () => {
    startDemoSession(T0);
    const later = T0 + DEMO_SESSION_MS + 1;

    expect(startDemoSession(later)).toBe(later + DEMO_SESSION_MS);
  });
});

describe("time remaining", () => {
  it("counts down as time passes", () => {
    startDemoSession(T0);

    expect(demoTimeRemaining(T0)).toBe(DEMO_SESSION_MS);
    expect(demoTimeRemaining(T0 + 10 * 60 * 1000)).toBe(20 * 60 * 1000);
  });

  it("never goes negative", () => {
    startDemoSession(T0);
    expect(demoTimeRemaining(T0 + DEMO_SESSION_MS + 60_000)).toBe(0);
  });

  it("reports nothing when no demo was ever started", () => {
    expect(demoTimeRemaining(T0)).toBe(0);
    expect(isDemoSessionActive(T0)).toBe(false);
  });
});

describe("expiry", () => {
  it("is expired once the deadline passes", () => {
    startDemoSession(T0);
    const after = T0 + DEMO_SESSION_MS + 1;

    expect(isDemoSessionActive(after)).toBe(false);
    expect(isDemoSessionExpired(after)).toBe(true);
  });

  it("is expired exactly on the deadline, not a moment later", () => {
    startDemoSession(T0);
    const onTheDot = T0 + DEMO_SESSION_MS;

    expect(isDemoSessionActive(onTheDot)).toBe(false);
    expect(isDemoSessionExpired(onTheDot)).toBe(true);
  });

  // "Never started" and "started and ran out" are different states: only the
  // second should trigger the sign-in prompt.
  it("distinguishes never-started from expired", () => {
    expect(isDemoSessionExpired(T0)).toBe(false);

    startDemoSession(T0);
    expect(isDemoSessionExpired(T0 + DEMO_SESSION_MS)).toBe(true);
  });

  it("reports neither active nor expired after ending", () => {
    startDemoSession(T0);
    endDemoSession();

    expect(isDemoSessionActive(T0)).toBe(false);
    expect(isDemoSessionExpired(T0 + DEMO_SESSION_MS + 1)).toBe(false);
  });
});

describe("the deadline is absolute", () => {
  // Stored as a timestamp, so a reload cannot buy more time.
  it("survives a reload without resetting", () => {
    startDemoSession(T0);
    const halfway = T0 + 15 * 60 * 1000;

    // A reload re-reads storage rather than restarting the clock.
    expect(demoTimeRemaining(halfway)).toBe(15 * 60 * 1000);
  });

  it("ignores a corrupted stored value", () => {
    localStorage.setItem("demo-session-expires-at", "not-a-number");

    expect(demoTimeRemaining(T0)).toBe(0);
    expect(isDemoSessionActive(T0)).toBe(false);
    expect(isDemoSessionExpired(T0)).toBe(false);
  });
});

describe("formatTimeRemaining", () => {
  it("renders mm:ss", () => {
    expect(formatTimeRemaining(30 * 60 * 1000)).toBe("30:00");
    expect(formatTimeRemaining(9 * 60 * 1000 + 5_000)).toBe("9:05");
    expect(formatTimeRemaining(45_000)).toBe("0:45");
  });

  it("shows zero rather than a negative time", () => {
    expect(formatTimeRemaining(0)).toBe("0:00");
    expect(formatTimeRemaining(-5_000)).toBe("0:00");
  });

  // Ceiling, so the badge does not read 0:00 while a second still remains.
  it("rounds part-seconds up", () => {
    expect(formatTimeRemaining(500)).toBe("0:01");
  });
});
