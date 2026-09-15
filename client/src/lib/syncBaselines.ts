/**
 * What this device and the server last agreed a note said.
 *
 * Last-write-wins needs this and does not have it. Given a local note and a
 * remote one with different timestamps, `updatedAt` alone cannot tell you
 * which of two very different things happened:
 *
 *   - the remote is newer because another device edited and this one did not,
 *     so taking the remote copy loses nothing; or
 *   - both devices edited since they last agreed, so taking the remote copy
 *     destroys writing that only exists here.
 *
 * The two are indistinguishable without a third number: the `updatedAt` this
 * device last reconciled with the server. If the local note still carries that
 * number, this device has not touched it. If the remote does, the other side
 * has not. If neither does, both edited, and somebody's work is about to be
 * thrown away.
 *
 * It is per-device state, not per-account — "what *I* last agreed to" — so it
 * belongs in this browser and is never synced. localStorage rather than
 * IndexedDB because it is one number per note and has to be readable during a
 * merge without awaiting a transaction.
 */

const STORAGE_KEY = "notepad-sync-baselines";

/** Note client id → the `updatedAt` this device last agreed with the server. */
export type Baselines = Record<string, number>;

/**
 * Reading has to survive a browser that refuses storage, a key holding
 * something that is not JSON, and JSON that is not the shape expected — a
 * corrupt baseline file must not take sync down with it. An empty map is the
 * safe answer: every note then looks like a possible conflict, and a conflict
 * keeps both sides.
 */
export function readBaselines(): Baselines {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Baselines = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

/** Best effort: a device that cannot persist baselines still syncs, it just
 *  treats more merges as conflicts, which errs towards keeping both sides. */
export function writeBaselines(baselines: Baselines): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(baselines));
  } catch {
    // Quota, private mode, storage disabled — nothing useful to do here.
  }
}

/**
 * The agreement reached for one note. Pure, so the rules above can be tested
 * without a browser.
 */
export function agree(
  baselines: Baselines,
  id: string,
  updatedAt: number
): Baselines {
  return { ...baselines, [id]: updatedAt };
}

/** A note that is gone has nothing left to agree about. Left behind, its
 *  baseline would outlive it and a note later created with the same id — a
 *  restore from the recycle bin — would inherit a stale agreement. */
export function forget(baselines: Baselines, id: string): Baselines {
  if (!(id in baselines)) return baselines;
  const next = { ...baselines };
  delete next[id];
  return next;
}

/**
 * Drop baselines for notes this device no longer has and the server no longer
 * sends. Without this the map grows for the life of the browser profile.
 */
export function prune(
  baselines: Baselines,
  liveIds: Iterable<string>
): Baselines {
  const live = new Set(liveIds);
  const next: Baselines = {};
  for (const [id, at] of Object.entries(baselines)) {
    if (live.has(id)) next[id] = at;
  }
  return next;
}
