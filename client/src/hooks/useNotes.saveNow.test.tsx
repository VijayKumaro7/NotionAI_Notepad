/**
 * Cmd+S has to save, and has to say what happened.
 *
 * The shortcut used to be `toast.success("Note saved")` and nothing else. The
 * autosave waits two seconds after the last keystroke, so a person pressing
 * Cmd+S mid-sentence was told the note was saved while the edit was still only
 * in the debounce — and a write that then failed would have been announced
 * the same way. `saveNow` is the debounce's flush, handed to the page: it
 * writes what is held (with the version snapshot and the push, the same as the
 * timer would) and resolves to whether the write landed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const saveFails = vi.hoisted(() => ({ current: false }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
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

vi.mock("@/lib/storage", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    saveNote: vi.fn(async (...args: Parameters<typeof actual.saveNote>) => {
      if (saveFails.current) throw new Error("disk full");
      return actual.saveNote(...args);
    }),
  };
});

import { useNotes } from "./useNotes";
import {
  getOrCreateEncryptionKey,
  LOCAL_KEY_ID,
  saveFolder,
  saveNote,
  getNote,
  type Note,
} from "@/lib/storage";

// One IDBFactory for the file and unique ids per test — see the note in
// `useNotes.sync.test.tsx`: a fresh factory means a fresh key.
let run = 0;
let FOLDER = "savenow-folder-0";
let NOTE = "savenow-note-0";
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;

  run += 1;
  FOLDER = `savenow-folder-${run}`;
  NOTE = `savenow-note-${run}`;
  saveFails.current = false;
  localStorage.clear();
});

const note = (): Note => ({
  id: NOTE,
  title: "Draft",
  content: "the original text",
  folderId: FOLDER,
  tags: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  isEncrypted: false,
  order: 0,
});

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

async function openAndType(
  view: Awaited<ReturnType<typeof mountWithNote>>,
  content: string
) {
  await act(async () => {
    await view.result.current.loadNote(NOTE);
  });
  act(() => {
    view.result.current.updateCurrentNote({ content });
  });
}

describe("saveNow", () => {
  it("writes an edit that is still inside the autosave window", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithNote(key);
    await openAndType(view, "typed a moment ago");

    // Nothing has reached the store yet: the two-second timer is still running.
    expect((await getNote(NOTE, key))?.content).toBe("the original text");

    let saved: boolean | undefined;
    await act(async () => {
      saved = await view.result.current.saveNow();
    });

    expect(saved).toBe(true);
    expect((await getNote(NOTE, key))?.content).toBe("typed a moment ago");
  });

  it("counts nothing pending as saved", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithNote(key);

    let saved: boolean | undefined;
    await act(async () => {
      saved = await view.result.current.saveNow();
    });

    expect(saved).toBe(true);
  });

  it("reports a write that failed instead of claiming it landed", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithNote(key);
    await openAndType(view, "typed, then the disk filled");

    saveFails.current = true;
    let saved: boolean | undefined;
    await act(async () => {
      saved = await view.result.current.saveNow();
    });

    expect(saved).toBe(false);
    expect(view.result.current.error).toBe("disk full");
    expect((await getNote(NOTE, key))?.content).toBe("the original text");
  });
});
