/**
 * The sync-to-editor wiring, end to end through the real hook.
 *
 * These paths shipped with no automated test, three times over, each time with
 * the same note in the commit message: there was no harness for a hook here.
 * The decisions they carry out — `resolveOpenNote`, `mergeNotes`,
 * `planRestore` — are pure and covered. The glue between them was reasoned
 * about and never executed, and every one of these behaviours exists because
 * the glue silently lost somebody's writing.
 *
 * Only `trpc` and `useAuth` are stubbed; the rest is real — real IndexedDB
 * (fake-indexeddb), real AES-GCM, real merge, real debounce. A test that mocked
 * storage would pass while the thing these guard against still happened.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const remoteRows = vi.hoisted(() => ({ current: [] as unknown[] }));
const pushed = vi.hoisted(() => ({ current: [] as { clientId: string }[] }));
const authed = vi.hoisted(() => ({ current: true }));

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
            mutate: async (input: { clientId: string }) => {
              pushed.current.push(input);
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
  getAllNotes,
  type Note,
} from "@/lib/storage";
import { encryptNotePayload } from "@/lib/syncService";
import { writeBaselines } from "@/lib/syncBaselines";

/**
 * A fresh id per test.
 *
 * `vitest.setup.ts` gives each test a new `IDBFactory`, but `storage.ts` caches
 * the open `IDBDatabase` in a module variable, and that cache outlives the
 * reset — so every test in this file shares one database and notes written by
 * one are visible to the next. Unique ids sidestep that entirely, and are
 * closer to life than a wiped store anyway: a real workspace is never empty.
 */
let run = 0;
let FOLDER = "folder-0";
let NOTE = "note-0";

/**
 * One database, and therefore one encryption key, for the whole file.
 *
 * `vitest.setup.ts` installs a fresh `IDBFactory` per test, which is right for
 * suites that want an empty store. It is wrong here: the encryption key lives
 * in IndexedDB too, so a fresh factory means a fresh key, and `getAllNotes`
 * decrypts every row it finds — including rows an earlier test wrote under the
 * previous key, which then fail to decrypt and poison the merge.
 *
 * This runs after that reset and puts the first factory back. Isolation comes
 * from the ids instead, which is closer to life anyway: a real workspace is
 * never empty when a sync runs.
 */
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;

  run += 1;
  FOLDER = `folder-${run}`;
  NOTE = `note-${run}`;
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

/** A row as the server would hand it back: opaque, encrypted with our key. */
async function remoteRow(n: Note, key: CryptoKey) {
  return {
    clientId: n.id,
    payload: await encryptNotePayload(n, key),
    deleted: false,
    serverUpdatedAt: n.updatedAt,
  };
}

async function setup() {
  const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
  await saveFolder({
    id: FOLDER,
    name: "Work",
    parentId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    order: 0,
  });
  return key;
}

/**
 * Mount, and wait for the key and the sync the hook runs on mount.
 *
 * That first sync matters to how these tests are written: the server is left
 * empty for it, so each test can then put a row there and call `syncNow` to
 * exercise one transition, rather than racing the mount.
 */
async function mountNotes() {
  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.encryptionKey).not.toBeNull());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await act(async () => {
    await view.result.current.syncNow();
  });
  return view;
}

beforeEach(() => {
  remoteRows.current = [];
  pushed.current = [];
  authed.current = true;
  localStorage.clear();
  vi.useRealTimers();
});

describe("a sync that replaces the note on screen", () => {
  it("puts the arriving version into the editor", async () => {
    // The bug: the merge wrote the newer copy to IndexedDB and the editor went
    // on showing the old one, so the next keystroke saved the stale text back
    // over what had just arrived.
    const key = await setup();
    const local = note({ content: "what the screen shows", updatedAt: 100 });
    await saveNote(local, key, { preserveTimestamp: true });
    writeBaselines({ [local.id]: 100 });

    const view = await mountNotes();
    await act(async () => {
      await view.result.current.loadNote(NOTE);
    });
    expect(view.result.current.currentNote?.content).toBe(
      "what the screen shows"
    );

    // Only now does the other device's version appear on the server.
    remoteRows.current = [
      await remoteRow(
        note({ content: "what the other device wrote", updatedAt: 500 }),
        key
      ),
    ];

    await act(async () => {
      await view.result.current.syncNow();
    });

    await waitFor(() =>
      expect(view.result.current.currentNote?.content).toBe(
        "what the other device wrote"
      )
    );
  });

  it("leaves the editor alone when the sync brought nothing for it", async () => {
    const key = await setup();
    const local = note({ content: "untouched", updatedAt: 100 });
    await saveNote(local, key, { preserveTimestamp: true });
    writeBaselines({ [local.id]: 100 });
    remoteRows.current = [await remoteRow(local, key)];

    const view = await mountNotes();
    await act(async () => {
      await view.result.current.loadNote(NOTE);
    });
    await act(async () => {
      await view.result.current.syncNow();
    });

    expect(view.result.current.currentNote?.content).toBe("untouched");
  });

  it("does not disturb a note nobody is looking at", async () => {
    const key = await setup();
    await saveNote(note({ updatedAt: 100 }), key, { preserveTimestamp: true });
    writeBaselines({ [NOTE]: 100 });

    const view = await mountNotes();
    remoteRows.current = [
      await remoteRow(note({ content: "newer", updatedAt: 500 }), key),
    ];
    await act(async () => {
      await view.result.current.syncNow();
    });

    expect(view.result.current.currentNote).toBeNull();
  });
});

describe("an edit still inside the autosave window", () => {
  it("is written down before the pull, so the merge can see it", async () => {
    // Invisible to `getAllNotes`, the edit was never weighed against the
    // server's copy: the remote row was taken as a clean win and the typing
    // was overwritten without ever becoming a conflict.
    const key = await setup();
    const local = note({ content: "saved text", updatedAt: 100 });
    await saveNote(local, key, { preserveTimestamp: true });
    writeBaselines({ [local.id]: 100 });

    const view = await mountNotes();
    await act(async () => {
      await view.result.current.loadNote(NOTE);
    });

    // Type, and sync before the two-second debounce fires.
    act(() => {
      view.result.current.updateCurrentNote({ content: "just typed" });
    });

    await act(async () => {
      await view.result.current.syncNow();
    });

    const stored = await getNote(NOTE, key);
    expect(stored?.content).toBe("just typed");
  });

  it("keeps both sides when the server moved too", async () => {
    // Both sides past the baseline is a real conflict, and the whole point of
    // persisting the pending edit first is that it gets to be one.
    const key = await setup();
    const local = note({ content: "saved text", updatedAt: 100 });
    await saveNote(local, key, { preserveTimestamp: true });
    writeBaselines({ [local.id]: 100 });

    const view = await mountNotes();
    await act(async () => {
      await view.result.current.loadNote(NOTE);
    });
    act(() => {
      view.result.current.updateCurrentNote({ content: "typed here" });
    });

    remoteRows.current = [
      await remoteRow(
        note({ content: "written elsewhere", updatedAt: 9_000_000_000_000 }),
        key
      ),
    ];

    await act(async () => {
      await view.result.current.syncNow();
    });

    await waitFor(() =>
      expect(view.result.current.conflicts).toBeGreaterThan(0)
    );

    // The losing side survives as a note of its own rather than being dropped.
    // Read from the store rather than the hook's `notes`: that array is
    // refreshed from the first folder only, and this file's folders accumulate.
    const all = await getAllNotes(key);
    const copies = all.filter(n => /conflicting copy/.test(n.title));
    expect(copies).toHaveLength(1);
    expect(copies[0].content).toBe("typed here");
  });
});

describe("a note the sync installed", () => {
  it("is not written straight back out by the autosave", async () => {
    // Arming the debounce for a version that came from the store re-saves it
    // with a fresh updatedAt and pushes that — dating another device's edit to
    // now, breaking the baseline the sync just recorded, and sending a write
    // nobody made. With the same note open on two devices, each refresh
    // provokes the other.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const key = await setup();
      const local = note({ content: "old", updatedAt: 100 });
      await saveNote(local, key, { preserveTimestamp: true });
      writeBaselines({ [local.id]: 100 });

      const view = await mountNotes();
      await act(async () => {
        await view.result.current.loadNote(NOTE);
      });
      remoteRows.current = [
        await remoteRow(note({ content: "arrived", updatedAt: 500 }), key),
      ];
      await act(async () => {
        await view.result.current.syncNow();
      });
      await waitFor(() =>
        expect(view.result.current.currentNote?.content).toBe("arrived")
      );

      const before = await getNote(NOTE, key);
      pushed.current = [];

      // Well past the two-second debounce.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      const after = await getNote(NOTE, key);
      expect(after?.updatedAt).toBe(before?.updatedAt);
      expect(pushed.current.map(p => p.clientId)).not.toContain(NOTE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still autosaves normally the moment somebody types", async () => {
    // The guard is by object identity, so a keystroke must lift it — otherwise
    // it would suppress the very saves it is meant to leave alone.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const key = await setup();
      await saveNote(note({ content: "old", updatedAt: 100 }), key, {
        preserveTimestamp: true,
      });
      writeBaselines({ [NOTE]: 100 });

      const view = await mountNotes();
      await act(async () => {
        await view.result.current.loadNote(NOTE);
      });
      remoteRows.current = [
        await remoteRow(note({ content: "arrived", updatedAt: 500 }), key),
      ];
      await act(async () => {
        await view.result.current.syncNow();
      });
      await waitFor(() =>
        expect(view.result.current.currentNote?.content).toBe("arrived")
      );

      act(() => {
        view.result.current.updateCurrentNote({ content: "typed after" });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      await waitFor(async () => {
        const stored = await getNote(NOTE, key);
        expect(stored?.content).toBe("typed after");
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
