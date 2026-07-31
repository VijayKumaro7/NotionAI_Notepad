import { useEffect, useState, useCallback, useRef } from 'react';
import { nanoid } from 'nanoid';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { encryptNotePayload, decryptRemoteNotes, mergeNotes } from '@/lib/syncService';
import {
  Note,
  Folder,
  initializeDB,
  getOrCreateEncryptionKey,
  saveNote,
  getNote,
  getNotesByFolder,
  deleteNote,
  searchNotes,
  getAllNotes,
  getNotesByTag,
  saveFolder,
  getAllFolders,
  getFolder,
  deleteFolder,
  getDeletedNotes,
  restoreNote,
  permanentlyDeleteNote,
  cleanupExpiredDeletedNotes,
  createNoteVersion,
} from '@/lib/storage';

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  const [deletedNotes, setDeletedNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const lastSnapshotRef = useRef<{ noteId: string; content: string } | null>(null);

  // End-to-end encrypted sync — notes are encrypted with the local key before
  // upload; the server only stores opaque blobs. Sync is best-effort: failures
  // are logged and never block local-first behavior.
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const syncRef = useRef({ isAuthenticated, client: utils.client });
  syncRef.current = { isAuthenticated, client: utils.client };
  const initialSyncDone = useRef(false);

  const pushNoteToServer = useCallback(async (note: Note, key: CryptoKey) => {
    const { isAuthenticated: authed, client } = syncRef.current;
    if (!authed) return;
    try {
      const payload = await encryptNotePayload(note, key);
      await client.notes.push.mutate({ clientId: note.id, payload });
    } catch (err) {
      console.warn('[Sync] Failed to push note:', err);
    }
  }, []);

  const pushDeletionToServer = useCallback(async (noteId: string) => {
    const { isAuthenticated: authed, client } = syncRef.current;
    if (!authed) return;
    try {
      await client.notes.push.mutate({
        clientId: noteId,
        deleted: true,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.warn('[Sync] Failed to push deletion:', err);
    }
  }, []);

  // Load all unique tags from non-deleted notes
  const loadAvailableTags = useCallback(async () => {
    try {
      const allNotes = await getAllNotes();
      const tagSet = new Set<string>();
      for (const note of allNotes) {
        if (!note.isDeleted) {
          for (const tag of note.tags) {
            tagSet.add(tag);
          }
        }
      }
      setAvailableTags(Array.from(tagSet).sort());
    } catch (err) {
      // Non-critical, silently ignore
    }
  }, []);

  // Load deleted notes
  const loadDeletedNotes = useCallback(async () => {
    try {
      const deleted = await getDeletedNotes(encryptionKey || undefined);
      setDeletedNotes(deleted);
      // Clean up expired deleted notes
      await cleanupExpiredDeletedNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deleted notes');
    }
  }, [encryptionKey]);

  // Initialize database and encryption
  useEffect(() => {
    const initialize = async () => {
      try {
        await initializeDB();
        
        // Get or create encryption key (using a simple user ID for now)
        const userId = 'default-user';
        const key = await getOrCreateEncryptionKey(userId);
        setEncryptionKey(key);

        // Load initial data
        const loadedFolders = await getAllFolders();
        setFolders(loadedFolders);

        // Create default folder if none exist
        if (loadedFolders.length === 0) {
          const defaultFolder: Folder = {
            id: nanoid(),
            name: 'My Notes',
            parentId: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            order: 0,
          };
          await saveFolder(defaultFolder);
          setFolders([defaultFolder]);
        }

        // Load deleted notes
        await loadDeletedNotes();
        // Load available tags
        await loadAvailableTags();
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
        setIsLoading(false);
      }
    };

    initialize();
  }, [loadDeletedNotes, loadAvailableTags]);

  // Auto-save current note
  useEffect(() => {
    if (!currentNote || !encryptionKey) return;

    // Clear existing timer
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }

    // Set new timer for auto-save (2 seconds after last change)
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await saveNote(currentNote, encryptionKey);
        setNotes((prevNotes) =>
          prevNotes.map((n) => (n.id === currentNote.id ? currentNote : n))
        );

        // Snapshot a version when the content actually changed since the last snapshot
        const last = lastSnapshotRef.current;
        if (!last || last.noteId !== currentNote.id || last.content !== currentNote.content) {
          await createNoteVersion(currentNote.id, currentNote, 'auto-save');
          lastSnapshotRef.current = { noteId: currentNote.id, content: currentNote.content };
        }

        pushNoteToServer(currentNote, encryptionKey);
        await loadAvailableTags();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to auto-save');
      }
    }, 2000);

    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
    };
  }, [currentNote, encryptionKey, pushNoteToServer, loadAvailableTags]);

  // Initial end-to-end encrypted sync: pull remote blobs, decrypt locally,
  // merge last-write-wins, then persist and upload the winners.
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  useEffect(() => {
    if (!encryptionKey || !isAuthenticated || isLoading || initialSyncDone.current) {
      return;
    }
    initialSyncDone.current = true;

    const runInitialSync = async () => {
      const { client } = syncRef.current;
      try {
        const rows = await client.notes.pull.query();
        const remote = await decryptRemoteNotes(rows, encryptionKey);
        const local = await getAllNotes(encryptionKey);
        const plan = mergeNotes(local, remote);

        const localFolderIds = new Set(foldersRef.current.map((f) => f.id));
        const fallbackFolderId = foldersRef.current[0]?.id;

        for (const note of plan.saveLocal) {
          const folderId =
            localFolderIds.has(note.folderId) || !fallbackFolderId
              ? note.folderId
              : fallbackFolderId;
          await saveNote({ ...note, folderId }, encryptionKey, { preserveTimestamp: true });
        }
        for (const id of plan.deleteLocal) {
          await deleteNote(id);
        }
        for (const note of plan.push) {
          await pushNoteToServer(note, encryptionKey);
        }

        if (
          (plan.saveLocal.length > 0 || plan.deleteLocal.length > 0) &&
          foldersRef.current.length > 0
        ) {
          const refreshed = await getNotesByFolder(foldersRef.current[0].id, encryptionKey);
          setNotes(refreshed);
        }
      } catch (err) {
        console.warn('[Sync] Initial sync failed:', err);
      }
    };

    runInitialSync();
  }, [encryptionKey, isAuthenticated, isLoading, pushNoteToServer]);

  // Create new note
  const createNote = useCallback(
    async (folderId: string, title: string = 'Untitled Note') => {
      const newNote: Note = {
        id: nanoid(),
        title,
        content: '',
        folderId,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: Date.now(),
      };

      try {
        if (encryptionKey) {
          await saveNote(newNote, encryptionKey);
          pushNoteToServer(newNote, encryptionKey);
        }
        setNotes((prev) => [...prev, newNote]);
        setCurrentNote(newNote);
        return newNote;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create note');
        throw err;
      }
    },
    [encryptionKey, pushNoteToServer]
  );

  // Update current note
  const updateCurrentNote = useCallback((updates: Partial<Note>) => {
    setCurrentNote((prev) => {
      if (!prev) return null;
      return { ...prev, ...updates, updatedAt: Date.now() };
    });
  }, []);

  // Load note by ID
  const loadNote = useCallback(
    async (noteId: string) => {
      try {
        const note = await getNote(noteId, encryptionKey || undefined);
        if (note) {
          setCurrentNote(note);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load note');
      }
    },
    [encryptionKey]
  );

  // Load notes by folder
  const loadNotesByFolder = useCallback(
    async (folderId: string) => {
      try {
        const folderNotes = await getNotesByFolder(folderId, encryptionKey || undefined);
        setNotes(folderNotes);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notes');
      }
    },
    [encryptionKey]
  );

  // Delete note (soft delete)
  const removeNote = useCallback(
    async (noteId: string) => {
      try {
        await deleteNote(noteId);
        pushDeletionToServer(noteId);
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        if (currentNote?.id === noteId) {
          setCurrentNote(null);
        }
        // Reload deleted notes
        await loadDeletedNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete note');
      }
    },
    [currentNote, loadDeletedNotes, pushDeletionToServer]
  );

  // Search notes
  const performSearch = useCallback(
    async (query: string) => {
      try {
        const results = await searchNotes(query, encryptionKey || undefined);
        setNotes(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to search notes');
      }
    },
    [encryptionKey]
  );

  // Filter notes by tag
  const filterByTag = useCallback(
    async (tag: string | null) => {
      setActiveTagFilter(tag);
      if (!tag) {
        // Clear filter: reload notes from first folder
        if (folders.length > 0) {
          const folderNotes = await getNotesByFolder(folders[0].id, encryptionKey || undefined);
          setNotes(folderNotes);
        }
        return;
      }
      try {
        const results = await getNotesByTag(tag, encryptionKey || undefined);
        setNotes(results.filter((n) => !n.isDeleted));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to filter by tag');
      }
    },
    [encryptionKey, folders]
  );

  // Create folder
  const createFolder = useCallback(async (name: string, parentId: string | null = null) => {
    const newFolder: Folder = {
      id: nanoid(),
      name,
      parentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: Date.now(),
    };

    try {
      await saveFolder(newFolder);
      setFolders((prev) => [...prev, newFolder]);
      return newFolder;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
      throw err;
    }
  }, []);

  // Update folder
  const updateFolder = useCallback(async (folderId: string, updates: Partial<Folder>) => {
    try {
      const folder = await getFolder(folderId);
      if (folder) {
        const updated = { ...folder, ...updates, updatedAt: Date.now() };
        await saveFolder(updated);
        setFolders((prev) =>
          prev.map((f) => (f.id === folderId ? updated : f))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update folder');
    }
  }, []);

  // Delete folder
  const removeFolder = useCallback(async (folderId: string) => {
    try {
      await deleteFolder(folderId);
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete folder');
    }
  }, []);

  // Get all notes for export
  const getAllNotesForExport = useCallback(async () => {
    try {
      return await getAllNotes(encryptionKey || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get notes');
      return [];
    }
  }, [encryptionKey]);

  // Restore a deleted note
  const restoreDeletedNote = useCallback(
    async (noteId: string) => {
      try {
        await restoreNote(noteId, encryptionKey || undefined);
        // Reload deleted notes
        await loadDeletedNotes();
        // Reload active notes
        if (folders.length > 0) {
          await loadNotesByFolder(folders[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to restore note');
        throw err;
      }
    },
    [encryptionKey, loadDeletedNotes, folders, loadNotesByFolder]
  );

  // Permanently delete a note
  const permanentlyDelete = useCallback(
    async (noteId: string) => {
      try {
        await permanentlyDeleteNote(noteId);
        // Reload deleted notes
        await loadDeletedNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to permanently delete note');
        throw err;
      }
    },
    [loadDeletedNotes]
  );

  return {
    notes,
    folders,
    currentNote,
    deletedNotes,
    isLoading,
    error,
    encryptionKey,
    availableTags,
    activeTagFilter,
    setNotes,
    setFolders,
    createNote,
    updateCurrentNote,
    loadNote,
    loadNotesByFolder,
    removeNote,
    performSearch,
    filterByTag,
    createFolder,
    updateFolder,
    removeFolder,
    getAllNotesForExport,
    loadDeletedNotes,
    restoreDeletedNote,
    permanentlyDelete,
  };
}
