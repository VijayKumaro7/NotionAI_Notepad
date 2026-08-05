/**
 * Server-side demo limit.
 *
 * The browser-side limit in client/src/lib/demoSession.ts is per browser: clear
 * site data or open a private window and it resets. This makes the deadline
 * survive that by recording it against the visitor rather than the browser.
 *
 * What is stored
 * --------------
 * Only a keyed hash. The raw IP address and user agent are used to compute an
 * HMAC and are then discarded — nothing in the database can be read back into
 * an address, and without the key the hash cannot be matched against a guess.
 * Rows are deleted once they are past the retention window.
 *
 * What this can and cannot do
 * ---------------------------
 * It is a deterrent, not enforcement. Two people behind one office NAT or a
 * mobile carrier's CGNAT share an address, so one visitor's demo can use up
 * another's. Equally, a phone moving between networks gets a new address and so
 * a new demo. Anyone determined to have a second look will manage it. The
 * intent is to stop the limit being bypassed by reflex — a private window —
 * rather than to make it airtight.
 *
 * Set DEMO_LIMIT_SALT to enable. Unset means the limit stays browser-only.
 */

import { createHmac } from "crypto";
import type { Request } from "express";

/** How long a hashed visitor record is kept after its demo ends. */
export const DEMO_RETENTION_MS = 24 * 60 * 60 * 1000;

export function isDemoLimitEnabled(): boolean {
  return Boolean(process.env.DEMO_LIMIT_SALT);
}

/**
 * The client address, preferring the forwarded header when the app sits behind
 * a proxy. Only the first entry is used — the rest are appended by intermediate
 * hops and are not trustworthy.
 */
function clientAddress(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;

  if (raw) {
    const first = raw.split(",")[0]?.trim();
    if (first) return first;
  }

  return req.ip ?? req.socket?.remoteAddress ?? "";
}

/**
 * Coarse browser family, so a user agent string alone cannot single someone
 * out. Anything more specific would be fingerprinting.
 */
function browserFamily(req: Request): string {
  const ua = String(req.headers["user-agent"] ?? "");

  if (/edg\//i.test(ua)) return "edge";
  if (/chrome|crios/i.test(ua)) return "chrome";
  if (/firefox|fxios/i.test(ua)) return "firefox";
  if (/safari/i.test(ua)) return "safari";
  return "other";
}

/**
 * A stable, non-reversible id for this visitor. Returns null when the limit is
 * switched off or there is no address to work from, so callers fall back to the
 * browser-side limit rather than failing.
 */
export function visitorHash(req: Request): string | null {
  const salt = process.env.DEMO_LIMIT_SALT;
  if (!salt) return null;

  const address = clientAddress(req);
  if (!address) return null;

  return createHmac("sha256", salt)
    .update(`${address}|${browserFamily(req)}`)
    .digest("hex");
}
