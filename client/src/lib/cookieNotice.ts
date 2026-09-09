/**
 * Whether to tell someone about this site's cookies, and remembering that we did.
 *
 * This is a notice rather than a consent gate, and that is a claim about the
 * cookies rather than a shortcut. The site sets two, both httpOnly and both
 * strictly necessary: `app_session_id` keeps you signed in, and
 * `google_oauth_flow` carries the unspent OAuth state and PKCE verifier for the
 * seconds a Google sign-in is in flight. There is no analytics, telemetry or
 * third-party cookie to opt out of. Consent is not required for cookies without
 * which the thing you asked for cannot happen, and a Reject button that cannot
 * refuse anything — refusing the session cookie is refusing to sign in — is
 * worse than no button: it tells people they have a choice they do not have.
 *
 * If a non-essential cookie is ever added, this stops being adequate. The
 * version below is the hook for that: bump it and everyone is asked again,
 * which is also the moment to give the banner a real Accept and Reject and to
 * gate the new cookie on the answer.
 */

/**
 * Bump when the cookies described in the notice change, so a person who
 * acknowledged the old set is told about the new one rather than being counted
 * as having agreed to it.
 */
export const COOKIE_NOTICE_VERSION = "2026-09-essential-only";

const STORAGE_KEY = "cookie-notice-acknowledged";

/**
 * Reading storage throws in private-mode browsers, and a notice about cookies
 * is not worth a blank page. Unreadable storage is treated as "not yet told",
 * which errs towards informing.
 */
export function acknowledgedVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** True when this browser has not been shown the current notice. */
export function shouldShowCookieNotice(): boolean {
  return acknowledgedVersion() !== COOKIE_NOTICE_VERSION;
}

/**
 * Record that the notice was shown and dismissed.
 *
 * False when the record could not be written — the caller still hides the
 * banner for this page load, but it will be back on the next one. Nagging is
 * the better failure: silently treating an unstorable acknowledgement as
 * permanent would be a claim we cannot support.
 */
export function acknowledgeCookieNotice(): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, COOKIE_NOTICE_VERSION);
    return true;
  } catch {
    return false;
  }
}
