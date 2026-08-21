/**
 * The two HTTP endpoints Google's redirect flow needs.
 *
 * Express rather than tRPC because a browser redirect is not an RPC: Google
 * sends the person back with query parameters, and the response has to be a
 * 302 with a cookie on it.
 */

import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { getSessionCookieOptions } from "./_core/cookies";
import * as db from "./db";
import {
  GoogleAuthError,
  authorizeUrl,
  createFlowSecrets,
  exchangeCode,
  isGoogleConfigured,
  openFlow,
  resolveGoogleAccount,
  sameSecret,
  FLOW_TTL_MS,
  flowSecret,
  sealFlow,
} from "./googleAuth";
import { establishSession } from "./session";

const FLOW_COOKIE = "google_oauth_flow";

/**
 * Read one cookie off the request.
 *
 * The app does not mount cookie-parser — sdk.ts parses the header itself with
 * the `cookie` package — so `req.cookies` is undefined here. Doing the same
 * rather than adding middleware keeps one way of reading cookies in the server.
 */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parseCookieHeader(header)[name];
}

const getQueryParam = (req: Request, key: string): string | undefined => {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
};

/** Errors go back to /login as a code, never as a message in the URL. */
const failSignIn = (res: Response, reason: string) =>
  res.redirect(302, `/login?error=${encodeURIComponent(reason)}`);

export function registerGoogleRoutes(app: Express) {
  app.get("/api/auth/google/start", async (req: Request, res: Response) => {
    if (!isGoogleConfigured()) {
      failSignIn(res, "google_unavailable");
      return;
    }

    try {
      const secrets = createFlowSecrets();
      const sealed = await sealFlow(secrets, flowSecret());

      res.cookie(FLOW_COOKIE, sealed, {
        ...getSessionCookieOptions(req),
        secure: true,
        // Lax, not Strict: the browser arrives back on a cross-site redirect
        // from Google, and a Strict cookie is not sent on that navigation, so
        // the callback would never see the state it is supposed to compare.
        sameSite: "lax",
        maxAge: FLOW_TTL_MS,
      });

      res.redirect(302, authorizeUrl(secrets));
    } catch (error) {
      console.error("[Google] Could not start sign-in", error);
      failSignIn(res, "google_unavailable");
    }
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    // Google reports a refusal here — a closed consent screen, mostly.
    const googleError = getQueryParam(req, "error");
    if (googleError) {
      res.clearCookie(FLOW_COOKIE, getSessionCookieOptions(req));
      failSignIn(res, "google_declined");
      return;
    }

    if (!code || !state) {
      failSignIn(res, "missing_code");
      return;
    }

    try {
      const secrets = await openFlow(readCookie(req, FLOW_COOKIE), flowSecret());

      // The state comparison is what ties this callback to the browser that
      // started the flow. Without it a callback URL can be handed to someone
      // else and sign them into the attacker's account.
      if (!sameSecret(state, secrets.state)) {
        throw new GoogleAuthError("State did not match.", "bad_state");
      }

      // One flow, one use — cleared before anything else can go wrong, so a
      // replayed callback finds nothing to compare against.
      res.clearCookie(FLOW_COOKIE, getSessionCookieOptions(req));

      const identity = await exchangeCode({
        code,
        codeVerifier: secrets.codeVerifier,
        nonce: secrets.nonce,
      });

      const user = await resolveGoogleAccount(identity, db);
      const { destination } = await establishSession(req, res, user);
      res.redirect(302, destination);
    } catch (error) {
      res.clearCookie(FLOW_COOKIE, getSessionCookieOptions(req));

      if (error instanceof GoogleAuthError) {
        console.warn("[Google] Sign-in refused:", error.reason, error.message);
        failSignIn(res, error.reason);
        return;
      }

      console.error("[Google] Callback failed", error);
      failSignIn(res, "callback_failed");
    }
  });
}
