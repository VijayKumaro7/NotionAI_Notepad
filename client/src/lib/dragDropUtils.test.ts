import { describe, it, expect } from 'vitest';
import {
  calculateNewOrder,
  reorderItems,
  moveNoteToFolder,
  sortByOrder,
  isValidDrop,
  getDropIndicatorPosition,
} from './dragDropUtils';
import { Note, Folder } from './storage';

describe('dragDropUtils', () => {
  const mockNotes: Note[] = [
    {
      id: 'note1',
      title: 'Note 1',
      content: 'Content 1',
      folderId: 'folder1',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isEncrypted: false,
      order: 10,
    },
    {
      id: 'note2',
      title: 'Note 2',
      content: 'Content 2',
      folderId: 'folder1',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isEncrypted: false,
      order: 20,
    },
    {
      id: 'note3',
      title: 'Note 3',
      content: 'Content 3',
      folderId: 'folder1',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isEncrypted: false,
      order: 30,
    },
  ];

  const mockFolders: Folder[] = [
    {
      id: 'folder1',
      name: 'Folder 1',
      parentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: 10,
    },
    {
      id: 'folder2',
      name: 'Folder 2',
      parentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: 20,
    },
  ];

  describe('calculateNewOrder', () => {
    it('should calculate order for insertion at beginning', () => {
      const order = calculateNewOrder(mockNotes, 0);
      expect(order).toBe(5); // 10 / 2
    });

    it('should calculate order for insertion at end', () => {
      const order = calculateNewOrder(mockNotes, mockNotes.length);
      expect(order).toBe(31); // 30 + 1
    });

    it('should calculate order for insertion in middle', () => {
      const order = calculateNewOrder(mockNotes, 1);
      expect(order).toBe(15); // (10 + 20) / 2
    });

    it('should handle empty array', () => {
      const order = calculateNewOrder([], 0);
      expect(order).toBe(0);
    });
  });

  describe('reorderItems', () => {
    it('should reorder items from index 0 to 2', () => {
      const result = reorderItems(mockNotes, 0, 2);
      expect(result[0].id).toBe('note2');
      expect(result[1].id).toBe('note3');
      expect(result[2].id).toBe('note1');
    });

    it('should reorder items from index 2 to 0', () => {
      const result = reorderItems(mockNotes, 2, 0);
      expect(result[0].id).toBe('note3');
      expect(result[1].id).toBe('note1');
      expect(result[2].id).toBe('note2');
    });

    it('should not modify original array', () => {
      const original = [...mockNotes];
      reorderItems(mockNotes, 0, 2);
      expect(mockNotes).toEqual(original);
    });
  });

  describe('moveNoteToFolder', () => {
    it('should move note to different folder', () => {
      const note = mockNotes[0];
      const result = moveNoteToFolder(note, 'folder2', 0, []);
      expect(result.folderId).toBe('folder2');
      expect(result.id).toBe('note1');
    });

    it('should update updatedAt timestamp', () => {
      const note = mockNotes[0];
      const before = Date.now();
      const result = moveNoteToFolder(note, 'folder2', 0, []);
      const after = Date.now();
      expect(result.updatedAt).toBeGreaterThanOrEqual(before);
      expect(result.updatedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('sortByOrder', () => {
    it('should sort items by order', () => {
      const unsorted = [mockNotes[2], mockNotes[0], mockNotes[1]];
      const result = sortByOrder(unsorted);
      expect(result[0].id).toBe('note1');
      expect(result[1].id).toBe('note2');
      expect(result[2].id).toBe('note3');
    });

    it('should not modify original array', () => {
      const unsorted = [mockNotes[2], mockNotes[0], mockNotes[1]];
      const original = [...unsorted];
      sortByOrder(unsorted);
      expect(unsorted).toEqual(original);
    });
  });

  describe('isValidDrop', () => {
    it('should allow dropping note into folder', () => {
      const result = isValidDrop(
        { id: 'note1', type: 'note' },
        { type: 'folder', folderId: 'folder2' },
        mockFolders
      );
      expect(result).toBe(true);
    });

    it('should prevent dropping folder into itself', () => {
      const result = isValidDrop(
        { id: 'folder1', type: 'folder' },
        { type: 'folder', folderId: 'folder1' },
        mockFolders
      );
      expect(result).toBe(false);
    });

    it('should allow dropping folder into different folder', () => {
      const result = isValidDrop(
        { id: 'folder1', type: 'folder' },
        { type: 'folder', folderId: 'folder2' },
        mockFolders
      );
      expect(result).toBe(true);
    });
  });

  describe('getDropIndicatorPosition', () => {
    it('should return "before" for top half', () => {
      const rect = new DOMRect(0, 0, 100, 100);
      const position = getDropIndicatorPosition(30, rect);
      expect(position).toBe('before');
    });

    it('should return "after" for bottom half', () => {
      const rect = new DOMRect(0, 0, 100, 100);
      const position = getDropIndicatorPosition(70, rect);
      expect(position).toBe('after');
    });

    // Exactly on the midpoint is an arbitrary tie-break; the implementation
    // uses `clientY < midpoint`, so the boundary pixel counts as "after".
    it('should return "after" exactly at the midpoint', () => {
      const rect = new DOMRect(0, 0, 100, 100);
      const position = getDropIndicatorPosition(50, rect);
      expect(position).toBe('after');
    });
  });
});

describe('dragDropUtils edge cases found in review', () => {
  const folder = (id: string, parentId: string | null): Folder =>
    ({
      id,
      name: id,
      parentId,
      createdAt: 0,
      updatedAt: 0,
      order: 0,
    }) as Folder;

  // The default folder is created with order 0, so items[0].order / 2 was also
  // 0 — the moved item tied with the one it was meant to precede.
  it('opens a real gap when inserting above an item whose order is 0', () => {
    const items = [
      { order: 0 },
      { order: 1 },
    ] as unknown as Parameters<typeof calculateNewOrder>[0];

    expect(calculateNewOrder(items, 0)).toBeLessThan(0);
  });

  it('still halves when there is room above', () => {
    const items = [{ order: 10 }] as unknown as Parameters<
      typeof calculateNewOrder
    >[0];

    expect(calculateNewOrder(items, 0)).toBe(5);
  });

  // The ancestor walk used to stand still when a parent was missing, so a
  // folder left with a dangling parentId froze the tab.
  it('terminates when a folder points at a parent that no longer exists', () => {
    const folders = [folder('child', 'deleted-parent'), folder('dragged', null)];

    expect(() =>
      isValidDrop(
        { type: 'folder', id: 'dragged' } as never,
        { type: 'folder', folderId: 'child' } as never,
        folders
      )
    ).not.toThrow();
  });

  it('terminates on a parent cycle', () => {
    const folders = [folder('a', 'b'), folder('b', 'a'), folder('dragged', null)];

    expect(() =>
      isValidDrop(
        { type: 'folder', id: 'dragged' } as never,
        { type: 'folder', folderId: 'a' } as never,
        folders
      )
    ).not.toThrow();
  });

  it('still refuses to drop a folder into its own descendant', () => {
    const folders = [folder('parent', null), folder('child', 'parent')];

    expect(
      isValidDrop(
        { type: 'folder', id: 'parent' } as never,
        { type: 'folder', folderId: 'child' } as never,
        folders
      )
    ).toBe(false);
  });
});
