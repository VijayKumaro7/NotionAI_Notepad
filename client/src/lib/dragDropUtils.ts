import { Note, Folder } from "./storage";

export type DragItem = {
  id: string;
  type: "note" | "folder";
  folderId?: string;
};

export type DropZone = {
  type: "folder" | "note-list";
  folderId?: string;
  targetId?: string;
  position?: "before" | "after";
};

/**
 * Calculate new order value for reordered items
 */
export function calculateNewOrder(
  items: (Note | Folder)[],
  targetIndex: number
): number {
  if (items.length === 0) return 0;

  if (targetIndex === 0) {
    // Halving only opens a gap when there is one. The default folder is created
    // with order 0, so items[0].order / 2 was 0 — the moved item tied with the
    // one it was supposed to precede, and the sort settled it arbitrarily.
    return items[0].order > 0 ? items[0].order / 2 : items[0].order - 1;
  }

  if (targetIndex >= items.length) {
    // Insert at end - add 1 to last item's order
    return items[items.length - 1].order + 1;
  }

  // Insert between two items - average their orders
  const prevOrder = items[targetIndex - 1].order;
  const nextOrder = items[targetIndex].order;
  return (prevOrder + nextOrder) / 2;
}

/**
 * Reorder items in a list
 */
export function reorderItems<T extends Note | Folder>(
  items: T[],
  sourceIndex: number,
  targetIndex: number
): T[] {
  const result = Array.from(items);
  const [removed] = result.splice(sourceIndex, 1);
  result.splice(targetIndex, 0, removed);
  return result;
}

/**
 * Move note to different folder
 */
export function moveNoteToFolder(
  note: Note,
  targetFolderId: string,
  targetIndex: number,
  notesInFolder: Note[]
): Note {
  return {
    ...note,
    folderId: targetFolderId,
    order: calculateNewOrder(notesInFolder, targetIndex),
    updatedAt: Date.now(),
  };
}

/**
 * Get sorted items by order
 */
export function sortByOrder<T extends Note | Folder>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/**
 * Validate drop operation
 */
export function isValidDrop(
  dragItem: DragItem,
  dropZone: DropZone,
  folders: Folder[]
): boolean {
  // Can't drop folder into itself
  if (dragItem.type === "folder" && dragItem.id === dropZone.folderId) {
    return false;
  }

  // Can't drop folder into its own children (prevent infinite nesting)
  if (dragItem.type === "folder" && dropZone.type === "folder") {
    const dragFolder = folders.find(f => f.id === dragItem.id);
    const dropFolder = folders.find(f => f.id === dropZone.folderId);

    if (dragFolder && dropFolder) {
      // Walk up from the drop target looking for the dragged folder.
      //
      // `|| current` used to leave the walk standing on the same node when a
      // parent was missing, and current.parentId was still set, so the loop
      // never ended — a folder with a dangling parentId froze the tab. A
      // missing parent means the chain is over; a seen-set covers a cycle.
      const seen = new Set<string>();
      let current: Folder | undefined = dropFolder;

      while (current?.parentId && !seen.has(current.id)) {
        if (current.parentId === dragFolder.id) {
          return false;
        }
        seen.add(current.id);
        current = folders.find(f => f.id === current!.parentId);
      }
    }
  }

  return true;
}

/**
 * Get drop indicator position
 */
export function getDropIndicatorPosition(
  clientY: number,
  elementRect: DOMRect
): "before" | "after" {
  const midpoint = elementRect.top + elementRect.height / 2;
  return clientY < midpoint ? "before" : "after";
}
