import type { Folder } from "./storage";
import { sortByOrder } from "./dragDropUtils";

/**
 * The folder tree, as the sidebar needs to walk it.
 *
 * `Folder.parentId` has always been in the schema, `isValidDrop` has always
 * refused a drop that would make a folder its own ancestor, and the sidebar
 * has never rendered a folder that had a parent — it drew the roots and their
 * notes and stopped. Nesting was designed and then not shown.
 *
 * Every function here treats the parent chain as untrusted. A `parentId`
 * pointing at a folder that no longer exists is not hypothetical: deleting a
 * folder removed one row and left its children behind, and a walk up from
 * such a child used to loop forever — the comment in `dragDropUtils.ts`
 * records it freezing the tab. Nesting being reachable makes that reachable
 * too, so the traversals here carry a seen-set and the roots include the
 * orphans.
 */

/** Direct children of a folder, in display order. `null` gives the roots. */
export function childFolders(folders: Folder[], parentId: string | null) {
  return sortByOrder(folders.filter(f => f.parentId === parentId));
}

/**
 * What the sidebar should draw at the top level: folders with no parent, and
 * folders whose parent is gone.
 *
 * An orphan rendered nowhere is a folder whose notes cannot be reached and
 * whose existence is invisible — the person is told nothing and simply has
 * less than they did. Showing it at the root is not tidy, but it is honest,
 * and it is how someone finds their way back to what is inside it.
 */
export function rootFolders(folders: Folder[]) {
  const ids = new Set(folders.map(f => f.id));

  return sortByOrder(
    folders.filter(f => f.parentId === null || !ids.has(f.parentId))
  );
}

/**
 * Every folder beneath this one. Cycle-safe: a `parentId` loop yields each
 * folder once instead of running forever.
 */
export function descendantIds(folders: Folder[], folderId: string): string[] {
  const found = new Set<string>();
  const queue = [folderId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const child of folders.filter(f => f.parentId === current)) {
      if (found.has(child.id)) continue;
      found.add(child.id);
      queue.push(child.id);
    }
  }

  return [...found];
}

/**
 * The folders that need rewriting when `folderId` is deleted: its children,
 * lifted to where it was.
 *
 * Deleting the subtree is the other option and it is the wrong one here.
 * Folder deletion has no undo and no recently-deleted list, and the notes
 * inside a folder are not deleted with it — they keep a `folderId` nothing
 * renders. Removing a parent would therefore take every folder under it out
 * of sight along with their notes, with nothing said and nothing to restore
 * from. Lifting the children one level costs a person some tidying; the
 * alternative costs them their writing.
 */
export function promoteChildren(folders: Folder[], folderId: string): Folder[] {
  const deleted = folders.find(f => f.id === folderId);
  if (!deleted) return [];

  // A folder that was its own ancestor would otherwise be promoted into
  // itself. Sending it to the root breaks the loop rather than preserving it.
  const parentId = deleted.parentId === folderId ? null : deleted.parentId;

  return folders
    .filter(f => f.parentId === folderId && f.id !== folderId)
    .map(f => ({ ...f, parentId, updatedAt: Date.now() }));
}
