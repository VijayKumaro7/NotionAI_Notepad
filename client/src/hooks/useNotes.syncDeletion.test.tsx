/**
 * A deletion the server never took, through the real hook.
 *
 * `useNotes.syncOrder.test.tsx` asserts the order `runSync` does things in,
 * and `syncIntegration.test.ts` proves the `owedDeletions` filter keeps a
 * deleted note deleted when its tombstone is still owed — but it proves it
 * over a plan it applies itself. Neither calls `removeNote` and then syncs,
 * which is the sequence a person actually performs, and that sequence had a
 * bug in it that no test above could see.
 *
 * Deleting a note left `pendingSave` holding it. The autosave effect bails out
 * early once `currentNote` is null, so nothing cleared what the debounce was
 * already carrying — and the next sync calls `persistPendingLocally`, which
 * wrote the deleted note straight back into the store. The `owedDeletions`
 * filter never got a say, because the resurrection happened before the merge
 * ran. `forgetPendingSave` drops the hold; these are the tests that fail
 * without it.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const remoteRows = vi.hoisted(() => ({ current: [] as unknown[] }));
const authed = vi.hoisted(() => ({ current: true }));

/** Set to refuse pushes, which is how a deletion's tombstone becomes owed. */
const pushFails = vi.hoisted(() => ({ current: false }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: authed.current }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        notes: {
          pull: { query: async () => remoteRows.current },
          push: {
            mutate: async () => {
              if (pushFails.current) throw new Error("offline");
              return { ok: true };
            },
          },
        },
      },
    }),
  },
}));

import { useNotes } from "./useNotes";
import {
  getOrCreateEncryptionKey,
  LOCAL_KEY_ID,
  saveFolder,
  saveNote,
  getNote,
  type Note,
} from "@/lib/storage";
import { encryptNotePayload } from "@/lib/syncService";

/**
 * Unique ids per test, and one IDBFactory for the file — see the identical
 * note in `useNotes.sync.test.tsx`. A fresh factory per test means a fresh
 * encryption key, and rows an earlier test wrote stop decrypting under it.
 */
let run = 0;
let FOLDER = "deletion-folder-0";
let NOTE = "deletion-note-0";

let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;

  run += 1;
  FOLDER = `deletion-folder-${run}`;
  NOTE = `deletion-note-${run}`;

  remoteRows.current = [];
  pushFails.current = false;
  authed.current = true;
  localStorage.clear();
});

const note = (over: Partial<Note> = {}): Note => ({
  id: NOTE,
  title: "Quarterly review",
  content: "the original text",
  folderId: FOLDER,
  tags: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  isEncrypted: false,
  order: 0,
  ...over,
});

async function remoteRow(n: Note, key: CryptoKey) {
  return {
    clientId: n.id,
    payload: await encryptNotePayload(n, key),
    deleted: false,
    serverUpdatedAt: n.updatedAt,
  };
}

type View = {
  result: {
    current: {
      sync: { owed: number; phase: string; lastSyncedAt: number | null };
    };
  };
};

/**
 * Wait until the hook has recorded what it could not send.
 *
 * `removeNote` calls `pushDeletionToServer` without awaiting it — the deletion
 * is local the moment it happens and the send is a background concern. So a
 * test that syncs straight afterwards can beat the failure being recorded, and
 * would then be exercising a sync with nothing owed while appearing to
 * exercise the opposite.
 */
async function owed(view: View) {
  await waitFor(() => expect(view.result.current.sync.owed).toBeGreaterThan(0));
}

/**
 * Mount the hook, seed the note, and wait for the sync the hook starts itself.
 *
 * Two things here are deliberate and were both learned the hard way.
 *
 * The note is seeded straight into storage rather than made with
 * `createNote`, because `createNote` fires its push without awaiting it.
 * Turning the server off immediately afterwards races that push: it fails as
 * kind `"note"`, and `owed` holds one entry per id, so it overwrites the
 * `"deletion"` these tests are about. Seeding leaves the tombstone as the only
 * push in play. What seeding must not do is skip `opened()` below — the bug
 * lives in the debounce, and a note nobody opened was never in it.
 *
 * And the mount sync is waited for rather than triggered. `useNotes` fires
 * `void runSync()` from an effect once the key and notes have loaded, and
 * `runSync` returns immediately while one is already running — so calling
 * `syncNow()` here would usually be a no-op, and the test would be relying on
 * the effect's run finishing inside the same await chain. `lastSyncedAt` is
 * stamped only by a run that finished with nothing owed, so it says the mount
 * sync is over rather than that one has started.
 */
async function mountWithNote(key: CryptoKey) {
  await saveFolder({
    id: FOLDER,
    name: "Work",
    parentId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    order: 0,
  });
  await saveNote(note(), key, { preserveTimestamp: true });

  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.encryptionKey).not.toBeNull());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await waitFor(() => {
    expect(view.result.current.sync.lastSyncedAt).not.toBeNull();
    expect(view.result.current.sync.phase).not.toBe("syncing");
  });
  return view;
}

/**
 * Open the note and type into it, which is what puts it in the debounce.
 *
 * Not decoration. `pendingSave` is armed by the autosave effect when
 * `currentNote` is set, and the bug is that deleting a note leaves it armed —
 * so a test that deletes a note nobody ever opened exercises nothing, and
 * passes just as happily with the fix commented out. That is not a guess: it
 * is what the first version of this file did.
 *
 * The two-second debounce is longer than the rest of each test, so the timer
 * does not fire before the delete. That is the point — the edit is still only
 * in the debounce when the note goes.
 */
async function opened(view: {
  result: {
    current: {
      loadNote: (id: string) => Promise<void>;
      updateCurrentNote: (updates: Partial<Note>) => void;
    };
  };
}) {
  await act(async () => {
    await view.result.current.loadNote(NOTE);
  });
  act(() => {
    view.result.current.updateCurrentNote({ content: "typed, then deleted" });
  });
}

describe("a deletion the server never took", () => {
  it("is not undone by the row still sitting there", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithNote(key);
    await opened(view);

    // Delete it while the server is refusing, so the tombstone is owed.
    pushFails.current = true;
    await act(async () => {
      await view.result.current.removeNote(NOTE);
    });
    await owed(view);

    // From the server's side this looks like a note this device has never
    // seen, which is exactly why the merge would otherwise put it back.
    remoteRows.current = [await remoteRow(note(), key)];

    await act(async () => {
      await view.result.current.syncNow();
    });

    expect(await getNote(NOTE)).toBeNull();
  });

  it("stays deleted across repeated syncs", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithNote(key);
    await opened(view);

    pushFails.current = true;
    await act(async () => {
      await view.result.current.removeNote(NOTE);
    });
    await owed(view);
    remoteRows.current = [await remoteRow(note(), key)];

    // The failure mode this guards is not a one-off: a deletion that comes
    // back does it on every beat, so a single pass proves less than it looks.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await view.result.current.syncNow();
      });
    }

    expect(await getNote(NOTE)).toBeNull();
  });
});
