/**
 * Timed demo session.
 *
 * Lets someone try a template without an account for a fixed window. When it
 * runs out the app asks them to sign in, and sends them back to the landing
 * page if they decline.
 *
 * The deadline is stored as an absolute timestamp rather than a countdown, so
 * a reload, a sleeping tab, or a backgrounded phone cannot extend it. It lives
 * in localStorage rather than sessionStorage because a per-tab record would
 * reset every time the tab was closed, which is not much of a limit.
 *
 * Notes written during a demo stay in IndexedDB. Expiry never deletes them —
 * signing in afterwards keeps everything.
 *
 * This record is per browser, so clearing site data resets it. When the server
 * has DEMO_LIMIT_SALT configured it returns a deadline of its own, keyed to a
 * hashed visitor id, and adoptServerDeadline pins this record to that instead.
 * The server is authoritative when it answers; this is the fallback.
 */

export const DEMO_SESSION_MS = 30 * 60 * 1000;

const STORAGE_KEY = 'demo-session-expires-at';

/** Reading storage can throw in private-mode browsers; a demo is not worth a crash. */
function readExpiry(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const expiresAt = Number.parseInt(raw, 10);
    return Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

/**
 * Begin a demo. Calling this while one is already running does not extend it —
 * otherwise picking a second template would hand out another half hour.
 */
export function startDemoSession(now: number = Date.now()): number {
  const existing = readExpiry();
  if (existing !== null && existing > now) return existing;

  const expiresAt = now + DEMO_SESSION_MS;
  try {
    localStorage.setItem(STORAGE_KEY, String(expiresAt));
  } catch {
    // Storage unavailable — the session simply will not survive a reload.
  }
  return expiresAt;
}

/**
 * Pin the local record to a deadline the server issued, so clearing site data
 * does not hand out a fresh half hour. An already-expired deadline is written
 * through unchanged — that is exactly the case worth remembering.
 */
export function adoptServerDeadline(expiresAt: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(expiresAt));
  } catch {
    // Storage unavailable — the server will say so again on the next load.
  }
}

export function endDemoSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}

/** Milliseconds left, clamped at zero. Zero also covers "never started". */
export function demoTimeRemaining(now: number = Date.now()): number {
  const expiresAt = readExpiry();
  if (expiresAt === null) return 0;
  return Math.max(0, expiresAt - now);
}

/** True while a demo is running and still has time on it. */
export function isDemoSessionActive(now: number = Date.now()): boolean {
  return demoTimeRemaining(now) > 0;
}

/** True only when a demo was started and has since run out. */
export function isDemoSessionExpired(now: number = Date.now()): boolean {
  const expiresAt = readExpiry();
  return expiresAt !== null && expiresAt <= now;
}

/** mm:ss for the countdown badge. */
export function formatTimeRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
