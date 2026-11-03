import * as db from "./db";
import { QUOTA, QuotaExceededError } from "./quota";

/**
 * Called before a note row is created. Updating a note the account already has
 * never counts against the limit, so an account at the ceiling can still edit,
 * sync and delete; it just cannot add more.
 */
export async function assertRoomForNote(
  userId: number,
  clientId: string | null
): Promise<void> {
  if (clientId && (await db.getNoteByClientId(userId, clientId))) return;

  if ((await db.countUserNotes(userId)) >= QUOTA.syncedNotes) {
    throw new QuotaExceededError(
      `You have reached the limit of ${QUOTA.syncedNotes.toLocaleString("en")} synced notes. Delete some before adding more.`
    );
  }
}
