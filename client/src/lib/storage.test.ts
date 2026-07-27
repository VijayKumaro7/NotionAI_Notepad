import { describe, it, expect, beforeEach } from 'vitest';
import {
  initializeDB,
  getOrCreateEncryptionKey,
  encryptContent,
  decryptContent,
  saveNote,
  getNote,
  deleteNote,
  searchNotes,
  saveFolder,
  getAllFolders,
  deleteFolder,
  Note,
  Folder,
} from './storage';
import { nanoid } from 'nanoid';

describe('Storage Module', () => {
  let encryptionKey: CryptoKey | null = null;

  beforeEach(async () => {
    // Initialize DB and get encryption key
    await initializeDB();
    encryptionKey = await getOrCreateEncryptionKey('test-user');
  });

  describe('Encryption', () => {
    it('should encrypt and decrypt content correctly', async () => {
      const originalContent = 'This is a secret note';
      const encrypted = await encryptContent(originalContent, encryptionKey!);
      
      expect(encrypted).not.toBe(originalContent);
      expect(typeof encrypted).toBe('string');
      
      const decrypted = await decryptContent(encrypted, encryptionKey!);
      expect(decrypted).toBe(originalContent);
    });

    it('should handle long content encryption', async () => {
      const longContent = 'Lorem ipsum dolor sit amet, '.repeat(100);
      const encrypted = await encryptContent(longContent, encryptionKey!);
      const decrypted = await decryptContent(encrypted, encryptionKey!);
      
      expect(decrypted).toBe(longContent);
    });

    it('should fail to decrypt with wrong content', async () => {
      const encrypted = await encryptContent('Test content', encryptionKey!);
      const tamperedContent = encrypted.slice(0, -5) + 'XXXXX';
      
      await expect(decryptContent(tamperedContent, encryptionKey!)).rejects.toThrow();
    });
  });

  describe('Note Operations', () => {
    let testNote: Note;

    beforeEach(() => {
      testNote = {
        id: nanoid(),
        title: 'Test Note',
        content: 'Test content',
        folderId: 'test-folder',
        tags: ['test', 'sample'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
      };
    });

    it('should save and retrieve a note', async () => {
      await saveNote(testNote, encryptionKey!);
      const retrieved = await getNote(testNote.id, encryptionKey!);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBe(testNote.title);
      expect(retrieved?.content).toBe(testNote.content);
    });

    it('should encrypt note content when saving with key', async () => {
      await saveNote(testNote, encryptionKey!);
      const retrieved = await getNote(testNote.id, encryptionKey!);
      
      expect(retrieved?.isEncrypted).toBe(true);
      expect(retrieved?.content).toBe(testNote.content);
    });

    it('should save note without encryption when no key provided', async () => {
      await saveNote(testNote);
      const retrieved = await getNote(testNote.id);
      
      expect(retrieved?.isEncrypted).toBe(false);
      expect(retrieved?.content).toBe(testNote.content);
    });

    it('should delete a note', async () => {
      await saveNote(testNote, encryptionKey!);
      await deleteNote(testNote.id);
      const retrieved = await getNote(testNote.id);
      
      expect(retrieved).toBeNull();
    });

    it('should update note updatedAt timestamp', async () => {
      const originalTime = testNote.updatedAt;
      await saveNote(testNote, encryptionKey!);
      
      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));
      
      const updated = { ...testNote, content: 'Updated content' };
      await saveNote(updated, encryptionKey!);
      
      const retrieved = await getNote(testNote.id, encryptionKey!);
      expect(retrieved?.updatedAt).toBeGreaterThan(originalTime);
    });
  });

  describe('Search Operations', () => {
    beforeEach(async () => {
      const notes: Note[] = [
        {
          id: nanoid(),
          title: 'JavaScript Tutorial',
          content: 'Learn JavaScript basics',
          folderId: 'test-folder',
          tags: ['programming'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isEncrypted: false,
        },
        {
          id: nanoid(),
          title: 'Python Guide',
          content: 'Python is great for data science',
          folderId: 'test-folder',
          tags: ['programming', 'data'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isEncrypted: false,
        },
        {
          id: nanoid(),
          title: 'Recipe Collection',
          content: 'Delicious recipes for cooking',
          folderId: 'test-folder',
          tags: ['cooking'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isEncrypted: false,
        },
      ];

      for (const note of notes) {
        await saveNote(note, encryptionKey!);
      }
    });

    it('should search notes by title', async () => {
      const results = await searchNotes('JavaScript', encryptionKey!);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('JavaScript');
    });

    it('should search notes by content', async () => {
      const results = await searchNotes('data science', encryptionKey!);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('data science');
    });

    it('should be case-insensitive search', async () => {
      const results = await searchNotes('PYTHON', encryptionKey!);
      
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty array for no matches', async () => {
      const results = await searchNotes('nonexistent', encryptionKey!);
      
      expect(results).toEqual([]);
    });
  });

  describe('Folder Operations', () => {
    let testFolder: Folder;

    beforeEach(() => {
      testFolder = {
        id: nanoid(),
        name: 'Test Folder',
        parentId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });

    it('should save and retrieve a folder', async () => {
      await saveFolder(testFolder);
      const folders = await getAllFolders();
      
      expect(folders.length).toBeGreaterThan(0);
      expect(folders.some((f) => f.id === testFolder.id)).toBe(true);
    });

    it('should delete a folder', async () => {
      await saveFolder(testFolder);
      await deleteFolder(testFolder.id);
      const folders = await getAllFolders();
      
      expect(folders.some((f) => f.id === testFolder.id)).toBe(false);
    });

    it('should support nested folders', async () => {
      const parentFolder = { ...testFolder };
      await saveFolder(parentFolder);
      
      const childFolder: Folder = {
        id: nanoid(),
        name: 'Child Folder',
        parentId: parentFolder.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveFolder(childFolder);
      
      const folders = await getAllFolders();
      const savedChild = folders.find((f) => f.id === childFolder.id);
      
      expect(savedChild?.parentId).toBe(parentFolder.id);
    });
  });
});
