/**
 * Version history, and whether it is actually encrypted.
 *
 * `noteVersions` rows carry an `isEncrypted` flag, and everything that reads
 * one — the preview, the restore — believes it. What made this worth its own
 * file is that the flag was being set on content that had never been through
 * `encryptContent`: the notes store held ciphertext while the history of those
 * same notes sat in the clear next to it, in an app whose whole premise is that
 * the content is unreadable at rest.
 *
 * So the assertions here are of two kinds: that a snapshot really is ciphertext,
 * and that the paths which read one still work — including for rows written
 * before this was true, which are real people's writing and cannot be dropped.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  DB_NAME,
  Note,
  closeDB,
  createNoteVersion,
  decryptContent,
  getNote,
  getNoteVersions,
  getOrCreateEncryptionKey,
  initializeDB,
  readVersionContent,
  restoreNoteVersion,
  saveNote,
} from "./storage";

const USER = "version-encryption-user";

const note = (overrides: Partial<Note> = {}): Note => ({
  id: nanoid(),
  title: "A note",
  content: "the current text",
  folderId: "root",
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isEncrypted: true,
  order: 0,
  ...overrides,
});

let key: CryptoKey;

beforeEach(async () => {
  closeDB();
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  await initializeDB();
  key = await getOrCreateEncryptionKey(USER);
});

describe("writing a snapshot", () => {
  it("stores ciphertext, not the note's words", async () => {
    const subject = note({ content: "the quiet part" });
    await saveNote(subject, key);

    await createNoteVersion(subject.id, subject, "auto-save", key);

    const [stored] = await getNoteVersions(subject.id);
    // The whole point. `notes` was encrypted and `noteVersions` was not, so
    // every autosave of every note sat readable in IndexedDB.
    expect(stored.content).not.toContain("the quiet part");
    expect(stored.isEncrypted).toBe(true);
    expect(await decryptContent(stored.content, key)).toBe("the quiet part");
  });

  it("does not claim encryption it did not do", async () => {
    const subject = note({ content: "no key was given" });
    await saveNote(subject, key);

    await createNoteVersion(subject.id, subject, "auto-save");

    const [stored] = await getNoteVersions(subject.id);
    // Without a key there is nothing to encrypt with, and the flag has to say
    // so — a row that lies about this is exactly how the bug went unnoticed.
    expect(stored.isEncrypted).toBe(false);
    expect(stored.content).toBe("no key was given");
  });

  it("encrypts each snapshot separately", async () => {
    const subject = note({ content: "same words" });
    await saveNote(subject, key);

    await createNoteVersion(subject.id, subject, "auto-save", key);
    await createNoteVersion(subject.id, subject, "auto-save", key);

    const stored = await getNoteVersions(subject.id);
    // AES-GCM with a fresh nonce each time: identical text must not produce
    // identical ciphertext, or the store leaks which snapshots are unchanged.
    expect(stored[0].content).not.toBe(stored[1].content);
  });
});

describe("reading a snapshot back", () => {
  it("returns the text that was snapshotted", async () => {
    const subject = note({ content: "an earlier draft" });
    await saveNote(subject, key);
    await createNoteVersion(subject.id, subject, "auto-save", key);

    const [stored] = await getNoteVersions(subject.id);

    expect(await readVersionContent(stored, key)).toBe("an earlier draft");
  });

  it("still reads a row written before any of this was encrypted", async () => {
    const subject = note({ content: "current" });
    await saveNote(subject, key);

    // Exactly what `useNotes` used to store: plaintext content, flagged
    // encrypted. These rows are real writing and predate the fix.
    await createNoteVersion(
      subject.id,
      { ...subject, content: "a legacy draft", isEncrypted: true },
      "auto-save"
    );

    const [stored] = await getNoteVersions(subject.id);
    expect(stored.isEncrypted).toBe(false);
    expect(await readVersionContent(stored, key)).toBe("a legacy draft");
  });

  it("does not need a key for a row that has none", async () => {
    const subject = note({ content: "current" });
    await saveNote(subject, key);
    await createNoteVersion(subject.id, subject, "auto-save");

    const [stored] = await getNoteVersions(subject.id);
    expect(await readVersionContent(stored)).toBe("current");
  });
});

describe("restoring a version", () => {
  it("puts the snapshotted text back on the note", async () => {
    const subject = note({ content: "the original" });
    await saveNote(subject, key);
    await createNoteVersion(subject.id, subject, "auto-save", key);

    await saveNote({ ...subject, content: "edited since" }, key);
    const [stored] = await getNoteVersions(subject.id);

    const restored = await restoreNoteVersion(subject.id, stored.id, key);

    // This threw before: the version was plaintext, the flag said encrypted,
    // and decryptContent rejected — so restoring an older version failed
    // outright and the button did nothing but log.
    expect(restored?.content).toBe("the original");
    expect((await getNote(subject.id, key))?.content).toBe("the original");
  });

  it("leaves the note encrypted afterwards", async () => {
    const subject = note({ content: "the original" });
    await saveNote(subject, key);
    await createNoteVersion(subject.id, subject, "auto-save", key);
    await saveNote({ ...subject, content: "edited since" }, key);

    const [stored] = await getNoteVersions(subject.id);
    await restoreNoteVersion(subject.id, stored.id, key);

    const raw = (await getNote(subject.id)) as Note;
    expect(raw.isEncrypted).toBe(true);
    expect(raw.content).not.toContain("the original");
  });

  it("restores a legacy plaintext version too", async () => {
    const subject = note({ content: "current" });
    await saveNote(subject, key);
    await createNoteVersion(
      subject.id,
      { ...subject, content: "a legacy draft", isEncrypted: true },
      "auto-save"
    );

    const [stored] = await getNoteVersions(subject.id);
    const restored = await restoreNoteVersion(subject.id, stored.id, key);

    // The rows that made this a bug are the ones people most want back.
    expect(restored?.content).toBe("a legacy draft");
  });

  it("snapshots the restore itself as ciphertext", async () => {
    const subject = note({ content: "the original" });
    await saveNote(subject, key);
    await createNoteVersion(subject.id, subject, "auto-save", key);
    await saveNote({ ...subject, content: "edited since" }, key);

    const [first] = await getNoteVersions(subject.id);
    await restoreNoteVersion(subject.id, first.id, key);

    const afterwards = await getNoteVersions(subject.id);
    const restorePoint = afterwards.find(v => v.changeType === "restore")!;
    // Restoring writes a new snapshot. It would be an odd fix that encrypted
    // every snapshot except the one it creates itself.
    expect(restorePoint.content).not.toContain("the original");
    expect(await readVersionContent(restorePoint, key)).toBe("the original");
  });
});
