/**
 * What the two-second autosave window does when the page goes away.
 *
 * The edit sits in a debounce for two seconds after the last keystroke, and
 * the only things that flushed it were switching notes, unmounting the
 * workspace and Cmd+S. Closing the tab, or a phone putting the browser in the
 * background (where the page can be discarded without any unload at all),
 * left whatever was typed in the last two seconds only in memory. The page
 * becoming hidden, and `pagehide`, are the last moments a write can still be
 * started, so both flush.
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
let FOLDER = "pagehide-folder-0";
let NOTE = "pagehide-note-0";
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;

  run += 1;
  FOLDER = `pagehide-folder-${run}`;
  NOTE = `pagehide-note-${run}`;
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

const setVisibility = (state: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });

afterEach(() => setVisibility("visible"));

describe("leaving the page inside the autosave window", () => {
  it("writes the edit when the page is hidden", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithNote(key);
    await openAndType(view, "typed just before switching apps");
    expect((await getNote(NOTE, key))?.content).toBe("the original text");

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(async () =>
      expect((await getNote(NOTE, key))?.content).toBe(
        "typed just before switching apps"
      )
    );
  });

  it("writes the edit on pagehide", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithNote(key);
    await openAndType(view, "typed just before closing the tab");

    window.dispatchEvent(new Event("pagehide"));

    await waitFor(async () =>
      expect((await getNote(NOTE, key))?.content).toBe(
        "typed just before closing the tab"
      )
    );
  });

  it("does nothing, and does not fail, when nothing is waiting", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithNote(key);
    const before = vi.mocked(saveNote).mock.calls.length;

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(vi.mocked(saveNote).mock.calls.length).toBe(before);
    expect(view.result.current.error).toBeNull();
  });

  it("lets go of both listeners when the workspace goes away", async () => {
    // Nothing is pending after an unmount, so a leaked listener would write
    // nothing and look harmless; what shows it is the pair of add and remove.
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const addDoc = vi.spyOn(document, "addEventListener");
    const addWin = vi.spyOn(window, "addEventListener");
    const view = await mountWithNote(key);
    const removeDoc = vi.spyOn(document, "removeEventListener");
    const removeWin = vi.spyOn(window, "removeEventListener");

    view.unmount();

    const added = (spy: typeof addDoc, type: string) =>
      spy.mock.calls.filter(([t]) => t === type).map(([, fn]) => fn);
    const removed = (spy: typeof removeDoc, type: string) =>
      spy.mock.calls.filter(([t]) => t === type).map(([, fn]) => fn);

    for (const fn of added(addDoc, "visibilitychange")) {
      if (removed(removeDoc, "visibilitychange").includes(fn)) continue;
      // every listener added for the page being hidden must have been removed
      throw new Error("a visibilitychange listener was left behind");
    }
    for (const fn of added(addWin, "pagehide")) {
      expect(removed(removeWin, "pagehide")).toContain(fn);
    }
    expect(added(addWin, "pagehide").length).toBeGreaterThan(0);
    expect(added(addDoc, "visibilitychange").length).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });
});
