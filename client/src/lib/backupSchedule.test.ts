import { describe, it, expect } from "vitest";
import {
  BACKUP_INTERVAL_MS,
  BACKUP_SETTLE_MS,
  VERIFY_INTERVAL_MS,
  backupDue,
  verificationDue,
  describeAge,
  describeBackupHealth,
} from "./backupSchedule";

const READY = 1_000_000_000;
const settled = READY + BACKUP_SETTLE_MS;

const clock = (over: Partial<Parameters<typeof backupDue>[0]> = {}) => ({
  lastBackupAt: null,
  lastVerifiedAt: null,
  readyAt: READY,
  now: settled,
  ...over,
});

describe("when an automatic backup is owed", () => {
  it("waits for the workspace to settle before the first one", () => {
    // Uploading the moment the app opens would archive a browser that may
    // still be pulling, and put that at the top of the restore list.
    expect(backupDue(clock({ now: READY + 1000 }), 5)).toEqual({
      due: false,
      reason: "settling",
    });
  });

  it("takes one once nothing has ever been backed up", () => {
    expect(backupDue(clock(), 5)).toEqual({
      due: true,
      reason: "never-backed-up",
    });
  });

  it("does not back up an empty workspace", () => {
    // Nothing to lose yet, and the archive would outrank real ones by date.
    expect(backupDue(clock(), 0)).toEqual({ due: false, reason: "no-notes" });
  });

  it("stays quiet while the last one is recent", () => {
    expect(
      backupDue(clock({ lastBackupAt: settled - 60_000 }), 5)
    ).toMatchObject({ due: false, reason: "recent" });
  });

  it("takes another once the interval has elapsed", () => {
    expect(
      backupDue(clock({ lastBackupAt: settled - BACKUP_INTERVAL_MS }), 5)
    ).toEqual({ due: true, reason: "interval-elapsed" });
  });

  it("treats the interval boundary as due rather than not", () => {
    const justUnder = clock({
      lastBackupAt: settled - BACKUP_INTERVAL_MS + 1,
    });
    expect(backupDue(justUnder, 5).due).toBe(false);
  });

  it("checks emptiness before anything else, even while settling", () => {
    expect(backupDue(clock({ now: READY }), 0).reason).toBe("no-notes");
  });
});

describe("when a stored backup should be proved readable", () => {
  it("has nothing to check when there are no backups", () => {
    expect(verificationDue(clock(), 0)).toBe(false);
  });

  it("checks once there is a backup and none has been checked", () => {
    expect(verificationDue(clock(), 1)).toBe(true);
  });

  it("waits for the workspace to settle", () => {
    expect(verificationDue(clock({ now: READY + 1 }), 1)).toBe(false);
  });

  it("stays quiet until the slower beat comes round", () => {
    expect(
      verificationDue(clock({ lastVerifiedAt: settled - 60_000 }), 1)
    ).toBe(false);
  });

  it("checks again after the verify interval", () => {
    expect(
      verificationDue(
        clock({ lastVerifiedAt: settled - VERIFY_INTERVAL_MS }),
        1
      )
    ).toBe(true);
  });
});

describe("saying how old a backup is", () => {
  const now = 10_000_000_000;

  it("says never when there has not been one", () => {
    expect(describeAge(null, now)).toBe("never");
  });

  it("counts minutes, hours and days", () => {
    expect(describeAge(now - 30_000, now)).toBe("just now");
    expect(describeAge(now - 60_000, now)).toBe("a minute ago");
    expect(describeAge(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(describeAge(now - 60 * 60_000, now)).toBe("an hour ago");
    expect(describeAge(now - 5 * 60 * 60_000, now)).toBe("5 hours ago");
    expect(describeAge(now - 24 * 60 * 60_000, now)).toBe("yesterday");
    expect(describeAge(now - 5 * 24 * 60 * 60_000, now)).toBe("5 days ago");
  });

  it("does not report a future backup as negative time", () => {
    // Clock skew between devices is ordinary and should not print "-3 days".
    expect(describeAge(now + 60_000, now)).toBe("just now");
  });
});

describe("what to tell someone about their backups", () => {
  const now = 10_000_000_000;

  it("says so when none has been taken", () => {
    expect(
      describeBackupHealth({ lastBackupAt: null, lastVerified: null, now })
    ).toMatchObject({ tone: "none" });
  });

  it("is content with a recent one", () => {
    expect(
      describeBackupHealth({
        lastBackupAt: now - 60_000,
        lastVerified: { ok: true, notes: 3, at: now },
        now,
      })
    ).toMatchObject({ tone: "ok" });
  });

  it("calls a long-neglected backup stale", () => {
    expect(
      describeBackupHealth({
        lastBackupAt: now - 3 * BACKUP_INTERVAL_MS,
        lastVerified: null,
        now,
      })
    ).toMatchObject({ tone: "stale" });
  });

  it("reports an unreadable backup above everything else", () => {
    // Even a backup taken seconds ago is worthless if it cannot be opened,
    // so a cheerful age must not bury the failure.
    const health = describeBackupHealth({
      lastBackupAt: now - 1_000,
      lastVerified: { ok: false, at: now, reason: "OperationError" },
      now,
    });

    expect(health.tone).toBe("broken");
    expect(health.message).toMatch(/could not be decrypted/);
  });
});
