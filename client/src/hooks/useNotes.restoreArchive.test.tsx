/**
 * Restoring a backup while a note is open.
 *
 * A restore rewrites rows in IndexedDB, including the note on screen.
 * `currentNote` is separate React state, so unless something says otherwise the
 * editor keeps showing — and the next keystroke keeps building on — the text the
 * restore just replaced, and the autosave writes that back over it. A restore
 * that undid itself at the first character typed afterwards.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false }),
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

import { useNotes } from "./useNotes";
import {
  getOrCreateEncryptionKey,
  LOCAL_KEY_ID,
  saveFolder,
  saveNote,
  getNote,
  type Note,
} from "@/lib/storage";
import { buildArchive } from "@/lib/cloudBackup";

// One IDBFactory for the file and unique ids per test — see the note in
// `useNotes.sync.test.tsx`: a fresh factory means a fresh key.
let run = 0;
let FOLDER = "restorearchive-folder-0";
let NOTE = "restorearchive-note-0";
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;

  run += 1;
  FOLDER = `restorearchive-folder-${run}`;
  NOTE = `restorearchive-note-${run}`;
  localStorage.clear();
});

const folder = () => ({
  id: FOLDER,
  name: "Work",
  parentId: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  order: 0,
});

const note = (content: string): Note => ({
  id: NOTE,
  title: "Draft",
  content,
  folderId: FOLDER,
  tags: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  isEncrypted: false,
  order: 0,
});

async function mountWithOpenNote(key: CryptoKey, content: string) {
  await saveFolder(folder());
  await saveNote(note(content), key, { preserveTimestamp: true });

  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.encryptionKey).not.toBeNull());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await act(async () => {
    await view.result.current.loadNote(NOTE);
  });
  return view;
}

describe("restoreFromArchive with the restored note open", () => {
  it("shows the restored text, not the text it replaced", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithOpenNote(key, "the text before the restore");

    const archive = buildArchive({
      notes: [note("the text from the backup")],
      folders: [folder()],
    });
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    expect((await getNote(NOTE, key))?.content).toBe(
      "the text from the backup"
    );
    expect(view.result.current.currentNote?.content).toBe(
      "the text from the backup"
    );
  });

  it("builds the next edit on the restored text and keeps it", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithOpenNote(key, "the text before the restore");

    const archive = buildArchive({
      notes: [note("the text from the backup")],
      folders: [folder()],
    });
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    act(() => {
      view.result.current.updateCurrentNote(current => ({
        content: current.content + " + typed afterwards",
      }));
    });
    await act(async () => {
      await view.result.current.saveNow();
    });

    expect((await getNote(NOTE, key))?.content).toBe(
      "the text from the backup + typed afterwards"
    );
  });

  it("does not disturb a note the archive leaves alone", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithOpenNote(key, "unchanged");

    const archive = buildArchive({
      notes: [note("unchanged")],
      folders: [folder()],
    });
    const before = view.result.current.currentNote;
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    expect(view.result.current.currentNote?.content).toBe("unchanged");
    expect(view.result.current.currentNote?.id).toBe(before?.id);
  });
});

describe("restoreFromArchive and the Recently Deleted list", () => {
  it("lists a deleted note the backup brings back", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithOpenNote(key, "unchanged");
    expect(view.result.current.deletedNotes).toHaveLength(0);

    const binned: Note = {
      ...note("in the bin"),
      id: `${NOTE}-binned`,
      title: "Binned",
      deletedAt: Date.now(),
    };
    const archive = buildArchive({
      notes: [note("unchanged")],
      folders: [folder()],
      deletedNotes: [binned],
    });
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    expect(view.result.current.deletedNotes.map(n => n.id)).toContain(
      binned.id
    );
  });

  it("keeps a bin entry deleted again since the backup, rather than overwriting it", async () => {
    // The same protection active notes already get from a restore
    // (`keeps a newer local note rather than writing over it`, in
    // cloudBackup.test.ts), reached through the bin: deleting the note again
    // after the backup was taken makes the bin's own copy newer than the
    // archive's, and restoreArchive must not silently overwrite it.
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithOpenNote(key, "edited, then deleted");

    // Bump updatedAt to a real "now", the same way an actual edit would:
    // deleteNote carries the note's existing updatedAt into the bin
    // unchanged, so a note never edited after creation would still carry
    // whatever timestamp the fixture gave it, and this test needs the bin
    // entry genuinely newer than the archive's for `disposition` to read
    // "displaced" rather than "replaced".
    act(() => {
      view.result.current.updateCurrentNote(current => ({
        content: current.content,
      }));
    });
    await act(async () => {
      await view.result.current.saveNow();
    });

    await act(async () => {
      await view.result.current.removeNote(NOTE);
    });
    expect(view.result.current.deletedNotes.map(n => n.id)).toContain(NOTE);

    const archive = buildArchive({
      notes: [],
      folders: [folder()],
      deletedNotes: [
        {
          ...note("the older, backed-up text"),
          id: NOTE,
          // Clearly older than the bin's own deletion of it just above, but
          // still well within the 30-day retention window `getDeletedNotes`
          // enforces — only the ordering between the two matters here.
          updatedAt: Date.now() - 10_000,
          deletedAt: Date.now() - 10_000,
        },
      ],
    });
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    const bin = view.result.current.deletedNotes;
    // The archive's older copy is back under the original id...
    expect(bin.find(n => n.id === NOTE)?.content).toBe(
      "the older, backed-up text"
    );
    // ...and the later deletion is still here, as a bin entry of its own —
    // found by content, not "any other id": the shared store in this file
    // keeps every earlier test's bin entries too.
    const kept = bin.find(n => n.content === "edited, then deleted");
    expect(kept?.id).not.toBe(NOTE);
    expect(kept?.isDeleted).toBe(true);
  });

  it("does not resurrect a note this browser already has in the bin, even though the archive lists it as active", async () => {
    // The backup predates the deletion, so archive.notes lists this id
    // active and archive.deletedNotes says nothing about it at all — there
    // is no "displaced" entry on the bin side to catch this one. Without the
    // cross-store check, the notes-plan would call it "added" (nothing
    // active under that id right now) and write it, landing the same id in
    // both the active store and the bin at once.
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithOpenNote(key, "deleted after this backup");

    await act(async () => {
      await view.result.current.removeNote(NOTE);
    });
    expect(view.result.current.deletedNotes.map(n => n.id)).toContain(NOTE);

    const archive = buildArchive({
      notes: [note("as backed up, before the deletion")],
      folders: [folder()],
    });
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    // Not resurrected to active...
    expect(await getNote(NOTE, key)).toBeNull();
    expect(view.result.current.notes.find(n => n.id === NOTE)).toBeUndefined();
    // ...and the bin's own copy is exactly as it was.
    const kept = view.result.current.deletedNotes.find(n => n.id === NOTE);
    expect(kept?.content).toBe("deleted after this backup");
  });
});

describe("restoreFromArchive and the tag list", () => {
  it("lists a tag the backup brings back", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const view = await mountWithOpenNote(key, "unchanged");
    const tag = `from-backup-${run}`;
    expect(view.result.current.availableTags).not.toContain(tag);

    const archive = buildArchive({
      notes: [
        note("unchanged"),
        { ...note("tagged"), id: `${NOTE}-tagged`, tags: [tag] },
      ],
      folders: [folder()],
      deletedNotes: [],
    });
    await act(async () => {
      await view.result.current.restoreFromArchive(archive);
    });

    await waitFor(() =>
      expect(view.result.current.availableTags).toContain(tag)
    );
  });
});
