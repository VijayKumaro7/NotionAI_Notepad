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
 * How many reverse proxies sit between the internet and this process.
 *
 * `X-Forwarded-For` is appended left to right, so with one proxy in front an
 * honest request arrives as `<client>` and a request from someone who sent the
 * header themselves arrives as `<whatever they typed>, <client>`. Only the
 * right-hand end of that list was written by infrastructure we control; the
 * rest is caller-supplied text.
 *
 * Defaults to one hop in production, which is what the documented Render
 * deployment has (see render.yaml), and to none in development, where the
 * server is reached directly and the header should carry no weight at all. A
 * deployment behind a CDN as well as the platform proxy sets
 * TRUSTED_PROXY_HOPS=2, and one exposed directly sets it to 0.
 */
function trustedProxyHops(): number {
  const configured = process.env.TRUSTED_PROXY_HOPS;

  if (configured) {
    const hops = Number(configured);
    if (Number.isInteger(hops) && hops >= 0) return hops;
  }

  return process.env.NODE_ENV === "production" ? 1 : 0;
}

/**
 * The client address, as seen by the outermost proxy we trust.
 *
 * This used to take the *first* `X-Forwarded-For` entry, which is the one an
 * attacker writes: send a different value on every request and every limit
 * keyed on this — sign-in attempts per origin, registrations per origin, the
 * demo deadline — counts each attempt against a fresh bucket and stops
 * limiting anything. Counting hops from the right takes the address the
 * nearest trusted proxy actually observed instead, which is the only part of
 * the chain the caller cannot choose.
 */
export function clientAddress(req: Request): string {
  const direct = req.ip ?? req.socket?.remoteAddress ?? "";
  const hops = trustedProxyHops();
  if (hops === 0) return direct;

  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;

  const chain = (raw ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);

  if (chain.length === 0) return direct;

  // One trusted hop means the last entry; two means the one before it. A chain
  // shorter than the configured hop count means fewer proxies appended than
  // expected, so fall back to its leftmost entry rather than reading past the
  // start of the list.
  return chain[Math.max(chain.length - hops, 0)] ?? direct;
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
