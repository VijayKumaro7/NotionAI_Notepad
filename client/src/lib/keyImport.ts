/**
 * Installing a key that came from another device.
 *
 * Here rather than in the panel because this is the part with the rules in it,
 * and the rules are about what must not happen:
 *
 *   - A phrase that does not check out never reaches the key store. Accepting a
 *     mistyped one installs 32 bytes of noise as this browser's key, and the
 *     notes written afterwards are unreadable by the device the phrase came
 *     from — with nothing going wrong at the moment it happens.
 *   - What is already on this device is re-sealed *with* the key swap, in one
 *     transaction. Any gap between the two leaves a window in which the stored
 *     key opens nothing that is actually in the stores.
 *   - A failure says nothing changed only when nothing changed.
 *
 * A component can be inspected by eye; this can be tested, and the difference
 * matters for an operation whose failure mode is invisible until someone opens
 * an old note.
 */

import {
  decodeRecoveryPhrase,
  describePhraseError,
  type PhraseError,
} from "./recoveryPhrase";
import {
  LOCAL_KEY_ID,
  getOrCreateEncryptionKey,
  reEncryptLocalContent,
} from "./storage";

export type ImportOutcome =
  | { ok: true; converted: number; leftAlone: number }
  /** The phrase itself was wrong. Nothing was read or written. */
  | { ok: false; reason: "phrase"; error: PhraseError; message: string }
  /** The phrase was good; moving the data was not possible. */
  | { ok: false; reason: "failed"; message: string };

export async function importRecoveryPhrase(
  phrase: string
): Promise<ImportOutcome> {
  const decoded = decodeRecoveryPhrase(phrase);

  // First, and before anything is read from the database: a phrase that does
  // not check out is not a key, and must not get as far as being treated as one.
  if (!decoded.ok) {
    return {
      ok: false,
      reason: "phrase",
      error: decoded.error,
      message: describePhraseError(decoded.error),
    };
  }

  try {
    const current = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const next = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(decoded.key),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );

    // Re-sealing and storing the key are one transaction: see
    // `reEncryptLocalContent`. Two steps left a window in which the stored key
    // opened nothing that was actually in the stores.
    const summary = await reEncryptLocalContent(current, next, {
      userId: LOCAL_KEY_ID,
      keyBytes: decoded.key,
    });

    return { ok: true, ...summary };
  } catch (error) {
    console.error("[Key] Import failed", error);

    return {
      ok: false,
      reason: "failed",
      // True whichever step threw: nothing is written until every record has
      // been re-sealed, and then the records and the key are written in one
      // transaction that either all lands or does not.
      message:
        "Could not install that key. Nothing was changed — your notes are as they were.",
    };
  }
}
