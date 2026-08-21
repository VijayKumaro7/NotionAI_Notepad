/**
 * Transactional email: address verification and password reset.
 *
 * A small POST to a JSON email API rather than a mail library. Resend,
 * Postmark, SendGrid and friends all accept the same shape — a from, a to, a
 * subject and a body — so a dependency-free sender covers them, and swapping
 * vendor is a URL and a key rather than a package.
 *
 * Unset configuration reports itself, the way cloud backup does. The
 * alternative — pretending to send and returning success — is the worse
 * failure: someone registers, never receives the link, and the logs say
 * everything worked.
 */

import { ENV } from "./_core/env";

export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain text. No HTML: nothing here needs it, and it cannot carry markup. */
  text: string;
};

export class EmailError extends Error {
  constructor(
    message: string,
    readonly reason: "not_configured" | "send_failed"
  ) {
    super(message);
    this.name = "EmailError";
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(ENV.emailApiUrl && ENV.emailApiKey && ENV.emailFrom);
}

/**
 * A header injection guard.
 *
 * Even though this sends JSON rather than assembling SMTP by hand, a newline in
 * a subject is never legitimate and some providers do build headers from these
 * fields. Rejecting is right rather than stripping: a subject containing a
 * newline means something upstream is wrong.
 */
function assertHeaderSafe(value: string, field: string): void {
  if (/[\r\n]/.test(value)) {
    throw new EmailError(`Invalid ${field}`, "send_failed");
  }
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!isEmailConfigured()) {
    throw new EmailError(
      "Email delivery is not configured on this server.",
      "not_configured"
    );
  }

  assertHeaderSafe(message.to, "recipient");
  assertHeaderSafe(message.subject, "subject");

  let response: Response;
  try {
    response = await fetch(ENV.emailApiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ENV.emailApiKey}`,
      },
      body: JSON.stringify({
        from: ENV.emailFrom,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
  } catch (error) {
    throw new EmailError(
      `Could not reach the email provider: ${String(error)}`,
      "send_failed"
    );
  }

  if (!response.ok) {
    // Body is read for the log only. It can echo the recipient and the
    // provider's own errors, neither of which belongs in an HTTP response to
    // the browser.
    const detail = await response.text().catch(() => "");
    throw new EmailError(
      `Email provider rejected the message: ${response.status} ${response.statusText} ${detail}`.trim(),
      "send_failed"
    );
  }
}

/**
 * Absolute link into this app.
 *
 * Built from PUBLIC_ORIGIN and never from the request. A Host header is
 * attacker-controlled, and a reset link built from one is a working reset token
 * delivered to whatever server the attacker named — the classic host header
 * poisoning account takeover.
 */
export function appUrl(path: string): string {
  if (!ENV.publicOrigin) {
    throw new EmailError(
      "PUBLIC_ORIGIN is not set, so links in email cannot be built safely.",
      "not_configured"
    );
  }

  return new URL(path, ENV.publicOrigin).toString();
}
