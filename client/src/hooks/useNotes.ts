import { useEffect, useState, useCallback, useRef } from 'react';
import { nanoid } from 'nanoid';
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
  saveFolder,
  getAllFolders,
  getFolder,
  deleteFolder,
} from '@/lib/storage';

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);

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

        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
        setIsLoading(false);
      }
    };

    initialize();
  }, []);

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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to auto-save');
      }
    }, 2000);

    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
    };
  }, [currentNote, encryptionKey]);

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
        }
        setNotes((prev) => [...prev, newNote]);
        setCurrentNote(newNote);
        return newNote;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create note');
        throw err;
      }
    },
    [encryptionKey]
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

  // Delete note
  const removeNote = useCallback(async (noteId: string) => {
    try {
      await deleteNote(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      if (currentNote?.id === noteId) {
        setCurrentNote(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete note');
    }
  }, [currentNote]);

  // Search notes
  const performSearch = useCallback(
    async (query: string) => {
      try {
        const results = await searchNotes(query, encryptionKey || undefined);
        setNotes(results);
        return results;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to search');
        return [];
      }
    },
    [encryptionKey]
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

  return {
    notes,
    folders,
    currentNote,
    isLoading,
    error,
    encryptionKey,
    setNotes,
    setFolders,
    createNote,
    updateCurrentNote,
    loadNote,
    loadNotesByFolder,
    removeNote,
    performSearch,
    createFolder,
    updateFolder,
    removeFolder,
    getAllNotesForExport,
  };
}
