/**
 * What restoring a backup would actually do.
 *
 * Restore used to be a loop that wrote every note in the archive straight over
 * whatever was here. Two things were wrong with that, and neither announced
 * itself.
 *
 * It destroyed newer work. A backup is a photograph of an older moment; a note
 * edited since is newer than its copy in the archive, and overwriting it threw
 * the edit away with nothing kept and nothing said. The sync merge has held the
 * opposite rule for a while — winning must not destroy the loser — and a
 * recovery tool is the last place that rule should lapse.
 *
 * And it went in blind. Nobody could see what a restore was about to change
 * before it changed it, which is precisely the moment you want to look: a
 * restore is reached for when something has already gone wrong, and the cost of
 * reaching for the wrong archive is a second loss on top of the first.
 *
 * So the decision is separated from the writing. `planRestore` is pure and
 * compares the archive against what is here; the preview renders the plan and
 * the apply step walks it. One description of what will happen, shown and then
 * carried out, rather than two implementations that can disagree.
 */

import { Note } from "./storage";

export type RestoreDisposition =
  /** Not in this browser at all — the restore brings it back. */
  | "added"
  /** Here, and not newer than the archive. The archive's copy supersedes it. */
  | "replaced"
  /** Here and NEWER than the archive: restoring would lose work done since. */
  | "displaced"
  /** Here and the same, to the byte. Nothing to do. */
  | "identical";

export interface RestoreEntry {
  /** The version held in the archive. */
  note: Note;
  /** What this browser holds for that id, or null when it holds nothing. */
  local: Note | null;
  disposition: RestoreDisposition;
}

export interface RestorePlan {
  entries: RestoreEntry[];
  added: number;
  replaced: number;
  displaced: number;
  identical: number;
  /** Notes here that the archive has never heard of. Restore leaves them be. */
  untouched: number;
}

/** Same text, same title, same filing — restoring it would be a no-op write. */
function sameContent(a: Note, b: Note): boolean {
  return (
    a.title === b.title &&
    a.content === b.content &&
    a.folderId === b.folderId &&
    a.tags.join("\u0000") === b.tags.join("\u0000")
  );
}

/**
 * Compare an archive against what this browser holds.
 *
 * Nothing is written here and nothing is decided about what the user should do;
 * the counts are what the preview shows and the entries are what the apply step
 * walks.
 *
 * A note the archive does not mention is never touched. A restore puts back
 * what was lost; it is not a demand that the workspace become the archive, and
 * deleting work simply because an older photograph does not show it would be
 * the same destruction by a different route.
 */
export function planRestore(
  archiveNotes: readonly Note[],
  localNotes: readonly Note[]
): RestorePlan {
  const localById = new Map(localNotes.map(n => [n.id, n]));
  const entries: RestoreEntry[] = [];

  for (const note of archiveNotes) {
    const local = localById.get(note.id) ?? null;

    let disposition: RestoreDisposition;
    if (!local) {
      disposition = "added";
    } else if (sameContent(local, note)) {
      // Checked before the clocks. Two copies of the same words are not a
      // conflict however their timestamps compare, and calling one "displaced"
      // would scare someone out of a restore that changes nothing.
      disposition = "identical";
    } else if (local.updatedAt > note.updatedAt) {
      disposition = "displaced";
    } else {
      disposition = "replaced";
    }

    entries.push({ note, local, disposition });
  }

  const archiveIds = new Set(archiveNotes.map(n => n.id));

  return {
    entries,
    added: entries.filter(e => e.disposition === "added").length,
    replaced: entries.filter(e => e.disposition === "replaced").length,
    displaced: entries.filter(e => e.disposition === "displaced").length,
    identical: entries.filter(e => e.disposition === "identical").length,
    untouched: localNotes.filter(n => !archiveIds.has(n.id)).length,
  };
}

/** True when carrying the plan out would change anything at all. */
export function planChangesAnything(plan: RestorePlan): boolean {
  return plan.added + plan.replaced + plan.displaced > 0;
}

/**
 * The local version of a note the restore is about to supersede, as a note of
 * its own.
 *
 * The same shape as `conflictCopy` in `syncService.ts`, and for the same
 * reason: the copy has to be a note, not a version snapshot, because version
 * history is capped and pruned and the only remaining copy of someone's
 * writing does not belong somewhere it can be evicted from.
 *
 * `updatedAt` is the moment of the restore rather than the note's own, so this
 * copy is newer than anything the restore writes and cannot be quietly
 * superseded by the very archive that displaced it.
 */
export function displacedCopy(local: Note, at: number, newId: string): Note {
  return {
    ...local,
    id: newId,
    title: displacedCopyTitle(local.title, at),
    createdAt: at,
    updatedAt: at,
    isDeleted: false,
    deletedAt: undefined,
  };
}

/** Says what it is and when, so two restores do not produce one title twice. */
export function displacedCopyTitle(title: string, at: number): string {
  const when = new Date(at).toISOString().slice(0, 16).replace("T", " ");
  return `${title || "Untitled"} (before restore ${when})`;
}
