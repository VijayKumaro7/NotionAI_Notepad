/**
 * The tag list follows the notes that arrive, not only the notes that are typed.
 *
 * `availableTags` was refreshed on load, on an autosave and when a note was
 * deleted. A tagged note that came back from the bin, arrived in a sync or was
 * put back by a backup restore left its tag out of the sidebar until something
 * was next typed, so there was nothing to filter by.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const env = vi.hoisted(() => ({
  authed: false,
  remote: [] as unknown[],
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: env.authed }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        notes: {
          pull: { query: async () => env.remote },
          push: { mutate: async () => ({ ok: true }) },
        },
      },
    }),
  },
}));

import { useNotes } from "./useNotes";
import {
  deleteNote,
  getOrCreateEncryptionKey,
  LOCAL_KEY_ID,
  saveFolder,
  saveNote,
  type Note,
} from "@/lib/storage";
import { buildArchive } from "@/lib/cloudBackup";
import { encryptNotePayload } from "@/lib/syncService";

let run = 0;
let FOLDER = "tagrefresh-folder-0";
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;
  run += 1;
  FOLDER = `tagrefresh-folder-${run}`;
  env.authed = false;
  env.remote = [];
  localStorage.clear();
});

const folder = () => ({
  id: FOLDER,
  name: "Work",
  parentId: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  order: 0,
});

const note = (id: string, tags: string[]): Note => ({
  id,
  title: id,
  content: "text",
  folderId: FOLDER,
  tags,
  createdAt: 1_000,
  updatedAt: 1_000,
  isEncrypted: false,
  order: 0,
});

async function mount() {
  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  return view;
}

describe("the tag list after notes arrive", () => {
  it("lists the tag of a note restored from Recently Deleted", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const tag = `bin-${run}`;
    const id = `bin-note-${run}`;
    await saveFolder(folder());
    await saveNote(note(id, [tag]), key, { preserveTimestamp: true });
    await deleteNote(id);

    const view = await mount();
    expect(view.result.current.availableTags).not.toContain(tag);

    await act(async () => {
      await view.result.current.restoreDeletedNote(id);
    });

    await waitFor(() =>
      expect(view.result.current.availableTags).toContain(tag)
    );
  });

  it("lists the tag of a note put back by restoring a backup", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    void key;
    const tag = `archive-${run}`;
    await saveFolder(folder());

    const view = await mount();
    expect(view.result.current.availableTags).not.toContain(tag);

    const archive = buildArchive({
      notes: [note(`archive-note-${run}`, [tag])],
      folders: [folder()],
    });
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    await waitFor(() =>
      expect(view.result.current.availableTags).toContain(tag)
    );
  });

  it("lists the tag of a note a sync pulled in from another device", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const tag = `remote-${run}`;
    const remoteNote = note(`remote-note-${run}`, [tag]);
    await saveFolder(folder());
    env.authed = true;
    env.remote = [
      {
        clientId: remoteNote.id,
        payload: await encryptNotePayload(remoteNote, key),
        deleted: false,
        serverUpdatedAt: remoteNote.updatedAt,
      },
    ];

    const view = renderHook(() => useNotes());
    await waitFor(() =>
      expect(view.result.current.sync.lastSyncedAt).not.toBeNull()
    );

    await waitFor(() =>
      expect(view.result.current.availableTags).toContain(tag)
    );
  });
});
