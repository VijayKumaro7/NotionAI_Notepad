/**
 * Response headers the browser enforces on our behalf.
 *
 * The server sent none of these. That left three things unguarded that nothing
 * in the application code can guard by itself:
 *
 * - **Framing.** Any site could put this app in an iframe, overlay its own
 *   chrome, and collect a password on a page that really is ours. A note app
 *   with a sign-in form is a plausible thing to impersonate, and clickjacking
 *   is the cheap way to do it.
 * - **Injected script.** Client-side encryption means the browser holds the
 *   key. Script that reaches the page reaches the key, so a content policy is
 *   worth more here than it would be in an app whose server could read the
 *   data anyway.
 * - **Referrer.** Verification and reset links carry their token in the query
 *   string, and the reset page loads a font from Google. With the default
 *   policy the token stays out of that request, but only because the default
 *   happens to be strict; saying so explicitly is what keeps it true.
 *
 * The policy is deliberately different in development, where Vite serves the
 * app: HMR needs an inline script and a WebSocket to itself, and a policy that
 * broke the dev server would be removed rather than fixed.
 */

import type { NextFunction, Request, Response } from "express";
import { ENV } from "./env";

/**
 * Where the app legitimately talks to a third party.
 *
 * reCAPTCHA runs Google's script and shows its challenge in an iframe; the
 * fonts come from Google's CDN; the landing page's screenshots come from the
 * CloudFront distribution they were published to. Everything else the app needs
 * is same-origin, including the collaboration WebSocket, which `'self'` covers.
 */
const GOOGLE_SCRIPTS = ["https://www.google.com", "https://www.gstatic.com"];
const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";
const LANDING_IMAGES = "https://d2xsxph8kpxj0f.cloudfront.net";

function contentSecurityPolicy(isDevelopment: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-inline' is not here. Vite emits the production bundle as an
    // external module, so nothing on the page needs it.
    "script-src": ["'self'", ...GOOGLE_SCRIPTS],
    // Styles are the one place inline content is allowed. Radix and the
    // animation utilities set style attributes on elements they position, and
    // a nonce cannot cover a style attribute written by a library at runtime.
    "style-src": ["'self'", "'unsafe-inline'", GOOGLE_FONTS_CSS],
    "font-src": ["'self'", GOOGLE_FONTS_FILES, "data:"],
    // data: for the QR code the two-step enrolment draws, blob: for a voice
    // memo played back before it is transcribed.
    "img-src": ["'self'", "data:", "blob:", LANDING_IMAGES],
    "media-src": ["'self'", "blob:"],
    "connect-src": ["'self'"],
    // The reCAPTCHA challenge.
    "frame-src": ["'self'", "https://www.google.com"],
    // Nothing may frame us — the anti-clickjacking half of this file.
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // A form on this page can only post back to this origin, so an injected
    // form cannot ship a password somewhere else.
    "form-action": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };

  if (isDevelopment) {
    // Vite's dev client is injected inline and connects over a WebSocket, and
    // its overlay evaluates module code. None of this exists in the bundle
    // `pnpm build` produces.
    directives["script-src"].push("'unsafe-inline'", "'unsafe-eval'");
    directives["connect-src"].push("ws:", "wss:");
  } else {
    // Only in production: on a plain-http development server this would make
    // every asset request a broken https one.
    directives["upgrade-insecure-requests"] = [];
  }

  return Object.entries(directives)
    .map(([name, values]) =>
      values.length ? `${name} ${values.join(" ")}` : name
    )
    .join("; ");
}

/** Whether the request reached us over TLS, including through a proxy. */
function isHttps(req: Request): boolean {
  if (req.protocol === "https") return true;

  const forwarded = req.headers["x-forwarded-proto"];
  if (!forwarded) return false;

  const protocols = Array.isArray(forwarded) ? forwarded : forwarded.split(",");
  return protocols.some(proto => proto.trim().toLowerCase() === "https");
}

export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const isDevelopment = !ENV.isProduction;

  res.setHeader(
    "Content-Security-Policy",
    contentSecurityPolicy(isDevelopment)
  );
  // Redundant beside frame-ancestors for anything current, and free for
  // anything that is not.
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Not "no-referrer": same-origin navigation keeps its referrer, which the
  // app's own routing benefits from. Cross-origin gets the origin only, so a
  // reset token in a query string never leaves with a request for a font.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // The microphone stays available to this origin — voice memos need it. Every
  // other capability is refused outright, including for framed content.
  res.setHeader(
    "Permissions-Policy",
    [
      "accelerometer=()",
      "camera=()",
      "display-capture=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=(self)",
      "payment=()",
      "usb=()",
    ].join(", ")
  );
  // Isolates the window from anything that opens it, so a page that opens the
  // app cannot reach into it through window.opener.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");

  // HSTS only over TLS. Sending it on a plain-http response is meaningless at
  // best, and on a development machine it pins localhost to https in the
  // browser's store for a year — a wedged laptop, fixable only by clearing the
  // policy by hand.
  if (isHttps(req)) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }

  next();
}

/**
 * Send anything arriving over plain http to the https URL for the same path.
 *
 * Production only, and only for requests a browser can act on: a redirect is
 * how the session cookie's `Secure` flag stops being a promise about a
 * connection nobody made. Behind Render's proxy the hop we see is http, so this
 * reads the forwarded protocol rather than the socket.
 */
/**
 * Reduce a request path to something that cannot leave this origin.
 *
 * `new URL("//evil.example/x", "https://ours")` resolves to evil.example: a
 * path beginning with two slashes is a protocol-relative URL, and browsers read
 * a backslash the same way. Express hands us the path as the client wrote it,
 * so a redirect built from it naively is an open redirect — the one bug this
 * whole file exists to prevent, reintroduced by the fix for it.
 */
export function safePath(originalUrl: string): string {
  const path = originalUrl.replace(/\\/g, "/");
  return `/${path.replace(/^\/+/, "")}`;
}

/**
 * A direct connection from this machine, with no proxy in front.
 *
 * `pnpm start` and `scripts/smoke.sh` both run the production build over plain
 * http on localhost, and so does anyone checking a release before deploying it.
 * Redirecting those to an https port that does not exist would make the
 * production build untestable locally, and a control people have to switch off
 * to do their job is a control that gets switched off.
 *
 * Both halves matter. The socket address cannot be set by a remote caller, and
 * the absence of forwarding headers is what distinguishes "nothing in front of
 * this server" from a proxied request whose Host merely says localhost.
 */
function isDirectLoopback(req: Request): boolean {
  const address = req.socket.remoteAddress ?? "";
  const loopback =
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1";

  const proxied =
    req.headers["x-forwarded-proto"] !== undefined ||
    req.headers["x-forwarded-for"] !== undefined;

  return loopback && !proxied;
}

export function requireHttps(req: Request, res: Response, next: NextFunction) {
  if (!ENV.isProduction || isHttps(req) || isDirectLoopback(req)) {
    next();
    return;
  }

  // A non-GET request cannot be redirected without losing its body, and
  // replaying it over https is the caller's decision, not ours.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(403).json({ error: "HTTPS is required." });
    return;
  }

  // Built from the configured origin where there is one.
  const origin = ENV.publicOrigin || `https://${req.headers.host ?? ""}`;
  res.redirect(308, new URL(safePath(req.originalUrl), origin).toString());
}
