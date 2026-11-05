import * as db from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long server-side records are kept once they have stopped doing a job.
 *
 * A deleted note's row is the tombstone other devices learn the deletion from,
 * so it outlives the 30 days the browser keeps its own bin: a device that has
 * been off for a month must still be told, or it would put the note back.
 */
export const RETENTION = {
  deletedNotesMs: 180 * DAY_MS,
  securityEventsMs: 180 * DAY_MS,
  /** An expired session has failed verification since the day it expired. */
  expiredSessionsMs: 7 * DAY_MS,
} as const;

export type RetentionSummary = {
  deletedNotes: number;
  sharedCopies: number;
  securityEvents: number;
  sessions: number;
  invitations: number;
  rateLimits: number;
};

export async function runRetention(
  now: Date = new Date()
): Promise<RetentionSummary> {
  const ago = (ms: number) => new Date(now.getTime() - ms);

  return {
    sharedCopies: await db.purgeSharingOfDeletedNotes(),
    deletedNotes: await db.purgeDeletedNotes(ago(RETENTION.deletedNotesMs)),
    securityEvents: await db.purgeSecurityEvents(
      ago(RETENTION.securityEventsMs)
    ),
    sessions: await db.purgeExpiredSessions(ago(RETENTION.expiredSessionsMs)),
    invitations: await db.purgeExpiredInvitations(now),
    rateLimits: await db.purgeExpiredRateLimits(now.getTime()),
  };
}

/** Once at start, then daily. Never throws and never holds the process open. */
export function scheduleRetention(): () => void {
  const run = () =>
    runRetention().then(
      summary => {
        const total = Object.values(summary).reduce((a, b) => a + b, 0);
        if (total > 0) console.log("[Retention] Removed", summary);
      },
      error => console.error("[Retention] Run failed", error)
    );

  const first = setTimeout(run, 60_000);
  const daily = setInterval(run, DAY_MS);
  first.unref();
  daily.unref();

  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}
