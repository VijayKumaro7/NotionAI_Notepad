/**
 * The one request a panel is waiting on.
 *
 * Three panels — the chat box, the assistant and the voice memo — each keep an
 * AbortController in a ref and each worked out the bookkeeping around it
 * separately. All three got it wrong, in the same three ways, and the mistakes
 * were only ever found by opening a browser and trying. The rules are small
 * and have nothing to do with React, so they live here where the suite can
 * reach them:
 *
 * - a reply may only be acted on while its own attempt is still the one being
 *   waited on;
 * - an attempt asks about *its own* signal, never about whatever is current;
 * - letting go of a finished attempt must not disturb the one that replaced it.
 *
 * `abandon` is the rule the components kept missing. Aborting is a request to
 * the network, not an answer from it: a reply already on its way still lands,
 * and if the panel is still holding the controller that reply is still "the
 * current one" and gets used. Stopping therefore has to let go of the attempt
 * as well as abort it — that is what makes a late reply nobody's.
 */

export type InFlight = {
  /**
   * Begin an attempt. Anything still running is abandoned first: nobody is
   * waiting on it, and leaving it live means two replies racing for the same
   * panel.
   */
  start(): AbortController;
  /** Is this attempt still the one being waited on? */
  owns(attempt: AbortController): boolean;
  /**
   * Stop waiting: abort, and let go, so a reply already on its way belongs to
   * nobody when it arrives. False when there was nothing running, which is how
   * a Stop handler knows whether it has anything to report.
   */
  abandon(): boolean;
  /**
   * Let go of a finished attempt. False when it had already been replaced —
   * the caller is cleaning up after a request the panel stopped caring about,
   * and must leave the current one's state alone.
   */
  settle(attempt: AbortController): boolean;
};

export function createInFlight(): InFlight {
  let current: AbortController | null = null;

  return {
    start() {
      current?.abort();
      current = new AbortController();
      return current;
    },

    owns(attempt) {
      return current === attempt;
    },

    abandon() {
      if (!current) return false;
      current.abort();
      current = null;
      return true;
    },

    settle(attempt) {
      if (current !== attempt) return false;
      current = null;
      return true;
    },
  };
}
