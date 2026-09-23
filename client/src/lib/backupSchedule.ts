/**
 * When a backup is due, and whether the ones already taken can still be read.
 *
 * Backups were entirely manual: there was a button, and it worked, and nothing
 * ever pressed it. A recovery plan that depends on somebody remembering is the
 * one that is discovered missing on the day it is needed, so the cadence below
 * decides when one is owed and the workspace takes it without being asked.
 *
 * Verification is the other half, and the less obvious one. An archive that
 * cannot be decrypted fails silently in exactly the way that matters: it sits
 * in the list looking like insurance for months, and is found to be worthless
 * at the moment it is reached for — after the thing it was insuring is gone.
 * Checking one on a slower beat turns that discovery around, from after the
 * loss to before it.
 *
 * Both are pure decisions over timestamps so they can be tested without a clock
 * or a network. Nothing here performs a backup; it only says whether one is
 * owed.
 */

/** How often an automatic backup is taken. */
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * How long after signing in to wait before the first automatic backup.
 *
 * Opening the app should not immediately upload. The workspace has only just
 * loaded, sync may still be pulling, and a backup of a half-populated browser
 * is worse than no backup taken yet — it would be the newest archive in the
 * list, and the one a restore reaches for first.
 */
export const BACKUP_SETTLE_MS = 5 * 60 * 1000;

/** How often a stored archive is proved still readable. */
export const VERIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface BackupClock {
  /** When the last backup was taken, or null if none ever has been. */
  lastBackupAt: number | null;
  /** When a stored archive was last proved readable, or null. */
  lastVerifiedAt: number | null;
  /** When this workspace finished loading. */
  readyAt: number;
  now: number;
}

export type BackupDecision =
  | { due: false; reason: "settling" | "recent" | "no-notes" }
  | { due: true; reason: "never-backed-up" | "interval-elapsed" };

/**
 * Whether an automatic backup is owed.
 *
 * `noteCount` is here because the first thing a new account would otherwise do
 * is upload an archive of nothing, and the second is push it to the top of the
 * restore list. An empty workspace has nothing to lose yet.
 */
export function backupDue(
  clock: BackupClock,
  noteCount: number
): BackupDecision {
  if (noteCount === 0) return { due: false, reason: "no-notes" };
  if (clock.now - clock.readyAt < BACKUP_SETTLE_MS) {
    return { due: false, reason: "settling" };
  }
  if (clock.lastBackupAt === null) {
    return { due: true, reason: "never-backed-up" };
  }
  if (clock.now - clock.lastBackupAt >= BACKUP_INTERVAL_MS) {
    return { due: true, reason: "interval-elapsed" };
  }
  return { due: false, reason: "recent" };
}

/**
 * Whether it is time to prove a stored archive still decrypts.
 *
 * Only worth asking when there is something to check: with no backups there is
 * nothing to verify and nothing to worry about either.
 */
export function verificationDue(
  clock: Pick<BackupClock, "lastVerifiedAt" | "now" | "readyAt">,
  backupCount: number
): boolean {
  if (backupCount === 0) return false;
  if (clock.now - clock.readyAt < BACKUP_SETTLE_MS) return false;
  if (clock.lastVerifiedAt === null) return true;
  return clock.now - clock.lastVerifiedAt >= VERIFY_INTERVAL_MS;
}

export type VerificationOutcome =
  /** Decrypted, and the shape was what a restore expects. */
  | { ok: true; notes: number; at: number }
  /** It is there and it cannot be read. This is the one worth saying out loud. */
  | { ok: false; at: number; reason: string };

/**
 * How long ago, in words, for the line under the backup list.
 *
 * Deliberately coarse. The useful distinction is "today" against "months ago",
 * and a precise duration invites reading a freshness guarantee into a number
 * that is only ever the age of the last upload.
 */
export function describeAge(at: number | null, now: number): string {
  if (at === null) return "never";

  const elapsed = Math.max(0, now - at);
  const days = Math.floor(elapsed / (24 * 60 * 60 * 1000));
  if (days >= 1) return days === 1 ? "yesterday" : `${days} days ago`;

  const hours = Math.floor(elapsed / (60 * 60 * 1000));
  if (hours >= 1) return hours === 1 ? "an hour ago" : `${hours} hours ago`;

  const minutes = Math.floor(elapsed / (60 * 1000));
  if (minutes >= 1)
    return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;

  return "just now";
}

/**
 * What to tell someone about the state of their backups.
 *
 * An unreadable archive outranks a stale one: "the last backup cannot be read"
 * is the sentence that should reach somebody, and burying it under a cheerful
 * age would be the silent-failure problem all over again.
 */
export function describeBackupHealth(input: {
  lastBackupAt: number | null;
  lastVerified: VerificationOutcome | null;
  now: number;
}): { tone: "ok" | "stale" | "broken" | "none"; message: string } {
  if (input.lastVerified && !input.lastVerified.ok) {
    return {
      tone: "broken",
      message:
        "The last backup could not be decrypted with this browser's key. Take a fresh one, and check the key is the one these backups were made with.",
    };
  }

  if (input.lastBackupAt === null) {
    return { tone: "none", message: "No backup has been taken yet." };
  }

  const age = input.now - input.lastBackupAt;
  const stale = age >= 2 * BACKUP_INTERVAL_MS;

  return {
    tone: stale ? "stale" : "ok",
    message: `Last backup ${describeAge(input.lastBackupAt, input.now)}.`,
  };
}
