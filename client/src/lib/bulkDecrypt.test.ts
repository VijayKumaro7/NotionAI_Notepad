/**
 * Reading a whole workspace at once, and what that costs.
 *
 * `getAllNotes` decrypts every note, and a sync calls it on mount, on the tab
 * regaining focus, on the network returning and on the retry beat. `searchNotes`
 * decrypts every note too — by definition, because an end-to-end encrypted
 * workspace has no index to consult. So the per-note cost of decryption is
 * paid hundreds of times over, on the main thread, while someone is typing.
 *
 * Measured over 500 notes of about 2KB, before the two changes these tests
 * guard: `getAllNotes` 177ms, `searchNotes` 206ms. After: 66ms and 36ms. The
 * whole of that came from two things that have nothing to do with the
 * cryptography, and both are easy to reintroduce without noticing, which is
 * why they are asserted rather than left to a comment.
 *
 * Neither test measures time. A threshold in CI is a flake waiting to happen
 * on a loaded runner, and it would not say *why* it regressed. These assert
 * the shape instead: that the decrypts are issued together rather than one
 * after another, which is deterministic — sequential code has exactly one
 * request outstanding at a time and concurrent code has all of them.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  DB_NAME,
  Note,
  closeDB,
  decryptContent,
  deleteNote,
  encryptContent,
  getAllNotes,
  getDeletedNotes,
  getNotesByFolder,
  getNotesByTag,
  getOrCreateEncryptionKey,
  initializeDB,
  saveNote,
  searchNotes,
} from "./storage";

const USER = "bulk-decrypt-user";
let key: CryptoKey;

const note = (overrides: Partial<Note> = {}): Note => ({
  id: "note",
  title: "A note",
  content: "the body",
  folderId: "root",
  tags: [],
  createdAt: 1000,
  updatedAt: 2000,
  isEncrypted: true,
  order: 0,
  ...overrides,
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
  key = await getOrCreateEncryptionKey(USER);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Watch how many decrypts are in the air at once.
 *
 * The high-water mark is the whole measurement: awaiting each decrypt before
 * starting the next pins it at 1 however many notes there are, and issuing
 * them together pins it at the number of notes. Nothing here depends on how
 * fast any of it runs.
 */
function watchConcurrency() {
  const real = crypto.subtle.decrypt.bind(crypto.subtle);
  const state = { inFlight: 0, peak: 0, calls: 0 };

  vi.spyOn(crypto.subtle, "decrypt").mockImplementation(
    async (...args: Parameters<typeof real>) => {
      state.calls += 1;
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      try {
        // A turn of the microtask queue before the work, so a caller that
        // awaited the previous one has no chance to look concurrent by
        // accident: it would not have reached this line yet.
        await Promise.resolve();
        return await real(...args);
      } finally {
        state.inFlight -= 1;
      }
    }
  );

  return state;
}

async function seed(count: number, body = "lorem ipsum dolor sit amet") {
  for (let i = 0; i < count; i += 1) {
    await saveNote(
      note({ id: `bulk-${i}`, title: `Note ${i}`, content: `${body} ${i}` }),
      key,
      { preserveTimestamp: true }
    );
  }
}

describe("decrypting a whole workspace", () => {
  it("issues every note's decrypt at once rather than one after another", async () => {
    await seed(12);
    const seen = watchConcurrency();

    const notes = await getAllNotes(key);

    expect(notes).toHaveLength(12);
    expect(seen.calls).toBe(12);
    // The assertion that matters. One at a time gives a peak of 1 no matter
    // how many notes there are, which is exactly the regression this catches.
    expect(seen.peak).toBe(12);
  });

  it("still returns every note readable", async () => {
    await seed(5);

    const notes = await getAllNotes(key);
    const bodies = notes.map(n => n.content).sort();

    expect(bodies).toEqual([
      "lorem ipsum dolor sit amet 0",
      "lorem ipsum dolor sit amet 1",
      "lorem ipsum dolor sit amet 2",
      "lorem ipsum dolor sit amet 3",
      "lorem ipsum dolor sit amet 4",
    ]);
  });

  it("leaves a note that was never encrypted alone", async () => {
    await saveNote(note({ id: "plain", content: "in the clear" }), undefined, {
      preserveTimestamp: true,
    });
    const seen = watchConcurrency();

    const stored = (await getAllNotes(key)).find(n => n.id === "plain");

    expect(stored?.content).toBe("in the clear");
    expect(seen.calls).toBe(0);
  });
});

describe("the other read paths that decrypt in bulk", () => {
  // Four functions had this loop, character for character, and all four
  // awaited one note before starting the next. They share `decryptNotesInPlace`
  // now; these are here so that re-inlining any one of them is caught rather
  // than only slowing things down quietly.

  it("getNotesByFolder issues them at once", async () => {
    await seed(8);
    const seen = watchConcurrency();

    const notes = await getNotesByFolder("root", key);

    expect(notes).toHaveLength(8);
    expect(seen.peak).toBe(8);
  });

  it("getNotesByTag issues them at once", async () => {
    for (let i = 0; i < 6; i += 1) {
      await saveNote(
        note({ id: `tagged-${i}`, tags: ["work"], content: `body ${i}` }),
        key,
        { preserveTimestamp: true }
      );
    }
    const seen = watchConcurrency();

    const notes = await getNotesByTag("work", key);

    expect(notes).toHaveLength(6);
    expect(seen.peak).toBe(6);
  });

  it("getDeletedNotes issues them at once", async () => {
    // Through `deleteNote`, because the bin is a store of its own — writing a
    // note with `isDeleted` set leaves it in the notes store, where
    // `getDeletedNotes` never looks.
    for (let i = 0; i < 5; i += 1) {
      await saveNote(note({ id: `gone-${i}`, content: `body ${i}` }), key, {
        preserveTimestamp: true,
      });
      await deleteNote(`gone-${i}`);
    }
    const seen = watchConcurrency();

    const notes = await getDeletedNotes(key);

    expect(notes).toHaveLength(5);
    expect(seen.peak).toBe(5);
    expect(notes[0].content).toMatch(/^body /);
  });
});

describe("searching a whole workspace", () => {
  it("issues every note's decrypt at once", async () => {
    await seed(10);
    const seen = watchConcurrency();

    await searchNotes("dolor", key);

    expect(seen.calls).toBe(10);
    expect(seen.peak).toBe(10);
  });

  it("finds by body and by title, and returns the plaintext", async () => {
    await seed(3);
    await saveNote(
      note({ id: "odd", title: "Groceries", content: "nothing matching" }),
      key,
      { preserveTimestamp: true }
    );

    const byBody = await searchNotes("dolor", key);
    const byTitle = await searchNotes("grocer", key);

    expect(byBody).toHaveLength(3);
    expect(byBody[0].content).toContain("lorem ipsum");
    expect(byTitle.map(n => n.id)).toEqual(["odd"]);
    // Readable, not the ciphertext it is stored as.
    expect(byTitle[0].content).toBe("nothing matching");
  });

  it("never decrypts a note in the bin, let alone returns it", async () => {
    await seed(2);
    await saveNote(
      note({ id: "binned", content: "dolor but deleted", isDeleted: true }),
      key,
      { preserveTimestamp: true }
    );
    const seen = watchConcurrency();

    const results = await searchNotes("dolor", key);

    expect(results.map(n => n.id).sort()).toEqual(["bulk-0", "bulk-1"]);
    // Two live notes, two decrypts. Reading the bin's contents to throw the
    // answer away is work nobody asked for, on every search.
    expect(seen.calls).toBe(2);
  });
});

describe("the base64 a decrypt has to walk first", () => {
  it("round-trips a note far larger than the argument limit", async () => {
    // 128KB is where the *encoding* side used to throw RangeError; the note
    // beside `bytesToBase64` records it. The decoding side has no such limit,
    // but a payload this size is exactly where a wrong idiom gets expensive,
    // so it is worth proving both directions still agree at that scale.
    const big = "x".repeat(200_000);

    expect(await decryptContent(await encryptContent(big, key), key)).toBe(big);
  });

  it("round-trips text that is not one byte per character", async () => {
    // The intermediate string from `atob` is latin1 — one byte per code unit —
    // and the UTF-8 decoding happens after. An idiom that conflates the two
    // returns mojibake rather than throwing, so this is asserted on content
    // that would show it.
    const text = "café 日本語 🔐 — em dash";

    expect(await decryptContent(await encryptContent(text, key), key)).toBe(
      text
    );
  });

  it("round-trips every byte value", async () => {
    const all = Array.from({ length: 256 }, (_, i) =>
      String.fromCharCode(i)
    ).join("");

    expect(await decryptContent(await encryptContent(all, key), key)).toBe(all);
  });
});
