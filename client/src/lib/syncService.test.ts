import { describe, expect, it } from "vitest";
import {
  decryptRemoteNotes,
  encryptNotePayload,
  decryptNotePayload,
  mergeNotes,
  alreadyAgreed,
  conflictCopy,
  conflictCopyTitle,
  type DecryptedRemoteNote,
  type RemoteNoteRow,
} from "./syncService";
import { getOrCreateEncryptionKey, type Note } from "./storage";

const note = (over: Partial<Note> = {}): Note => ({
  id: "note-1",
  title: "Note",
  content: "Body",
  folderId: "folder-1",
  tags: [],
  createdAt: 1_000,
  updatedAt: 2_000,
  isEncrypted: false,
  order: 0,
  ...over,
});

const remote = (
  over: Partial<DecryptedRemoteNote> = {}
): DecryptedRemoteNote => ({
  clientId: "note-1",
  note: note(),
  deleted: false,
  serverUpdatedAt: 2_000,
  ...over,
});

describe("mergeNotes", () => {
  it("returns an empty plan for empty input", () => {
    expect(mergeNotes([], [])).toEqual({
      saveLocal: [],
      deleteLocal: [],
      conflicts: [],
      push: [],
    });
  });

  it("saves a remote note that does not exist locally", () => {
    const incoming = note({ id: "remote-only" });
    const plan = mergeNotes(
      [],
      [remote({ clientId: "remote-only", note: incoming })]
    );

    expect(plan.saveLocal).toEqual([incoming]);
    expect(plan.push).toEqual([]);
    expect(plan.deleteLocal).toEqual([]);
  });

  it("pushes a local note the server has never seen", () => {
    const local = note({ id: "local-only" });
    const plan = mergeNotes([local], []);

    expect(plan.push).toEqual([local]);
    expect(plan.saveLocal).toEqual([]);
  });

  it("takes the remote copy when it is newer", () => {
    const local = note({ updatedAt: 2_000 });
    const newer = note({ updatedAt: 3_000, content: "From the other device" });

    const plan = mergeNotes([local], [remote({ note: newer })]);

    expect(plan.saveLocal).toEqual([newer]);
    expect(plan.push).toEqual([]);
  });

  it("pushes the local copy when it is newer", () => {
    const local = note({ updatedAt: 5_000, content: "Edited here" });

    const plan = mergeNotes(
      [local],
      [remote({ note: note({ updatedAt: 4_000 }) })]
    );

    expect(plan.push).toEqual([local]);
    expect(plan.saveLocal).toEqual([]);
  });

  it("does nothing when both sides carry the same timestamp", () => {
    const local = note({ updatedAt: 2_000 });

    const plan = mergeNotes(
      [local],
      [remote({ note: note({ updatedAt: 2_000 }) })]
    );

    expect(plan).toEqual({
      saveLocal: [],
      deleteLocal: [],
      push: [],
      conflicts: [],
    });
  });

  it("leaves both sides alone when the payload could not be decrypted", () => {
    const local = note({ updatedAt: 9_000 });

    // note=null with deleted=false is the "written with a different key" case.
    const plan = mergeNotes([local], [remote({ note: null })]);

    expect(plan).toEqual({
      saveLocal: [],
      deleteLocal: [],
      push: [],
      conflicts: [],
    });
  });

  describe("deletions", () => {
    it("deletes locally when the remote tombstone is newer", () => {
      const local = note({ updatedAt: 1_000 });

      const plan = mergeNotes(
        [local],
        [remote({ note: null, deleted: true, serverUpdatedAt: 5_000 })]
      );

      expect(plan.deleteLocal).toEqual(["note-1"]);
      expect(plan.push).toEqual([]);
    });

    it("revives the note when the local edit is newer than the tombstone", () => {
      const local = note({
        updatedAt: 9_000,
        content: "Edited after the delete",
      });

      const plan = mergeNotes(
        [local],
        [remote({ note: null, deleted: true, serverUpdatedAt: 5_000 })]
      );

      expect(plan.push).toEqual([local]);
      expect(plan.deleteLocal).toEqual([]);
    });

    it("ignores a tombstone for a note this device does not have", () => {
      const plan = mergeNotes(
        [],
        [remote({ note: null, deleted: true, serverUpdatedAt: 5_000 })]
      );

      expect(plan).toEqual({
        saveLocal: [],
        deleteLocal: [],
        push: [],
        conflicts: [],
      });
    });
  });

  it("handles several notes in one pass without cross-talk", () => {
    const staying = note({ id: "a", updatedAt: 5_000 });
    const doomed = note({ id: "b", updatedAt: 1_000 });
    const localOnly = note({ id: "c", updatedAt: 7_000 });
    const incoming = note({ id: "d", updatedAt: 8_000 });

    const plan = mergeNotes(
      [staying, doomed, localOnly],
      [
        remote({ clientId: "a", note: note({ id: "a", updatedAt: 4_000 }) }),
        remote({
          clientId: "b",
          note: null,
          deleted: true,
          serverUpdatedAt: 3_000,
        }),
        remote({ clientId: "d", note: incoming }),
      ]
    );

    expect(plan.saveLocal.map(n => n.id)).toEqual(["d"]);
    expect(plan.deleteLocal).toEqual(["b"]);
    expect(plan.push.map(n => n.id).sort()).toEqual(["a", "c"]);
  });
});

describe("payload encryption round trip", () => {
  it("restores the note exactly", async () => {
    const key = await getOrCreateEncryptionKey("sync-test-user");
    const original = note({
      title: "Round trip",
      tags: ["a", "b"],
      content: "Line 1\nLine 2",
    });

    const restored = await decryptNotePayload(
      await encryptNotePayload(original, key),
      key
    );

    expect(restored).toEqual(original);
  });
});

describe("decryptRemoteNotes", () => {
  const row = (over: Partial<RemoteNoteRow> = {}): RemoteNoteRow => ({
    clientId: "note-1",
    payload: "",
    deleted: false,
    serverUpdatedAt: 2_000,
    ...over,
  });

  it("decrypts a readable row", async () => {
    const key = await getOrCreateEncryptionKey("sync-test-user");
    const original = note();
    const payload = await encryptNotePayload(original, key);

    const [result] = await decryptRemoteNotes([row({ payload })], key);

    expect(result.note).toEqual(original);
    expect(result.deleted).toBe(false);
  });

  it("reports a tombstone without touching the payload", async () => {
    const key = await getOrCreateEncryptionKey("sync-test-user");

    const [result] = await decryptRemoteNotes(
      [row({ deleted: true, payload: "not-decryptable" })],
      key
    );

    expect(result).toMatchObject({
      note: null,
      deleted: true,
      serverUpdatedAt: 2_000,
    });
  });

  it("keeps a row written with a different key instead of dropping it", async () => {
    const theirKey = await getOrCreateEncryptionKey("other-device-user");
    const ourKey = await getOrCreateEncryptionKey("this-device-user");
    const payload = await encryptNotePayload(note(), theirKey);

    const [result] = await decryptRemoteNotes([row({ payload })], ourKey);

    // note=null so mergeNotes leaves it alone rather than clobbering it.
    expect(result.note).toBeNull();
    expect(result.deleted).toBe(false);
    expect(mergeNotes([note()], [result])).toEqual({
      saveLocal: [],
      deleteLocal: [],
      conflicts: [],
      push: [],
    });
  });
});

// The bug these cover: sync used to resolve every disagreement by timestamp
// and overwrite the loser in place. `saveNote` is a plain put and records no
// version, so an edit made on a second device was not recoverable afterwards —
// it was simply gone, with nothing shown to say so.
describe("conflicts", () => {
  const local = note({ content: "written here", updatedAt: 3_000 });
  const theirs = note({ content: "written there", updatedAt: 4_000 });

  it("is not a conflict when this device never touched the note", () => {
    const plan = mergeNotes([local], [remote({ note: theirs })], {
      // The local copy still sits exactly where the last sync left it.
      "note-1": 3_000,
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.saveLocal).toEqual([theirs]);
  });

  it("is not a conflict when the server never took another edit", () => {
    const plan = mergeNotes([theirs], [remote({ note: local })], {
      "note-1": 3_000,
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.push).toEqual([theirs]);
  });

  it("is a conflict when both sides moved on from what was agreed", () => {
    const plan = mergeNotes([local], [remote({ note: theirs })], {
      // Agreed at 2_000; local went to 3_000 and remote to 4_000 since.
      "note-1": 2_000,
    });

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({
      id: "note-1",
      losingSide: "local",
    });
    expect(plan.conflicts[0].winning.content).toBe("written there");
    expect(plan.conflicts[0].losing.content).toBe("written here");
  });

  // The winner still has to be applied — keeping both sides does not mean
  // refusing to sync.
  it("still applies the winner alongside the conflict", () => {
    const plan = mergeNotes([local], [remote({ note: theirs })], {
      "note-1": 2_000,
    });

    expect(plan.saveLocal).toEqual([theirs]);
  });

  it("reports the remote as the losing side when the local edit is newer", () => {
    const plan = mergeNotes([theirs], [remote({ note: local })], {
      "note-1": 2_000,
    });

    expect(plan.conflicts[0]).toMatchObject({ losingSide: "remote" });
    expect(plan.conflicts[0].losing.content).toBe("written here");
    expect(plan.push).toEqual([theirs]);
  });

  // A baseline can go missing — a cleared profile, a new browser, storage
  // refused. Guessing "no conflict" there is guessing in the direction that
  // loses writing, so the merge guesses the other way.
  it("treats a missing baseline as a possible conflict rather than a clean win", () => {
    const plan = mergeNotes([local], [remote({ note: theirs })]);

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.saveLocal).toEqual([theirs]);
  });

  it("does not invent a conflict for a note only one side has", () => {
    const fresh = note({ id: "note-2", updatedAt: 9_000 });

    expect(
      mergeNotes([], [remote({ clientId: "note-2", note: fresh })]).conflicts
    ).toEqual([]);
    expect(mergeNotes([fresh], []).conflicts).toEqual([]);
  });

  it("does not invent a conflict when the two sides already agree", () => {
    expect(mergeNotes([local], [remote({ note: local })]).conflicts).toEqual(
      []
    );
  });

  // Deletion handling was reasoned about separately and is left alone here:
  // the tombstone rules already decide between a deletion and a later edit.
  it("leaves tombstone handling to the deletion rules", () => {
    const plan = mergeNotes(
      [local],
      [remote({ note: null, deleted: true, serverUpdatedAt: 5_000 })],
      { "note-1": 2_000 }
    );

    expect(plan.conflicts).toEqual([]);
    expect(plan.deleteLocal).toEqual(["note-1"]);
  });
});

describe("the copy kept from a conflict", () => {
  const losing = note({ title: "Meeting", content: "the version that lost" });
  const conflict = {
    id: "note-1",
    winning: note({ content: "the version that won", updatedAt: 4_000 }),
    losing,
    losingSide: "local" as const,
  };

  it("keeps the losing content under a new id, in the same folder", () => {
    const copy = conflictCopy(conflict, 5_000, "note-2");

    expect(copy.id).toBe("note-2");
    expect(copy.content).toBe("the version that lost");
    expect(copy.folderId).toBe(losing.folderId);
  });

  it("says what it is and when, so two conflicts do not collide", () => {
    expect(
      conflictCopy(conflict, Date.UTC(2026, 8, 15, 14, 30), "x").title
    ).toBe("Meeting (conflicting copy 2026-09-15 14:30)");
    expect(conflictCopyTitle("", Date.UTC(2026, 8, 15, 14, 30))).toBe(
      "Untitled (conflicting copy 2026-09-15 14:30)"
    );
  });

  // If the copy carried the losing note's own timestamp it could out-rank the
  // note it split from on a later merge and overwrite the winner.
  it("is stamped as a record, not as a fresh edit that could win later", () => {
    const copy = conflictCopy(conflict, 5_000, "note-2");

    expect(copy.updatedAt).toBe(5_000);
    expect(copy.createdAt).toBe(5_000);
  });

  it("is never born deleted, even if the losing note was on its way out", () => {
    const copy = conflictCopy(
      { ...conflict, losing: note({ isDeleted: true, deletedAt: 1 }) },
      5_000,
      "note-2"
    );

    expect(copy.isDeleted).toBe(false);
    expect(copy.deletedAt).toBeUndefined();
  });
});

// Agreement leaves no trace in the plan, so it is the easiest thing to drop —
// and dropping it means the steady state never gets a baseline, which turns
// the next ordinary one-device edit into a conflict nobody asked for.
describe("notes that already agree", () => {
  it("reports a note both sides carry at the same timestamp", () => {
    const same = note({ updatedAt: 3_000 });

    expect(alreadyAgreed([same], [remote({ note: same })])).toEqual([
      { id: "note-1", updatedAt: 3_000 },
    ]);
  });

  it("says nothing about notes that differ", () => {
    expect(
      alreadyAgreed(
        [note({ updatedAt: 3_000 })],
        [remote({ note: note({ updatedAt: 4_000 }) })]
      )
    ).toEqual([]);
  });

  it("says nothing about a note only one side has", () => {
    expect(alreadyAgreed([], [remote()])).toEqual([]);
    expect(alreadyAgreed([note()], [])).toEqual([]);
  });

  it("says nothing about tombstones or unreadable rows", () => {
    expect(
      alreadyAgreed([note()], [remote({ note: null, deleted: true })])
    ).toEqual([]);
    expect(alreadyAgreed([note()], [remote({ note: null })])).toEqual([]);
  });
});
