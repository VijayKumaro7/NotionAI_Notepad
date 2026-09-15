/**
 * What the app knows about whether your notes are actually on the server.
 *
 * Sync was best-effort and silent: every failure was a `console.warn`, and a
 * push that failed was simply lost — the edit never reached the server again
 * unless that note happened to be edited a second time. From the outside there
 * was no difference between "everything is synced" and "nothing has synced
 * since you opened the tab", which is the worse of the two failures, because
 * someone who believes they have a server copy stops keeping their own.
 *
 * So two things are tracked rather than logged. What is still *owed* to the
 * server — push by push, by client id, so a retry knows exactly what to send —
 * and when a sync last actually went through. Everything else the indicator
 * shows is derived from those.
 *
 * A reducer rather than a mutable tracker: this drives a React render, and the
 * decisions in here — when a failure stops mattering, what counts as synced —
 * are worth testing without a DOM.
 */

/** A note's content, or the tombstone that says it is gone. */
export type OwedKind = "note" | "deletion";

export type SyncState = {
  /** Client ids the server has not taken yet, and what to send for each. */
  owed: Record<string, OwedKind>;
  /** Attempts currently running. More than one is normal: pushes overlap. */
  inFlight: number;
  /** When a sync run last completed with nothing left owed. */
  lastSyncedAt: number | null;
  /** What the most recent failure said, cleared by the next success. */
  lastError: string | null;
};

export type SyncEvent =
  | { type: "started" }
  | { type: "settled" }
  /** A push landed. `at` stamps it so "synced 2 minutes ago" can be true. */
  | { type: "pushed"; id: string; at: number }
  | { type: "push-failed"; id: string; kind: OwedKind; message: string }
  /** A whole sync run — pull, merge, flush — finished with nothing left. */
  | { type: "synced"; at: number }
  | { type: "sync-failed"; message: string };

export const initialSyncState: SyncState = {
  owed: {},
  inFlight: 0,
  lastSyncedAt: null,
  lastError: null,
};

export function syncReducer(state: SyncState, event: SyncEvent): SyncState {
  switch (event.type) {
    case "started":
      return { ...state, inFlight: state.inFlight + 1 };

    // Never below zero. A settle without a start is a bookkeeping slip, and a
    // negative count would read as "syncing" forever afterwards.
    case "settled":
      return { ...state, inFlight: Math.max(0, state.inFlight - 1) };

    case "pushed": {
      if (!(event.id in state.owed)) {
        return { ...state, lastSyncedAt: event.at, lastError: null };
      }
      const owed = { ...state.owed };
      delete owed[event.id];
      return { ...state, owed, lastSyncedAt: event.at, lastError: null };
    }

    case "push-failed":
      return {
        ...state,
        owed: { ...state.owed, [event.id]: event.kind },
        lastError: event.message,
      };

    // Only a run that left nothing owed may stamp the clock. A pull that
    // succeeded while three pushes are still queued has not synced this
    // device, and saying otherwise is the lie this module exists to stop.
    case "synced":
      return hasOwed(state)
        ? state
        : { ...state, lastSyncedAt: event.at, lastError: null };

    case "sync-failed":
      return { ...state, lastError: event.message };
  }
}

export type SyncPhase =
  /** Everything this device has written, the server has. */
  | "synced"
  /** Something is on its way. */
  | "syncing"
  /** Changes are owed and are not moving — offline, or failing. */
  | "waiting"
  /** Nothing has been attempted yet, so there is nothing honest to claim. */
  | "unknown";

export type SyncSummary = {
  phase: SyncPhase;
  /** How many client ids the server has not taken. */
  owed: number;
  offline: boolean;
  lastSyncedAt: number | null;
  error: string | null;
};

/**
 * The one thing a reader needs to know, from everything tracked.
 *
 * Order matters. Being offline outranks being in flight, because a request
 * made with no network is not progress. Owing something outranks having synced
 * earlier, because "synced 2 minutes ago" beside three unsent edits is exactly
 * the reassurance nobody should be given.
 */
export function describeSync(
  state: SyncState,
  context: { online: boolean }
): SyncSummary {
  const owed = Object.keys(state.owed).length;
  const base = {
    owed,
    offline: !context.online,
    lastSyncedAt: state.lastSyncedAt,
    error: state.lastError,
  };

  if (!context.online) {
    // "Offline, nothing waiting" is only reassuring if a sync ever happened.
    // A tab opened with no network has sent nothing and received nothing, and
    // has no business calling itself synced.
    if (owed > 0) return { ...base, phase: "waiting" };
    return {
      ...base,
      phase: state.lastSyncedAt === null ? "unknown" : "synced",
    };
  }
  if (state.inFlight > 0) return { ...base, phase: "syncing" };
  if (owed > 0) return { ...base, phase: "waiting" };
  if (state.lastError) return { ...base, phase: "waiting" };
  if (state.lastSyncedAt === null) return { ...base, phase: "unknown" };
  return { ...base, phase: "synced" };
}

/**
 * What a retry has to send. Unordered on purpose: each entry is the whole
 * current truth about one note, so sending them in any order lands the same
 * state, and a queue that had to be drained in sequence would stall entirely
 * on one note the server keeps refusing.
 */
export function owedEntries(
  state: SyncState
): Array<{ id: string; kind: OwedKind }> {
  return Object.entries(state.owed).map(([id, kind]) => ({ id, kind }));
}

function hasOwed(state: SyncState): boolean {
  return Object.keys(state.owed).length > 0;
}
