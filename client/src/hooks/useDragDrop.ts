import { useCallback } from "react";
import { Note, Folder, saveNote, saveFolder } from "@/lib/storage";
import {
  reorderItems,
  calculateNewOrder,
  moveNoteToFolder,
  sortByOrder,
} from "@/lib/dragDropUtils";

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
        .filter(n => n.folderId === folderId)
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
        n => updatedNotes.find(u => u.id === n.id) || n
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
      const note = notes.find(n => n.id === noteId);
      if (!note) return;

      const targetFolderNotes = notes
        .filter(n => n.folderId === targetFolderId)
        .sort((a, b) => a.order - b.order);

      const updatedNote = moveNoteToFolder(
        note,
        targetFolderId,
        targetIndex,
        targetFolderNotes
      );

      // Save to database
      if (encryptionKey) {
        await saveNote(updatedNote, encryptionKey);
      } else {
        await saveNote(updatedNote);
      }

      // Update state
      const updatedNotes = notes.map(n => (n.id === noteId ? updatedNote : n));
      onNotesChange(updatedNotes);
    },
    [notes, encryptionKey, onNotesChange]
  );

  /**
   * Put a folder under a new parent, at a position among its new siblings.
   *
   * One operation rather than two, because from the sidebar's side there is
   * no difference worth having: dropping a folder onto another nests it,
   * dropping it above or below one makes it a sibling there, and "sibling
   * there" is a re-parent too whenever the target sits somewhere else. Having
   * a separate reorder path is what made the old drop handler compute indices
   * against the root list no matter which folder was being dragged.
   *
   * `null` is the root. Whether the move is legal at all — into itself, or
   * into something already inside it — is `isValidDrop`'s question, and the
   * caller asks it before showing a drop target rather than after.
   */
  const moveFolder = useCallback(
    async (
      folderId: string,
      newParentId: string | null,
      targetIndex: number
    ) => {
      const folder = folders.find(f => f.id === folderId);
      if (!folder) return;

      // Excluding the folder being moved: it is either leaving this list or
      // changing place within it, and counting it would shift every index by
      // one against what the person is pointing at.
      const siblings = sortByOrder(
        folders.filter(f => f.parentId === newParentId && f.id !== folderId)
      );

      const updated = {
        ...folder,
        parentId: newParentId,
        order: calculateNewOrder(siblings, targetIndex),
        updatedAt: Date.now(),
      };

      await saveFolder(updated);
      onFoldersChange(folders.map(f => (f.id === folderId ? updated : f)));
    },
    [folders, onFoldersChange]
  );

  return {
    reorderNotesInFolder,
    moveNoteToNewFolder,
    moveFolder,
  };
}
