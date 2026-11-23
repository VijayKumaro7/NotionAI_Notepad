/**
 * Close codes the collaboration socket uses, so the server that sends them and
 * the client that decides what to do about them agree on what they mean.
 *
 * 4401, 4403 and 4404 are the server saying no (not signed in, no access, no
 * such room). Retrying any of them changes nothing, so the client does not.
 */
export const CLOSE_UNAUTHENTICATED = 4401;
export const CLOSE_FORBIDDEN = 4403;
export const CLOSE_BAD_ROOM = 4404;
