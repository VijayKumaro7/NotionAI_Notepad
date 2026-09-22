import { describe, it, expect, beforeEach } from "vitest";
import { readBackupJournal, writeBackupJournal } from "./backupJournal";

describe("the backup journal", () => {
  beforeEach(() => localStorage.clear());

  it("reads as never-backed-up when empty", () => {
    expect(readBackupJournal()).toEqual({
      lastBackupAt: null,
      lastVerified: null,
    });
  });

  it("round-trips a backup time", () => {
    writeBackupJournal({ lastBackupAt: 1234 });
    expect(readBackupJournal().lastBackupAt).toBe(1234);
  });

  it("round-trips a verification outcome", () => {
    writeBackupJournal({ lastVerified: { ok: true, notes: 3, at: 99 } });
    expect(readBackupJournal().lastVerified).toEqual({
      ok: true,
      notes: 3,
      at: 99,
    });
  });

  it("keeps a failed verification, which is the one worth keeping", () => {
    writeBackupJournal({
      lastVerified: { ok: false, at: 99, reason: "OperationError" },
    });
    expect(readBackupJournal().lastVerified).toMatchObject({ ok: false });
  });

  it("merges rather than replacing, so one write does not erase the other", () => {
    writeBackupJournal({ lastBackupAt: 1 });
    writeBackupJournal({ lastVerified: { ok: true, notes: 0, at: 2 } });

    expect(readBackupJournal()).toEqual({
      lastBackupAt: 1,
      lastVerified: { ok: true, notes: 0, at: 2 },
    });
  });

  it("treats junk in the key as an empty journal rather than throwing", () => {
    localStorage.setItem("notepad-backup-journal", "not json");
    expect(readBackupJournal()).toEqual({
      lastBackupAt: null,
      lastVerified: null,
    });
  });

  it("ignores a stored shape it does not recognise", () => {
    localStorage.setItem(
      "notepad-backup-journal",
      JSON.stringify({ lastBackupAt: "yesterday", lastVerified: 7 })
    );
    expect(readBackupJournal()).toEqual({
      lastBackupAt: null,
      lastVerified: null,
    });
  });
});
