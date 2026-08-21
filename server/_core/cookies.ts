import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // const hostname = req.hostname;
  // const shouldSetDomain =
  //   hostname &&
  //   !LOCAL_HOSTS.has(hostname) &&
  //   !isIpAddress(hostname) &&
  //   hostname !== "127.0.0.1" &&
  //   hostname !== "::1";

  // const domain =
  //   shouldSetDomain && !hostname.startsWith(".")
  //     ? `.${hostname}`
  //     : shouldSetDomain
  //       ? hostname
  //       : undefined;

  return {
    httpOnly: true,
    path: "/",
    // Lax, not None. None means the session cookie rides along on requests any
    // other site makes to this one, which is the precondition for CSRF and the
    // reason to avoid it. Nothing here needs it: the OAuth portal returns via a
    // top-level navigation, which Lax allows, and everything after that is a
    // same-origin fetch from our own page.
    //
    // It also fixes local development, where None was silently self-defeating —
    // browsers reject SameSite=None without Secure, and Secure is false over
    // plain http, so the session cookie was being dropped on arrival.
    sameSite: "lax",
    // In production, always. Otherwise, follow the request.
    //
    // Deriving this from the request alone looks right and has a bad failure
    // mode: behind a proxy that forgets x-forwarded-proto, isSecureRequest
    // reports false on a site that is genuinely served over HTTPS, and the
    // session cookie goes out without Secure — travelling in clear text on any
    // http:// request an attacker can provoke. CodeQL flagged exactly this on
    // the Google flow cookie.
    //
    // Pinning it to true in production makes a misconfigured proxy break sign-in
    // loudly instead of leaking quietly, which is the right direction to fail.
    // Development over plain http keeps working, which forcing it everywhere
    // would not: browsers drop a Secure cookie on http, and the sign-in flow
    // would fail with a state mismatch that says nothing about the cause.
    secure: ENV.isProduction || isSecureRequest(req),
  };
}
