/**
 * The order `runSync` applies a plan in, and a bug living in that order.
 *
 * `syncIntegration.test.ts` drives the merge and storage together and proves
 * the pieces compose into the right result; its own header says plainly that
 * it does not prove `runSync` sequences them that way, because the order lives
 * in the hook's body and nothing called the hook. `useNotes.sync.test.tsx`
 * calls the hook, but asserts outcomes, not the order calls happen in.
 *
 * This file asserts the order. Both mocked collaborators — the network client
 * and `saveNote` — write into one shared log, so "pull before push" and
 * "conflict copy before overwrite" are read off actual call sequence rather
 * than inferred from a final state that could have arrived several ways.
 *
 * Writing this test surfaced a real bug on the first attempt, in the same
 * session and the same file this harness was built to catch that kind of
 * thing in. `runSync`'s two push loops recorded a baseline right after
 * `await pushNoteToServer(...)`, and `pushNoteToServer` catches its own
 * errors and never rethrows — so the `await` always resolved, and the
 * baseline was written whether or not the server actually took the push. A
 * push that failed then looked exactly like one that had succeeded: the next
 * pull would read local as "unchanged since we agreed," and a genuinely
 * independent edit arriving after it would be taken as a clean win instead of
 * the conflict it was — local's still-owed writing gone, no copy kept, no
 * conflict raised, nothing said. `pushNoteToServer` and `pushDeletionToServer`
 * now report whether the push landed, and both loops in `runSync` gate the
 * baseline on that.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const remoteRows = vi.hoisted(() => ({ current: [] as unknown[] }));
const authed = vi.hoisted(() => ({ current: true }));
/** What happened, in order, across the mocked network and storage calls. */
const events = vi.hoisted(() => ({ current: [] as string[] }));
/** Client ids whose next push attempt should fail, to simulate offline. */
const failPush = vi.hoisted(() => ({ current: new Set<string>() }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: authed.current }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        notes: {
          pull: {
            query: async () => {
              events.current.push("pull");
              return remoteRows.current;
            },
          },
          push: {
            mutate: async (input: { clientId: string }) => {
              events.current.push(`push:${input.clientId}`);
              if (failPush.current.has(input.clientId)) {
                throw new Error("simulated offline");
              }
              return { ok: true };
            },
          },
        },
      },
    }),
  },
}));

// Wraps the real `saveNote` rather than replacing it: everything else in
// storage.ts stays exactly itself, and IndexedDB genuinely gets written to.
// Only the moment of the call is recorded, so the log reads out the true
// sequence `runSync` executed rather than one reconstructed from side effects.
vi.mock("@/lib/storage", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    saveNote: vi.fn(async (...args: Parameters<typeof actual.saveNote>) => {
      events.current.push(`saveNote:${args[0].id}`);
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
  type Note,
} from "@/lib/storage";
import { encryptNotePayload } from "@/lib/syncService";
import { readBaselines, writeBaselines } from "@/lib/syncBaselines";

let run = 0;
let FOLDER = "folder-0";

// One IDBFactory, and therefore one encryption key, for the whole file — see
// the identical note in useNotes.sync.test.tsx for why a fresh factory per
// test (the repo-wide default) breaks a suite that calls getAllNotes across
// tests: the key would be fresh too, and every earlier row would fail to
// decrypt under it.
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;

  run += 1;
  FOLDER = `folder-${run}`;
  remoteRows.current = [];
  authed.current = true;
  failPush.current.clear();
  events.current = [];
  localStorage.clear();
});

const note = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  title: id,
  content: `content of ${id}`,
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

/**
 * Mount, and settle the sync the hook runs on its own on mount.
 *
 * The log is cleared once this returns, so every test's own `events.current`
 * reflects only the sync it goes on to trigger explicitly, not the mount's.
 *
 * Settling it means *waiting* for it, not calling `syncNow()`. The hook fires
 * `void runSync()` from an effect once the key and the notes have loaded, and
 * `runSync` returns immediately while one is already running — so an explicit
 * call here is usually a no-op, and the tests below end up relying on the
 * effect's run finishing inside the same await chain. That holds while the
 * stubs resolve in one tick and stops holding when they take a moment: put a
 * 40ms delay in the push stub and four of the five tests in this file fail,
 * on a sync that never ran rather than on anything they assert.
 *
 * `lastSyncedAt` is stamped only by a run that finished with nothing owed, so
 * it says the mount sync is over rather than that one has started.
 */
async function mount() {
  const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
  await saveFolder({
    id: FOLDER,
    name: "Work",
    parentId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    order: 0,
  });

  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.encryptionKey).not.toBeNull());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await waitFor(() => {
    expect(view.result.current.sync.lastSyncedAt).not.toBeNull();
    expect(view.result.current.sync.phase).not.toBe("syncing");
  });
  events.current = [];
  return { view, key };
}

describe("the pull happens before anything is pushed", () => {
  it("pulls before pushing a note that was already owed", async () => {
    // The scenario CLAUDE.md names directly: sending an owed edit before
    // looking at the server overwrites whatever arrived there in the
    // meantime. Here it is enough to show the pull is not skipped or
    // deferred — `readsWhatIsThereBeforePushing` below covers the
    // consequence of getting this backwards.
    const { view, key } = await mount();
    const n = note("owed-note", { updatedAt: 500 });
    await saveNote(n, key, { preserveTimestamp: true });
    events.current = [];

    await act(async () => {
      await view.result.current.syncNow();
    });

    const pullIndex = events.current.indexOf("pull");
    const pushIndex = events.current.findIndex(e => e === "push:owed-note");

    expect(pullIndex).toBeGreaterThanOrEqual(0);
    expect(pushIndex).toBeGreaterThan(pullIndex);
  });

  it("persists a pending edit before the pull, not after", async () => {
    // Complements the ordering above from the other end: what goes out has
    // to be read in first, which means what is *typed* has to be on disk
    // before the read happens at all. `useNotes.sync.test.tsx` proves this by
    // outcome; this proves it by call order.
    const { view, key } = await mount();
    const n = note("typed-note", { updatedAt: 500 });
    await saveNote(n, key, { preserveTimestamp: true });
    events.current = [];

    await act(async () => {
      await view.result.current.loadNote("typed-note");
    });
    act(() => {
      view.result.current.updateCurrentNote({ content: "just typed" });
    });

    await act(async () => {
      await view.result.current.syncNow();
    });

    const persistIndex = events.current.indexOf("saveNote:typed-note");
    const pullIndex = events.current.indexOf("pull");

    expect(persistIndex).toBeGreaterThanOrEqual(0);
    expect(pullIndex).toBeGreaterThan(persistIndex);
  });
});

describe("a failed push must not look like an agreement", () => {
  it("does not record a baseline for a push the server never took", async () => {
    const { view, key } = await mount();
    const n = note("flaky-note", { updatedAt: 500 });
    await saveNote(n, key, { preserveTimestamp: true });
    failPush.current.add("flaky-note");

    await act(async () => {
      await view.result.current.syncNow();
    });

    expect(view.result.current.sync.owed).toBeGreaterThan(0);
    expect(readBaselines()["flaky-note"]).toBeUndefined();
  });

  it("reads what is actually there before pushing, so a failed push cannot overwrite a genuine edit unseen", async () => {
    // The consequence, played all the way through. Without the fix: the
    // wrongly-recorded baseline makes the next pull read local as unchanged
    // since agreement, a real independent edit arriving after is taken as a
    // clean win, and it silently replaces local's still-owed writing — no
    // conflict raised, no copy kept, nothing reported. This is the same
    // failure mode `mergeNotes`'s baseline tests already guard against,
    // arriving here by a different door: a push that failed instead of a
    // clock that lied.
    const { view, key } = await mount();
    const n = note("racing-note", { updatedAt: 500 });
    await saveNote(n, key, { preserveTimestamp: true });
    failPush.current.add("racing-note");

    await act(async () => {
      await view.result.current.syncNow();
    });
    expect(readBaselines()["racing-note"]).toBeUndefined();

    // The push can go through from here; what matters is that the server
    // genuinely never took the first attempt. A second device's real edit
    // now lands — from this test's point of view, on the server all along.
    failPush.current.delete("racing-note");
    remoteRows.current = [
      await remoteRow(
        note("racing-note", {
          content: "written by someone who never saw this device's edit",
          updatedAt: 999_999_999_999,
        }),
        key
      ),
    ];

    await act(async () => {
      await view.result.current.syncNow();
    });

    await waitFor(() =>
      expect(view.result.current.conflicts).toBeGreaterThan(0)
    );

    const stored = await view.result.current.getAllNotesForExport();
    const winner = stored.find(x => x.id === "racing-note");
    expect(winner?.content).toBe(
      "written by someone who never saw this device's edit"
    );

    const copy = stored.find(
      x => x.id !== "racing-note" && /conflicting copy/.test(x.title)
    );
    expect(copy?.content).toBe(`content of racing-note`);
  });
});

describe("a conflict copy survives before the note it lost to is overwritten", () => {
  it("saves the losing copy before the winning content lands on the original id", async () => {
    const { view, key } = await mount();
    const original = note("contested", { updatedAt: 100 });
    await saveNote(original, key, { preserveTimestamp: true });
    writeBaselines({ contested: 100 });
    remoteRows.current = [
      await remoteRow(note("contested", { updatedAt: 100 }), key),
    ];

    // Settle the "both sides agree" state before anyone diverges.
    await act(async () => {
      await view.result.current.syncNow();
    });

    await act(async () => {
      await view.result.current.loadNote("contested");
    });
    act(() => {
      view.result.current.updateCurrentNote({
        content: "typed here, and lost",
      });
    });
    remoteRows.current = [
      await remoteRow(
        note("contested", {
          content: "arrived from elsewhere",
          updatedAt: 9_000_000_000_000,
        }),
        key
      ),
    ];
    events.current = [];

    await act(async () => {
      await view.result.current.syncNow();
    });

    const saveNoteEvents = events.current
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.startsWith("saveNote:"));

    // Two writes to "contested" happen in this run: `persistPendingLocally`
    // puts the local edit on disk before the pull, and `plan.saveLocal` later
    // overwrites it with the version that won. The copy's own save — a fresh
    // id, since `conflictCopy` never reuses the note's own — has to land
    // before that second one, or a run that died in between would have lost
    // the losing content for good.
    const contestedIndices = saveNoteEvents
      .filter(({ e }) => e === "saveNote:contested")
      .map(({ i }) => i);
    const copyIndex = saveNoteEvents.find(
      ({ e }) => e !== "saveNote:contested"
    )?.i;

    expect(contestedIndices).toHaveLength(2);
    expect(copyIndex).toBeGreaterThanOrEqual(0);
    expect(copyIndex).toBeLessThan(contestedIndices[1]);
  });
});
