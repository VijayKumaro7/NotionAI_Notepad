import { randomBytes } from "crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import * as db from "../db";
import { flowSecret, sameSecret } from "../googleAuth";
import { establishSession } from "../session";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

const FLOW_COOKIE = "portal_oauth_flow";
const FLOW_TTL_MS = 10 * 60 * 1000;
const FLOW_PURPOSE = "portal_oauth";

/**
 * Where the portal sends the browser back to. Derived here, never taken from a
 * request parameter: it used to be decoded from the `state` the client built,
 * which made a value an attacker could write the redirect URI of the exchange.
 */
function callbackUri(req: Request): string {
  const protocol = ENV.isProduction ? "https" : req.protocol;
  const origin = ENV.publicOrigin || `${protocol}://${req.headers.host ?? ""}`;
  return new URL("/api/oauth/callback", origin).toString();
}

/**
 * The flow's secrets, kept in the browser that started it. `state` is only an
 * anti-CSRF value if the callback can compare it with something the attacker's
 * link could not have supplied, so it is sealed in an HttpOnly cookie, as the
 * Google flow does. `purpose` stops this cookie and that one standing in for
 * each other: both are signed with the same key.
 */
async function sealFlow(state: string, redirectUri: string): Promise<string> {
  return new SignJWT({ purpose: FLOW_PURPOSE, state, redirectUri })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor((Date.now() + FLOW_TTL_MS) / 1000))
    .sign(flowSecret());
}

async function openFlow(
  sealed: string | undefined
): Promise<{ state: string; redirectUri: string } | null> {
  if (!sealed) return null;
  try {
    const { payload } = await jwtVerify(sealed, flowSecret(), {
      algorithms: ["HS256"],
    });
    const { purpose, state, redirectUri } = payload as Record<string, unknown>;
    if (
      purpose !== FLOW_PURPOSE ||
      typeof state !== "string" ||
      typeof redirectUri !== "string"
    ) {
      return null;
    }
    return { state, redirectUri };
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  return header ? parseCookieHeader(header)[name] : undefined;
}

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

// The OAuth portal sends the browser here, so a failure has to land the person
// somewhere they can act on. Returning JSON left them staring at
// {"error":"..."} with no way back. /login rather than the landing page,
// because the thing they wanted to do next is try again.
function failSignIn(res: Response, reason: string) {
  res.redirect(302, `/login?auth_error=${encodeURIComponent(reason)}`);
}

export function registerOAuthRoutes(app: Express) {
  // The sign-in button points here rather than straight at the portal, so the
  // server can issue the `state` and remember it.
  app.get("/api/oauth/start", async (req: Request, res: Response) => {
    if (!ENV.oauthPortalUrl || !ENV.appId) {
      console.error("[OAuth] Portal sign-in is not configured on the server");
      failSignIn(res, "callback_failed");
      return;
    }

    try {
      const state = randomBytes(32).toString("base64url");
      const redirectUri = callbackUri(req);

      const cookieOptions = getSessionCookieOptions(req);

      res.cookie(FLOW_COOKIE, await sealFlow(state, redirectUri), {
        ...cookieOptions,
        // Written out, as in googleRoutes.ts, so the flags are visible to a
        // reader and to CodeQL, which cannot follow them through the spread.
        httpOnly: true,
        // The spread's own value (always true in production), not a literal
        // `true`: a Secure cookie is dropped over plain http, which would fail
        // sign-in on a LAN address with a state mismatch that names no cause.
        // See the note on the same line in googleRoutes.ts and SECURITY.md.
        secure: cookieOptions.secure,
        sameSite: "lax",
        maxAge: FLOW_TTL_MS,
      });

      const url = new URL(`${ENV.oauthPortalUrl}/app-auth`);
      url.searchParams.set("appId", ENV.appId);
      url.searchParams.set("redirectUri", redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("type", "signIn");
      res.redirect(302, url.toString());
    } catch (error) {
      console.error("[OAuth] Could not start sign-in", error);
      failSignIn(res, "callback_failed");
    }
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      failSignIn(res, "missing_code");
      return;
    }

    try {
      const flow = await openFlow(readCookie(req, FLOW_COOKIE));
      // Cleared whichever way this goes: the state is single-use.
      res.clearCookie(FLOW_COOKIE, getSessionCookieOptions(req));

      if (!flow || !sameSecret(state, flow.state)) {
        failSignIn(res, "bad_state");
        return;
      }

      const tokenResponse = await sdk.exchangeCodeForToken(
        code,
        flow.redirectUri
      );
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        console.error("[OAuth] User info has no openId");
        failSignIn(res, "no_account");
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      // The OAuth portal has vouched for who this is. Whether that is enough
      // depends on the account, and that decision lives in one place now —
      // establishSession — so the portal, email and Google all pass the same
      // two-step gate rather than each carrying its own copy of it.
      const account = await db.getUserByOpenId(userInfo.openId);
      if (!account) {
        console.error("[OAuth] User row missing straight after upsert");
        failSignIn(res, "no_account");
        return;
      }

      const { destination } = await establishSession(req, res, account);
      res.redirect(302, destination);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      failSignIn(res, "callback_failed");
    }
  });
}
