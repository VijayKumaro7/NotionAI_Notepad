import { describe, expect, it } from "vitest";
import { resolveOpenNote } from "./openNote";
import type { Note } from "./storage";

const note = (overrides: Partial<Note> = {}): Note => ({
  id: "note-1",
  title: "A note",
  content: "what was there",
  folderId: "root",
  tags: [],
  createdAt: 1000,
  updatedAt: 2000,
  isEncrypted: true,
  order: 0,
  ...overrides,
});

describe("nothing to decide", () => {
  it("keeps when no note is open", () => {
    expect(resolveOpenNote({ open: null, stored: note() })).toEqual({
      action: "keep",
    });
  });

  it("keeps when the store agrees with the editor", () => {
    const open = note();
    expect(resolveOpenNote({ open, stored: { ...open } })).toEqual({
      action: "keep",
    });
  });
});

describe("the sync brought something newer", () => {
  it("replaces the open note", () => {
    const open = note({ content: "typed here", updatedAt: 2000 });
    const stored = note({ content: "typed elsewhere", updatedAt: 3000 });

    expect(resolveOpenNote({ open, stored })).toEqual({
      action: "replace",
      note: stored,
    });
  });

  it("replaces when only the title moved on", () => {
    const open = note({ title: "Draft", updatedAt: 2000 });
    const stored = note({ title: "Final", updatedAt: 3000 });

    expect(resolveOpenNote({ open, stored })).toMatchObject({
      action: "replace",
    });
  });

  it("replaces when two writes landed in the same millisecond", () => {
    // Timestamps cannot separate these, and trusting the clock alone would
    // leave the editor showing the losing version for as long as it stayed
    // open.
    const open = note({ content: "mine", updatedAt: 2000 });
    const stored = note({ content: "theirs", updatedAt: 2000 });

    expect(resolveOpenNote({ open, stored })).toMatchObject({
      action: "replace",
    });
  });
});

describe("the editor is ahead", () => {
  it("keeps what is being typed", () => {
    // The store is behind because the person has carried on writing. Replacing
    // here would throw their edit away — the same data loss this prevents,
    // arriving from the other direction.
    const open = note({ content: "still typing", updatedAt: 5000 });
    const stored = note({ content: "older", updatedAt: 3000 });

    expect(resolveOpenNote({ open, stored })).toEqual({ action: "keep" });
  });
});

describe("the note went away", () => {
  it("closes the editor when the merge deleted it", () => {
    // Deleted on another device. Leaving it open means autosaving it back into
    // existence on the next keystroke.
    expect(resolveOpenNote({ open: note(), stored: null })).toEqual({
      action: "close",
    });
  });
});

describe("guarding against the wrong note", () => {
  it("keeps rather than swapping one note's text for another's", () => {
    const open = note({ id: "note-1" });
    const stored = note({ id: "note-2", updatedAt: 9000 });

    // A caller that looked up the wrong id would otherwise replace the open
    // note's contents with a different note's — a bug that reads as corruption.
    expect(resolveOpenNote({ open, stored })).toEqual({ action: "keep" });
  });
});
