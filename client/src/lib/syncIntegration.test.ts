/**
 * Two devices, one server, and a real IndexedDB.
 *
 * `mergeNotes` is thoroughly unit tested, and everything it decides is decided
 * on plain objects. What none of those tests touch is the step afterwards:
 * taking a plan and *applying* it to the store. That is where a decision
 * becomes somebody's notes changing on disk, and it is where the interesting
 * failures live — a conflict copy that is computed and then not written, a
 * remote row saved with this device's clock instead of the other device's, a
 * tombstone that comes back because the row was re-encrypted on the way in.
 *
 * So these tests drive the real pieces together: real `encryptNotePayload` to
 * put a row on a fake server, real `decryptRemoteNotes` to take it off, real
 * `mergeNotes` to decide, and real `saveNote` / `deleteNote` to apply — then
 * read the store back and check what a person would actually see.
 *
 * What this does not do, and it matters: it applies the plan in the order
 * `runSync` applies it, rather than calling `runSync`. `runSync` lives inside a
 * React hook and holds the order in its body. So these tests prove the pieces
 * compose into the right result; they do not prove the app sequences them that
 * way. Anything that reorders `runSync` can still break the rules in CLAUDE.md
 * without turning a test here red.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  DB_NAME,
  Note,
  closeDB,
  deleteNote,
  getAllNotes,
  getNote,
  getOrCreateEncryptionKey,
  initializeDB,
  saveNote,
} from "./storage";
import {
  conflictCopy,
  decryptRemoteNotes,
  encryptNotePayload,
  mergeNotes,
} from "./syncService";
import { agree } from "./syncBaselines";

const USER = "sync-integration-user";

let key: CryptoKey;

/**
 * Fixtures use small, explicit timestamps so the comparisons below are legible.
 * Every setup write therefore passes `preserveTimestamp` — `saveNote` stamps
 * `updatedAt` with `Date.now()` otherwise, which dwarfs any number written here
 * and would silently make the local side win every comparison.
 */
const note = (overrides: Partial<Note> = {}): Note => ({
  id: nanoid(),
  title: "A note",
  content: "something",
  folderId: "root",
  tags: [],
  createdAt: 1000,
  updatedAt: 2000,
  isEncrypted: true,
  order: 0,
  ...overrides,
});

/**
 * The server, as far as this device can tell: opaque rows it cannot read.
 *
 * Deliberately built with the real encryption rather than handing the merge
 * plain objects. A row only reaches `mergeNotes` through `decryptRemoteNotes`,
 * and that is the step that decides whether a note is readable at all.
 */
async function serverRow(
  source: Note,
  serverUpdatedAt = source.updatedAt,
  withKey: CryptoKey = key
) {
  return {
    clientId: source.id,
    payload: await encryptNotePayload(source, withKey),
    serverUpdatedAt,
    deleted: false,
  };
}

const tombstone = (id: string, serverUpdatedAt: number) => ({
  clientId: id,
  payload: "",
  serverUpdatedAt,
  deleted: true,
});

/**
 * Apply a plan the way `runSync` does.
 *
 * Kept in one place so every test below exercises the same application, and so
 * the one thing it is worth being exact about — `preserveTimestamp` on the
 * remote row — is written once rather than repeated and eventually mistyped.
 */
async function applyPlan(
  plan: Awaited<ReturnType<typeof mergeNotes>>,
  owedDeletions = new Set<string>()
) {
  for (const conflict of plan.conflicts) {
    if (owedDeletions.has(conflict.id)) continue;
    await saveNote(conflictCopy(conflict, 5000, nanoid()), key, {
      preserveTimestamp: true,
    });
  }

  for (const incoming of plan.saveLocal) {
    if (owedDeletions.has(incoming.id)) continue;
    await saveNote(incoming, key, { preserveTimestamp: true });
  }

  for (const id of plan.deleteLocal) {
    await deleteNote(id);
  }
}

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

describe("a note written on the other device", () => {
  it("arrives readable, not as ciphertext", async () => {
    const theirs = note({ content: "written elsewhere" });

    const plan = mergeNotes(
      [],
      await decryptRemoteNotes([await serverRow(theirs)], key)
    );
    await applyPlan(plan);

    // The whole round trip: encrypted on one device, decrypted on this one,
    // re-encrypted into this store, and readable when opened.
    expect((await getNote(theirs.id, key))?.content).toBe("written elsewhere");
  });

  it("keeps the other device's clock rather than the time it landed", async () => {
    const theirs = note({ updatedAt: 4000 });

    const plan = mergeNotes(
      [],
      await decryptRemoteNotes([await serverRow(theirs)], key)
    );
    await applyPlan(plan);

    // `preserveTimestamp` is the whole reason this matters. Stamping the write
    // with now would make every pulled note look freshly edited here, and the
    // next sync would push them all back over whatever the other device did.
    expect((await getNote(theirs.id))?.updatedAt).toBe(4000);
  });
});

describe("both devices edited the same note", () => {
  it("keeps both versions, not just the winner", async () => {
    const shared = note({ id: "shared", content: "agreed", updatedAt: 2000 });
    await saveNote({ ...shared, content: "mine", updatedAt: 3000 }, key, {
      preserveTimestamp: true,
    });

    const plan = mergeNotes(
      await getAllNotes(key),
      await decryptRemoteNotes(
        [
          await serverRow({
            ...shared,
            content: "theirs",
            updatedAt: 4000,
          }),
        ],
        key
      ),
      // Both sides have moved on from what this device last agreed.
      agree({}, "shared", 2000)
    );

    expect(plan.conflicts).toHaveLength(1);
    await applyPlan(plan);

    const stored = await getAllNotes(key);
    const contents = stored.map(n => n.content).sort();

    // The newer edit keeps the id so other devices stay consistent, and the
    // losing one is a note of its own. Neither is gone.
    expect(contents).toEqual(["mine", "theirs"]);
    expect((await getNote("shared", key))?.content).toBe("theirs");
  });

  it("writes the losing copy where it can be found", async () => {
    const shared = note({ id: "shared", folderId: "work", updatedAt: 2000 });
    await saveNote(
      { ...shared, content: "mine", updatedAt: 3000, folderId: "work" },
      key,
      { preserveTimestamp: true }
    );

    const plan = mergeNotes(
      await getAllNotes(key),
      await decryptRemoteNotes(
        [await serverRow({ ...shared, content: "theirs", updatedAt: 4000 })],
        key
      ),
      agree({}, "shared", 2000)
    );
    await applyPlan(plan);

    const copy = (await getAllNotes(key)).find(n => n.id !== "shared")!;
    // Same folder as the note it came from. A copy filed somewhere else is a
    // copy nobody finds.
    expect(copy.folderId).toBe("work");
    expect(copy.title).toMatch(/conflict/i);
    expect(copy.content).toBe("mine");
  });

  it("is not a conflict when only the other device moved", async () => {
    const shared = note({ id: "shared", content: "agreed", updatedAt: 2000 });
    await saveNote(shared, key, { preserveTimestamp: true });

    const plan = mergeNotes(
      await getAllNotes(key),
      await decryptRemoteNotes(
        [await serverRow({ ...shared, content: "theirs", updatedAt: 4000 })],
        key
      ),
      agree({}, "shared", 2000)
    );
    await applyPlan(plan);

    // Nothing of this device's to lose, so no copy — just the newer text.
    expect(plan.conflicts).toHaveLength(0);
    expect(await getAllNotes(key)).toHaveLength(1);
    expect((await getNote("shared", key))?.content).toBe("theirs");
  });
});

describe("a note deleted here", () => {
  it("stays deleted when its tombstone has not reached the server", async () => {
    const doomed = note({ id: "doomed", updatedAt: 3000 });
    await saveNote(doomed, key, { preserveTimestamp: true });
    await deleteNote(doomed.id);

    // The server still holds it: this device's tombstone is owed, not sent.
    const plan = mergeNotes(
      await getAllNotes(key),
      await decryptRemoteNotes([await serverRow(doomed)], key)
    );

    await applyPlan(plan, new Set(["doomed"]));

    // Without the owed-deletions filter the merge reads this as a note this
    // device has never seen and puts it back — a deletion that undoes itself
    // on the next sync, every thirty seconds, forever.
    expect(await getNote("doomed")).toBeNull();
  });

  it("goes away here when the other device deleted it", async () => {
    const shared = note({ id: "shared", updatedAt: 2000 });
    await saveNote(shared, key, { preserveTimestamp: true });

    const plan = mergeNotes(
      await getAllNotes(key),
      await decryptRemoteNotes([tombstone("shared", 4000)], key),
      agree({}, "shared", 2000)
    );
    await applyPlan(plan);

    expect(await getNote("shared")).toBeNull();
  });
});

describe("a row this device has no key for", () => {
  it("is left alone rather than dropped or mangled", async () => {
    const mine = note({ content: "mine" });
    await saveNote(mine, key, { preserveTimestamp: true });

    const theirKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const foreign = note({ id: "foreign", content: "unreadable here" });

    const remote = await decryptRemoteNotes(
      [
        await serverRow(mine),
        await serverRow(foreign, foreign.updatedAt, theirKey),
      ],
      key
    );

    // The row arrives, and arrives unreadable. That is a fact worth reporting,
    // not an error — it is what happens before the key has been carried across.
    expect(remote.find(r => r.clientId === "foreign")?.note).toBeNull();

    const plan = mergeNotes(await getAllNotes(key), remote);
    await applyPlan(plan);

    // Nothing was written for it, and nothing of this device's was harmed.
    expect(await getNote("foreign")).toBeNull();
    expect((await getNote(mine.id, key))?.content).toBe("mine");
  });
});

describe("a quiet sync", () => {
  it("changes nothing when both sides already agree", async () => {
    const settled = note({ id: "settled", updatedAt: 2000 });
    await saveNote(settled, key, { preserveTimestamp: true });
    const before = await getNote("settled");

    const plan = mergeNotes(
      await getAllNotes(key),
      await decryptRemoteNotes([await serverRow(settled)], key),
      agree({}, "settled", 2000)
    );
    await applyPlan(plan);

    expect(plan.conflicts).toHaveLength(0);
    expect(plan.saveLocal).toHaveLength(0);
    // Byte for byte. A sync that rewrites rows it did not need to touch churns
    // ciphertext and moves timestamps for no reason.
    expect(await getNote("settled")).toEqual(before);
  });
});
