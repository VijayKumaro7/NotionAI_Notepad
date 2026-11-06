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
