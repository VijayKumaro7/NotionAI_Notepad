/**
 * Restoring a backup while a note is open.
 *
 * A restore rewrites rows in IndexedDB, including the note on screen.
 * `currentNote` is separate React state, so unless something says otherwise the
 * editor keeps showing — and the next keystroke keeps building on — the text the
 * restore just replaced, and the autosave writes that back over it. A restore
 * that undid itself at the first character typed afterwards.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        notes: {
          pull: { query: async () => [] },
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
  getNote,
  type Note,
} from "@/lib/storage";
import { buildArchive } from "@/lib/cloudBackup";

// One IDBFactory for the file and unique ids per test — see the note in
// `useNotes.sync.test.tsx`: a fresh factory means a fresh key.
let run = 0;
let FOLDER = "restorearchive-folder-0";
let NOTE = "restorearchive-note-0";
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;

  run += 1;
  FOLDER = `restorearchive-folder-${run}`;
  NOTE = `restorearchive-note-${run}`;
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

const note = (content: string): Note => ({
  id: NOTE,
  title: "Draft",
  content,
  folderId: FOLDER,
  tags: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  isEncrypted: false,
  order: 0,
});

async function mountWithOpenNote(key: CryptoKey, content: string) {
  await saveFolder(folder());
  await saveNote(note(content), key, { preserveTimestamp: true });

  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.encryptionKey).not.toBeNull());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await act(async () => {
    await view.result.current.loadNote(NOTE);
  });
  return view;
}

describe("restoreFromArchive with the restored note open", () => {
  it("shows the restored text, not the text it replaced", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithOpenNote(key, "the text before the restore");

    const archive = buildArchive({
      notes: [note("the text from the backup")],
      folders: [folder()],
    });
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    expect((await getNote(NOTE, key))?.content).toBe(
      "the text from the backup"
    );
    expect(view.result.current.currentNote?.content).toBe(
      "the text from the backup"
    );
  });

  it("builds the next edit on the restored text and keeps it", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithOpenNote(key, "the text before the restore");

    const archive = buildArchive({
      notes: [note("the text from the backup")],
      folders: [folder()],
    });
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    act(() => {
      view.result.current.updateCurrentNote(current => ({
        content: current.content + " + typed afterwards",
      }));
    });
    await act(async () => {
      await view.result.current.saveNow();
    });

    expect((await getNote(NOTE, key))?.content).toBe(
      "the text from the backup + typed afterwards"
    );
  });

  it("does not disturb a note the archive leaves alone", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithOpenNote(key, "unchanged");

    const archive = buildArchive({
      notes: [note("unchanged")],
      folders: [folder()],
    });
    const before = view.result.current.currentNote;
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    expect(view.result.current.currentNote?.content).toBe("unchanged");
    expect(view.result.current.currentNote?.id).toBe(before?.id);
  });
});
