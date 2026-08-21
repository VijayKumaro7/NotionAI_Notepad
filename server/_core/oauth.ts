import type { Express, Request, Response } from "express";
import * as db from "../db";
import { establishSession } from "../session";
import { sdk } from "./sdk";

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
