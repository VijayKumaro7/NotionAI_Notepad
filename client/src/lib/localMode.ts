/**
 * Local-only mode — the app with no server behind it.
 *
 * Some deploys of this repo are the client bundle and nothing else: a static
 * host publishing `dist/public`, where `/api/*` answers 404 by design. Sign-in
 * cannot work there, and neither can sync, sharing, collaboration or anything
 * AI. What does work is the part the app is built around — notes written,
 * encrypted and kept in this browser.
 *
 * This records that someone was told that and chose to carry on, so the /app
 * route lets them in. It is deliberately not the demo: a demo ends by asking
 * you to sign in, and on a deploy with no server that is a door into a wall —
 * someone gets thirty minutes, writes notes, and is then returned to the
 * landing page with no way back to them. There is no deadline here because
 * there is nothing to convert to.
 *
 * localStorage rather than sessionStorage, so a reload or a second tab does
 * not put the person back in front of the same notice with their own notes on
 * the far side of it. The in-memory copy is the fallback for browsers that
 * refuse storage entirely: that session still works, it just does not survive
 * a reload.
 */

const STORAGE_KEY = "local-only-mode";

let active = false;

export function enableLocalMode(): void {
  active = true;
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage unavailable — this tab is fine, a reload starts over.
  }
}

/** Signing in retires it: there is a server after all. */
export function disableLocalMode(): void {
  active = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}

export function isLocalModeActive(): boolean {
  if (active) return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
