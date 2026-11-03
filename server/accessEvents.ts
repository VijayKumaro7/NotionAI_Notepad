/**
 * "Someone's access may have changed" — a signal, not a decision.
 *
 * The collaboration socket checks access once, when it opens. Anything that
 * can take that access away later (removing a collaborator, narrowing a role,
 * revoking a link, ending a session) says so here, and the socket server
 * re-asks the same questions it asked at the door. The sender needs no
 * knowledge of sockets, and this file imports nothing, so the session store
 * and the collaboration code can both use it without importing each other.
 *
 * A signal that is missed costs one sweep interval, not the revocation: the
 * socket server also re-checks on a timer.
 */

export type AccessChange = {
  /** Every connection to this note should be re-checked. */
  noteId?: number;
  /** Every connection this user holds should be re-checked. */
  userId?: number;
};

type Listener = (change: AccessChange) => void;

const listeners = new Set<Listener>();

export function onAccessChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitAccessChanged(change: AccessChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (error) {
      console.error("[Access] A listener failed", error);
    }
  }
}
