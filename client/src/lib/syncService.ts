/**
 * End-to-end encrypted note sync.
 *
 * Notes are serialized to JSON and encrypted with the user's local AES-GCM key
 * before leaving the browser — the server only ever stores opaque blobs keyed
 * by the note's client id.
 *
 * The newer of two versions wins, on the note's own updatedAt (carried inside
 * the encrypted payload) — but winning no longer means the other one is
 * destroyed. When both sides have moved on from what this device last agreed
 * with the server (see `syncBaselines.ts`), that is a real conflict: two people
 * or two devices wrote different things, and there is no honest way to pick.
 * The merge reports it, the loser is kept, and nobody's writing disappears
 * because one clock read later than another.
 */

import { Note, encryptContent, decryptContent } from "./storage";

export interface RemoteNoteRow {
  clientId: string;
  payload: string;
  deleted: boolean;
  /**
   * For a tombstone this is the deleting device's own clock, forwarded through
   * the server, so it can be compared against a note's updatedAt. It is only
   * the server's clock for rows written before that was sent.
   */
  serverUpdatedAt: number;
}

export interface DecryptedRemoteNote {
  clientId: string;
  note: Note | null; // null when deleted or undecryptable
  deleted: boolean;
  serverUpdatedAt: number;
}

export interface MergePlan {
  saveLocal: Note[]; // remote is newer (or new) — persist locally
  deleteLocal: string[]; // deleted remotely — soft-delete locally
  push: Note[]; // local is newer (or unknown remotely) — upload
  /** Both sides edited independently. The winner is applied as usual; `losing`
   *  is the content that would otherwise have been silently overwritten. */
  conflicts: NoteConflict[];
}

export interface NoteConflict {
  /** The note's client id — the winner keeps it, so other devices agree. */
  id: string;
  /** The version that won on timestamp, already present in saveLocal or push. */
  winning: Note;
  /** The version that lost, and would have been thrown away. */
  losing: Note;
  /** Which side this device is about to lose, for what the user is told. */
  losingSide: "local" | "remote";
}

export async function encryptNotePayload(
  note: Note,
  key: CryptoKey
): Promise<string> {
  return encryptContent(JSON.stringify(note), key);
}

export async function decryptNotePayload(
  payload: string,
  key: CryptoKey
): Promise<Note> {
  return JSON.parse(await decryptContent(payload, key)) as Note;
}

/**
 * Decrypt pulled rows. Rows that cannot be decrypted (e.g. written by a
 * browser with a different key) are kept with note=null so the merge can
 * leave them untouched rather than clobbering them.
 */
export async function decryptRemoteNotes(
  rows: RemoteNoteRow[],
  key: CryptoKey
): Promise<DecryptedRemoteNote[]> {
  return Promise.all(
    rows.map(async row => {
      if (row.deleted) {
        return {
          clientId: row.clientId,
          note: null,
          deleted: true,
          serverUpdatedAt: row.serverUpdatedAt,
        };
      }
      try {
        const note = await decryptNotePayload(row.payload, key);
        return {
          clientId: row.clientId,
          note,
          deleted: false,
          serverUpdatedAt: row.serverUpdatedAt,
        };
      } catch {
        return {
          clientId: row.clientId,
          note: null,
          deleted: false,
          serverUpdatedAt: row.serverUpdatedAt,
        };
      }
    })
  );
}

/**
 * Pure merge between local notes and decrypted remote state.
 *
 * `baselines` is what this device last agreed with the server, per note id.
 * It is what separates "the other device edited and I did not" from "we both
 * edited" — see `syncBaselines.ts`. Omit it and the merge behaves as it always
 * did, newest timestamp wins and the other side is dropped; that is only
 * appropriate where there is nothing to lose, such as a test fixture.
 *
 * A note with no baseline recorded and two differing sides is treated as a
 * conflict rather than a clean win. It might not be one — the baseline may
 * simply have been lost with the browser profile — but the cost of being wrong
 * runs one way only. A needless second copy is a small annoyance; a discarded
 * paragraph is gone.
 */
export function mergeNotes(
  local: Note[],
  remote: DecryptedRemoteNote[],
  baselines: Record<string, number> = {}
): MergePlan {
  const plan: MergePlan = {
    saveLocal: [],
    deleteLocal: [],
    push: [],
    conflicts: [],
  };
  const remoteById = new Map(remote.map(r => [r.clientId, r]));
  const localById = new Map(local.map(n => [n.id, n]));

  // Untouched since the last agreement, so this side has nothing to lose.
  const unchanged = (id: string, updatedAt: number) =>
    baselines[id] !== undefined && baselines[id] === updatedAt;

  for (const r of remote) {
    const l = localById.get(r.clientId);
    if (r.deleted) {
      // Both sides are client clocks, so this compares like with like: the
      // deletion propagates unless this device edited the note more recently.
      if (l && l.updatedAt < r.serverUpdatedAt) {
        plan.deleteLocal.push(l.id);
      } else if (l) {
        plan.push.push(l); // local edit outlives the deletion — revive on server
      }
      continue;
    }
    if (!r.note) continue; // undecryptable — leave both sides alone
    if (!l) {
      plan.saveLocal.push(r.note);
      continue;
    }
    if (r.note.updatedAt === l.updatedAt) continue; // already agreed

    const winner = r.note.updatedAt > l.updatedAt ? r.note : l;
    const loser = winner === r.note ? l : r.note;

    // One side still standing where the agreement left it has written nothing
    // since, so the other side's version supersedes it with nothing lost.
    const clean =
      unchanged(r.clientId, l.updatedAt) ||
      unchanged(r.clientId, r.note.updatedAt);

    if (!clean) {
      plan.conflicts.push({
        id: r.clientId,
        winning: winner,
        losing: loser,
        losingSide: winner === r.note ? "local" : "remote",
      });
    }

    if (winner === r.note) {
      plan.saveLocal.push(r.note);
    } else {
      plan.push.push(l);
    }
  }

  for (const l of local) {
    if (!remoteById.has(l.id)) {
      plan.push.push(l);
    }
  }

  return plan;
}

/**
 * The losing side of a conflict, as a note of its own.
 *
 * A new id, so it is a separate note rather than a competitor for the one that
 * won — the winner keeps the original id and every other device goes on
 * agreeing about it. Same folder, because a copy filed somewhere else is a copy
 * nobody finds.
 *
 * Deliberately a note and not a version snapshot. Version history is capped and
 * pruned, and a record that can be evicted is the wrong place for the only
 * remaining copy of something. A note can be read, searched, exported and
 * deleted on purpose.
 */
export function conflictCopy(
  conflict: NoteConflict,
  at: number,
  newId: string
): Note {
  return {
    ...conflict.losing,
    id: newId,
    title: conflictCopyTitle(conflict.losing.title, at),
    createdAt: at,
    // Older than the winner on purpose: this is a record of what was written,
    // not a fresh edit, and it must never win a later merge against the note
    // it was split from.
    updatedAt: at,
    isDeleted: false,
    deletedAt: undefined,
  };
}

/** Says what it is and when, so two conflicts on one note do not collide. */
export function conflictCopyTitle(title: string, at: number): string {
  const when = new Date(at).toISOString().slice(0, 16).replace("T", " ");
  return `${title || "Untitled"} (conflicting copy ${when})`;
}

/**
 * Notes both sides already agree about.
 *
 * These appear in no part of the plan — there is nothing to save, push or
 * delete — which makes them easy to forget, and forgetting them is the bug.
 * Agreement is exactly what a baseline records, so a steady state that never
 * gets written down leaves every note looking like it has no baseline. The
 * next perfectly ordinary edit on one device would then be read as a possible
 * conflict and split into a copy nobody asked for.
 */
export function alreadyAgreed(
  local: Note[],
  remote: DecryptedRemoteNote[]
): Array<{ id: string; updatedAt: number }> {
  const localById = new Map(local.map(n => [n.id, n]));
  const agreed: Array<{ id: string; updatedAt: number }> = [];

  for (const r of remote) {
    if (r.deleted || !r.note) continue;
    const l = localById.get(r.clientId);
    if (l && l.updatedAt === r.note.updatedAt) {
      agreed.push({ id: r.clientId, updatedAt: l.updatedAt });
    }
  }
  return agreed;
}
