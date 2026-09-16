/**
 * Password length bounds, shared by the form and the procedure.
 *
 * Here rather than in server/password.ts because the browser needs them too —
 * a form that lets someone type an eleven-character password and then has the
 * server reject it has wasted their time to tell them something it knew before
 * they pressed anything. The server still checks; this is so the form can say
 * the same thing first, from the same numbers, rather than from a copy that
 * drifts.
 *
 * server/password.ts imports these rather than declaring its own, and the
 * client must not import that module: it pulls in node's crypto and would be a
 * hashing implementation compiled into the page.
 */

/**
 * Length only. Composition rules — one capital, one symbol — push people
 * towards `Passw0rd!`, which is short, predictable and satisfies all of them.
 * Twelve characters of anything is worth more.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Not a limit on what the algorithm can take — scrypt does not truncate. It
 * exists so a megabyte of input cannot be used to tie up 64MB of RAM per
 * request.
 */
export const MAX_PASSWORD_LENGTH = 200;
