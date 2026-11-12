import { describe, expect, it } from "vitest";
import {
  ARCHIVE_VERSION,
  decryptBackup,
  encryptBackup,
  formatBackupSize,
  restoreArchive,
} from "./cloudBackup";
import {
  getOrCreateEncryptionKey,
  getNote,
  getNotesByFolder,
  getNoteVersions,
  getDeletedNotes,
  putDeletedNotes,
  readVersionContent,
  saveFolder,
  saveNote,
  type Folder,
  type Note,
} from "./storage";

const note = (over: Partial<Note> = {}): Note => ({
  id: "note-1",
  title: "Quarterly review",
  content: "Body text",
  folderId: "folder-1",
  tags: ["work"],
  createdAt: 1_000,
  updatedAt: 2_000,
  isEncrypted: false,
  order: 0,
  ...over,
});

const folder = (over: Partial<Folder> = {}): Folder => ({
  id: "folder-1",
  name: "Work",
  parentId: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  order: 0,
  ...over,
});

describe("encrypt / decrypt round trip", () => {
  it("restores notes and folders unchanged", async () => {
    const key = await getOrCreateEncryptionKey("backup-user");
    const notes = [note(), note({ id: "note-2", title: "Second" })];
    const folders = [folder()];

    const archive = await decryptBackup(
      await encryptBackup(notes, folders, key),
      key
    );

    expect(archive.notes).toEqual(notes);
    expect(archive.folders).toEqual(folders);
  });

  it("produces ciphertext, not readable JSON", async () => {
    const key = await getOrCreateEncryptionKey("backup-user");

    const payload = await encryptBackup(
      [note({ title: "Secret plans" })],
      [folder()],
      key
    );

    expect(payload).not.toContain("Secret plans");
    expect(payload).not.toContain('"notes"');
  });

  it("carries a version and export date", async () => {
    const key = await getOrCreateEncryptionKey("backup-user");

    const archive = await decryptBackup(await encryptBackup([], [], key), key);

    expect(archive.version).toBe(ARCHIVE_VERSION);
    expect(Number.isNaN(Date.parse(archive.exportDate))).toBe(false);
  });

  it("handles an empty account", async () => {
    const key = await getOrCreateEncryptionKey("backup-user");

    const archive = await decryptBackup(await encryptBackup([], [], key), key);

    expect(archive.notes).toEqual([]);
    expect(archive.folders).toEqual([]);
  });

  it("cannot be read with a different key", async () => {
    const theirKey = await getOrCreateEncryptionKey("someone-else");
    const ourKey = await getOrCreateEncryptionKey("us");

    const payload = await encryptBackup([note()], [folder()], theirKey);

    await expect(decryptBackup(payload, ourKey)).rejects.toThrow();
  });

  it("rejects a payload that decrypts to something that is not an archive", async () => {
    const key = await getOrCreateEncryptionKey("backup-user");
    const { encryptContent } = await import("./storage");

    const payload = await encryptContent(
      JSON.stringify({ hello: "world" }),
      key
    );

    await expect(decryptBackup(payload, key)).rejects.toThrow(
      /not in a recognised format/
    );
  });
});

describe("restoreArchive", () => {
  it("writes the notes and folders back to local storage", async () => {
    const key = await getOrCreateEncryptionKey("restore-user");
    const archive = {
      version: "1.0",
      exportDate: new Date().toISOString(),
      folders: [folder({ id: "restored-folder" })],
      notes: [
        note({ id: "restored-1", folderId: "restored-folder" }),
        note({
          id: "restored-2",
          folderId: "restored-folder",
          title: "Second",
        }),
      ],
    };

    const result = await restoreArchive(archive, key);

    expect(result).toMatchObject({ notes: 2, folders: 1, displaced: 0 });
    const stored = await getNotesByFolder("restored-folder", key);
    expect(stored.map(n => n.id).sort()).toEqual(["restored-1", "restored-2"]);
  });

  it("dates what it writes now, so the restore survives the next sync", async () => {
    // This replaces a test that pinned the opposite. Preserving the archive's
    // timestamps did not stop a restore winning later comparisons so much as
    // guarantee it lost them: the server still held the newer copy, the merge
    // read that as a clean win because the baseline agreed with it, and the
    // restored text was replaced with no conflict reported and no copy kept.
    const key = await getOrCreateEncryptionKey("restore-user");
    const before = Date.now();
    const archive = {
      version: "1.0",
      exportDate: new Date().toISOString(),
      folders: [folder({ id: "ts-folder" })],
      notes: [
        note({ id: "ts-note", folderId: "ts-folder", updatedAt: 12_345 }),
      ],
    };

    await restoreArchive(archive, key);

    const [stored] = await getNotesByFolder("ts-folder", key);
    expect(stored.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("keeps a newer local note rather than writing over it", async () => {
    const key = await getOrCreateEncryptionKey("restore-user");
    const local = note({
      id: "keep-me",
      folderId: "keep-folder",
      title: "Edited since the backup",
      content: "words typed after the backup was taken",
      updatedAt: 9_000_000,
    });
    await saveFolder(folder({ id: "keep-folder" }));
    await saveNote(local, key, { preserveTimestamp: true });

    const result = await restoreArchive(
      {
        version: "2.0",
        exportDate: new Date().toISOString(),
        folders: [folder({ id: "keep-folder" })],
        notes: [
          note({
            id: "keep-me",
            folderId: "keep-folder",
            title: "As backed up",
            content: "the older text",
            updatedAt: 1_000,
          }),
        ],
      },
      key,
      [local]
    );

    expect(result.displaced).toBe(1);

    const stored = await getNotesByFolder("keep-folder", key);
    // The archive's version is back under the original id...
    expect(stored.find(n => n.id === "keep-me")?.content).toBe(
      "the older text"
    );
    // ...and the work done since is still here, as a note of its own.
    const kept = stored.find(n => n.id !== "keep-me");
    expect(kept?.content).toBe("words typed after the backup was taken");
    expect(kept?.title).toMatch(/before restore/);
  });

  it("does not rewrite a note the archive already agrees with", async () => {
    const key = await getOrCreateEncryptionKey("restore-user");
    const same = note({
      id: "same",
      folderId: "same-folder",
      content: "unchanged",
      updatedAt: 500,
    });

    const result = await restoreArchive(
      {
        version: "2.0",
        exportDate: new Date().toISOString(),
        folders: [folder({ id: "same-folder" })],
        notes: [same],
      },
      key,
      [same]
    );

    expect(result).toMatchObject({ notes: 0, displaced: 0 });
  });

  it("keeps a newer bin entry rather than writing over it", async () => {
    // The same failure `planRestore` exists to stop for active notes, just
    // reached through the bin instead: a note deleted again since the
    // backup was taken is newer than the archive's copy of it, and a bare
    // putDeletedNotes(archive.deletedNotes) used to overwrite it with no
    // comparison at all — unrecoverably, since the bin has no history of
    // its own to fall back on.
    const key = await getOrCreateEncryptionKey("restore-user");
    // Both well within the 30-day retention window `getDeletedNotes` enforces
    // — only their order relative to each other matters here, not to "now".
    const older = Date.now() - 2_000;
    const newer = Date.now() - 1_000;
    const localBin = note({
      id: "binned",
      title: "Edited after the backup, then deleted again",
      content: "the newer deleted text",
      updatedAt: newer,
      isDeleted: true,
      deletedAt: newer,
    });

    const result = await restoreArchive(
      {
        version: "2.0",
        exportDate: new Date().toISOString(),
        folders: [],
        notes: [],
        deletedNotes: [
          note({
            id: "binned",
            title: "As backed up",
            content: "the older binned text",
            updatedAt: older,
            isDeleted: true,
            deletedAt: older,
          }),
        ],
      },
      key,
      [],
      [localBin]
    );

    expect(result.deletedDisplaced).toBe(1);

    const binned = await getDeletedNotes(key);
    // The archive's older copy is back under the original id...
    expect(binned.find(n => n.id === "binned")?.content).toBe(
      "the older binned text"
    );
    // ...and the newer deletion is still here, as a bin entry of its own —
    // not resurrected to an active note.
    const kept = binned.find(n => n.id !== "binned");
    expect(kept?.content).toBe("the newer deleted text");
    expect(kept?.isDeleted).toBe(true);
    expect(kept?.title).toMatch(/before restore/);
  });

  it("does not rewrite a bin entry the archive already agrees with", async () => {
    const key = await getOrCreateEncryptionKey("restore-user");
    const same = note({
      id: "same-binned",
      content: "unchanged",
      updatedAt: 500,
      isDeleted: true,
      deletedAt: 500,
    });

    const result = await restoreArchive(
      {
        version: "2.0",
        exportDate: new Date().toISOString(),
        folders: [],
        notes: [],
        deletedNotes: [same],
      },
      key,
      [],
      [same]
    );

    expect(result).toMatchObject({ deletedNotes: 0, deletedDisplaced: 0 });
  });

  it("does not resurrect a note the bin already holds, even though the archive lists it as active", async () => {
    // The archive was taken before this note was deleted, so archive.notes
    // lists it active and archive.deletedNotes says nothing about it at
    // all — there is no "displaced" entry to catch this on the bin side.
    // Without the cross-store check, planRestore's notes-plan would call
    // this "added" (this browser's active store has nothing for the id) and
    // write it there, landing the same id in both the active store and the
    // bin at once.
    const key = await getOrCreateEncryptionKey("restore-user");
    const binned = note({
      id: "split-brain",
      content: "deleted after this backup was taken",
      isDeleted: true,
      // Recent enough to survive the 30-day retention window `getDeletedNotes`
      // enforces — the absolute time doesn't matter otherwise.
      deletedAt: Date.now() - 5_000,
    });
    await putDeletedNotes([binned], key);

    const result = await restoreArchive(
      {
        version: "2.0",
        exportDate: new Date().toISOString(),
        folders: [],
        notes: [note({ id: "split-brain", content: "as backed up" })],
      },
      key,
      [],
      [binned]
    );

    expect(result.notes).toBe(0);
    // Not written to the active store...
    expect(await getNote("split-brain", key)).toBeNull();
    // ...and the bin's own copy is exactly as it was, not duplicated either.
    const bin = await getDeletedNotes(key);
    const matches = bin.filter(n => n.id === "split-brain");
    expect(matches).toHaveLength(1);
    expect(matches[0].content).toBe("deleted after this backup was taken");
  });

  it("does not file a note in the bin that this browser already has active, even though the archive lists it as deleted", async () => {
    // The mirror image: the archive was taken while this note was in the
    // bin, and it has since been restored from there (now active). Writing
    // the archive's deleted copy into the bin would put the id in both
    // stores again, from the other direction.
    const key = await getOrCreateEncryptionKey("restore-user");
    await saveFolder(folder({ id: "revived-folder" }));
    const active = note({
      id: "split-brain-2",
      folderId: "revived-folder",
      content: "restored from the bin after this backup",
    });
    await saveNote(active, key, { preserveTimestamp: true });

    const result = await restoreArchive(
      {
        version: "2.0",
        exportDate: new Date().toISOString(),
        folders: [],
        notes: [],
        deletedNotes: [
          note({
            id: "split-brain-2",
            content: "as backed up, still in the bin then",
            isDeleted: true,
            deletedAt: 1_000,
          }),
        ],
      },
      key,
      [active],
      []
    );

    expect(result.deletedNotes).toBe(0);
    // Not filed in the bin...
    const bin = await getDeletedNotes(key);
    expect(bin.find(n => n.id === "split-brain-2")).toBeUndefined();
    // ...and the active note is exactly as it was.
    const stillActive = await getNote("split-brain-2", key);
    expect(stillActive?.content).toBe(
      "restored from the bin after this backup"
    );
  });

  it("carries version history and the bin back", async () => {
    const key = await getOrCreateEncryptionKey("restore-user");

    const result = await restoreArchive(
      {
        version: "2.0",
        exportDate: new Date().toISOString(),
        folders: [folder({ id: "wide-folder" })],
        notes: [note({ id: "wide-note", folderId: "wide-folder" })],
        versions: [
          {
            id: "v1",
            noteId: "wide-note",
            title: "Quarterly review",
            content: "an earlier draft",
            createdAt: 800,
            versionNumber: 1,
            isEncrypted: false,
          },
        ],
        deletedNotes: [
          note({
            id: "binned",
            folderId: "wide-folder",
            isDeleted: true,
            deletedAt: Date.now(),
          }),
        ],
      },
      key
    );

    expect(result).toMatchObject({ versions: 1, deletedNotes: 1 });

    const versions = await getNoteVersions("wide-note");
    expect(versions).toHaveLength(1);
    expect(await readVersionContent(versions[0], key)).toBe("an earlier draft");

    const binned = await getDeletedNotes(key);
    expect(binned.map(n => n.id)).toContain("binned");
  });

  it("restores a 1.0 archive, which carries neither", async () => {
    const key = await getOrCreateEncryptionKey("restore-user");

    await expect(
      restoreArchive(
        {
          version: "1.0",
          exportDate: new Date().toISOString(),
          notes: [],
          folders: [],
        },
        key
      )
    ).resolves.toEqual({
      notes: 0,
      folders: 0,
      versions: 0,
      deletedNotes: 0,
      displaced: 0,
      deletedDisplaced: 0,
    });
  });
});

describe("formatBackupSize", () => {
  it("reports bytes, kilobytes and megabytes", () => {
    expect(formatBackupSize(512)).toBe("512 B");
    expect(formatBackupSize(2048)).toBe("2.0 KB");
    expect(formatBackupSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("handles zero", () => {
    expect(formatBackupSize(0)).toBe("0 B");
  });
});
