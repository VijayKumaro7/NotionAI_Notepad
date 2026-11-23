/**
 * How long a call to someone else's server may take before it is given up on.
 *
 * `fetch` with no signal waits for as long as undici's own limits allow (five
 * minutes for the headers, five more between chunks of the body), so a provider
 * that accepts the connection and then says nothing holds a sign-in, a
 * password reset or the reCAPTCHA check open that long, and the request behind
 * it holds a connection and its memory. Every caller already treats a throw as
 * "could not reach it" and fails closed, so the limit only makes that answer
 * arrive in seconds. One signal covers the body as well as the headers.
 *
 * Not used for the AI provider and voice transcription: a completion can run
 * for a long time legitimately, and those calls carry the caller's own
 * cancellation instead.
 */
export const OUTBOUND_TIMEOUT_MS = 10_000;

export function outboundSignal(): AbortSignal {
  return AbortSignal.timeout(OUTBOUND_TIMEOUT_MS);
}
