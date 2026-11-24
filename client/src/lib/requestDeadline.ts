/** Longer than any call the app makes (a transcription is the slowest). */
export const REQUEST_DEADLINE_MS = 120_000;

/**
 * `init` with a deadline added to its signal, so a request the server accepted
 * and then never answered ends instead of waiting for ever. The caller's own
 * signal (a Stop button) still aborts at once.
 */
export function withDeadline(
  init: RequestInit | undefined,
  ms: number = REQUEST_DEADLINE_MS
): RequestInit {
  const deadline = AbortSignal.timeout(ms);
  const own = init?.signal;
  const signal = own ? AbortSignal.any([own, deadline]) : deadline;
  return { ...(init ?? {}), signal };
}
