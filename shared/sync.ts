/**
 * The longest sealed note the server accepts in one push, in characters of the
 * payload (the base64 of the encrypted note, which is about a third larger than
 * the note's own JSON). Both sides read it: the procedure's input schema, and
 * the client, which would otherwise find out only from a validation error.
 */
export const MAX_SYNC_PAYLOAD_CHARS = 200_000;
