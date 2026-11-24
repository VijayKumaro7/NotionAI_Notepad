/**
 * Asking the browser not to delete the notes.
 *
 * In this app the browser's own storage can be the only copy of someone's
 * notes. Left at the default ("best effort") a browser may discard the whole
 * origin under disk pressure, and Safari clears a site's storage after a week
 * without use, with no warning. `navigator.storage.persist()` is the request
 * that makes it ask the person first. It is made after the first note has been
 * written, not at page load: Firefox shows a prompt for it, and a prompt before
 * the person has done anything is one they have no reason to grant.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const saveFails = vi.hoisted(() => ({ current: false }));
const readFails = vi.hoisted(() => ({ current: false }));

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
    getAllNotes: vi.fn(
      async (...args: Parameters<typeof actual.getAllNotes>) => {
        if (readFails.current) throw new Error("store unreadable");
        return actual.getAllNotes(...args);
      }
    ),
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
let FOLDER = "persist-folder-0";
let NOTE = "persist-note-0";
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;

  run += 1;
  FOLDER = `persist-folder-${run}`;
  NOTE = `persist-note-${run}`;
  saveFails.current = false;
  readFails.current = false;
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

const persist = vi.fn(async () => true);
const persisted = vi.fn(async () => false);

beforeEach(() => {
  persist.mockClear();
  persisted.mockClear();
  Object.defineProperty(navigator, "storage", {
    value: { persisted, persist },
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "storage");
});

describe("persistent storage", () => {
  it("is not asked for just by opening the workspace", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    await mountWithNote(key);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(persist).not.toHaveBeenCalled();
  });

  it("is asked for once the first note has been written, and only once", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithNote(key);
    await openAndType(view, "first words");

    await act(async () => {
      await view.result.current.saveNow();
    });
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));

    act(() => {
      view.result.current.updateCurrentNote({ content: "more words" });
    });
    await act(async () => {
      await view.result.current.saveNow();
    });
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(persist).toHaveBeenCalledTimes(1);
    // The helper has its own week-long memory, so asking again would not reach
    // `persist`; what shows the page does not even consult it again is this.
    expect(persisted).toHaveBeenCalledTimes(1);
  });

  it("is not asked for when the write failed", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithNote(key);
    await openAndType(view, "words that will not save");

    saveFails.current = true;
    await act(async () => {
      await view.result.current.saveNow();
    });
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(persist).not.toHaveBeenCalled();
  });
});
