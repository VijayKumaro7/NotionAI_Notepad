/**
 * Asking the browser to keep this site's storage.
 *
 * Notes live in the browser's own storage, and for a signed-out or local-mode
 * visitor that is the only copy. Storage a site has not asked to keep is
 * "best effort": a browser short of disk may discard the whole origin, and
 * Safari clears a site's storage after a week without use, in both cases
 * without telling anyone. `navigator.storage.persist()` is the request that
 * moves the origin out of that class; where the browser decides by asking,
 * it asks the person.
 */

import { getStored, setStored } from "./safeStorage";

export type Persistence = "granted" | "denied" | "unsupported";

const ASKED_AT_KEY = "persistent-storage-asked-at";

/**
 * A refusal is remembered for a week, not for ever: Chrome decides from how
 * much the person uses the site, so a no today can be a yes later, and Firefox
 * shows a prompt, which should not come back at every visit.
 */
const ASK_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Never throws: a browser with no storage manager, or one that refuses, is an answer. */
export async function ensurePersistentStorage(
  now: number = Date.now()
): Promise<Persistence> {
  const storage =
    typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage || typeof storage.persist !== "function") return "unsupported";

  try {
    if (await storage.persisted?.()) return "granted";

    const askedAt = Number(getStored(ASKED_AT_KEY));
    if (askedAt && now - askedAt < ASK_AGAIN_AFTER_MS) return "denied";

    setStored(ASKED_AT_KEY, String(now));
    return (await storage.persist()) ? "granted" : "denied";
  } catch {
    return "denied";
  }
}
