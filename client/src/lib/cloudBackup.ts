/**
 * Encrypted cloud backup.
 *
 * The archive is built and encrypted in the browser with the user's AES-GCM key
 * before it is uploaded, so the server stores an opaque blob — the same
 * arrangement as note sync. Lose the key and the backup is unreadable; nobody
 * can recover it for you.
 *
 * What the archive holds is `ARCHIVE_NOT_INCLUDED`, kept here for the same
 * reason `lib/dataExport.ts` keeps its own list: a copy that quietly omits
 * something is only discovered to have omitted it once the original is gone.
 */

import { nanoid } from "nanoid";
import {
  encryptContent,
  decryptContent,
  Folder,
  Note,
  NoteVersion,
  saveNote,
  saveFolder,
  putNoteVersions,
  putDeletedNotes,
} from "./storage";
import { planRestore, displacedCopy, RestorePlan } from "./restorePlan";
import type { VerificationOutcome } from "./backupSchedule";

/**
 * Archives written before version history and the bin were carried. They are
 * still readable and still restorable; the fields they lack simply arrive
 * empty.
 */
export const ARCHIVE_VERSION_LEGACY = "1.0";
export const ARCHIVE_VERSION = "2.0";

export interface BackupArchive {
  version: string;
  exportDate: string;
  notes: Note[];
  folders: Folder[];
  /** Absent in a 1.0 archive. */
  versions?: NoteVersion[];
  /** Absent in a 1.0 archive. */
  deletedNotes?: Note[];
}

/** What a backup cannot hold, and why. Shown next to the restore button. */
export const ARCHIVE_NOT_INCLUDED = [
  "Your encryption key. It is what makes the backup readable, so storing the two together would defeat the point. Carry it with the recovery phrase in the account panel.",
  "Saved chat transcripts. They live on the server, not in this browser, and there is no route to put them back — use the account export for a copy of those.",
  "Notes other people shared with you, which are theirs to back up.",
] as const;

export function encryptBackupArchive(
  archive: BackupArchive,
  key: CryptoKey
): Promise<string> {
  return encryptContent(JSON.stringify(archive), key);
}

/** Everything this browser holds that a restore can put back. */
export function buildArchive(input: {
  notes: Note[];
  folders: Folder[];
  versions?: NoteVersion[];
  deletedNotes?: Note[];
}): BackupArchive {
  return {
    version: ARCHIVE_VERSION,
    exportDate: new Date().toISOString(),
    notes: input.notes,
    folders: input.folders,
    versions: input.versions ?? [],
    deletedNotes: input.deletedNotes ?? [],
  };
}

export async function encryptBackup(
  notes: Note[],
  folders: Folder[],
  key: CryptoKey,
  extra?: { versions?: NoteVersion[]; deletedNotes?: Note[] }
): Promise<string> {
  return encryptBackupArchive(buildArchive({ notes, folders, ...extra }), key);
}

export async function decryptBackup(
  payload: string,
  key: CryptoKey
): Promise<BackupArchive> {
  const archive = JSON.parse(
    await decryptContent(payload, key)
  ) as BackupArchive;

  if (!Array.isArray(archive?.notes) || !Array.isArray(archive?.folders)) {
    throw new Error("Backup is not in a recognised format");
  }

  // A 1.0 archive has no version history and no bin. Normalising here means
  // the restore below has one shape to walk rather than a pile of optionals.
  return {
    ...archive,
    versions: Array.isArray(archive.versions) ? archive.versions : [],
    deletedNotes: Array.isArray(archive.deletedNotes)
      ? archive.deletedNotes
      : [],
  };
}

export interface RestoreResult {
  notes: number;
  folders: number;
  versions: number;
  deletedNotes: number;
  /** Newer local notes kept as separate notes rather than overwritten. */
  displaced: number;
}

/**
 * Write a decrypted archive back into local storage.
 *
 * Two rules, both learned the hard way elsewhere in this codebase.
 *
 * **Winning must not destroy the loser.** A note edited since the backup was
 * taken is newer than the archive's copy of it, and the old restore wrote over
 * it without a word. Now the local version is kept as a note of its own first —
 * `displacedCopy`, the same shape `conflictCopy` uses for a sync conflict — and
 * only then is the archive's version written.
 *
 * **A restore has to survive the next sync.** Timestamps used to be preserved,
 * on the reasoning that a restore should not win every later comparison. The
 * consequence was that it won none: the server still held the newer copy, the
 * merge read it as a clean win because the baseline agreed with it, and the
 * restored content was replaced with no conflict reported and no copy kept — a
 * restore that undid itself, quietly, some seconds after it said it had worked.
 * Restoring is a deliberate act, so what it writes is dated now and propagates
 * like any other edit.
 */
export async function restoreArchive(
  archive: BackupArchive,
  key: CryptoKey,
  localNotes: readonly Note[] = []
): Promise<RestoreResult> {
  const plan = planRestore(archive.notes, localNotes);
  const at = Date.now();

  for (const folder of archive.folders) {
    await saveFolder(folder);
  }

  let displaced = 0;
  let written = 0;

  for (const entry of plan.entries) {
    if (entry.disposition === "identical") continue;

    if (entry.disposition === "displaced" && entry.local) {
      await saveNote(displacedCopy(entry.local, at, nanoid()), key, {
        preserveTimestamp: true,
      });
      displaced++;
    }

    // Dated now, deliberately: see the note above about surviving the sync.
    await saveNote({ ...entry.note, updatedAt: at }, key, {
      preserveTimestamp: true,
    });
    written++;
  }

  await putNoteVersions(archive.versions ?? [], key);
  await putDeletedNotes(archive.deletedNotes ?? [], key);

  return {
    notes: written,
    folders: archive.folders.length,
    versions: (archive.versions ?? []).length,
    deletedNotes: (archive.deletedNotes ?? []).length,
    displaced,
  };
}

/** What restoring this archive would do, without doing any of it. */
export function previewRestore(
  archive: BackupArchive,
  localNotes: readonly Note[]
): RestorePlan {
  return planRestore(archive.notes, localNotes);
}

/** Human-readable size for the backup list. */
export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Prove a stored archive can still be opened and would restore something.
 *
 * Decryption alone is not the whole question — a blob that decrypts to
 * something which is not an archive is just as useless on the day it is needed
 * — so the shape is checked too, by the same `decryptBackup` a restore would
 * use. Whatever a restore would choke on, this chokes on first, months earlier.
 */
export async function verifyBackup(
  payload: string,
  key: CryptoKey,
  at: number = Date.now()
): Promise<VerificationOutcome> {
  try {
    const archive = await decryptBackup(payload, key);
    return { ok: true, notes: archive.notes.length, at };
  } catch (error) {
    return {
      ok: false,
      at,
      reason: error instanceof Error ? error.message : "Unreadable",
    };
  }
}
