import { describe, it, expect, beforeEach } from "vitest";
import {
  createNoteVersion,
  getNoteVersions,
  getNoteVersion,
  restoreNoteVersion,
  deleteNoteVersion,
  deleteAllNoteVersions,
  getVersionStats,
  initializeDB,
  saveNote,
  Note,
  NoteVersion,
} from "./storage";

describe("Version History Feature", () => {
  beforeEach(async () => {
    await initializeDB();
  });

  describe("createNoteVersion", () => {
    it("should create a version snapshot of a note", async () => {
      const testNote: Note = {
        id: "test-note-1",
        title: "Test Note",
        content: "Initial content",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const version = await createNoteVersion(testNote.id, testNote, "edit");

      expect(version).toBeDefined();
      expect(version.noteId).toBe(testNote.id);
      expect(version.title).toBe(testNote.title);
      expect(version.content).toBe(testNote.content);
      expect(version.versionNumber).toBe(1);
      expect(version.changeType).toBe("edit");
    });

    it("should increment version number for each snapshot", async () => {
      const testNote: Note = {
        id: "test-note-2",
        title: "Test Note",
        content: "Content v1",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);

      const v1 = await createNoteVersion(testNote.id, testNote, "edit");
      expect(v1.versionNumber).toBe(1);

      const updatedNote = { ...testNote, content: "Content v2" };
      const v2 = await createNoteVersion(testNote.id, updatedNote, "edit");
      expect(v2.versionNumber).toBe(2);

      const v3 = await createNoteVersion(testNote.id, updatedNote, "auto-save");
      expect(v3.versionNumber).toBe(3);
    });

    it("should record change type correctly", async () => {
      const testNote: Note = {
        id: "test-note-3",
        title: "Test Note",
        content: "Content",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);

      const editVersion = await createNoteVersion(
        testNote.id,
        testNote,
        "edit"
      );
      expect(editVersion.changeType).toBe("edit");

      const autoSaveVersion = await createNoteVersion(
        testNote.id,
        testNote,
        "auto-save"
      );
      expect(autoSaveVersion.changeType).toBe("auto-save");

      const restoreVersion = await createNoteVersion(
        testNote.id,
        testNote,
        "restore"
      );
      expect(restoreVersion.changeType).toBe("restore");
    });
  });

  describe("getNoteVersions", () => {
    it("should return all versions of a note", async () => {
      const testNote: Note = {
        id: "test-note-4",
        title: "Test Note",
        content: "Content",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      await createNoteVersion(testNote.id, testNote, "edit");
      await createNoteVersion(testNote.id, testNote, "auto-save");

      const versions = await getNoteVersions(testNote.id);
      expect(versions.length).toBe(2);
      expect(versions[0].versionNumber).toBe(2); // Newest first
      expect(versions[1].versionNumber).toBe(1);
    });

    it("should return empty array for note with no versions", async () => {
      const versions = await getNoteVersions("non-existent-note");
      expect(versions).toEqual([]);
    });
  });

  describe("getNoteVersion", () => {
    it("should retrieve a specific version", async () => {
      const testNote: Note = {
        id: "test-note-5",
        title: "Test Note",
        content: "Content",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const version = await createNoteVersion(testNote.id, testNote, "edit");

      const retrieved = await getNoteVersion(version.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(version.id);
      expect(retrieved?.title).toBe(testNote.title);
    });

    it("should return null for non-existent version", async () => {
      const version = await getNoteVersion("non-existent-version-id");
      expect(version).toBeNull();
    });
  });

  describe("restoreNoteVersion", () => {
    it("should restore a note to a previous version", async () => {
      const testNote: Note = {
        id: "test-note-6",
        title: "Original Title",
        content: "Original content",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const version1 = await createNoteVersion(testNote.id, testNote, "edit");

      // Update note
      const updatedNote = {
        ...testNote,
        title: "Updated Title",
        content: "Updated content",
      };
      await saveNote(updatedNote);

      // Restore to version 1
      const restored = await restoreNoteVersion(testNote.id, version1.id);

      expect(restored).toBeDefined();
      expect(restored?.title).toBe("Original Title");
      expect(restored?.content).toBe("Original content");
    });

    it("should create a restore version snapshot", async () => {
      const testNote: Note = {
        id: "test-note-7",
        title: "Test",
        content: "Content",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const version1 = await createNoteVersion(testNote.id, testNote, "edit");

      const updatedNote = { ...testNote, content: "Updated" };
      await saveNote(updatedNote);
      await createNoteVersion(testNote.id, updatedNote, "edit");

      await restoreNoteVersion(testNote.id, version1.id);

      const versions = await getNoteVersions(testNote.id);
      const restoreVersion = versions.find(v => v.changeType === "restore");
      expect(restoreVersion).toBeDefined();
    });
  });

  describe("deleteNoteVersion", () => {
    it("should delete a specific version", async () => {
      const testNote: Note = {
        id: "test-note-8",
        title: "Test",
        content: "Content",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const version = await createNoteVersion(testNote.id, testNote, "edit");

      await deleteNoteVersion(version.id);

      const retrieved = await getNoteVersion(version.id);
      expect(retrieved).toBeNull();
    });
  });

  describe("deleteAllNoteVersions", () => {
    it("should delete all versions of a note", async () => {
      const testNote: Note = {
        id: "test-note-9",
        title: "Test",
        content: "Content",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      await createNoteVersion(testNote.id, testNote, "edit");
      await createNoteVersion(testNote.id, testNote, "auto-save");

      await deleteAllNoteVersions(testNote.id);

      const versions = await getNoteVersions(testNote.id);
      expect(versions).toEqual([]);
    });
  });

  describe("getVersionStats", () => {
    it("should return version statistics", async () => {
      const testNote: Note = {
        id: "test-note-10",
        title: "Test",
        content: "Content",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const v1 = await createNoteVersion(testNote.id, testNote, "edit");
      const v2 = await createNoteVersion(testNote.id, testNote, "auto-save");

      const stats = await getVersionStats(testNote.id);

      expect(stats.totalVersions).toBe(2);
      expect(stats.oldestVersion?.versionNumber).toBe(1);
      expect(stats.newestVersion?.versionNumber).toBe(2);
      expect(stats.lastModified).toBe(v2.createdAt);
    });

    it("should return empty stats for note with no versions", async () => {
      const stats = await getVersionStats("non-existent-note");

      expect(stats.totalVersions).toBe(0);
      expect(stats.oldestVersion).toBeNull();
      expect(stats.newestVersion).toBeNull();
      expect(stats.lastModified).toBe(0);
    });
  });

  describe("Version history limits", () => {
    it("should maintain version history up to limit", async () => {
      const testNote: Note = {
        id: "test-note-11",
        title: "Test",
        content: "Content",
        folderId: "folder-1",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);

      // Create multiple versions
      for (let i = 0; i < 5; i++) {
        await createNoteVersion(testNote.id, testNote, "edit");
      }

      const versions = await getNoteVersions(testNote.id);
      expect(versions.length).toBeLessThanOrEqual(50); // VERSION_HISTORY_LIMIT
    });
  });
});
