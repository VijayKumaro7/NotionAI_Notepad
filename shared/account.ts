/**
 * The confirmation phrase, shared by the dialog that asks for it and the
 * procedure that checks it.
 *
 * The server is what enforces it — the button being disabled is a courtesy,
 * not a control. But the two have to agree on what counts as having typed it,
 * or the dialog enables a button the server then refuses, or worse, disables
 * one that would have worked. One copy of the phrase and one copy of the
 * comparison is the only way that stays true.
 */

export const CONFIRMATION_PHRASE = "delete my account";

/**
 * Whether someone typed the phrase, being forgiving about how.
 *
 * Case and surrounding space are not the point — the point is that the words
 * were typed out deliberately rather than produced by a stray click. Insisting
 * on the capitalisation would only make a confirmation box that refuses a
 * correct answer.
 */
export function matchesConfirmation(typed: string): boolean {
  return (
    typed.trim().replace(/\s+/g, " ").toLowerCase() === CONFIRMATION_PHRASE
  );
}
