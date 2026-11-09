/**
 * What a signed token is for.
 *
 * Three kinds of token are signed with the same key (`JWT_SECRET`): the session
 * cookie and the two sign-in flow cookies. They already could not stand in for
 * one another, but only because each reader happens to require fields the
 * others lack (`openId` for a session, `state`/`nonce` for a flow). That is a
 * property of today's payloads; the next claim someone adds to one of them can
 * quietly remove it. The `aud` claim says what the token is for in one place,
 * and every reader checks it.
 *
 * Sessions accept a token with no `aud`: those were issued before this claim
 * existed and live for up to a year, and signing everyone out for a hardening
 * change is a poor trade. They are still checked against the session row, so
 * they stay revocable. The flow cookies last ten minutes, so they require it.
 */

import type { JWTPayload } from "jose";

export const AUDIENCE = {
  session: "notepad:session",
  googleFlow: "notepad:google-flow",
  portalFlow: "notepad:portal-flow",
} as const;

export type Audience = (typeof AUDIENCE)[keyof typeof AUDIENCE];

/**
 * Whether a verified payload was issued for `expected`.
 *
 * A token for some other purpose never passes. A token with no audience passes
 * only where `allowLegacy` says tokens of that age exist.
 */
export function hasAudience(
  payload: JWTPayload,
  expected: Audience,
  options: { allowLegacy?: boolean } = {}
): boolean {
  const { aud } = payload;
  if (aud === undefined) return options.allowLegacy === true;
  return typeof aud === "string"
    ? aud === expected
    : aud.length === 1 && aud[0] === expected;
}
