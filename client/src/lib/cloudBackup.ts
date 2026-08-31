/**
 * Encrypted cloud backup.
 *
 * The archive is built and encrypted in the browser with the user's AES-GCM key
 * before it is uploaded, so the server stores an opaque blob — the same
 * arrangement as note sync. Lose the key and the backup is unreadable; nobody
 * can recover it for you.
 */

import { createBackup } from "./exportService";
import {
  encryptContent,
  decryptContent,
  Folder,
  Note,
  saveNote,
  saveFolder,
} from "./storage";

export interface BackupArchive {
  version: string;
  exportDate: string;
  notes: Note[];
  folders: Folder[];
}

export async function encryptBackup(
  notes: Note[],
  folders: Folder[],
  key: CryptoKey
): Promise<string> {
  return encryptContent(createBackup(notes, folders), key);
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

  return archive;
}

export interface RestoreResult {
  notes: number;
  folders: number;
}

/**
 * Write a decrypted archive back into local storage.
 *
 * Folders are restored first so notes always land somewhere that exists.
 * Timestamps are preserved, otherwise restoring would make every note look
 * freshly edited and win every subsequent sync comparison.
 */
export async function restoreArchive(
  archive: BackupArchive,
  key: CryptoKey
): Promise<RestoreResult> {
  for (const folder of archive.folders) {
    await saveFolder(folder);
  }

  for (const note of archive.notes) {
    await saveNote(note, key, { preserveTimestamp: true });
  }

  return { notes: archive.notes.length, folders: archive.folders.length };
}

/** Human-readable size for the backup list. */
export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
