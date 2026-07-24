/**
 * End-to-end encrypted note sync.
 *
 * Notes are serialized to JSON and encrypted with the user's local AES-GCM key
 * before leaving the browser — the server only ever stores opaque blobs keyed
 * by the note's client id. Conflict resolution is last-write-wins on the
 * note's own updatedAt timestamp (carried inside the encrypted payload).
 */

import { Note, encryptContent, decryptContent } from './storage';

export interface RemoteNoteRow {
  clientId: string;
  payload: string;
  deleted: boolean;
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
}

export async function encryptNotePayload(note: Note, key: CryptoKey): Promise<string> {
  return encryptContent(JSON.stringify(note), key);
}

export async function decryptNotePayload(payload: string, key: CryptoKey): Promise<Note> {
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
    rows.map(async (row) => {
      if (row.deleted) {
        return { clientId: row.clientId, note: null, deleted: true, serverUpdatedAt: row.serverUpdatedAt };
      }
      try {
        const note = await decryptNotePayload(row.payload, key);
        return { clientId: row.clientId, note, deleted: false, serverUpdatedAt: row.serverUpdatedAt };
      } catch {
        return { clientId: row.clientId, note: null, deleted: false, serverUpdatedAt: row.serverUpdatedAt };
      }
    })
  );
}

/**
 * Pure last-write-wins merge between local notes and decrypted remote state.
 */
export function mergeNotes(local: Note[], remote: DecryptedRemoteNote[]): MergePlan {
  const plan: MergePlan = { saveLocal: [], deleteLocal: [], push: [] };
  const remoteById = new Map(remote.map((r) => [r.clientId, r]));
  const localById = new Map(local.map((n) => [n.id, n]));

  for (const r of remote) {
    const l = localById.get(r.clientId);
    if (r.deleted) {
      // Deletion propagates unless the local copy was edited after the server row changed
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
    } else if (r.note.updatedAt > l.updatedAt) {
      plan.saveLocal.push(r.note);
    } else if (l.updatedAt > r.note.updatedAt) {
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
