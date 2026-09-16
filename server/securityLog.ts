/**
 * What happened to an account, written down.
 *
 * The value of an audit log is that it can answer "was that me?" months later,
 * and the risk of one is that it becomes a second copy of everything sensitive
 * that passed through the request. This module is shaped around the second
 * problem: the only things it can write are a type from `SecurityEventType`, an
 * account id, a keyed hash of the caller's address, a coarse device label and a
 * short phrase from `detail`. There is no field for free text, so there is
 * nowhere for a password, a token, a cookie or an email address to end up, even
 * by accident at a call site written in a hurry.
 *
 * Two rules that look like omissions and are not:
 *
 * - A failed sign-in against an address with no account records no address.
 *   Writing it down would assemble, out of failed guesses, exactly the list of
 *   addresses the identical error messages exist to refuse to confirm.
 * - Nothing here ever throws. An audit write that can fail a request turns a
 *   brief database hiccup into a sign-in outage, and a missing line in a log is
 *   worth much less than a refused login.
 */

import type { Request } from "express";
import * as db from "./db";
import { clientAddress } from "./demoLimit";
import { describeDevice, hashAddress } from "./sessionStore";

/**
 * Every kind of event this app records.
 *
 * A closed union rather than a string, so a typo is a type error and the set of
 * things the log can say stays readable in one place.
 */
export type SecurityEventType =
  | "sign_in_succeeded"
  | "sign_in_first_factor"
  | "sign_in_failed"
  | "sign_out"
  | "register_requested"
  | "email_verified"
  | "password_reset_requested"
  | "password_reset_completed"
  | "password_changed"
  | "session_revoked"
  | "sessions_revoked_all"
  | "two_factor_enabled"
  | "two_factor_disabled"
  | "two_factor_failed"
  | "rate_limited"
  | "account_deleted";

/**
 * The fixed phrases a call site may attach to an event.
 *
 * Closed for the same reason the types are: a `detail` that accepted anything
 * would, sooner or later, be handed the thing that was being checked.
 */
export type SecurityEventDetail =
  | "wrong_password"
  | "no_account"
  | "unverified_email"
  | "invalid_token"
  | "idle_timeout"
  | "by_user"
  | "after_password_change"
  | "after_password_reset"
  | "two_factor_code"
  | "recovery_code";

export type SecurityEventInput = {
  /** Null when the attempt names no account we are willing to confirm exists. */
  userId: number | null;
  type: SecurityEventType;
  detail?: SecurityEventDetail;
};

/**
 * Record an event, taking the origin from the request.
 *
 * Returns a promise, and every caller may ignore it: the audit trail is a
 * record of what happened, not a step in making it happen.
 */
export async function record(
  req: Pick<Request, "headers" | "ip" | "socket">,
  input: SecurityEventInput
): Promise<void> {
  await safely(async () =>
    db.recordSecurityEvent({
      userId: input.userId,
      type: input.type,
      ipHash: hashAddress(clientAddress(req as Request)),
      device: describeDevice(req.headers["user-agent"] as string | undefined),
      detail: input.detail ?? null,
    })
  );
}

/**
 * Record an event with no request to read an origin from.
 *
 * The password-reset path reaches this: it runs from a link click whose request
 * belongs to the person clicking, which is not necessarily the person the event
 * is about.
 */
export async function recordForUser(input: SecurityEventInput): Promise<void> {
  await safely(async () =>
    db.recordSecurityEvent({
      userId: input.userId,
      type: input.type,
      ipHash: null,
      device: null,
      detail: input.detail ?? null,
    })
  );
}

/**
 * Swallow whatever the write threw, and say so in the process log.
 *
 * The query in db.ts already catches, and this catches again on purpose: the
 * guarantee that recording an event cannot fail a request is one that every
 * call site here relies on — `establishSession` awaits this in the middle of
 * signing somebody in — so it belongs where those callers can see it, not
 * only in the layer underneath, where a refactor could quietly remove it.
 *
 * The error goes to console.error and not to the audit table. Failing to write
 * a row is not itself an account event, and trying to record it in the store
 * that just refused a write is the obvious way to turn one failure into a loop.
 */
async function safely(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    console.error("[Security] Failed to record event", error);
  }
}
