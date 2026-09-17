/**
 * Carrying the key between devices, tested against a real IndexedDB.
 *
 * The assertions that matter here are about what survives. Installing a key is
 * the one operation in this app that can make existing notes unreadable without
 * deleting anything, and a version of it that "works" while quietly orphaning
 * what was already on the device is worse than one that refuses — the failure
 * is invisible until someone opens an old note.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  DB_NAME,
  Note,
  closeDB,
  createNoteVersion,
  decryptContent,
  deleteNote,
  getAllNotes,
  getDeletedNotes,
  getNote,
  getNoteVersions,
  encryptContent,
  getOrCreateEncryptionKey,
  initializeDB,
  readEncryptionKeyBytes,
  reEncryptLocalContent,
  replaceEncryptionKey,
  saveNote,
} from "./storage";
import { encodeRecoveryPhrase, decodeRecoveryPhrase } from "./recoveryPhrase";

const USER = "key-portability-user";

const note = (overrides: Partial<Note> = {}): Note => ({
  id: nanoid(),
  title: "A note",
  content: "Something worth not losing.",
  folderId: "root",
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isEncrypted: true,
  order: 0,
  ...overrides,
});

/** A fresh database per test, so one test's key cannot leak into the next. */
beforeEach(async () => {
  closeDB();
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  await initializeDB();
});

/** Import raw bytes as a usable AES-GCM key, the way a second device would. */
const asKey = (bytes: Uint8Array) =>
  crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );

describe("reading the key out", () => {
  it("returns the bytes the key was made from", async () => {
    await getOrCreateEncryptionKey(USER);

    const bytes = await readEncryptionKeyBytes(USER);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes!.length).toBe(32);
  });

  it("returns null before a key exists, rather than making one", async () => {
    // Reading is not creating. A panel that renders a phrase for an account
    // that has never encrypted anything would be offering a backup of nothing.
    expect(await readEncryptionKeyBytes("nobody")).toBeNull();
  });

  it("gives the same bytes every time", async () => {
    await getOrCreateEncryptionKey(USER);

    expect(await readEncryptionKeyBytes(USER)).toEqual(
      await readEncryptionKeyBytes(USER)
    );
  });

  it("round-trips through a recovery phrase into a working key", async () => {
    const key = await getOrCreateEncryptionKey(USER);
    const sealed = await import("./storage").then(m =>
      m.encryptContent("the original device wrote this", key)
    );

    // Everything the feature promises, in one line each: the bytes become a
    // phrase, the phrase becomes bytes, and those bytes open the ciphertext.
    const phrase = encodeRecoveryPhrase((await readEncryptionKeyBytes(USER))!);
    const decoded = decodeRecoveryPhrase(phrase);
    expect(decoded.ok).toBe(true);

    const elsewhere = await asKey((decoded as { key: Uint8Array }).key);
    expect(await decryptContent(sealed, elsewhere)).toBe(
      "the original device wrote this"
    );
  });
});

describe("replacing the key", () => {
  it("installs the new bytes and hands back a usable key", async () => {
    await getOrCreateEncryptionKey(USER);
    const incoming = crypto.getRandomValues(new Uint8Array(32));

    const key = await replaceEncryptionKey(USER, incoming);

    expect(await readEncryptionKeyBytes(USER)).toEqual(incoming);
    // Usable, not merely stored.
    const { encryptContent } = await import("./storage");
    expect(await decryptContent(await encryptContent("hello", key), key)).toBe(
      "hello"
    );
  });

  it("is what getOrCreateEncryptionKey returns afterwards", async () => {
    await getOrCreateEncryptionKey(USER);
    const incoming = crypto.getRandomValues(new Uint8Array(32));

    await replaceEncryptionKey(USER, incoming);

    // The next caller must get the imported key, not a cached original — this
    // is the difference between the import taking effect and appearing to.
    const { encryptContent } = await import("./storage");
    const reopened = await getOrCreateEncryptionKey(USER);
    const viaImported = await encryptContent("x", await asKey(incoming));
    expect(await decryptContent(viaImported, reopened)).toBe("x");
  });

  it("refuses bytes that are not a key", async () => {
    await expect(
      replaceEncryptionKey(USER, new Uint8Array(16))
    ).rejects.toThrow(/32 bytes/);
  });
});

describe("re-encrypting what this device already holds", () => {
  it("keeps notes readable across the swap", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);
    const mine = note({ content: "written before the import" });
    await saveNote(mine, oldKey);

    const incoming = crypto.getRandomValues(new Uint8Array(32));
    const newKey = await asKey(incoming);
    await reEncryptLocalContent(oldKey, newKey);
    await replaceEncryptionKey(USER, incoming);

    // The whole point: a note written before the import is still openable
    // after it, under the key that arrived.
    const after = await getNote(mine.id, newKey);
    expect(after?.content).toBe("written before the import");
  });

  it("reports how much it moved", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);
    await saveNote(note(), oldKey);
    await saveNote(note(), oldKey);

    const summary = await reEncryptLocalContent(
      oldKey,
      await asKey(crypto.getRandomValues(new Uint8Array(32)))
    );

    expect(summary.converted).toBe(2);
    expect(summary.leftAlone).toBe(0);
  });

  it("leaves untouched what the old key cannot open, and says so", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);
    await saveNote(note({ content: "mine" }), oldKey);

    // A note that arrived from the other device: real ciphertext, sealed with
    // a key this browser has never had.
    const foreignKey = await asKey(crypto.getRandomValues(new Uint8Array(32)));
    const foreign = note({ content: "theirs" });
    await saveNote(foreign, foreignKey);
    const stored = (await getAllNotes()).find(n => n.id === foreign.id)!;

    const summary = await reEncryptLocalContent(
      oldKey,
      await asKey(crypto.getRandomValues(new Uint8Array(32)))
    );

    expect(summary).toEqual({ converted: 1, leftAlone: 1 });

    // Byte for byte as it was. These are exactly the notes the incoming key is
    // about to open; mangling them would destroy what the import is for.
    const afterwards = (await getAllNotes()).find(n => n.id === foreign.id)!;
    expect(afterwards.content).toBe(stored.content);
  });

  it("carries deleted notes too", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);

    const binned = note({ content: "in the bin" });
    await saveNote(binned, oldKey);
    await deleteNote(binned.id);

    const newKey = await asKey(crypto.getRandomValues(new Uint8Array(32)));
    await reEncryptLocalContent(oldKey, newKey);

    // Recently-deleted is easy to forget: the note is out of the main store
    // but the UI still offers to restore it, and a restore that returns
    // ciphertext is a note destroyed rather than recovered.
    const deleted = await getDeletedNotes(newKey);
    expect(deleted.find(n => n.id === binned.id)?.content).toBe("in the bin");
  });

  it("carries version history", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);

    const kept = note({ content: "current" });
    await saveNote(kept, oldKey);
    await createNoteVersion(
      kept.id,
      { ...kept, content: "an earlier draft" },
      "auto-save",
      oldKey
    );

    const newKey = await asKey(crypto.getRandomValues(new Uint8Array(32)));
    await reEncryptLocalContent(oldKey, newKey);

    // Snapshots are real ciphertext now, so they move with everything else —
    // which they could not do while they were plaintext flagged as encrypted.
    const versions = await getNoteVersions(kept.id);
    expect(versions).toHaveLength(1);
    expect(await decryptContent(versions[0].content, newKey)).toBe(
      "an earlier draft"
    );
  });

  it("leaves a legacy plaintext snapshot exactly as it found it", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);

    const kept = note({ content: "current" });
    await saveNote(kept, oldKey);

    // A row as it was written before snapshots were encrypted: plaintext
    // content carrying `isEncrypted: true`. Nothing produces these any more,
    // but they are sitting in real browsers, and they are real writing.
    const database = await initializeDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["noteVersions"], "readwrite");
      transaction.objectStore("noteVersions").put({
        id: `${kept.id}-legacy`,
        noteId: kept.id,
        title: kept.title,
        content: "a legacy draft",
        createdAt: Date.now(),
        versionNumber: 1,
        changeType: "auto-save",
        isEncrypted: true,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const newKey = await asKey(crypto.getRandomValues(new Uint8Array(32)));
    const summary = await reEncryptLocalContent(oldKey, newKey);

    // Untouched and counted. Re-sealing it would need decrypting it first,
    // which cannot be done — and overwriting it with a guess would destroy a
    // draft someone may want back.
    const versions = await getNoteVersions(kept.id);
    expect(versions[0].content).toBe("a legacy draft");
    expect(summary.leftAlone).toBe(1);
  });

  it("does not disturb the timestamps sync compares", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);
    const mine = note({ content: "unchanged" });
    await saveNote(mine, oldKey);
    const before = (await getAllNotes()).find(n => n.id === mine.id)!;

    await new Promise(resolve => setTimeout(resolve, 5));
    await reEncryptLocalContent(
      oldKey,
      await asKey(crypto.getRandomValues(new Uint8Array(32)))
    );

    const after = (await getAllNotes()).find(n => n.id === mine.id)!;
    // Re-sealing is not an edit. Bumping updatedAt would make every note on
    // the device look newer than the server's copy, and the next sync would
    // push all of them over whatever the other device had written.
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("actually changes the ciphertext", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);
    const mine = note({ content: "same words" });
    await saveNote(mine, oldKey);
    const before = (await getAllNotes()).find(n => n.id === mine.id)!.content;

    await reEncryptLocalContent(
      oldKey,
      await asKey(crypto.getRandomValues(new Uint8Array(32)))
    );

    const after = (await getAllNotes()).find(n => n.id === mine.id)!.content;
    // A no-op that reported success would leave the notes sealed under a key
    // nobody has written down.
    expect(after).not.toBe(before);
  });

  it("copes with a device that has nothing on it", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);

    // The common case: a brand new browser, importing before writing anything.
    await expect(
      reEncryptLocalContent(
        oldKey,
        await asKey(crypto.getRandomValues(new Uint8Array(32)))
      )
    ).resolves.toEqual({ converted: 0, leftAlone: 0 });
  });

  it("handles more records than one transaction could straddle", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);
    for (let i = 0; i < 25; i++) {
      await saveNote(note({ content: `note ${i}` }), oldKey);
    }

    const newKey = await asKey(crypto.getRandomValues(new Uint8Array(32)));
    const summary = await reEncryptLocalContent(oldKey, newKey);

    expect(summary.converted).toBe(25);

    // Every one of them, not just the first few: an IndexedDB transaction
    // closes as soon as it yields to a non-IndexedDB await, so crypto inside
    // the write transaction would silently strand the tail.
    const all = await getAllNotes(newKey);
    expect(all).toHaveLength(25);
    expect(new Set(all.map(n => n.content)).size).toBe(25);
  });
});
