/**
 * The order `runSync` does things in, through the real hook.
 *
 * CLAUDE.md spends more words on this than on anything else in the sync path,
 * because it is the rule whose breach destroyed someone's writing and reported
 * nothing: **the pull goes before the flush**. An owed push is a local edit the
 * server has not taken. Send it first and it overwrites whatever arrived there
 * meanwhile; the merge then compares this device against its own edit, sees no
 * disagreement, and a newer edit made elsewhere is gone with no conflict
 * reported and no copy kept.
 *
 * That rule was enforced by a comment. `syncIntegration.test.ts` came close and
 * said so at the top: it applies a plan in the order `runSync` applies it
 * rather than calling `runSync`, so a reorder of the real thing could not turn
 * it red. This calls the real thing, and watches what reaches the server and
 * when.
 *
 * The harness is deliberately the one in `useNotes.sync.test.tsx` — same stubs,
 * same shared-database reasoning — with one addition: a timeline, because the
 * question here is not what was sent but what was sent *first*.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const remoteRows = vi.hoisted(() => ({ current: [] as unknown[] }));
const authed = vi.hoisted(() => ({ current: true }));

/**
 * Every call that reaches the server, in the order it reached it.
 *
 * The whole point of this file. `pushed` in the sibling suite answers "was it
 * sent"; nothing there could answer "was it sent before we looked".
 */
const timeline = vi.hoisted(() => ({
  current: [] as ({ op: "pull" } | { op: "push"; clientId: string })[],
}));

/** Set to refuse pushes, which is how a push becomes owed. */
const pushFails = vi.hoisted(() => ({ current: false }));

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
              timeline.current.push({ op: "pull" });
              return remoteRows.current;
            },
          },
          push: {
            mutate: async (input: { clientId: string }) => {
              timeline.current.push({ op: "push", clientId: input.clientId });
              if (pushFails.current) throw new Error("offline");
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
  getNote,
  type Note,
} from "@/lib/storage";
import { encryptNotePayload } from "@/lib/syncService";

/** Unique ids per test: see the sibling suite for why the database is shared. */
let run = 0;
let FOLDER = "order-folder-0";
let NOTE = "order-note-0";

let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;

  run += 1;
  FOLDER = `order-folder-${run}`;
  NOTE = `order-note-${run}`;

  remoteRows.current = [];
  timeline.current = [];
  pushFails.current = false;
  authed.current = true;
  localStorage.clear();
  vi.useRealTimers();
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

async function remoteRow(n: Note, key: CryptoKey) {
  return {
    clientId: n.id,
    payload: await encryptNotePayload(n, key),
    deleted: false,
    serverUpdatedAt: n.updatedAt,
  };
}

/**
 * The same note, as the other device left it: newer than whatever this one just
 * wrote.
 *
 * Relative to `mine.updatedAt` rather than a literal, because `createNote` and
 * `saveNote` stamp `Date.now()` — any number written here by hand is decades
 * older and would quietly make the local side win every comparison.
 */
async function elsewhere(mine: Note, key: CryptoKey) {
  return remoteRow(
    note({
      id: mine.id,
      content: "written elsewhere",
      updatedAt: mine.updatedAt + 10_000,
    }),
    key
  );
}

/**
 * Wait until the hook has recorded what it could not send.
 *
 * `removeNote` calls `pushDeletionToServer` without awaiting it — the deletion
 * is local the moment it happens and the send is a background concern. So a
 * test that syncs straight afterwards can beat the failure being recorded, and
 * would then be exercising a sync with nothing owed while appearing to
 * exercise the opposite.
 */
async function owed(view: { result: { current: { sync: { owed: number } } } }) {
  await waitFor(() => expect(view.result.current.sync.owed).toBeGreaterThan(0));
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

async function mountNotes() {
  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.encryptionKey).not.toBeNull());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await act(async () => {
    await view.result.current.syncNow();
  });
  return view;
}

const firstPull = () => timeline.current.findIndex(e => e.op === "pull");
const firstPush = () => timeline.current.findIndex(e => e.op === "push");

describe("a push the server never took", () => {
  it("is not sent again until after the pull", async () => {
    const key = await setup();
    const view = await mountNotes();

    // Make a note while the server is refusing, so the push is owed.
    pushFails.current = true;
    await act(async () => {
      await view.result.current.createNote("Quarterly review", FOLDER);
    });

    // The server meanwhile has a newer version from somewhere else.
    const mine = view.result.current.notes[0];
    remoteRows.current = [await elsewhere(mine, key)];

    pushFails.current = false;
    timeline.current = [];

    await act(async () => {
      await view.result.current.syncNow();
    });

    // The rule, as a timeline. Flushing first would put this device's edit on
    // the server before anything looked at what was already there, and the
    // merge would then find nothing to disagree with.
    expect(firstPull()).toBeGreaterThanOrEqual(0);
    expect(firstPush()).toBeGreaterThan(firstPull());
  });

  it("does not destroy the version that arrived while it was owed", async () => {
    const key = await setup();
    const view = await mountNotes();

    pushFails.current = true;
    await act(async () => {
      await view.result.current.createNote("Quarterly review", FOLDER);
    });
    const mine = view.result.current.notes[0];

    remoteRows.current = [await elsewhere(mine, key)];

    pushFails.current = false;
    await act(async () => {
      await view.result.current.syncNow();
    });

    // Both sides moved on from nothing agreed, so the newer one takes the id
    // and the other is kept as a copy. What must not happen is the local edit
    // silently winning because it was sent before anyone looked.
    const stored = await getNote(mine.id, key);
    expect(stored?.content).toBe("written elsewhere");
  });
});

describe("a deletion the server never took", () => {
  it("is not undone by the row still sitting there", async () => {
    const key = await setup();
    const view = await mountNotes();

    await act(async () => {
      await view.result.current.createNote("Quarterly review", FOLDER);
    });
    const mine = view.result.current.notes[0];

    // Delete it while the server is refusing, so the tombstone is owed.
    pushFails.current = true;
    await act(async () => {
      await view.result.current.removeNote(mine.id);
    });
    await owed(view);

    // From the server's side this looks like a note this device has never
    // seen, which is exactly why the merge would otherwise put it back.
    remoteRows.current = [await remoteRow(note({ id: mine.id }), key)];

    await act(async () => {
      await view.result.current.syncNow();
    });

    expect(await getNote(mine.id)).toBeNull();
  });

  it("stays deleted across repeated syncs", async () => {
    const key = await setup();
    const view = await mountNotes();

    await act(async () => {
      await view.result.current.createNote("Quarterly review", FOLDER);
    });
    const mine = view.result.current.notes[0];

    pushFails.current = true;
    await act(async () => {
      await view.result.current.removeNote(mine.id);
    });
    await owed(view);
    remoteRows.current = [await remoteRow(note({ id: mine.id }), key)];

    // The failure mode this guards is not a one-off: a deletion that comes
    // back does it on every beat, so a single pass proves less than it looks.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await view.result.current.syncNow();
      });
    }

    expect(await getNote(mine.id)).toBeNull();
  });
});

describe("an ordinary sync", () => {
  it("still pulls when there is nothing owed", async () => {
    await setup();
    const view = await mountNotes();

    timeline.current = [];
    await act(async () => {
      await view.result.current.syncNow();
    });

    // The guard above must not be satisfiable by never pulling at all.
    expect(firstPull()).toBe(0);
  });
});
