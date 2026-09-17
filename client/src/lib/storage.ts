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
  changeType?: "edit" | "auto-save" | "restore";
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

export type PermissionLevel = "view" | "comment" | "edit";

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

export type ShareActivityType = "created" | "revoked" | "viewed" | "commented";

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

export const DB_NAME = "NotionAINotepad";

/**
 * Which key the browser's single local account uses.
 *
 * A constant rather than a literal repeated at each call site, because the
 * encryption key is stored under this id: a caller that spells it differently
 * does not fail, it silently gets a *different* key — and the one place that
 * would bite hardest is the panel that shows someone their recovery phrase,
 * which would hand them a working phrase for the wrong key.
 */
export const LOCAL_KEY_ID = "default-user";
const DB_VERSION = 5;
const NOTES_STORE = "notes";
const FOLDERS_STORE = "folders";
const ENCRYPTION_KEY_STORE = "encryptionKeys";
const DELETED_NOTES_STORE = "deletedNotes";
const VERSIONS_STORE = "noteVersions";
const SHARES_STORE = "noteShares";
const COMMENTS_STORE = "noteComments";
const SHARE_ACTIVITY_STORE = "shareActivity";
const DELETION_RETENTION_DAYS = 30;
const DELETION_RETENTION_MS = DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const VERSION_HISTORY_LIMIT = 50;
const AUTO_SAVE_INTERVAL_MS = 5000;
const SHARE_LINK_EXPIRY_DAYS = 30;
const SHARE_LINK_EXPIRY_MS = SHARE_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

let db: IDBDatabase | null = null;

/**
 * Let go of the cached connection.
 *
 * deleteDatabase does not force open connections shut — it waits for them, and
 * fires `blocked` instead if one of them is this module's own. Anything that
 * means to delete the database has to come through here first.
 */
export function closeDB(): void {
  db?.close();
  db = null;
}

/**
 * Adapt an async body to an IndexedDB event handler.
 *
 * IndexedDB invokes handlers and ignores what they return, so an `async`
 * handler that throws has nowhere to send the failure. Two things went wrong at
 * once: the rejection escaped as an unhandled promise rejection, and the
 * surrounding promise — the one the handler was supposed to resolve — stayed
 * pending forever, so every caller awaiting it hung.
 *
 * That is not hypothetical. Opening a note with a key that cannot decrypt it
 * (a second profile, a rotated key, a corrupted record) threw inside the
 * handler, and the editor waited on a promise that could never settle.
 *
 * Routing the failure into `reject` turns a permanent hang into an error the
 * caller can report.
 */
function rejectOnThrow(
  reject: (reason?: unknown) => void,
  body: () => Promise<void>
): () => void {
  return () => void body().catch(reject);
}

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

    request.onupgradeneeded = event => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create notes store
      if (!database.objectStoreNames.contains(NOTES_STORE)) {
        const notesStore = database.createObjectStore(NOTES_STORE, {
          keyPath: "id",
        });
        notesStore.createIndex("folderId", "folderId", { unique: false });
        notesStore.createIndex("tags", "tags", {
          unique: false,
          multiEntry: true,
        });
        notesStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      // Create folders store
      if (!database.objectStoreNames.contains(FOLDERS_STORE)) {
        const foldersStore = database.createObjectStore(FOLDERS_STORE, {
          keyPath: "id",
        });
        foldersStore.createIndex("parentId", "parentId", { unique: false });
      }

      // Create encryption keys store
      if (!database.objectStoreNames.contains(ENCRYPTION_KEY_STORE)) {
        database.createObjectStore(ENCRYPTION_KEY_STORE, { keyPath: "id" });
      }

      // Create deleted notes store (v2)
      if (!database.objectStoreNames.contains(DELETED_NOTES_STORE)) {
        const deletedNotesStore = database.createObjectStore(
          DELETED_NOTES_STORE,
          { keyPath: "id" }
        );
        deletedNotesStore.createIndex("deletedAt", "deletedAt", {
          unique: false,
        });
      }

      // Create versions store (v3)
      if (!database.objectStoreNames.contains(VERSIONS_STORE)) {
        const versionsStore = database.createObjectStore(VERSIONS_STORE, {
          keyPath: "id",
        });
        versionsStore.createIndex("noteId", "noteId", { unique: false });
        versionsStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      // Create shares store (v4)
      if (!database.objectStoreNames.contains(SHARES_STORE)) {
        const sharesStore = database.createObjectStore(SHARES_STORE, {
          keyPath: "id",
        });
        sharesStore.createIndex("noteId", "noteId", { unique: false });
        sharesStore.createIndex("shareToken", "shareToken", { unique: true });
        sharesStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      // Create comments store (v4)
      if (!database.objectStoreNames.contains(COMMENTS_STORE)) {
        const commentsStore = database.createObjectStore(COMMENTS_STORE, {
          keyPath: "id",
        });
        commentsStore.createIndex("noteId", "noteId", { unique: false });
        commentsStore.createIndex("shareId", "shareId", { unique: false });
        commentsStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      // Create share activity store (v5)
      if (!database.objectStoreNames.contains(SHARE_ACTIVITY_STORE)) {
        const activityStore = database.createObjectStore(SHARE_ACTIVITY_STORE, {
          keyPath: "id",
        });
        activityStore.createIndex("noteId", "noteId", { unique: false });
        activityStore.createIndex("shareId", "shareId", { unique: false });
        activityStore.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
  });
}

/**
 * Get or create encryption key for the user
 */
export async function getOrCreateEncryptionKey(
  userId: string
): Promise<CryptoKey> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [ENCRYPTION_KEY_STORE],
      "readonly"
    );
    const store = transaction.objectStore(ENCRYPTION_KEY_STORE);
    const request = store.get(userId);

    request.onerror = () => reject(request.error);
    request.onsuccess = rejectOnThrow(reject, async () => {
      if (request.result) {
        // Key exists, import it
        const keyData = request.result.keyData;
        const key = await crypto.subtle.importKey(
          "raw",
          new Uint8Array(keyData),
          { name: "AES-GCM" },
          false,
          ["encrypt", "decrypt"]
        );
        resolve(key);
      } else {
        // Generate new key
        const key = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"]
        );

        // Export and store the key
        const exportedKey = await crypto.subtle.exportKey("raw", key);
        const transaction = database.transaction(
          [ENCRYPTION_KEY_STORE],
          "readwrite"
        );
        const store = transaction.objectStore(ENCRYPTION_KEY_STORE);
        store.put({
          id: userId,
          keyData: Array.from(new Uint8Array(exportedKey)),
          createdAt: Date.now(),
        });

        resolve(key);
      }
    });
  });
}

/**
 * Encrypt text content using AES-GCM
 */
export async function encryptContent(
  content: string,
  key: CryptoKey
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return bytesToBase64(combined);
}

/**
 * Bytes to base64, in chunks.
 *
 * `String.fromCharCode(...bytes)` passes one argument per byte, so it throws
 * RangeError once the array outgrows the engine's argument limit. Measured on
 * node 22: fine at 100KB, "Maximum call stack size exceeded" at 128KB. That is
 * not an exotic size — it is a long note, and a cloud backup of a whole
 * workspace passes it easily, which made both fail with nothing more useful
 * than "Failed to auto-save".
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += CHUNK) {
    // apply, not spread: the tsconfig target predates iterating a typed array.
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK))
    );
  }

  return btoa(binary);
}

/**
 * Decrypt text content
 */
export async function decryptContent(
  encryptedContent: string,
  key: CryptoKey
): Promise<string> {
  try {
    const combined = new Uint8Array(
      Array.from(atob(encryptedContent), c => c.charCodeAt(0))
    );
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error("Failed to decrypt content");
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
    const transaction = database.transaction([NOTES_STORE], "readwrite");
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
export async function getNote(
  noteId: string,
  encryptionKey?: CryptoKey
): Promise<Note | null> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE], "readonly");
    const store = transaction.objectStore(NOTES_STORE);
    const request = store.get(noteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = rejectOnThrow(reject, async () => {
      if (!request.result) {
        resolve(null);
        return;
      }

      const note = request.result;
      if (note.isEncrypted && encryptionKey) {
        note.content = await decryptContent(note.content, encryptionKey);
      }
      resolve(note);
    });
  });
}

/**
 * Get all notes in a folder
 */
export async function getNotesByFolder(
  folderId: string,
  encryptionKey?: CryptoKey
): Promise<Note[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE], "readonly");
    const store = transaction.objectStore(NOTES_STORE);
    const index = store.index("folderId");
    const request = index.getAll(folderId);

    request.onerror = () => reject(request.error);
    request.onsuccess = rejectOnThrow(reject, async () => {
      const notes = request.result as Note[];
      if (encryptionKey) {
        for (const note of notes) {
          if (note.isEncrypted) {
            note.content = await decryptContent(note.content, encryptionKey);
          }
        }
      }
      resolve(notes);
    });
  });
}

/**
 * Get notes by tags
 */
export async function getNotesByTag(
  tag: string,
  encryptionKey?: CryptoKey
): Promise<Note[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE], "readonly");
    const store = transaction.objectStore(NOTES_STORE);
    const index = store.index("tags");
    const request = index.getAll(tag);

    request.onerror = () => reject(request.error);
    request.onsuccess = rejectOnThrow(reject, async () => {
      const notes = request.result as Note[];
      if (encryptionKey) {
        for (const note of notes) {
          if (note.isEncrypted) {
            note.content = await decryptContent(note.content, encryptionKey);
          }
        }
      }
      resolve(notes);
    });
  });
}

/**
 * Soft delete a note (move to Recently Deleted)
 */
export async function deleteNote(noteId: string): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [NOTES_STORE, DELETED_NOTES_STORE],
      "readwrite"
    );

    // Get the note first
    const notesStore = transaction.objectStore(NOTES_STORE);
    const getRequest = notesStore.get(noteId);

    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => {
      const note = getRequest.result;
      if (!note) {
        reject(new Error("Note not found"));
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
export async function getDeletedNotes(
  encryptionKey?: CryptoKey
): Promise<Note[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DELETED_NOTES_STORE], "readonly");
    const store = transaction.objectStore(DELETED_NOTES_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = rejectOnThrow(reject, async () => {
      let notes = request.result as Note[];

      // Filter out notes older than 30 days
      const now = Date.now();
      notes = notes.filter(note => {
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
    });
  });
}

/**
 * Restore a deleted note
 */
export async function restoreNote(
  noteId: string,
  encryptionKey?: CryptoKey
): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [NOTES_STORE, DELETED_NOTES_STORE],
      "readwrite"
    );

    // Get the deleted note
    const deletedNotesStore = transaction.objectStore(DELETED_NOTES_STORE);
    const getRequest = deletedNotesStore.get(noteId);

    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => {
      const note = getRequest.result;
      if (!note) {
        reject(new Error("Deleted note not found"));
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
    const transaction = database.transaction(
      [DELETED_NOTES_STORE],
      "readwrite"
    );
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
    const transaction = database.transaction(
      [DELETED_NOTES_STORE],
      "readwrite"
    );
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
export async function searchNotes(
  query: string,
  encryptionKey?: CryptoKey
): Promise<Note[]> {
  const database = db || (await initializeDB());
  const lowerQuery = query.toLowerCase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([NOTES_STORE], "readonly");
    const store = transaction.objectStore(NOTES_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = rejectOnThrow(reject, async () => {
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
    });
  });
}

/**
 * Save a folder
 */
export async function saveFolder(folder: Folder): Promise<void> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FOLDERS_STORE], "readwrite");
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
    const transaction = database.transaction([FOLDERS_STORE], "readonly");
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
    const transaction = database.transaction([FOLDERS_STORE], "readonly");
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
    const transaction = database.transaction([FOLDERS_STORE], "readwrite");
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
    const transaction = database.transaction([NOTES_STORE], "readonly");
    const store = transaction.objectStore(NOTES_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = rejectOnThrow(reject, async () => {
      const notes = request.result as Note[];
      if (encryptionKey) {
        for (const note of notes) {
          if (note.isEncrypted) {
            note.content = await decryptContent(note.content, encryptionKey);
          }
        }
      }
      resolve(notes);
    });
  });
}

/**
 * Create a version snapshot of a note
 */
export async function createNoteVersion(
  noteId: string,
  note: Note,
  changeType: "edit" | "auto-save" | "restore" = "edit",
  encryptionKey?: CryptoKey
): Promise<NoteVersion> {
  const database = db || (await initializeDB());

  return new Promise(async (resolve, reject) => {
    try {
      // Get existing versions to determine version number
      const versions = await getNoteVersions(noteId);
      const versionNumber = versions.length + 1;

      // Encrypted here rather than trusted from the caller, and the flag is set
      // from what actually happened rather than copied off the note.
      //
      // Copying it is what made version history the one place note bodies were
      // readable at rest. `note` is the in-memory note — plaintext content
      // carrying `isEncrypted: true` from the record it was loaded out of — so
      // every autosave wrote the note's words into IndexedDB under a flag
      // claiming otherwise, and `restoreNoteVersion` then tried to decrypt
      // plaintext and threw. The bug and the broken restore were the same line.
      const content = encryptionKey
        ? await encryptContent(note.content, encryptionKey)
        : note.content;

      const versionId = `${noteId}-v${versionNumber}-${Date.now()}`;
      const version: NoteVersion = {
        id: versionId,
        noteId,
        title: note.title,
        content,
        createdAt: Date.now(),
        versionNumber,
        changeType,
        isEncrypted: Boolean(encryptionKey),
      };

      const transaction = database.transaction([VERSIONS_STORE], "readwrite");
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
    const transaction = database.transaction([VERSIONS_STORE], "readonly");
    const store = transaction.objectStore(VERSIONS_STORE);
    const index = store.index("noteId");
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
export async function getNoteVersion(
  versionId: string
): Promise<NoteVersion | null> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([VERSIONS_STORE], "readonly");
    const store = transaction.objectStore(VERSIONS_STORE);
    const request = store.get(versionId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

/**
 * Could this string have come out of `encryptContent`?
 *
 * Used to avoid attempting a decryption that is certain to fail. Version rows
 * written before snapshots were encrypted are plaintext flagged as encrypted,
 * and feeding each one to `crypto.subtle.decrypt` works — it throws, and the
 * caller falls back — but `decryptContent` logs every failure, so opening the
 * history of an old note would fill the console with errors that are not
 * errors and bury the ones that are.
 *
 * Deliberately a shape check and not a guarantee: base64 of at least a 12-byte
 * nonce plus a 16-byte tag. Something plausible that is not actually ciphertext
 * still fails the real decryption below, which is the part that decides.
 */
function looksLikeCiphertext(content: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(content) && content.length >= 40;
}

/**
 * The text of a snapshot, or null if this browser cannot read it.
 *
 * Lenient in one direction and strict in the other, and the asymmetry is the
 * point.
 *
 * Lenient about plaintext: snapshots are encrypted now, but the rows already in
 * people's browsers are not, and they are real writing — the drafts someone
 * opens version history to get back. Dropping them, or refusing to read them,
 * would turn a privacy bug into data loss while fixing it.
 *
 * Strict about ciphertext it cannot open: that returns null rather than the
 * raw base64. A snapshot written under a different key is not text, and the
 * caller that mattered here is `restoreNoteVersion` — handing it gibberish
 * would write base64 over a perfectly good note and call it a restore.
 */
export async function readVersionContent(
  version: NoteVersion,
  encryptionKey?: CryptoKey
): Promise<string | null> {
  if (!version.isEncrypted || !encryptionKey) return version.content;
  if (!looksLikeCiphertext(version.content)) return version.content;

  try {
    return await decryptContent(version.content, encryptionKey);
  } catch {
    // Flagged encrypted, shaped like ciphertext, and not openable with this
    // key: a snapshot from another device, or from before the key was replaced.
    return null;
  }
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

      const content = await readVersionContent(version, encryptionKey);

      // Refuse rather than restore something unreadable. Writing the raw
      // ciphertext back would replace a working note with base64 and report
      // success — the restore button's original bug, arriving by a new route.
      if (content === null) {
        resolve(null);
        return;
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
      await createNoteVersion(noteId, restoredNote, "restore", encryptionKey);

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
    const transaction = database.transaction([VERSIONS_STORE], "readwrite");
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
    const transaction = database.transaction([VERSIONS_STORE], "readwrite");
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
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
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
  entry: Omit<ShareActivity, "id" | "createdAt"> & { createdAt?: number }
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
      const transaction = database.transaction(
        [SHARE_ACTIVITY_STORE],
        "readwrite"
      );
      const request = transaction
        .objectStore(SHARE_ACTIVITY_STORE)
        .add(activity);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(activity);
    });
  } catch (error) {
    console.warn("[Sharing] Failed to record activity:", error);
    return null;
  }
}

/**
 * Sharing activity for a note, newest first.
 */
export async function getShareActivity(
  noteId: string
): Promise<ShareActivity[]> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [SHARE_ACTIVITY_STORE],
      "readonly"
    );
    const index = transaction.objectStore(SHARE_ACTIVITY_STORE).index("noteId");
    const request = index.getAll(noteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve(
        (request.result as ShareActivity[]).sort(
          (a, b) => b.createdAt - a.createdAt
        )
      );
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
    type: "viewed",
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
    expiresAt: expiryDays
      ? Date.now() + expiryDays * 24 * 60 * 60 * 1000
      : undefined,
    isActive: true,
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([SHARES_STORE], "readwrite");
    const store = transaction.objectStore(SHARES_STORE);
    const request = store.add(share);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });

  await recordShareActivity({
    noteId,
    shareId: share.id,
    type: "created",
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
    const transaction = database.transaction([SHARES_STORE], "readonly");
    const store = transaction.objectStore(SHARES_STORE);
    const index = store.index("noteId");
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
export async function getShareByToken(
  shareToken: string
): Promise<NoteShare | null> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SHARES_STORE], "readonly");
    const store = transaction.objectStore(SHARES_STORE);
    const index = store.index("shareToken");
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
    const transaction = database.transaction([SHARES_STORE], "readwrite");
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
            type: "revoked",
            detail: share.permission,
          }).then(
            () => resolve(),
            () => resolve()
          );
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
    const transaction = database.transaction([COMMENTS_STORE], "readwrite");
    const store = transaction.objectStore(COMMENTS_STORE);
    const request = store.add(comment);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });

  await recordShareActivity({
    noteId,
    shareId,
    type: "commented",
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
    const transaction = database.transaction([COMMENTS_STORE], "readonly");
    const store = transaction.objectStore(COMMENTS_STORE);
    const index = store.index("noteId");
    const request = index.getAll(noteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const comments = (request.result as Comment[]).sort(
        (a, b) => b.createdAt - a.createdAt
      );
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
    const transaction = database.transaction([COMMENTS_STORE], "readonly");
    const store = transaction.objectStore(COMMENTS_STORE);
    const index = store.index("shareId");
    const request = index.getAll(shareId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const comments = (request.result as Comment[]).sort(
        (a, b) => b.createdAt - a.createdAt
      );
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
    const transaction = database.transaction([COMMENTS_STORE], "readwrite");
    const store = transaction.objectStore(COMMENTS_STORE);
    const request = store.delete(commentId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/* -------------------------------------------------------------------------- *
 * Carrying the key to another device
 *
 * The key is generated per browser and stored raw in IndexedDB, which is what
 * makes the server unable to read anything — and what makes a second device
 * show an empty workspace next to a server full of notes. These three
 * functions are the way across: read the bytes out, put different bytes in,
 * and re-encrypt what this device already holds so that installing a key does
 * not orphan the notes written before it.
 * -------------------------------------------------------------------------- */

/**
 * The raw key bytes for this account, or null if none has been made yet.
 *
 * Read straight out of the store rather than via `crypto.subtle.exportKey`,
 * because the CryptoKey this module hands out is deliberately created
 * non-extractable — the bytes are already here, and making the live key
 * exportable just to read them would weaken every other use of it.
 */
export async function readEncryptionKeyBytes(
  userId: string
): Promise<Uint8Array | null> {
  const database = db || (await initializeDB());

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [ENCRYPTION_KEY_STORE],
      "readonly"
    );
    const request = transaction.objectStore(ENCRYPTION_KEY_STORE).get(userId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const stored = request.result;
      resolve(stored ? new Uint8Array(stored.keyData) : null);
    };
  });
}

/**
 * Put different key bytes in, and return the key they make.
 *
 * Does not touch any note: re-encrypting is `reEncryptLocalContent`, and the
 * caller runs it in between reading the old key and calling this so that a
 * failure partway leaves something recoverable rather than a store full of
 * content encrypted under a key no longer written down anywhere.
 */
export async function replaceEncryptionKey(
  userId: string,
  keyBytes: Uint8Array
): Promise<CryptoKey> {
  if (keyBytes.length !== 32) {
    throw new Error("An encryption key is 32 bytes.");
  }

  const database = db || (await initializeDB());

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [ENCRYPTION_KEY_STORE],
      "readwrite"
    );
    const request = transaction.objectStore(ENCRYPTION_KEY_STORE).put({
      id: userId,
      keyData: Array.from(keyBytes),
      createdAt: Date.now(),
    });

    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export type ReEncryptSummary = {
  /** Records read with the old key and written back with the new one. */
  converted: number;
  /**
   * Records the old key could not open, left byte-for-byte as they were.
   *
   * Almost always content that arrived from the device the new key came from —
   * which the new key is about to be able to read. Overwriting or dropping
   * these would destroy exactly the notes this feature exists to recover.
   */
  leftAlone: number;
};

/** Every store whose records carry content sealed with the encryption key. */
const ENCRYPTED_STORES = [
  NOTES_STORE,
  DELETED_NOTES_STORE,
  VERSIONS_STORE,
] as const;

/**
 * Move everything this device holds from one key to another.
 *
 * Needed because installing a key is not additive. A device that has been used
 * has notes sealed with the key it generated for itself; swapping that key
 * without doing this leaves them as ciphertext nobody can open, which is the
 * same as deleting them while appearing to succeed.
 *
 * A record the old key cannot open is left exactly as it is rather than
 * skipped-and-forgotten: it is counted and reported, because the honest thing
 * to tell someone is how much moved and how much did not.
 */
export async function reEncryptLocalContent(
  oldKey: CryptoKey,
  newKey: CryptoKey
): Promise<ReEncryptSummary> {
  const database = db || (await initializeDB());
  let converted = 0;
  let leftAlone = 0;

  for (const storeName of ENCRYPTED_STORES) {
    const records = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        const request = database
          .transaction([storeName], "readonly")
          .objectStore(storeName)
          .getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result ?? []);
      }
    );

    const rewritten: Record<string, unknown>[] = [];

    for (const record of records) {
      if (!record.isEncrypted || typeof record.content !== "string") continue;

      let plaintext: string;
      try {
        plaintext = await decryptContent(record.content, oldKey);
      } catch {
        leftAlone++;
        continue;
      }

      rewritten.push({
        ...record,
        content: await encryptContent(plaintext, newKey),
      });
    }

    if (rewritten.length === 0) continue;

    // One transaction per store, after all the crypto for it is done. An
    // IndexedDB transaction closes the moment it yields to something that is
    // not an IndexedDB request, and `await crypto.subtle.encrypt` inside one
    // is exactly that — the writes would fail with TransactionInactiveError
    // partway through, leaving half the store on each key.
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);

      for (const record of rewritten) store.put(record);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    converted += rewritten.length;
  }

  return { converted, leftAlone };
}
