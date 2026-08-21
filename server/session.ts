/**
 * Minting a signed-in session, in one place.
 *
 * Every way into the app ends here: the Manus portal callback, email and
 * password, and Google. That is deliberate. The two-step verification gate is
 * one `if`, and if each sign-in path had its own copy, adding a fourth would
 * mean remembering to write it again — a second factor that guards two doors
 * out of three is not a second factor.
 */

import type { Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { PENDING_SESSION_MS, sdk } from "./_core/sdk";
import * as db from "./db";

export type SignedInUser = {
  id: number;
  openId: string;
  name: string | null;
};

/**
 * Put a session cookie on the response and say where the browser should land.
 *
 * Returns the destination rather than redirecting, because the tRPC procedures
 * need the same decision without an HTTP redirect.
 */
export async function establishSession(
  req: Request,
  res: Response,
  user: SignedInUser
): Promise<{ needsSecondFactor: boolean; destination: string }> {
  const twoFactor = await db.getTwoFactor(user.id);
  const needsSecondFactor = Boolean(twoFactor?.confirmedAt);

  const expiresInMs = needsSecondFactor ? PENDING_SESSION_MS : ONE_YEAR_MS;
  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name || "",
    expiresInMs,
    scope: needsSecondFactor ? "pending_2fa" : "full",
  });

  res.cookie(COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge: expiresInMs,
  });

  // Anyone still owing a code goes to /login, which reads the pending cookie
  // and asks for it. Everyone else lands in the workspace.
  return {
    needsSecondFactor,
    destination: needsSecondFactor ? "/login" : "/app",
  };
}
