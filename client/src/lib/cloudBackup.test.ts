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
  getNotesByFolder,
  getNoteVersions,
  getDeletedNotes,
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
