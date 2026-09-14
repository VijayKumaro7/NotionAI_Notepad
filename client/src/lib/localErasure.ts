/**
 * Erasing the copy of everything that lives in this browser.
 *
 * Deleting the account removes what the server holds, which for notes is
 * ciphertext it could never read anyway. The readable copy is here — the
 * IndexedDB database holds the notes, their folders, the version history, the
 * share records and the AES key that opens them — and deleting an account
 * without offering to remove it would leave the plainest copy of all behind.
 *
 * It is offered rather than assumed. The database is on the person's own
 * machine, nobody else can reach it, and wiping a device's only copy of notes
 * that were never synced is not something to do on their behalf.
 */

import { DB_NAME, closeDB } from "./storage";

export type LocalErasureResult =
  /** The database is gone. */
  | "erased"
  /** Another tab still has it open; the browser will delete it once that closes. */
  | "blocked"
  /** The browser refused, or there is no IndexedDB here at all. */
  | "failed";

/** The cached profile from the session that is being deleted. */
const PROFILE_KEY = "manus-runtime-user-info";

export async function eraseLocalData(): Promise<LocalErasureResult> {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    // A browser with storage blocked has nothing cached to remove.
  }

  if (typeof indexedDB === "undefined") return "failed";

  closeDB();

  return new Promise<LocalErasureResult>(resolve => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(DB_NAME);
    } catch {
      resolve("failed");
      return;
    }

    request.onsuccess = () => resolve("erased");
    request.onerror = () => resolve("failed");

    // Resolving here rather than waiting: the deletion is still outstanding and
    // will go through when the other tab lets go, but nothing useful happens in
    // this one until then, and a dialog that hangs forever is worse than one
    // that says which tab to close.
    request.onblocked = () => resolve("blocked");
  });
}
