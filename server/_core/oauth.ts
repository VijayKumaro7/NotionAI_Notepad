import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { PENDING_SESSION_MS, sdk } from "./sdk";

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
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      failSignIn(res, "missing_code");
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
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
      // depends on the account: an enrolment that was confirmed means there is
      // a second factor still to clear, and the cookie set below reflects that.
      const account = await db.getUserByOpenId(userInfo.openId);
      const twoFactor = account ? await db.getTwoFactor(account.id) : null;
      const needsSecondFactor = Boolean(twoFactor?.confirmedAt);

      const expiresInMs = needsSecondFactor ? PENDING_SESSION_MS : ONE_YEAR_MS;
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs,
        scope: needsSecondFactor ? "pending_2fa" : "full",
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: expiresInMs,
      });

      // Land signed-in users in the workspace, not back on the marketing page.
      // Anyone still owing a code goes to /login, which reads the pending
      // cookie and asks for it.
      res.redirect(302, needsSecondFactor ? "/login" : "/app");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      failSignIn(res, "callback_failed");
    }
  });
}
