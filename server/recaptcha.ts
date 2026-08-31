/**
 * reCAPTCHA verification.
 *
 * The token the browser sends is not evidence of anything on its own — it is a
 * string a script produced, and a script is exactly what a bot is. It becomes
 * evidence only after Google confirms it, which is what this file does. Reading
 * "the widget was filled in" from the request and believing it is the whole
 * failure mode this feature exists to prevent.
 *
 * Three things are checked, not one:
 *
 *   success   Google says the token is valid and unspent. Tokens are
 *             single-use at Google's end, so a captured one cannot be replayed.
 *   hostname  the page that produced it was ours. Google enforces this itself
 *             unless domain verification is switched off in the console, and if
 *             it is off nothing else notices — so it is checked here too.
 *   score     for a v3 key. v2 does not return one, so its absence is not a
 *             failure; a low one is.
 *
 * The same siteverify endpoint serves v2 and v3, which is why both work here.
 */

import { ENV } from "./_core/env";

const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

/**
 * Google's suggested starting point for v3. Only consulted when the response
 * carries a score at all, so a v2 checkbox key is unaffected by it.
 */
const MIN_SCORE = 0.5;

export class RecaptchaError extends Error {
  constructor(
    message: string,
    readonly reason: "failed" | "unavailable"
  ) {
    super(message);
    this.name = "RecaptchaError";
  }
}

export function isRecaptchaConfigured(): boolean {
  return Boolean(ENV.recaptchaSiteKey && ENV.recaptchaSecretKey);
}

/**
 * The public half, handed to the browser at runtime.
 *
 * Deliberately served from here rather than compiled in through a `VITE_`
 * variable. The key is public either way, but a build-time variable named
 * anything like a key trips the guard in clientSecrets.test.ts — and weakening
 * that guard so one safe key can pass is how an unsafe one gets through later.
 * Serving it also means rotating the key needs no rebuild.
 */
export function recaptchaSiteKey(): string | null {
  return isRecaptchaConfigured() ? ENV.recaptchaSiteKey : null;
}

type SiteVerifyResponse = {
  success?: boolean;
  score?: number;
  hostname?: string;
  "error-codes"?: string[];
};

/**
 * Confirm a token with Google.
 *
 * Throws on anything short of a clean pass. Callers treat that as "refuse the
 * request" — see the note on failing closed below.
 */
export async function verifyRecaptcha(
  token: string,
  remoteIp?: string
): Promise<void> {
  if (!isRecaptchaConfigured()) return;

  if (!token) {
    throw new RecaptchaError(
      "Confirm you are not a robot and try again.",
      "failed"
    );
  }

  const body = new URLSearchParams({
    secret: ENV.recaptchaSecretKey,
    response: token,
  });
  // Optional, and only helps Google's own scoring. Left off when unknown rather
  // than sent as an empty string.
  if (remoteIp) body.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (error) {
    // Failing closed, deliberately.
    //
    // The alternative — letting people through when Google is unreachable — is
    // a check anyone able to interfere with this server's outbound traffic can
    // switch off. Sign-in stops working during a Google outage, which is loud,
    // visible and temporary; the other way is silent and is exactly when an
    // attacker would choose to act.
    console.error("[reCAPTCHA] siteverify unreachable", error);
    throw new RecaptchaError(
      "Could not check that you are human just now. Try again in a moment.",
      "unavailable"
    );
  }

  if (!response.ok) {
    console.error("[reCAPTCHA] siteverify returned", response.status);
    throw new RecaptchaError(
      "Could not check that you are human just now. Try again in a moment.",
      "unavailable"
    );
  }

  const result = (await response
    .json()
    .catch(() => null)) as SiteVerifyResponse | null;

  if (!result?.success) {
    // error-codes name our own misconfiguration as readily as a bad token
    // (`invalid-input-secret`, for one), so they go to the log and never to the
    // browser.
    console.warn(
      "[reCAPTCHA] rejected:",
      result?.["error-codes"] ?? "no response body"
    );
    throw new RecaptchaError(
      "That did not pass the robot check. Please try again.",
      "failed"
    );
  }

  assertOurHostname(result.hostname);

  // Present only for a v3 key. `typeof` rather than a truthiness test, because
  // a score of 0 — the most bot-like answer there is — is falsy.
  if (typeof result.score === "number" && result.score < MIN_SCORE) {
    console.warn("[reCAPTCHA] score below threshold:", result.score);
    throw new RecaptchaError(
      "That did not pass the robot check. Please try again.",
      "failed"
    );
  }
}

/**
 * Confirm the token came from a page on our own domain.
 *
 * Google already refuses tokens from other domains — unless domain verification
 * has been turned off in the console, which is a checkbox and leaves no other
 * trace. With it off, a token minted on any site using this site key would
 * otherwise be accepted here.
 *
 * Only enforced in production, and only when PUBLIC_ORIGIN says what to expect.
 * Development runs on localhost, ngrok tunnels and IP addresses, and Google
 * reports whichever of those the browser used.
 */
function assertOurHostname(hostname: string | undefined): void {
  if (!ENV.isProduction || !ENV.publicOrigin || !hostname) return;

  let expected: string;
  try {
    expected = new URL(ENV.publicOrigin).hostname;
  } catch {
    return;
  }

  if (hostname !== expected) {
    console.warn(
      `[reCAPTCHA] token came from ${hostname}, expected ${expected}`
    );
    throw new RecaptchaError(
      "That did not pass the robot check. Please try again.",
      "failed"
    );
  }
}
