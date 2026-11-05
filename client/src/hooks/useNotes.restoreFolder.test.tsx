/**
 * Restoring a deleted note whose folder has since been deleted.
 *
 * `removeFolder` reparents the notes filed on a folder, but a note already in
 * the bin is not in the list it walks. It keeps its old `folderId`, and
 * `restoreNote` put it back there: a note filed under a folder that no longer
 * exists, which no folder in the sidebar lists, so a restore that said
 * "restored successfully" left it nowhere anyone could open it. Sync already
 * moves such a note to a folder that exists; a restore now does the same.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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
  DB_NAME,
  closeDB,
  initializeDB,
  saveFolder,
  saveNote,
  getNote,
  type Note,
  type Folder,
} from "@/lib/storage";

beforeEach(async () => {
  closeDB();
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  await initializeDB();
});

const folderRow = (id: string): Folder => ({
  id,
  name: id,
  parentId: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  order: 0,
});

const noteRow = (id: string, folderId: string): Note => ({
  id,
  title: id,
  content: "text",
  folderId,
  tags: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  isEncrypted: false,
  order: 0,
});

async function mount() {
  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.encryptionKey).not.toBeNull());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await act(() => view.result.current.loadAllNotes());
  return view;
}

describe("restoreDeletedNote", () => {
  it("files the note under a folder that exists when its own is gone", async () => {
    await saveFolder(folderRow("keep"));
    await saveFolder(folderRow("doomed"));
    await saveNote(noteRow("binned", "doomed"), undefined, {
      preserveTimestamp: true,
    });

    const view = await mount();
    await act(() => view.result.current.removeNote("binned"));
    await act(() => view.result.current.removeFolder("doomed"));
    await act(() => view.result.current.restoreDeletedNote("binned"));

    const stored = await getNote("binned", view.result.current.encryptionKey!);
    expect(stored?.folderId).toBe("keep");
    expect(
      view.result.current.notes.find(n => n.id === "binned")?.folderId
    ).toBe("keep");
  });

  it("leaves a note in its own folder when that folder is still there", async () => {
    await saveFolder(folderRow("keep"));
    await saveFolder(folderRow("other"));
    await saveNote(noteRow("binned", "other"), undefined, {
      preserveTimestamp: true,
    });

    const view = await mount();
    await act(() => view.result.current.removeNote("binned"));
    await act(() => view.result.current.restoreDeletedNote("binned"));

    const stored = await getNote("binned", view.result.current.encryptionKey!);
    expect(stored?.folderId).toBe("other");
  });
});
