import { describe, expect, it } from "vitest";
import {
  type SyncEvent,
  type SyncState,
  describeSync,
  initialSyncState,
  owedEntries,
  syncReducer,
} from "./syncState";

/** Apply a run of events, the way the hook does. */
const run = (...events: SyncEvent[]): SyncState =>
  events.reduce(syncReducer, initialSyncState);

const online = { online: true };
const offline = { online: false };

describe("what is owed to the server", () => {
  it("remembers a push that failed, so it can be sent again", () => {
    const state = run({
      type: "push-failed",
      id: "note-1",
      kind: "note",
      message: "Failed to fetch",
    });

    expect(owedEntries(state)).toEqual([{ id: "note-1", kind: "note" }]);
  });

  it("forgets it once the push lands", () => {
    const state = run(
      { type: "push-failed", id: "note-1", kind: "note", message: "offline" },
      { type: "pushed", id: "note-1", at: 1000 }
    );

    expect(owedEntries(state)).toEqual([]);
    expect(state.lastSyncedAt).toBe(1000);
    expect(state.lastError).toBeNull();
  });

  // Editing the same note twice while offline owes one push, not two: the
  // payload is the whole note, so the second send carries the first edit.
  it("counts a note once however many times its push failed", () => {
    const state = run(
      { type: "push-failed", id: "note-1", kind: "note", message: "offline" },
      { type: "push-failed", id: "note-1", kind: "note", message: "offline" },
      { type: "push-failed", id: "note-2", kind: "note", message: "offline" }
    );

    expect(owedEntries(state)).toHaveLength(2);
  });

  it("keeps a deletion apart from a note, since they send different things", () => {
    const state = run({
      type: "push-failed",
      id: "note-1",
      kind: "deletion",
      message: "offline",
    });

    expect(owedEntries(state)).toEqual([{ id: "note-1", kind: "deletion" }]);
  });

  // A note edited and then deleted while offline: the tombstone is the truth,
  // and sending the content afterwards would resurrect it.
  it("lets a deletion replace the note push it supersedes", () => {
    const state = run(
      { type: "push-failed", id: "note-1", kind: "note", message: "offline" },
      {
        type: "push-failed",
        id: "note-1",
        kind: "deletion",
        message: "offline",
      }
    );

    expect(owedEntries(state)).toEqual([{ id: "note-1", kind: "deletion" }]);
  });
});

describe("in-flight bookkeeping", () => {
  it("counts overlapping attempts", () => {
    const state = run(
      { type: "started" },
      { type: "started" },
      { type: "settled" }
    );

    expect(state.inFlight).toBe(1);
  });

  // A settle without a start is a slip somewhere; a negative count would read
  // as "syncing" for the rest of the session.
  it("never goes below zero", () => {
    expect(run({ type: "settled" }, { type: "settled" }).inFlight).toBe(0);
  });
});

describe("when the clock may be stamped", () => {
  it("stamps a run that left nothing owed", () => {
    const state = run({ type: "synced", at: 5000 });

    expect(state.lastSyncedAt).toBe(5000);
  });

  // The point of the module. A pull that succeeded while pushes are still
  // queued has not synced this device, and "synced just now" beside three
  // unsent edits is the reassurance nobody should be given.
  it("refuses to stamp a run that still owes something", () => {
    const state = run(
      { type: "push-failed", id: "note-1", kind: "note", message: "offline" },
      { type: "synced", at: 5000 }
    );

    expect(state.lastSyncedAt).toBeNull();
  });

  it("clears the last failure on a success, and not before", () => {
    const failed = run({ type: "sync-failed", message: "Failed to fetch" });
    expect(failed.lastError).toBe("Failed to fetch");

    expect(syncReducer(failed, { type: "synced", at: 1 }).lastError).toBeNull();
  });
});

describe("what the reader is told", () => {
  it("says nothing before anything has been attempted", () => {
    expect(describeSync(initialSyncState, online).phase).toBe("unknown");
  });

  it("says synced when the server has everything this device wrote", () => {
    const state = run({ type: "synced", at: 1000 });

    expect(describeSync(state, online)).toMatchObject({
      phase: "synced",
      owed: 0,
      offline: false,
      lastSyncedAt: 1000,
    });
  });

  it("says syncing while an attempt is running", () => {
    const state = run({ type: "synced", at: 1000 }, { type: "started" });

    expect(describeSync(state, online).phase).toBe("syncing");
  });

  it("says waiting, with a count, while pushes are owed", () => {
    const state = run(
      { type: "synced", at: 1000 },
      { type: "push-failed", id: "a", kind: "note", message: "offline" },
      { type: "push-failed", id: "b", kind: "note", message: "offline" }
    );

    expect(describeSync(state, online)).toMatchObject({
      phase: "waiting",
      owed: 2,
    });
  });

  // Being offline outranks being in flight: a request made with no network is
  // not progress, and a spinner would suggest it is about to resolve.
  it("does not call it syncing when there is no network", () => {
    const state = run(
      { type: "push-failed", id: "a", kind: "note", message: "offline" },
      { type: "started" }
    );

    expect(describeSync(state, offline)).toMatchObject({
      phase: "waiting",
      offline: true,
    });
  });

  // Offline with nothing owed is genuinely synced — everything written here is
  // on the server. The flag is carried so the indicator can still say so.
  it("is synced but offline when there is nothing to send", () => {
    const state = run({ type: "synced", at: 1000 });

    expect(describeSync(state, offline)).toMatchObject({
      phase: "synced",
      offline: true,
      owed: 0,
    });
  });

  // Opened with no network: nothing has been sent and nothing received, so
  // "Synced" would be a claim about a conversation that never happened.
  it("does not claim synced when offline and nothing ever synced", () => {
    expect(describeSync(initialSyncState, offline).phase).toBe("unknown");
  });

  it("stays waiting after a failure with nothing queued, rather than claiming synced", () => {
    const state = run(
      { type: "synced", at: 1000 },
      { type: "sync-failed", message: "Failed to fetch" }
    );

    expect(describeSync(state, online)).toMatchObject({
      phase: "waiting",
      owed: 0,
      error: "Failed to fetch",
    });
  });

  // The sequence an editor actually produces: write, fail, come back, retry.
  it("walks from synced to waiting and back", () => {
    let state = run({ type: "synced", at: 1000 });
    expect(describeSync(state, online).phase).toBe("synced");

    state = syncReducer(state, {
      type: "push-failed",
      id: "note-1",
      kind: "note",
      message: "Failed to fetch",
    });
    expect(describeSync(state, online).phase).toBe("waiting");

    state = syncReducer(state, { type: "started" });
    expect(describeSync(state, online).phase).toBe("syncing");

    state = syncReducer(state, { type: "pushed", id: "note-1", at: 2000 });
    state = syncReducer(state, { type: "settled" });
    expect(describeSync(state, online)).toMatchObject({
      phase: "synced",
      owed: 0,
      lastSyncedAt: 2000,
      error: null,
    });
  });
});
