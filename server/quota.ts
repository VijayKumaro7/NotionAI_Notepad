/**
 * What one account may keep on the server.
 *
 * Rate limits say how fast something may be written; they say nothing about how
 * much. Without a ceiling on volume a single cheap account could fill the
 * bucket and the table at whatever pace the rate limit allowed. These are
 * generous for a person and far short of an abuser.
 */

export const QUOTA = {
  /** Most backups kept per account; the oldest is dropped to make room. */
  backups: 30,
  /** Most bytes of backups kept per account, across all of them. */
  backupBytes: 300 * 1024 * 1024,
  /** Most synced note rows per account, deleted ones included. */
  syncedNotes: 5_000,
} as const;

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}
