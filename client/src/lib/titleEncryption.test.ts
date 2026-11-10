/**
 * Note titles, and whether they are actually encrypted.
 *
 * Content has been encrypted at rest since this app had encryption at all;
 * title was not — not in the notes store, not in the bin, not in version
 * history. The server never saw the gap (the whole note, title included, is
 * JSON-stringified and encrypted as one opaque blob before it is synced), but
 * locally a title sat in IndexedDB in the clear next to ciphertext it was
 * supposedly protecting, in an app whose whole premise is that nothing here
 * is readable at rest.
 *
 * So the assertions below are of the same two kinds `versionEncryption.test.ts`
 * uses for content: that a title really is ciphertext once it is saved, and
 * that every path which reads one back still works — including for a title
 * already sitting in plaintext in someone's browser, which is real writing
 * and cannot be refused or garbled just because this field is encrypted now.
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
  getNoteVersion,
  getNoteVersions,
  getOrCreateEncryptionKey,
  initializeDB,
  reEncryptLocalContent,
  restoreNoteVersion,
  saveNote,
  searchNotes,
} from "./storage";

const USER = "title-encryption-user";

const note = (overrides: Partial<Note> = {}): Note => ({
  id: nanoid(),
  title: "A note",
  content: "the body",
  folderId: "root",
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isEncrypted: true,
  order: 0,
  ...overrides,
});

let key: CryptoKey;

const asKey = (bytes: Uint8Array) =>
  crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );

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

describe("saving a note", () => {
  it("stores the title as ciphertext, not the words themselves", async () => {
    const subject = note({ title: "Secret project plan" });
    await saveNote(subject, key);

    const database = await initializeDB();
    const raw = await new Promise<Note>((resolve, reject) => {
      const request = database
        .transaction(["notes"], "readonly")
        .objectStore("notes")
        .get(subject.id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    expect(raw.title).not.toBe("Secret project plan");
    expect(await decryptContent(raw.title, key)).toBe("Secret project plan");
  });

  it("does not encrypt the title without a key", async () => {
    const subject = note({ title: "In the clear" });
    await saveNote(subject);

    const retrieved = await getNote(subject.id);
    expect(retrieved?.title).toBe("In the clear");
  });
});

describe("reading notes back", () => {
  it("getNote decrypts the title", async () => {
    const subject = note({ title: "Reader's title" });
    await saveNote(subject, key);

    const retrieved = await getNote(subject.id, key);
    expect(retrieved?.title).toBe("Reader's title");
  });

  it("getAllNotes decrypts every title in the batch", async () => {
    const a = note({ title: "First" });
    const b = note({ title: "Second" });
    await saveNote(a, key);
    await saveNote(b, key);

    const all = await getAllNotes(key);
    expect(all.map(n => n.title).sort()).toEqual(["First", "Second"]);
  });

  it("still reads a title written before this field was encrypted", async () => {
    // Exactly the shape every existing note has the moment this feature
    // ships: content genuinely encrypted, title plaintext, both under the
    // one `isEncrypted` flag.
    const subject = note({ title: "Legacy title" });
    await saveNote(subject, key);

    const database = await initializeDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["notes"], "readwrite");
      const store = transaction.objectStore("notes");
      const getRequest = store.get(subject.id);
      getRequest.onsuccess = () => {
        store.put({ ...getRequest.result, title: "Legacy title" });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const retrieved = await getNote(subject.id, key);
    expect(retrieved?.title).toBe("Legacy title");
    expect(retrieved?.content).toBe(subject.content);

    const all = await getAllNotes(key);
    expect(all.find(n => n.id === subject.id)?.title).toBe("Legacy title");
  });

  it("getDeletedNotes decrypts the title of a binned note", async () => {
    const subject = note({ title: "Binned title" });
    await saveNote(subject, key);
    await deleteNote(subject.id);

    const deleted = await getDeletedNotes(key);
    expect(deleted.find(n => n.id === subject.id)?.title).toBe("Binned title");
  });
});

describe("searching", () => {
  it("finds a note by its encrypted title", async () => {
    await saveNote(note({ title: "Groceries for the week" }), key);
    await saveNote(note({ title: "Something else entirely" }), key);

    const results = await searchNotes("groceries", key);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Groceries for the week");
  });
});

describe("version history", () => {
  it("createNoteVersion encrypts the title, not just the body", async () => {
    const subject = note({ title: "Draft title", content: "draft body" });
    await saveNote(subject, key);
    const version = await createNoteVersion(subject.id, subject, "edit", key);

    expect(version.title).not.toBe("Draft title");
    expect(await decryptContent(version.title, key)).toBe("Draft title");
  });

  it("getNoteVersions decrypts the title when given the key", async () => {
    const subject = note({ title: "Versioned title" });
    await saveNote(subject, key);
    await createNoteVersion(subject.id, subject, "edit", key);

    const versions = await getNoteVersions(subject.id, key);
    expect(versions[0].title).toBe("Versioned title");
  });

  it("getNoteVersion decrypts the title when given the key", async () => {
    const subject = note({ title: "Single version title" });
    await saveNote(subject, key);
    const created = await createNoteVersion(subject.id, subject, "edit", key);

    const retrieved = await getNoteVersion(created.id, key);
    expect(retrieved?.title).toBe("Single version title");
  });

  it("still reads a version title written before this field was encrypted", async () => {
    const subject = note({ title: "current" });
    await saveNote(subject, key);

    // Exactly what `createNoteVersion` used to write: plaintext title next
    // to real ciphertext content, both flagged encrypted.
    await createNoteVersion(
      subject.id,
      { ...subject, title: "A legacy snapshot title" },
      "auto-save",
      key
    );
    const database = await initializeDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["noteVersions"], "readwrite");
      const store = transaction.objectStore("noteVersions");
      const index = store.index("noteId");
      const getRequest = index.getAll(subject.id);
      getRequest.onsuccess = () => {
        const [stored] = getRequest.result;
        store.put({ ...stored, title: "A legacy snapshot title" });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const versions = await getNoteVersions(subject.id, key);
    expect(versions[0].title).toBe("A legacy snapshot title");
  });

  it("restores the decrypted title, not ciphertext, onto the live note", async () => {
    // The dangerous case: `restoreNoteVersion` reading a version's title raw
    // would write the version's ciphertext title literally into the note —
    // the same class of bug this codebase already fixed once for content.
    const subject = note({ title: "Original title", content: "original" });
    await saveNote(subject, key);
    const version1 = await createNoteVersion(subject.id, subject, "edit", key);

    await saveNote(
      { ...subject, title: "Changed title", content: "changed" },
      key
    );

    const restored = await restoreNoteVersion(subject.id, version1.id, key);

    expect(restored?.title).toBe("Original title");
    expect(restored?.content).toBe("original");

    // And the note on disk agrees — nothing wrote base64 into the title.
    const onDisk = await getNote(subject.id, key);
    expect(onDisk?.title).toBe("Original title");
  });

  it("restores a legacy plaintext version title too", async () => {
    const subject = note({ title: "current" });
    await saveNote(subject, key);
    await createNoteVersion(
      subject.id,
      { ...subject, title: "A legacy title", content: "a legacy draft" },
      "auto-save"
    );

    const [stored] = await getNoteVersions(subject.id);
    const restored = await restoreNoteVersion(subject.id, stored.id, key);

    expect(restored?.title).toBe("A legacy title");
  });
});

describe("re-encrypting under a new key", () => {
  it("carries an encrypted title to the new key", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);
    const subject = note({ title: "Carried title" });
    await saveNote(subject, oldKey);

    const newKey = await asKey(crypto.getRandomValues(new Uint8Array(32)));
    await reEncryptLocalContent(oldKey, newKey);

    const database = await initializeDB();
    const raw = await new Promise<Note>((resolve, reject) => {
      const request = database
        .transaction(["notes"], "readonly")
        .objectStore("notes")
        .get(subject.id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // Ciphertext under the new key, not the old one.
    await expect(decryptContent(raw.title, oldKey)).rejects.toThrow();
    expect(await decryptContent(raw.title, newKey)).toBe("Carried title");
  });

  it("leaves a never-encrypted title alone, and does not count it as unreadable", async () => {
    const oldKey = await getOrCreateEncryptionKey(USER);
    const subject = note({ title: "Still plaintext", content: "current" });
    await saveNote(subject, oldKey);

    // Exactly the state of every note on the day this feature ships.
    const database = await initializeDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["notes"], "readwrite");
      const store = transaction.objectStore("notes");
      const getRequest = store.get(subject.id);
      getRequest.onsuccess = () => {
        store.put({ ...getRequest.result, title: "Still plaintext" });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const newKey = await asKey(crypto.getRandomValues(new Uint8Array(32)));
    const summary = await reEncryptLocalContent(oldKey, newKey);

    // Not a failure to re-seal — there was nothing encrypted to re-seal.
    expect(summary.leftAlone).toBe(0);

    const retrieved = await getNote(subject.id, newKey);
    expect(retrieved?.title).toBe("Still plaintext");
  });
});
