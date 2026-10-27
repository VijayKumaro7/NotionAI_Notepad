/**
 * Restoring a note from Recently Deleted, then syncing, through the real hook.
 *
 * Deleting pushes a tombstone. Restoring now pushes the note straight away —
 * the second describe block below — which also replaces a tombstone the first
 * attempt never landed, so there is no longer a stale one for the next sync to
 * flush at the server ahead of the note.
 *
 * The first block checks the outcome after a sync, with the server up and with
 * the tombstone landed or owed. It used to be what proved `runSync` flushes an
 * owed tombstone before the note's own push; since the restore pushes for
 * itself, moving `flushOwed` no longer changes any result here, so these are
 * outcome checks and not an ordering guard. The ordering for a deletion that
 * is still owed is covered by `useNotes.syncDeletion.test.tsx`.
 *
 * The fake server keeps state and follows the real procedure's semantics: a
 * tombstone is stamped with the deleting device's clock, and an upsert clears
 * it. A stub that answered a fixed list could not tell "revived" from "never
 * deleted".
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type ServerRow = {
  clientId: string;
  payload: string;
  deleted: boolean;
  serverUpdatedAt: number;
};

const server = vi.hoisted(() => ({ rows: new Map<string, ServerRow>() }));
const pushFails = vi.hoisted(() => ({ current: false }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        notes: {
          pull: { query: async () => [...server.rows.values()] },
          push: {
            mutate: async (input: {
              clientId: string;
              payload?: string;
              deleted?: boolean;
              updatedAt?: number;
            }) => {
              if (pushFails.current) throw new Error("offline");
              const existing = server.rows.get(input.clientId);
              if (input.deleted) {
                server.rows.set(input.clientId, {
                  clientId: input.clientId,
                  payload: existing?.payload ?? "",
                  deleted: true,
                  serverUpdatedAt: input.updatedAt ?? Date.now(),
                });
              } else {
                server.rows.set(input.clientId, {
                  clientId: input.clientId,
                  payload: input.payload ?? "",
                  deleted: false,
                  serverUpdatedAt: Date.now(),
                });
              }
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

// One IDBFactory for the file and unique ids per test — see the note in
// `useNotes.sync.test.tsx`: a fresh factory means a fresh key.
let run = 0;
let FOLDER = "restore-folder-0";
let NOTE = "restore-note-0";
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;

  run += 1;
  FOLDER = `restore-folder-${run}`;
  NOTE = `restore-note-${run}`;
  server.rows.clear();
  pushFails.current = false;
  localStorage.clear();
});

const note = (): Note => ({
  id: NOTE,
  title: "Quarterly review",
  content: "the original text",
  folderId: FOLDER,
  tags: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  isEncrypted: false,
  order: 0,
});

/** A note both this device and the server already hold, and agree about. */
async function mountWithSyncedNote(key: CryptoKey) {
  await saveFolder({
    id: FOLDER,
    name: "Work",
    parentId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    order: 0,
  });
  await saveNote(note(), key, { preserveTimestamp: true });
  server.rows.set(NOTE, {
    clientId: NOTE,
    payload: await encryptNotePayload(note(), key),
    deleted: false,
    serverUpdatedAt: 1_000,
  });

  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.encryptionKey).not.toBeNull());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await waitFor(() => {
    expect(view.result.current.sync.lastSyncedAt).not.toBeNull();
    expect(view.result.current.sync.phase).not.toBe("syncing");
  });
  return view;
}

describe("a restored note, then a sync", () => {
  it("comes back on the server when the tombstone had landed", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithSyncedNote(key);

    await act(async () => {
      await view.result.current.removeNote(NOTE);
    });
    await waitFor(() => expect(server.rows.get(NOTE)?.deleted).toBe(true));

    await act(async () => {
      await view.result.current.restoreDeletedNote(NOTE);
    });
    await act(async () => {
      await view.result.current.syncNow();
    });

    expect(await getNote(NOTE, key)).not.toBeNull();
    expect(server.rows.get(NOTE)?.deleted).toBe(false);
  });

  it("comes back on the server when the tombstone was still owed", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithSyncedNote(key);

    pushFails.current = true;
    await act(async () => {
      await view.result.current.removeNote(NOTE);
    });
    await waitFor(() =>
      expect(view.result.current.sync.owed).toBeGreaterThan(0)
    );

    await act(async () => {
      await view.result.current.restoreDeletedNote(NOTE);
    });

    // The server is back, and the stale tombstone is still in the queue.
    pushFails.current = false;
    await act(async () => {
      await view.result.current.syncNow();
    });

    expect(await getNote(NOTE, key)).not.toBeNull();
    expect(server.rows.get(NOTE)?.deleted).toBe(false);
    expect(view.result.current.sync.owed).toBe(0);
  });

  it("stays restored across a second sync", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithSyncedNote(key);

    pushFails.current = true;
    await act(async () => {
      await view.result.current.removeNote(NOTE);
    });
    await waitFor(() =>
      expect(view.result.current.sync.owed).toBeGreaterThan(0)
    );
    await act(async () => {
      await view.result.current.restoreDeletedNote(NOTE);
    });
    pushFails.current = false;

    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await view.result.current.syncNow();
      });
    }

    expect(await getNote(NOTE, key)).not.toBeNull();
    expect(server.rows.get(NOTE)?.deleted).toBe(false);
  });
});

/**
 * A restore used to push nothing and leave the server to find out at the next
 * sync. Until then another device kept seeing the note as deleted, and a
 * tombstone the first attempt never landed stayed in the queue, ready to be
 * flushed at the server a moment before the note itself.
 */
describe("a restored note, before any sync", () => {
  it("is already back on the server when the tombstone had landed", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithSyncedNote(key);

    await act(async () => {
      await view.result.current.removeNote(NOTE);
    });
    await waitFor(() => expect(server.rows.get(NOTE)?.deleted).toBe(true));

    await act(async () => {
      await view.result.current.restoreDeletedNote(NOTE);
    });

    await waitFor(() => expect(server.rows.get(NOTE)?.deleted).toBe(false));
  });

  it("drops a tombstone it never managed to send, instead of sending it later", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithSyncedNote(key);

    pushFails.current = true;
    await act(async () => {
      await view.result.current.removeNote(NOTE);
    });
    await waitFor(() =>
      expect(view.result.current.sync.owed).toBeGreaterThan(0)
    );

    pushFails.current = false;
    await act(async () => {
      await view.result.current.restoreDeletedNote(NOTE);
    });

    await waitFor(() => expect(view.result.current.sync.owed).toBe(0));
    expect(server.rows.get(NOTE)?.deleted).toBe(false);
  });
});
