/**
 * IndexedDB storage utilities for local-first encrypted note storage
 * Provides encryption/decryption using Web Crypto API
 */

export interface Note {
  id: string;
  title: string;
  content: string;
  folderId: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  isEncrypted: boolean;
  order: number;
  isDeleted?: boolean;
  deletedAt?: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  order: number;
}

const DB_NAME = 'NotionAINotepad';
const DB_VERSION = 2;
const NOTES_STORE = 'notes';
const FOLDERS_STORE = 'folders';
const ENCRYPTION_KEY_STORE = 'encryptionKeys';
const DELETED_NOTES_STORE = 'deletedNotes';
const DELETION_RETENTION_DAYS = 30;
const DELETION_RETENTION_MS = DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB database
 */
export async function initializeDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create notes store
      if (!database.objectStoreNames.contains(NOTES_STORE)) {
        const notesStore = database.createObjectStore(NOTES_STORE, { keyPath: 'id' });
        notesStore.createIndex('folderId', 'folderId', { unique: false });
        notesStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Create folders store
      if (!database.objectStoreNames.contains(FOLDERS_STORE)) {
        const foldersStore = database.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
        foldersStore.createIndex('parentId', 'parentId', { unique: false });
      }

      // Create encryption keys store
      if (!database.objectStoreNames.contains(ENCRYPTION_KEY_STORE)) {
        database.createObjectStore(ENCRYPTION_KEY_STORE, { keyPath: 'id' });
      }

      // Create deleted notes store (v2)
      if (!database.objectStoreNames.contains(DELETED_NOTES_STORE)) {
        const deletedNotesStore = database.createObjectStore(DELETED_NOTES_STORE, { keyPath: 'id' });
        deletedNotesStore.createIndex('deletedAt', 'deletedAt', { unique: false });
      }
    };
  });
}

/**
 * Get or create encryption key for the user
 */
export async function getOrCreateEncryptionKey(userId: string): Promise<CryptoKey> {
  const database = db || (await initializeDB());
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ENCRYPTION_KEY_STORE], 'readonly');
    const store = transaction.objectStore(ENCRYPTION_KEY_STORE);
    const request = store.get(userId);

    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      if (request.result) {
        // Key exists, import it
        const keyData = request.result.keyData;
        const key = await crypto.subtle.importKey(
          'raw',
          new Uint8Array(keyData),
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );
        resolve(key);
      } else {
        // Generate new key
        const key = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );

        // Export and store the key
        const exportedKey = await crypto.subtle.exportKey('raw', key);
        const transaction = database.transaction([ENCRYPTION_KEY_STORE], 'readwrite');
        const store = transaction.objectStore(ENCRYPTION_KEY_STORE);
        store.put({
          id: userId,
          keyData: Array.from(new Uint8Array(exportedKey)),
          createdAt: Date.now(),
        });

        resolve(key);
      }
    };
  });
}

/**
 * Encrypt text content using AES-GCM
 */
export async function encryptContent(content: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  // Convert to base64 for storage
  return btoa(String.fromCharCode(...Array.from(combined)));
}

/**
 * Decrypt text content
 */
export async function decryptContent(encryptedContent: string, key: CryptoKey): Promise<string> {
  try {
    const combined = new Uint8Array(Array.from(atob(encryptedContent), (c) => c.charCodeAt(0)));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt content');
  }
}

/**
 * Save a note to IndexedDB
 */
export async function saveNote(note: Note, encryptionKey?: CryptoKey): Promise<void> {
  const database = db || (await initializeDB());
  
  let contentToStore = note.content;
  let isEncrypted = false;

  if (encryptionKey) {
    contentToStore = await encryptContent(note.content, encryptionKey);
    isEncrypted = true;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE], 'readwrite');
    const store = transaction.objectStore(NOTES_STORE);
    const request = store.put({
      ...note,
      content: contentToStore,
      isEncrypted,
      updatedAt: Date.now(),
    });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Get a note by ID
 */
export async function getNote(noteId: string, encryptionKey?: CryptoKey): Promise<Note | null> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE], 'readonly');
    const store = transaction.objectStore(NOTES_STORE);
    const request = store.get(noteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      if (!request.result) {
        resolve(null);
        return;
      }

      const note = request.result;
      if (note.isEncrypted && encryptionKey) {
        note.content = await decryptContent(note.content, encryptionKey);
      }
      resolve(note);
    };
  });
}

/**
 * Get all notes in a folder
 */
export async function getNotesByFolder(folderId: string, encryptionKey?: CryptoKey): Promise<Note[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE], 'readonly');
    const store = transaction.objectStore(NOTES_STORE);
    const index = store.index('folderId');
    const request = index.getAll(folderId);

    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const notes = request.result as Note[];
      if (encryptionKey) {
        for (const note of notes) {
          if (note.isEncrypted) {
            note.content = await decryptContent(note.content, encryptionKey);
          }
        }
      }
      resolve(notes);
    };
  });
}

/**
 * Get notes by tags
 */
export async function getNotesByTag(tag: string, encryptionKey?: CryptoKey): Promise<Note[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE], 'readonly');
    const store = transaction.objectStore(NOTES_STORE);
    const index = store.index('tags');
    const request = index.getAll(tag);

    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const notes = request.result as Note[];
      if (encryptionKey) {
        for (const note of notes) {
          if (note.isEncrypted) {
            note.content = await decryptContent(note.content, encryptionKey);
          }
        }
      }
      resolve(notes);
    };
  });
}

/**
 * Soft delete a note (move to Recently Deleted)
 */
export async function deleteNote(noteId: string): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE, DELETED_NOTES_STORE], 'readwrite');
    
    // Get the note first
    const notesStore = transaction.objectStore(NOTES_STORE);
    const getRequest = notesStore.get(noteId);

    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => {
      const note = getRequest.result;
      if (!note) {
        reject(new Error('Note not found'));
        return;
      }

      // Move to deleted notes store
      const deletedNotesStore = transaction.objectStore(DELETED_NOTES_STORE);
      const deletedNote = {
        ...note,
        deletedAt: Date.now(),
        isDeleted: true,
      };
      deletedNotesStore.put(deletedNote);

      // Remove from active notes
      notesStore.delete(noteId);
    };

    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

/**
 * Get all deleted notes
 */
export async function getDeletedNotes(encryptionKey?: CryptoKey): Promise<Note[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DELETED_NOTES_STORE], 'readonly');
    const store = transaction.objectStore(DELETED_NOTES_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      let notes = request.result as Note[];
      
      // Filter out notes older than 30 days
      const now = Date.now();
      notes = notes.filter((note) => {
        const deletedAt = note.deletedAt || 0;
        return now - deletedAt < DELETION_RETENTION_MS;
      });

      if (encryptionKey) {
        for (const note of notes) {
          if (note.isEncrypted) {
            note.content = await decryptContent(note.content, encryptionKey);
          }
        }
      }
      resolve(notes);
    };
  });
}

/**
 * Restore a deleted note
 */
export async function restoreNote(noteId: string, encryptionKey?: CryptoKey): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE, DELETED_NOTES_STORE], 'readwrite');
    
    // Get the deleted note
    const deletedNotesStore = transaction.objectStore(DELETED_NOTES_STORE);
    const getRequest = deletedNotesStore.get(noteId);

    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => {
      const note = getRequest.result;
      if (!note) {
        reject(new Error('Deleted note not found'));
        return;
      }

      // Restore to active notes
      const notesStore = transaction.objectStore(NOTES_STORE);
      const restoredNote = {
        ...note,
        isDeleted: false,
        updatedAt: Date.now(),
      };
      delete restoredNote.deletedAt;
      notesStore.put(restoredNote);

      // Remove from deleted notes
      deletedNotesStore.delete(noteId);
    };

    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

/**
 * Permanently delete a note
 */
export async function permanentlyDeleteNote(noteId: string): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DELETED_NOTES_STORE], 'readwrite');
    const store = transaction.objectStore(DELETED_NOTES_STORE);
    const request = store.delete(noteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Clean up expired deleted notes (older than 30 days)
 */
export async function cleanupExpiredDeletedNotes(): Promise<number> {
  const database = db || (await initializeDB());
  const now = Date.now();
  let deletedCount = 0;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DELETED_NOTES_STORE], 'readwrite');
    const store = transaction.objectStore(DELETED_NOTES_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const notes = request.result as Note[];
      
      for (const note of notes) {
        const deletedAt = note.deletedAt || 0;
        if (now - deletedAt >= DELETION_RETENTION_MS) {
          store.delete(note.id);
          deletedCount++;
        }
      }
    };

    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve(deletedCount);
  });
}

/**
 * Search notes by title and content (excluding deleted notes)
 */
export async function searchNotes(query: string, encryptionKey?: CryptoKey): Promise<Note[]> {
  const database = db || (await initializeDB());
  const lowerQuery = query.toLowerCase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE], 'readonly');
    const store = transaction.objectStore(NOTES_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const notes = request.result;
      const results: Note[] = [];

      for (const note of notes) {
        // Skip deleted notes
        if (note.isDeleted) continue;

        let content = note.content;
        if (note.isEncrypted && encryptionKey) {
          content = await decryptContent(note.content, encryptionKey);
        }

        if (
          note.title.toLowerCase().includes(lowerQuery) ||
          content.toLowerCase().includes(lowerQuery)
        ) {
          results.push({ ...note, content });
        }
      }

      resolve(results);
    };
  });
}

/**
 * Save a folder
 */
export async function saveFolder(folder: Folder): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FOLDERS_STORE], 'readwrite');
    const store = transaction.objectStore(FOLDERS_STORE);
    const request = store.put({
      ...folder,
      updatedAt: Date.now(),
    });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Get all folders
 */
export async function getAllFolders(): Promise<Folder[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FOLDERS_STORE], 'readonly');
    const store = transaction.objectStore(FOLDERS_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Get folder by ID
 */
export async function getFolder(folderId: string): Promise<Folder | null> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FOLDERS_STORE], 'readonly');
    const store = transaction.objectStore(FOLDERS_STORE);
    const request = store.get(folderId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

/**
 * Delete a folder
 */
export async function deleteFolder(folderId: string): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FOLDERS_STORE], 'readwrite');
    const store = transaction.objectStore(FOLDERS_STORE);
    const request = store.delete(folderId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Get all notes (for export or backup)
 */
export async function getAllNotes(encryptionKey?: CryptoKey): Promise<Note[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE], 'readonly');
    const store = transaction.objectStore(NOTES_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const notes = request.result as Note[];
      if (encryptionKey) {
        for (const note of notes) {
          if (note.isEncrypted) {
            note.content = await decryptContent(note.content, encryptionKey);
          }
        }
      }
      resolve(notes);
    };
  });
}

/**
 * Clear all data from IndexedDB
 */
export async function clearAllData(): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE, FOLDERS_STORE], 'readwrite');
    
    const notesRequest = transaction.objectStore(NOTES_STORE).clear();
    const foldersRequest = transaction.objectStore(FOLDERS_STORE).clear();

    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}
