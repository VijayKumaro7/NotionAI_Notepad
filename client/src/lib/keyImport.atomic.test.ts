/**
 * Installing a key is all or nothing.
 *
 * `keyImport.test.ts` mocks storage and can only say which functions were
 * called in which order. What matters is what is left on disk when the swap
 * fails partway: re-sealing writes records under the new key while the stored
 * key is still the old one, so any gap between those writes leaves notes that
 * the browser's own key cannot open, under a message saying nothing changed.
 * These tests use the real stores and break the write that stores the key.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { importRecoveryPhrase } from "./keyImport";
import { encodeRecoveryPhrase } from "./recoveryPhrase";
import {
  DB_NAME,
  LOCAL_KEY_ID,
  closeDB,
  createNoteVersion,
  deleteNote,
  getAllNotes,
  getDeletedNotes,
  getNoteVersions,
  getOrCreateEncryptionKey,
  initializeDB,
  readEncryptionKeyBytes,
  readVersionContent,
  saveNote,
  type Note,
} from "./storage";

const INCOMING = new Uint8Array(
  Array.from({ length: 32 }, (_, i) => (i * 13 + 7) & 0xff)
);

const note = (title: string): Note => ({
  id: nanoid(),
  title,
  content: `${title} body`,
  folderId: "root",
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isEncrypted: true,
  order: 0,
});

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a key swap that fails while storing the key", () => {
  it("leaves every store readable with the key the browser still has", async () => {
    const oldKey = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const oldBytes = await readEncryptionKeyBytes(LOCAL_KEY_ID);

    const live = note("live");
    const binned = note("binned");
    await saveNote(live, oldKey);
    await saveNote(binned, oldKey);
    await createNoteVersion(live.id, live, "edit", oldKey);
    await deleteNote(binned.id);

    // The write that stores the new key fails; everything before it succeeds.
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "encryptionKeys") throw new Error("disk full");
      return put.apply(this, args);
    });

    const result = await importRecoveryPhrase(encodeRecoveryPhrase(INCOMING));
    vi.restoreAllMocks();

    expect(result.ok).toBe(false);

    // The stored key is still the old one...
    expect(await readEncryptionKeyBytes(LOCAL_KEY_ID)).toEqual(oldBytes);

    // ...so it has to open all of it, which "nothing was changed" promises.
    const notes = await getAllNotes(oldKey);
    expect(notes.find(n => n.id === live.id)?.content).toBe("live body");

    const bin = await getDeletedNotes(oldKey);
    expect(bin.find(n => n.id === binned.id)?.content).toBe("binned body");

    const [version] = await getNoteVersions(live.id);
    expect(await readVersionContent(version, oldKey)).toBe("live body");
  });
});

describe("a key swap that succeeds", () => {
  it("opens everything with the new key and stores that key", async () => {
    const oldKey = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const live = note("live");
    await saveNote(live, oldKey);

    const result = await importRecoveryPhrase(encodeRecoveryPhrase(INCOMING));

    expect(result.ok).toBe(true);
    expect(await readEncryptionKeyBytes(LOCAL_KEY_ID)).toEqual(INCOMING);

    const newKey = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const notes = await getAllNotes(newKey);
    expect(notes.find(n => n.id === live.id)?.content).toBe("live body");
  });
});
