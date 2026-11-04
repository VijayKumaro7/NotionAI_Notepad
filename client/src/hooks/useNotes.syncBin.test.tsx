/**
 * A note deleted on another device lands in Recently Deleted here.
 *
 * `runSync` applies a remote deletion with `deleteNote`, which moves the note
 * into the bin, and then refreshed the note list and the open note but not
 * `deletedNotes`. The list is state of its own, so the note was gone from the
 * sidebar and missing from Recently Deleted until the page was reloaded.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const remoteRows = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        notes: {
          pull: { query: async () => remoteRows.current },
          push: { mutate: async () => ({ ok: true }) },
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
  type Note,
} from "@/lib/storage";
import { writeBaselines } from "@/lib/syncBaselines";

let run = 0;
let FOLDER = "syncbin-folder-0";
let NOTE = "syncbin-note-0";
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;
  run += 1;
  FOLDER = `syncbin-folder-${run}`;
  NOTE = `syncbin-note-${run}`;
  remoteRows.current = [];
  localStorage.clear();
});

const note: () => Note = () => ({
  id: NOTE,
  title: "Gone elsewhere",
  content: "text",
  folderId: FOLDER,
  tags: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  isEncrypted: false,
  order: 0,
});

describe("a remote deletion and the Recently Deleted list", () => {
  it("lists the note once the sync has moved it to the bin", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    await saveFolder({
      id: FOLDER,
      name: "Work",
      parentId: null,
      createdAt: 1_000,
      updatedAt: 1_000,
      order: 0,
    });
    await saveNote(note(), key, { preserveTimestamp: true });
    writeBaselines({ [NOTE]: 1_000 });
    remoteRows.current = [
      { clientId: NOTE, payload: "", deleted: true, serverUpdatedAt: 5_000 },
    ];

    const view = renderHook(() => useNotes());
    await waitFor(() =>
      expect(view.result.current.sync.lastSyncedAt).not.toBeNull()
    );

    expect(view.result.current.notes.map(n => n.id)).not.toContain(NOTE);
    expect(view.result.current.deletedNotes.map(n => n.id)).toContain(NOTE);
  });
});
