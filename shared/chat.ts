/**
 * The size limits the chat box and the chat procedure have to agree on.
 *
 * The server enforces them — `chatInput` in server/chat.ts refuses anything
 * over, rather than trimming the oldest turns, because an assistant that
 * quietly forgets the start of a conversation is a bug nobody can see. That
 * makes it the client's job to notice beforehand and say so, which needs the
 * same numbers and the same arithmetic on both sides.
 */

export const CHAT_LIMITS = {
  /** Characters in one message, sent or received. */
  message: 4_000,
  /** Prior turns the client may resend. */
  turns: 20,
  /** Characters of note the client may attach for grounding. */
  noteContext: 20_000,
  /** Characters across the whole request. Every turn is resent every time. */
  total: 24_000,
} as const;

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

/** What a request would spend against `CHAT_LIMITS.total`. */
export function chatPayloadSize(payload: {
  message: string;
  history?: ChatTurn[];
  noteContext?: string;
}): number {
  return (
    payload.message.length +
    (payload.noteContext?.length ?? 0) +
    (payload.history ?? []).reduce(
      (total, turn) => total + turn.content.length,
      0
    )
  );
}
