import type { Note } from "./storage";

/**
 * What to do with the note someone is looking at when a sync changes it.
 *
 * A sync replaces rows in IndexedDB. `currentNote` is separate React state, so
 * until something says otherwise the editor keeps showing — and keeps
 * autosaving — the version that was open before the merge ran. Two things go
 * wrong with that, and the second is the serious one:
 *
 *   - the editor shows text the store no longer holds;
 *   - the debounced autosave then writes that stale text back over the version
 *     the sync just pulled in, and pushes it. The edit made on the other device
 *     is destroyed, and nothing reports a conflict, because by the time
 *     anything looked there was none.
 *
 * Keeping the decision here rather than inline in the hook is what makes those
 * cases testable. React state and IndexedDB are hard to drive in a test; "given
 * what is open and what the store now holds, what should the editor show" is
 * three lines and every branch matters.
 */

export type OpenNoteOutcome =
  /** Leave the editor alone. Anything else would disturb someone's cursor. */
  | { action: "keep" }
  /** The store holds something newer; show it. */
  | { action: "replace"; note: Note }
  /** The merge removed this note — it was deleted on another device. */
  | { action: "close" };

export function resolveOpenNote(input: {
  /** The note the editor has, or null when nothing is open. */
  open: Note | null;
  /** The same id, re-read from the store after the merge, or null if gone. */
  stored: Note | null;
}): OpenNoteOutcome {
  const { open, stored } = input;

  if (!open) return { action: "keep" };
  if (!stored) return { action: "close" };

  // A different note entirely. Nothing sensible to do but leave the editor as
  // it is; replacing one note's contents with another's would be a bug that
  // looks like corruption.
  if (stored.id !== open.id) return { action: "keep" };

  // The ordinary case for a sync that brought something in. `saveLocal` writes
  // the remote row with `preserveTimestamp`, so this is the other device's
  // clock, and it is newer precisely when the other device wrote last.
  if (stored.updatedAt > open.updatedAt)
    return { action: "replace", note: stored };

  // Same moment, different text. Rare, and worth catching: two writes inside
  // one millisecond are indistinguishable by timestamp, and trusting the clock
  // alone would leave the editor showing the losing one indefinitely.
  if (
    stored.updatedAt === open.updatedAt &&
    (stored.content !== open.content || stored.title !== open.title)
  ) {
    return { action: "replace", note: stored };
  }

  // The store is behind what is open — the person has typed since. Replacing
  // here would throw away their edit, which is the failure this whole function
  // exists to prevent, arriving from the other direction.
  return { action: "keep" };
}
