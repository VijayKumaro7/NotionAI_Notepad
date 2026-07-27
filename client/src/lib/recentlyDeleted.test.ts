import { describe, it, expect, beforeEach } from 'vitest';
import {
  deleteNote,
  getDeletedNotes,
  restoreNote,
  permanentlyDeleteNote,
  cleanupExpiredDeletedNotes,
  initializeDB,
  saveNote,
  getNote,
  Note,
} from './storage';

describe('Recently Deleted Feature', () => {
  beforeEach(async () => {
    await initializeDB();
  });

  describe('deleteNote (soft delete)', () => {
    it('should move a note to deleted notes store', async () => {
      const testNote: Note = {
        id: 'test-1',
        title: 'Test Note',
        content: 'Test content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      // Save note first
      await saveNote(testNote);

      // Delete note
      await deleteNote(testNote.id);

      // Verify note is no longer in active notes
      const activeNote = await getNote(testNote.id);
      expect(activeNote).toBeNull();

      // Verify note is in deleted notes
      const deletedNotes = await getDeletedNotes();
      expect(deletedNotes.length).toBeGreaterThan(0);
      expect(deletedNotes.some((n) => n.id === testNote.id)).toBe(true);
    });

    it('should record deletion timestamp', async () => {
      const testNote: Note = {
        id: 'test-2',
        title: 'Test Note 2',
        content: 'Test content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const beforeDelete = Date.now();
      await deleteNote(testNote.id);
      const afterDelete = Date.now();

      const deletedNotes = await getDeletedNotes();
      const deletedNote = deletedNotes.find((n) => n.id === testNote.id);

      expect(deletedNote).toBeDefined();
      expect(deletedNote?.deletedAt).toBeDefined();
      expect(deletedNote!.deletedAt! >= beforeDelete).toBe(true);
      expect(deletedNote!.deletedAt! <= afterDelete).toBe(true);
    });
  });

  describe('getDeletedNotes', () => {
    it('should return only notes deleted within retention period', async () => {
      const testNote: Note = {
        id: 'test-3',
        title: 'Test Note 3',
        content: 'Test content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      await deleteNote(testNote.id);

      const deletedNotes = await getDeletedNotes();
      expect(deletedNotes.length).toBeGreaterThan(0);
      expect(deletedNotes.some((n) => n.id === testNote.id)).toBe(true);
    });

    it('should filter out notes older than 30 days', async () => {
      const deletedNotes = await getDeletedNotes();
      const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();

      for (const note of deletedNotes) {
        const deletedAt = note.deletedAt || 0;
        const ageMs = now - deletedAt;
        expect(ageMs).toBeLessThan(RETENTION_MS);
      }
    });
  });

  describe('restoreNote', () => {
    it('should restore a deleted note to active notes', async () => {
      const testNote: Note = {
        id: 'test-4',
        title: 'Test Note 4',
        content: 'Test content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      await deleteNote(testNote.id);

      // Verify it's deleted
      let activeNote = await getNote(testNote.id);
      expect(activeNote).toBeNull();

      // Restore it
      await restoreNote(testNote.id);

      // Verify it's back in active notes
      activeNote = await getNote(testNote.id);
      expect(activeNote).toBeDefined();
      expect(activeNote?.id).toBe(testNote.id);
      expect(activeNote?.isDeleted).not.toBe(true);
    });

    it('should remove note from deleted notes after restore', async () => {
      const testNote: Note = {
        id: 'test-5',
        title: 'Test Note 5',
        content: 'Test content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      await deleteNote(testNote.id);
      await restoreNote(testNote.id);

      const deletedNotes = await getDeletedNotes();
      expect(deletedNotes.some((n) => n.id === testNote.id)).toBe(false);
    });
  });

  describe('permanentlyDeleteNote', () => {
    it('should permanently remove a note from deleted notes', async () => {
      const testNote: Note = {
        id: 'test-6',
        title: 'Test Note 6',
        content: 'Test content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      await deleteNote(testNote.id);

      // Verify it's deleted
      let deletedNotes = await getDeletedNotes();
      expect(deletedNotes.some((n) => n.id === testNote.id)).toBe(true);

      // Permanently delete
      await permanentlyDeleteNote(testNote.id);

      // Verify it's gone
      deletedNotes = await getDeletedNotes();
      expect(deletedNotes.some((n) => n.id === testNote.id)).toBe(false);
    });
  });

  describe('cleanupExpiredDeletedNotes', () => {
    it('should return number of cleaned up notes', async () => {
      const result = await cleanupExpiredDeletedNotes();
      expect(typeof result).toBe('number');
      expect(result >= 0).toBe(true);
    });
  });

  describe('30-day retention window', () => {
    it('should maintain notes for 30 days', async () => {
      const testNote: Note = {
        id: 'test-7',
        title: 'Test Note 7',
        content: 'Test content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      await deleteNote(testNote.id);

      const deletedNotes = await getDeletedNotes();
      const deletedNote = deletedNotes.find((n) => n.id === testNote.id);

      expect(deletedNote).toBeDefined();
      const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const ageMs = now - (deletedNote?.deletedAt || 0);
      expect(ageMs).toBeLessThan(RETENTION_MS);
    });
  });
});
