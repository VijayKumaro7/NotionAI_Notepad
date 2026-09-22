/**
 * When this browser last took a backup, and last proved one readable.
 *
 * Per-device state, like `syncBaselines`: the question is "when did *I* last
 * do this", so it lives in this browser and is never synced. localStorage
 * because it is three small numbers read on load to decide whether anything is
 * owed, and awaiting a transaction for that would delay the decision past the
 * point it matters.
 *
 * Every read survives a browser that refuses storage and a key holding
 * something that is not the expected shape. The safe answer is an empty
 * journal, which reads as "nothing has ever been backed up" — that errs
 * towards taking one, and a redundant backup costs an upload while a skipped
 * one costs the thing it would have held.
 */

import type { VerificationOutcome } from "./backupSchedule";

const STORAGE_KEY = "notepad-backup-journal";

export interface BackupJournal {
  lastBackupAt: number | null;
  lastVerified: VerificationOutcome | null;
}

const EMPTY: BackupJournal = { lastBackupAt: null, lastVerified: null };

function isOutcome(value: unknown): value is VerificationOutcome {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.ok === "boolean" && typeof candidate.at === "number";
}

export function readBackupJournal(): BackupJournal {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (!raw) return EMPTY;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      lastBackupAt:
        typeof parsed.lastBackupAt === "number" ? parsed.lastBackupAt : null,
      lastVerified: isOutcome(parsed.lastVerified) ? parsed.lastVerified : null,
    };
  } catch {
    return EMPTY;
  }
}

/** Merges, so recording a backup does not erase the verification beside it. */
export function writeBackupJournal(entry: Partial<BackupJournal>): void {
  const next = { ...readBackupJournal(), ...entry };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A browser refusing storage means the cadence restarts next load: another
    // backup gets taken sooner than needed, which is the harmless direction.
  }
}
