/**
 * Which sidebar folders are open, remembered across reloads.
 *
 * The sidebar started every load with every folder shut, and nothing ever
 * opened one but a click. A workspace with notes in it therefore looked empty:
 * the tree showed folder names and no notes, and a note created a moment ago
 * was filed somewhere invisible. For an app whose whole argument is that your
 * writing is here and safe, a sidebar that shows none of it is the wrong first
 * impression and, on a device holding the only copy, a genuinely alarming one.
 *
 * `null` from `readExpandedFolders` means nothing was ever remembered, and it
 * is deliberately not the same as `[]`. The first is a browser that has not
 * used the sidebar yet, and the folders should open so the person sees their
 * notes; the second is someone who closed them all on purpose, and reopening
 * them would be overriding a choice they made.
 *
 * localStorage, like the theme and the rest of the small preferences — it is a
 * convenience per browser, and the privacy page lists it with them.
 */

const STORAGE_KEY = "sidebar-expanded-folders";

/** Folder ids this browser last had open, or null if it has never said. */
export function readExpandedFolders(): string[] | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-mode browsers throw rather than return null. Treated as "never
    // said", which opens the folders — the same as a first visit.
    return null;
  }

  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    // Anything but an array of strings is a value this app did not write, or
    // one an older version did. Discarding it reverts to the default rather
    // than spreading the damage into the Set the sidebar renders from.
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

export function writeExpandedFolders(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable — the folders simply open fresh next time.
  }
}
