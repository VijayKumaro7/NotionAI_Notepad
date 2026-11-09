/**
 * `localStorage`, for the values that are a convenience and not the data.
 *
 * Reading or writing it throws in browsers that block site storage (private
 * windows in some, "block all cookies", a sandboxed frame), and `localStorage`
 * itself can throw on access. Called bare inside a component's initial state
 * or an effect, that is not a lost preference but a blank page.
 */

export function getStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The preference lasts until the tab closes instead of across visits.
  }
}

/**
 * `sessionStorage` is refused separately from `localStorage` in some setups,
 * and refused the same way: the property access itself can throw. The landing
 * page's template hand-off lives here, so a person who cannot use it still
 * gets a workspace, only without the template they picked.
 */
export function getStoredSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStoredSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // The hand-off is lost; the workspace opens without the chosen template.
  }
}

export function removeStoredSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing to remove if nothing could be stored.
  }
}
