import { useCallback } from 'react';
import { Note, Folder, saveNote, saveFolder } from '@/lib/storage';
import { reorderItems, calculateNewOrder, moveNoteToFolder } from '@/lib/dragDropUtils';

export interface UseDragDropProps {
  notes: Note[];
  folders: Folder[];
  encryptionKey: CryptoKey | null;
  onNotesChange: (notes: Note[]) => void;
  onFoldersChange: (folders: Folder[]) => void;
}

export function useDragDrop({
  notes,
  folders,
  encryptionKey,
  onNotesChange,
  onFoldersChange,
}: UseDragDropProps) {
  /**
   * Reorder notes within the same folder
   */
  const reorderNotesInFolder = useCallback(
    async (folderId: string, sourceIndex: number, targetIndex: number) => {
      const folderNotes = notes
        .filter((n) => n.folderId === folderId)
        .sort((a, b) => a.order - b.order);

      const reordered = reorderItems(folderNotes, sourceIndex, targetIndex);

      // Update order values
      const updatedNotes = reordered.map((note, index) => ({
        ...note,
        order: calculateNewOrder(reordered, index),
        updatedAt: Date.now(),
      }));

      // Save to database
      for (const note of updatedNotes) {
        if (encryptionKey) {
          await saveNote(note, encryptionKey);
        } else {
          await saveNote(note);
        }
      }

      // Update state
      const allUpdatedNotes = notes.map(
        (n) => updatedNotes.find((u) => u.id === n.id) || n
      );
      onNotesChange(allUpdatedNotes);
    },
    [notes, encryptionKey, onNotesChange]
  );

  /**
   * Move note to different folder
   */
  const moveNoteToNewFolder = useCallback(
    async (noteId: string, targetFolderId: string, targetIndex: number) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;

      const targetFolderNotes = notes
        .filter((n) => n.folderId === targetFolderId)
        .sort((a, b) => a.order - b.order);

      const updatedNote = moveNoteToFolder(note, targetFolderId, targetIndex, targetFolderNotes);

      // Save to database
      if (encryptionKey) {
        await saveNote(updatedNote, encryptionKey);
      } else {
        await saveNote(updatedNote);
      }

      // Update state
      const updatedNotes = notes.map((n) => (n.id === noteId ? updatedNote : n));
      onNotesChange(updatedNotes);
    },
    [notes, encryptionKey, onNotesChange]
  );

  /**
   * Reorder folders
   */
  const reorderFolders = useCallback(
    async (sourceIndex: number, targetIndex: number) => {
      const rootFolders = folders
        .filter((f) => f.parentId === null)
        .sort((a, b) => a.order - b.order);

      const reordered = reorderItems(rootFolders, sourceIndex, targetIndex);

      // Update order values
      const updatedFolders = reordered.map((folder, index) => ({
        ...folder,
        order: calculateNewOrder(reordered, index),
        updatedAt: Date.now(),
      }));

      // Save to database
      for (const folder of updatedFolders) {
        await saveFolder(folder);
      }

      // Update state
      const allUpdatedFolders = folders.map(
        (f) => updatedFolders.find((u) => u.id === f.id) || f
      );
      onFoldersChange(allUpdatedFolders);
    },
    [folders, onFoldersChange]
  );

  /**
   * Reorder folders within parent
   */
  const reorderSubFolders = useCallback(
    async (parentId: string | null, sourceIndex: number, targetIndex: number) => {
      const subFolders = folders
        .filter((f) => f.parentId === parentId)
        .sort((a, b) => a.order - b.order);

      const reordered = reorderItems(subFolders, sourceIndex, targetIndex);

      // Update order values
      const updatedFolders = reordered.map((folder, index) => ({
        ...folder,
        order: calculateNewOrder(reordered, index),
        updatedAt: Date.now(),
      }));

      // Save to database
      for (const folder of updatedFolders) {
        await saveFolder(folder);
      }

      // Update state
      const allUpdatedFolders = folders.map(
        (f) => updatedFolders.find((u) => u.id === f.id) || f
      );
      onFoldersChange(allUpdatedFolders);
    },
    [folders, onFoldersChange]
  );

  return {
    reorderNotesInFolder,
    moveNoteToNewFolder,
    reorderFolders,
    reorderSubFolders,
  };
}
