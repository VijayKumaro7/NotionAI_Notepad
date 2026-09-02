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
import { clientAddress } from "./demoLimit";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

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

/**
 * How often one address may run either half of the Google flow.
 *
 * Both routes are public and both spend something per call — three 32-byte
 * secrets and a seal on the way out, an outbound token exchange with Google on
 * the way back. One middleware guards both, so thirty in fifteen minutes is a
 * budget shared across the pair rather than thirty each.
 *
 * Middleware from express-rate-limit rather than the hand-rolled check that was
 * here before. That check was correct and enforced exactly this, but it was a
 * conditional buried inside the handler: nothing reading the route could tell
 * the route was limited, and CodeQL's js/missing-rate-limiting kept reporting
 * it because the query only recognises limiting that arrives as middleware.
 * Being legible to a reviewer and to analysis is worth more here than owning
 * the implementation, and the standard middleware also answers with proper
 * RateLimit headers, which the old one did not.
 *
 * keyGenerator is ours rather than the default `req.ip`. This app does not set
 * `trust proxy`, so req.ip is the address of the proxy in front of it — every
 * visitor would land in one bucket. clientAddress reads the trusted end of
 * X-Forwarded-For instead; see the note on it in demoLimit.ts.
 *
 * That address goes through ipKeyGenerator rather than being used raw, which
 * matters more than it looks: a residential IPv6 allocation is a /64, so
 * keying on the full address would hand anyone with one about 1.8e19 buckets
 * and no limit at all. ipKeyGenerator collapses v6 to its subnet and leaves v4
 * alone. The library flags a raw key generator for exactly this reason.
 */
const googleAuthRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  keyGenerator: (req: Request) => ipKeyGenerator(clientAddress(req)),
  // draft-7 sends one combined `RateLimit: limit=30, remaining=29, reset=…`
  // header plus RateLimit-Policy. draft-8 is newer but states the policy as a
  // quoted name that fewer clients parse; draft-6's separate headers are on
  // their way out. The old hand-rolled check sent none of them.
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // The library warns when it sees X-Forwarded-For without `trust proxy`, on
  // the assumption the default keyGenerator is in use and would be fooled. It
  // is not in use, and the reason it is not is the same one the warning is
  // about, so the check has nothing left to catch here.
  validate: { xForwardedForHeader: false },
  // A redirect rather than a bare 429: this is a browser in the middle of
  // signing in, and /login has a message for this reason
  // (client/src/lib/signInErrors.ts). The flow cookie goes too — refusing to
  // spend a state and verifier while leaving them live in the browser is the
  // one thing this path must not do.
  handler: (req: Request, res: Response) => {
    res.clearCookie(FLOW_COOKIE, getSessionCookieOptions(req));
    failSignIn(res, "rate_limited");
  },
});

export function registerGoogleRoutes(app: Express) {
  app.get(
    "/api/auth/google/start",
    googleAuthRateLimit,
    async (req: Request, res: Response) => {
      if (!isGoogleConfigured()) {
        failSignIn(res, "google_unavailable");
        return;
      }

      try {
        const secrets = createFlowSecrets();
        const sealed = await sealFlow(secrets, flowSecret());
        const cookieOptions = getSessionCookieOptions(req);

        res.cookie(FLOW_COOKIE, sealed, {
          ...cookieOptions,
          // Spelled out even though the spread above already sets it. Two
          // reasons: anyone reading this line can see that the flow cookie is
          // never readable from script, and a later change to
          // getSessionCookieOptions cannot quietly take that away from the one
          // cookie that carries an unspent OAuth state and PKCE verifier.
          //
          // It also answers CodeQL's js/client-exposed-cookie, which reported
          // this cookie because it could not follow the property through the
          // spread. The flag was already set; now it is visible where it matters.
          httpOnly: true,
          // The same value the spread already carries — `ENV.isProduction ||
          // <the request arrived over https>` — written out for exactly the
          // reason httpOnly is above. A property reaching this call through a
          // spread is invisible to anyone skimming the line, and invisible to
          // analysis: js/clear-text-cookie reported this cookie not because
          // `secure` was wrong but because it could not find `secure` here at
          // all.
          //
          // Not pinned to a literal `true`, which would settle the alert and
          // break development over plain http on an ngrok tunnel or a LAN
          // address — browsers drop a Secure cookie there, and the flow then
          // fails on a state mismatch that names no cause. `http://localhost`
          // is unaffected either way, being a secure context. In production
          // this expression is unconditionally true, which is the only place
          // the cookie crosses a network anyone else can see. See
          // server/_core/cookies.ts, and SECURITY.md under "Sessions".
          secure: cookieOptions.secure,
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
    }
  );

  app.get(
    "/api/auth/google/callback",
    googleAuthRateLimit,
    async (req: Request, res: Response) => {
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
        const secrets = await openFlow(
          readCookie(req, FLOW_COOKIE),
          flowSecret()
        );

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
          console.warn(
            "[Google] Sign-in refused:",
            error.reason,
            error.message
          );
          failSignIn(res, error.reason);
          return;
        }

        console.error("[Google] Callback failed", error);
        failSignIn(res, "callback_failed");
      }
    }
  );
}
