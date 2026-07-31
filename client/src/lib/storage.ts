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

export interface NoteVersion {
  id: string;
  noteId: string;
  title: string;
  content: string;
  createdAt: number;
  versionNumber: number;
  summary?: string;
  changeType?: 'edit' | 'auto-save' | 'restore';
  isEncrypted: boolean;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  order: number;
}

export type PermissionLevel = 'view' | 'comment' | 'edit';

export interface NoteShare {
  id: string;
  noteId: string;
  shareToken: string;
  permission: PermissionLevel;
  createdAt: number;
  expiresAt?: number;
  isActive: boolean;
  sharedWith?: string; // Email or identifier of recipient
}

export type ShareActivityType = 'created' | 'revoked' | 'viewed' | 'commented';

export interface ShareActivity {
  id: string;
  noteId: string;
  shareId: string;
  type: ShareActivityType;
  createdAt: number;
  /** Who caused it, when that is known — a comment author, for instance. */
  actor?: string;
  /** Short human-readable context, e.g. the permission a link was created with. */
  detail?: string;
}

export interface Comment {
  id: string;
  noteId: string;
  shareId: string;
  author: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  position?: number; // Character position in note
}

const DB_NAME = 'NotionAINotepad';
const DB_VERSION = 5;
const NOTES_STORE = 'notes';
const FOLDERS_STORE = 'folders';
const ENCRYPTION_KEY_STORE = 'encryptionKeys';
const DELETED_NOTES_STORE = 'deletedNotes';
const VERSIONS_STORE = 'noteVersions';
const SHARES_STORE = 'noteShares';
const COMMENTS_STORE = 'noteComments';
const SHARE_ACTIVITY_STORE = 'shareActivity';
const DELETION_RETENTION_DAYS = 30;
const DELETION_RETENTION_MS = DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const VERSION_HISTORY_LIMIT = 50;
const AUTO_SAVE_INTERVAL_MS = 5000;
const SHARE_LINK_EXPIRY_DAYS = 30;
const SHARE_LINK_EXPIRY_MS = SHARE_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

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

      // Create versions store (v3)
      if (!database.objectStoreNames.contains(VERSIONS_STORE)) {
        const versionsStore = database.createObjectStore(VERSIONS_STORE, { keyPath: 'id' });
        versionsStore.createIndex('noteId', 'noteId', { unique: false });
        versionsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Create shares store (v4)
      if (!database.objectStoreNames.contains(SHARES_STORE)) {
        const sharesStore = database.createObjectStore(SHARES_STORE, { keyPath: 'id' });
        sharesStore.createIndex('noteId', 'noteId', { unique: false });
        sharesStore.createIndex('shareToken', 'shareToken', { unique: true });
        sharesStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Create comments store (v4)
      if (!database.objectStoreNames.contains(COMMENTS_STORE)) {
        const commentsStore = database.createObjectStore(COMMENTS_STORE, { keyPath: 'id' });
        commentsStore.createIndex('noteId', 'noteId', { unique: false });
        commentsStore.createIndex('shareId', 'shareId', { unique: false });
        commentsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Create share activity store (v5)
      if (!database.objectStoreNames.contains(SHARE_ACTIVITY_STORE)) {
        const activityStore = database.createObjectStore(SHARE_ACTIVITY_STORE, { keyPath: 'id' });
        activityStore.createIndex('noteId', 'noteId', { unique: false });
        activityStore.createIndex('shareId', 'shareId', { unique: false });
        activityStore.createIndex('createdAt', 'createdAt', { unique: false });
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
export async function saveNote(
  note: Note,
  encryptionKey?: CryptoKey,
  options?: { preserveTimestamp?: boolean }
): Promise<void> {
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
      updatedAt: options?.preserveTimestamp ? note.updatedAt : Date.now(),
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
 * Create a version snapshot of a note
 */
export async function createNoteVersion(
  noteId: string,
  note: Note,
  changeType: 'edit' | 'auto-save' | 'restore' = 'edit'
): Promise<NoteVersion> {
  const database = db || (await initializeDB());

  return new Promise(async (resolve, reject) => {
    try {
      // Get existing versions to determine version number
      const versions = await getNoteVersions(noteId);
      const versionNumber = versions.length + 1;

      const versionId = `${noteId}-v${versionNumber}-${Date.now()}`;
      const version: NoteVersion = {
        id: versionId,
        noteId,
        title: note.title,
        content: note.content,
        createdAt: Date.now(),
        versionNumber,
        changeType,
        isEncrypted: note.isEncrypted,
      };

      const transaction = database.transaction([VERSIONS_STORE], 'readwrite');
      const store = transaction.objectStore(VERSIONS_STORE);
      const request = store.add(version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        // Clean up old versions if exceeding limit
        cleanupOldVersions(noteId).catch(console.error);
        resolve(version);
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Get all versions of a note
 */
export async function getNoteVersions(noteId: string): Promise<NoteVersion[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([VERSIONS_STORE], 'readonly');
    const store = transaction.objectStore(VERSIONS_STORE);
    const index = store.index('noteId');
    const request = index.getAll(noteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const versions = request.result as NoteVersion[];
      // Sort by version number descending (newest first)
      versions.sort((a, b) => b.versionNumber - a.versionNumber);
      resolve(versions);
    };
  });
}

/**
 * Get a specific version of a note
 */
export async function getNoteVersion(versionId: string): Promise<NoteVersion | null> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([VERSIONS_STORE], 'readonly');
    const store = transaction.objectStore(VERSIONS_STORE);
    const request = store.get(versionId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

/**
 * Restore a note to a previous version
 */
export async function restoreNoteVersion(
  noteId: string,
  versionId: string,
  encryptionKey?: CryptoKey
): Promise<Note | null> {
  const database = db || (await initializeDB());

  return new Promise(async (resolve, reject) => {
    try {
      const version = await getNoteVersion(versionId);
      if (!version) {
        resolve(null);
        return;
      }

      // Get current note
      const currentNote = await getNote(noteId);
      if (!currentNote) {
        resolve(null);
        return;
      }

      // Decrypt content if needed
      let content = version.content;
      if (version.isEncrypted && encryptionKey) {
        content = await decryptContent(version.content, encryptionKey);
      }

      // Update note with version content
      const restoredNote: Note = {
        ...currentNote,
        title: version.title,
        content,
        updatedAt: Date.now(),
      };

      // Save restored note
      await saveNote(restoredNote, encryptionKey);

      // Create a version snapshot marking this as a restore
      await createNoteVersion(noteId, restoredNote, 'restore');

      resolve(restoredNote);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Delete a specific version
 */
export async function deleteNoteVersion(versionId: string): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([VERSIONS_STORE], 'readwrite');
    const store = transaction.objectStore(VERSIONS_STORE);
    const request = store.delete(versionId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Clean up old versions exceeding the limit
 */
async function cleanupOldVersions(noteId: string): Promise<void> {
  const versions = await getNoteVersions(noteId);
  
  if (versions.length > VERSION_HISTORY_LIMIT) {
    // Delete oldest versions
    const versionsToDelete = versions.slice(VERSION_HISTORY_LIMIT);
    for (const version of versionsToDelete) {
      await deleteNoteVersion(version.id);
    }
  }
}

/**
 * Delete all versions of a note
 */
export async function deleteAllNoteVersions(noteId: string): Promise<void> {
  const database = db || (await initializeDB());
  const versions = await getNoteVersions(noteId);

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([VERSIONS_STORE], 'readwrite');
    const store = transaction.objectStore(VERSIONS_STORE);

    for (const version of versions) {
      store.delete(version.id);
    }

    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

/**
 * Get version statistics for a note
 */
export async function getVersionStats(noteId: string): Promise<{
  totalVersions: number;
  oldestVersion: NoteVersion | null;
  newestVersion: NoteVersion | null;
  lastModified: number;
}> {
  const versions = await getNoteVersions(noteId);

  return {
    totalVersions: versions.length,
    oldestVersion: versions.length > 0 ? versions[versions.length - 1] : null,
    newestVersion: versions.length > 0 ? versions[0] : null,
    lastModified: versions.length > 0 ? versions[0].createdAt : 0,
  };
}


/**
 * Generate a unique share token
 */
function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a share link for a note
 */
/**
 * Append an entry to a note's sharing activity log.
 *
 * Recording is best-effort: a share that was created should not fail because
 * its audit entry could not be written.
 */
export async function recordShareActivity(
  entry: Omit<ShareActivity, 'id' | 'createdAt'> & { createdAt?: number }
): Promise<ShareActivity | null> {
  const activity: ShareActivity = {
    id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: entry.createdAt ?? Date.now(),
    noteId: entry.noteId,
    shareId: entry.shareId,
    type: entry.type,
    actor: entry.actor,
    detail: entry.detail,
  };

  try {
    const database = db || (await initializeDB());
    return await new Promise<ShareActivity>((resolve, reject) => {
      const transaction = database.transaction([SHARE_ACTIVITY_STORE], 'readwrite');
      const request = transaction.objectStore(SHARE_ACTIVITY_STORE).add(activity);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(activity);
    });
  } catch (error) {
    console.warn('[Sharing] Failed to record activity:', error);
    return null;
  }
}

/**
 * Sharing activity for a note, newest first.
 */
export async function getShareActivity(noteId: string): Promise<ShareActivity[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SHARE_ACTIVITY_STORE], 'readonly');
    const index = transaction.objectStore(SHARE_ACTIVITY_STORE).index('noteId');
    const request = index.getAll(noteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve((request.result as ShareActivity[]).sort((a, b) => b.createdAt - a.createdAt));
  });
}

/**
 * Record that someone opened a share link. Kept separate from getShareByToken
 * so reading a share stays a read.
 */
export async function recordShareView(share: NoteShare): Promise<void> {
  await recordShareActivity({
    noteId: share.noteId,
    shareId: share.id,
    type: 'viewed',
  });
}

export async function createNoteShare(
  noteId: string,
  permission: PermissionLevel,
  expiryDays?: number
): Promise<NoteShare> {
  const database = db || (await initializeDB());
  const shareToken = generateShareToken();
  const share: NoteShare = {
    id: `share-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    noteId,
    shareToken,
    permission,
    createdAt: Date.now(),
    expiresAt: expiryDays ? Date.now() + expiryDays * 24 * 60 * 60 * 1000 : undefined,
    isActive: true,
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([SHARES_STORE], 'readwrite');
    const store = transaction.objectStore(SHARES_STORE);
    const request = store.add(share);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });

  await recordShareActivity({
    noteId,
    shareId: share.id,
    type: 'created',
    detail: permission,
  });

  return share;
}

/**
 * Get all shares for a note
 */
export async function getNoteShares(noteId: string): Promise<NoteShare[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SHARES_STORE], 'readonly');
    const store = transaction.objectStore(SHARES_STORE);
    const index = store.index('noteId');
    const request = index.getAll(noteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const shares = (request.result as NoteShare[]).filter(s => s.isActive);
      resolve(shares.sort((a, b) => b.createdAt - a.createdAt));
    };
  });
}

/**
 * Get share by token
 */
export async function getShareByToken(shareToken: string): Promise<NoteShare | null> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SHARES_STORE], 'readonly');
    const store = transaction.objectStore(SHARES_STORE);
    const index = store.index('shareToken');
    const request = index.get(shareToken);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const share = request.result as NoteShare | undefined;
      if (!share || !share.isActive) {
        resolve(null);
        return;
      }
      if (share.expiresAt && share.expiresAt < Date.now()) {
        resolve(null);
        return;
      }
      resolve(share);
    };
  });
}

/**
 * Revoke a share link
 */
export async function revokeShare(shareId: string): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SHARES_STORE], 'readwrite');
    const store = transaction.objectStore(SHARES_STORE);
    const request = store.get(shareId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const share = request.result as NoteShare;
      if (share) {
        share.isActive = false;
        const updateRequest = store.put(share);
        updateRequest.onerror = () => reject(updateRequest.error);
        updateRequest.onsuccess = () => {
          void recordShareActivity({
            noteId: share.noteId,
            shareId: share.id,
            type: 'revoked',
            detail: share.permission,
          }).then(() => resolve(), () => resolve());
        };
      } else {
        resolve();
      }
    };
  });
}

/**
 * Add a comment to a shared note
 */
export async function addComment(
  noteId: string,
  shareId: string,
  author: string,
  content: string,
  position?: number
): Promise<Comment> {
  const database = db || (await initializeDB());
  const comment: Comment = {
    id: `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    noteId,
    shareId,
    author,
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    position,
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([COMMENTS_STORE], 'readwrite');
    const store = transaction.objectStore(COMMENTS_STORE);
    const request = store.add(comment);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });

  await recordShareActivity({
    noteId,
    shareId,
    type: 'commented',
    actor: author,
    detail: content.slice(0, 80),
  });

  return comment;
}

/**
 * Get comments for a note
 */
export async function getNoteComments(noteId: string): Promise<Comment[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([COMMENTS_STORE], 'readonly');
    const store = transaction.objectStore(COMMENTS_STORE);
    const index = store.index('noteId');
    const request = index.getAll(noteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const comments = (request.result as Comment[]).sort((a, b) => b.createdAt - a.createdAt);
      resolve(comments);
    };
  });
}

/**
 * Get comments for a specific share
 */
export async function getShareComments(shareId: string): Promise<Comment[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([COMMENTS_STORE], 'readonly');
    const store = transaction.objectStore(COMMENTS_STORE);
    const index = store.index('shareId');
    const request = index.getAll(shareId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const comments = (request.result as Comment[]).sort((a, b) => b.createdAt - a.createdAt);
      resolve(comments);
    };
  });
}

/**
 * Delete a comment
 */
export async function deleteComment(commentId: string): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([COMMENTS_STORE], 'readwrite');
    const store = transaction.objectStore(COMMENTS_STORE);
    const request = store.delete(commentId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
