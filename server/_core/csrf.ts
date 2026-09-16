/**
 * Refusing a request that another site told the browser to make.
 *
 * The session cookie is `SameSite=Lax`, which already means a browser will not
 * attach it to a cross-site POST — that is the protection doing most of the
 * work here, and it is described in _core/cookies.ts. This file is the second
 * layer, and it exists for three reasons rather than for tidiness:
 *
 * - Lax is a property of the browser, not of this server. It protects us for
 *   exactly as long as every browser in use agrees about what Lax means, and
 *   the history of that attribute is a history of it changing.
 * - A cookie attribute cannot be tested from the server side. An origin check
 *   can, so "cross-site writes are refused" becomes an assertion in a test file
 *   rather than a claim in a comment.
 * - Lax has a documented hole: a top-level GET navigation carries the cookie.
 *   Nothing state-changing here answers GET, but that is a property of the
 *   router that nothing enforces, and an origin check does not care.
 *
 * What it deliberately does not do is invent a token. A synchroniser token
 * would mean somewhere to keep it, somewhere to put it on every call, and a new
 * way for sign-in to break; the app is a single origin talking to itself, so
 * checking that the caller *is* that origin answers the same question with
 * nothing to store.
 */

import type { NextFunction, Request, Response } from "express";
import { ENV } from "./env";

/**
 * Methods that can change something. GET, HEAD and OPTIONS are excluded because
 * they are supposed to be safe — and where tRPC is concerned they are, since
 * queries are GET and every mutation is POST.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Where a request is allowed to say it came from.
 *
 * The configured origin wins when there is one: it is the deployment's own
 * statement of what it is, rather than a header the caller wrote. Falling back
 * to the Host header is weaker — a caller controls it — but a request that lies
 * about Host to match its own Origin has not gained anything, because the
 * browser would not have attached the cookie to it in the first place.
 */
function isTrustedOrigin(origin: string, host: string | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (ENV.publicOrigin) {
    try {
      return parsed.host === new URL(ENV.publicOrigin).host;
    } catch {
      // A malformed PUBLIC_ORIGIN falls through to the Host comparison rather
      // than refusing every request on the deployment.
    }
  }

  return Boolean(host) && parsed.host === host;
}

/**
 * Decide, from the two headers a browser sets and cannot be talked out of
 * setting, whether this request came from our own page.
 *
 * `Origin` is preferred; `Referer` is the fallback for the handful of older
 * clients that omit Origin on same-origin POSTs, and only its origin part is
 * read — the path is none of our business and logging it would be recording
 * where someone was.
 *
 * A request with neither is allowed through. That is the deliberate part: every
 * browser sends at least one on a cross-site POST, so a request with neither is
 * a non-browser client — curl, a health check, a test — which is not the thing
 * this stops. Those callers have no ambient cookie to be abused, which is what
 * CSRF is made of. The same judgement, for the same reason, is already made by
 * the WebSocket handshake check in _core/collaboration.ts.
 */
export function isAllowedRequestOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) {
    // `null` included, deliberately. It is what a sandboxed iframe and a
    // `data:` document send, and it is an origin — an opaque one that matches
    // nothing. Treating it as "no Origin header" and falling through to the
    // permissive default below is how a check like this ends up waving through
    // the one caller it should be most suspicious of.
    return isTrustedOrigin(origin, req.headers.host);
  }

  const referer = req.headers.referer;
  if (typeof referer === "string" && referer) {
    try {
      return isTrustedOrigin(new URL(referer).origin, req.headers.host);
    } catch {
      return false;
    }
  }

  return true;
}

export function requireSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (SAFE_METHODS.has(req.method) || isAllowedRequestOrigin(req)) {
    next();
    return;
  }

  // No detail. The caller already knows which origin it sent, and naming the
  // one we expected would help someone mapping the deployment rather than
  // helping anyone fix a real problem.
  res.status(403).json({ error: "Cross-origin request refused." });
}
