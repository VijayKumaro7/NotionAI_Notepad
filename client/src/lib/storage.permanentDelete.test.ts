/**
 * "Permanently delete" says it cannot be undone, and the Recently Deleted
 * panel asks for confirmation before it does it. The note's saved history is
 * part of the note: leaving every snapshot behind in IndexedDB keeps the words
 * the person just chose to erase, and nothing can ever show them again.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { nanoid } from "nanoid";
import {
  initializeDB,
  getOrCreateEncryptionKey,
  saveNote,
  deleteNote,
  restoreNote,
  permanentlyDeleteNote,
  cleanupExpiredDeletedNotes,
  createNoteVersion,
  getNoteVersions,
  getDeletedNotes,
  getNote,
  type Note,
} from "./storage";

const DAY = 24 * 60 * 60 * 1000;

let key: CryptoKey;

const makeNote = (title: string): Note => ({
  id: nanoid(),
  title,
  content: `${title} body`,
  folderId: "f",
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isEncrypted: false,
});

async function noteWithHistory(title: string) {
  const note = makeNote(title);
  await saveNote(note, key);
  await createNoteVersion(note.id, note, "edit", key);
  await createNoteVersion(note.id, note, "auto-save", key);
  return note;
}

beforeEach(async () => {
  await initializeDB();
  key = await getOrCreateEncryptionKey("permanent-delete-test");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("permanentlyDeleteNote", () => {
  it("takes the note's version history with it", async () => {
    const gone = await noteWithHistory("erase me");
    await deleteNote(gone.id);
    expect((await getNoteVersions(gone.id)).length).toBe(2);

    await permanentlyDeleteNote(gone.id);

    expect(await getNoteVersions(gone.id)).toEqual([]);
  });

  it("leaves another note's history alone", async () => {
    const gone = await noteWithHistory("erase me");
    const kept = await noteWithHistory("keep me");
    await deleteNote(gone.id);

    await permanentlyDeleteNote(gone.id);

    expect((await getNoteVersions(kept.id)).length).toBe(2);
  });

  it("keeps the history of a note that is only in the bin", async () => {
    const binned = await noteWithHistory("restore me later");

    await deleteNote(binned.id);

    expect((await getNoteVersions(binned.id)).length).toBe(2);
  });

  it("is a no-op, and keeps the note's history, when the note has since been restored", async () => {
    // The Recently Deleted panel's old shared busy flag could let a restore
    // still be running when a second click asked to permanently delete the
    // same id. By the time that second call's own IndexedDB transaction
    // starts, `restoreNote` has already moved the note back into the active
    // store — so this is what the race actually hands `permanentlyDeleteNote`:
    // an id that is no longer in the bin at all.
    const note = await noteWithHistory("restore me");
    await deleteNote(note.id);
    await restoreNote(note.id, key);

    await permanentlyDeleteNote(note.id);

    expect(await getNote(note.id, key)).not.toBeNull();
    expect((await getNoteVersions(note.id)).length).toBe(2);
    expect((await getDeletedNotes(key)).some(n => n.id === note.id)).toBe(
      false
    );
  });
});

describe("cleanupExpiredDeletedNotes", () => {
  it("takes the history of the notes it expires, and only those", async () => {
    const old = await noteWithHistory("expired");
    const recent = await noteWithHistory("recent");

    const realNow = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow - 40 * DAY);
    await deleteNote(old.id);
    spy.mockReturnValue(realNow);
    await deleteNote(recent.id);

    const removed = await cleanupExpiredDeletedNotes();

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await getNoteVersions(old.id)).toEqual([]);
    expect((await getNoteVersions(recent.id)).length).toBe(2);
    expect((await getDeletedNotes(key)).some(n => n.id === recent.id)).toBe(
      true
    );
  });
});
