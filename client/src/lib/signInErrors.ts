/**
 * What the sign-in page says when a redirect flow comes back having failed.
 *
 * Two query parameters carry those failures, because two flows land on /login:
 * `auth_error` from the Manus portal callback (server/_core/oauth.ts) and
 * `error` from Google's (server/googleRoutes.ts). The page used to read only
 * the first, so every Google failure — a declined consent screen, an expired
 * flow, a rate limit, an unverified address — arrived silently: the person was
 * dropped back on the sign-in page with no idea why, and the obvious thing to
 * do was press the same button again.
 *
 * One map covers both parameters. The reasons are distinct strings across the
 * two flows, and the two they share (`missing_code`, `callback_failed`) mean
 * the same thing in each.
 *
 * A reason with no entry here falls back to the generic message, which is safe
 * but useless — so signInErrors.test.ts reads the server sources and fails when
 * a route learns to emit a reason nothing here explains.
 */

/** In the order they are checked. Only ever one arrives at a time. */
export const SIGN_IN_ERROR_PARAMS = ["auth_error", "error"] as const;

const FALLBACK = "Sign-in failed. Please try again.";

/**
 * Deliberately vague where being specific would help an attacker more than a
 * person, and specific where it would not. `unverified_email` and
 * `already_linked` name the actual obstacle because the person reading them is
 * the account's owner and cannot get past it otherwise; the token and state
 * failures stay general, since anyone who provoked one already knows what they
 * did.
 */
export const SIGN_IN_ERROR_MESSAGES: Record<string, string> = {
  // Sent by both flows.
  missing_code: "Sign-in was cancelled or the link expired. Please try again.",
  callback_failed: FALLBACK,

  // The Manus portal.
  no_account:
    "That account is missing an ID we need. Try a different sign-in method.",

  // Google, from the routes.
  google_unavailable:
    "Google sign-in is not available on this server. Try another method.",
  google_declined: "Google sign-in was cancelled.",
  rate_limited:
    "Too many sign-in attempts from your network. Wait a few minutes and try again.",

  // Google, from the flow itself.
  not_configured:
    "Google sign-in is not available on this server. Try another method.",
  bad_state:
    "That sign-in attempt is no longer valid. Please start again from this page.",
  exchange_failed: "Google could not complete the sign-in. Please try again.",
  bad_token: "Google's reply could not be verified. Please try again.",
  unverified_email:
    "Google has not verified that email address. Verify it with Google, then try again.",
  already_linked:
    "That email is already linked to a different Google account. Sign in with the account you used before.",
};

export type SignInError = {
  /** Which parameter carried it, so a caller can say where it came from. */
  param: (typeof SIGN_IN_ERROR_PARAMS)[number];
  reason: string;
  message: string;
};

/** The failure named in a query string, if it names one. */
export function readSignInError(search: string): SignInError | null {
  const params = new URLSearchParams(search);

  for (const param of SIGN_IN_ERROR_PARAMS) {
    const reason = params.get(param);
    if (!reason) continue;

    return {
      param,
      reason,
      message: SIGN_IN_ERROR_MESSAGES[reason] ?? FALLBACK,
    };
  }

  return null;
}

/**
 * The same query string with the failure parameters removed.
 *
 * The reason has been shown by the time this is used; leaving it in the address
 * bar means a reload repeats the message, and a copied URL carries a stale
 * complaint to whoever it is sent to. Anything else in the query is kept.
 */
export function withoutSignInError(search: string): string {
  const params = new URLSearchParams(search);

  for (const param of SIGN_IN_ERROR_PARAMS) params.delete(param);

  const query = params.toString();
  return query ? `?${query}` : "";
}
