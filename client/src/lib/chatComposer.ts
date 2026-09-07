/**
 * The decisions the chat box makes before it sends anything.
 *
 * These lived inside AIChatBox, which meant the only way to check them was to
 * open a browser and try. They are pure functions of their arguments, so they
 * belong where the suite can reach them — the size arithmetic in particular,
 * which mirrors what the server refuses and is the thing standing between a
 * person and an error they cannot act on.
 *
 * The limits themselves stay in shared/chat.ts, because the server enforces the
 * same ones.
 */

import { TRPCClientError } from "@trpc/client";
import { CHAT_LIMITS, chatPayloadSize, type ChatTurn } from "@shared/chat";

/**
 * Room left for the lead-in an action wraps around its subject — "Rewrite
 * this:" and two newlines, with slack. Trimming the subject to the whole
 * message budget would send a request the server then refuses for the sake of
 * the twelve characters in front of it.
 */
const PROMPT_OVERHEAD = 40;

export type ComposerState = {
  /** The note can be attached without pushing the request over the limit. */
  noteFits: boolean;
  /**
   * The conversation cannot take another turn — too many turns, or too much
   * text even with the note left off. The box offers a new chat rather than a
   * send that would be refused.
   */
  isFull: boolean;
};

/**
 * Which of the three states this conversation is in.
 *
 * The server refuses an oversized request rather than dropping the oldest
 * turns, so this is worked out before sending and shown, instead of being
 * discovered as an error afterwards.
 */
export function composerState(input: {
  draft: string;
  messages: ChatTurn[];
  note: string;
}): ComposerState {
  const { draft, messages, note } = input;

  const withNote = chatPayloadSize({
    message: draft,
    history: messages,
    noteContext: note,
  });
  const withoutNote = chatPayloadSize({ message: draft, history: messages });

  return {
    noteFits: note.length > 0 && withNote <= CHAT_LIMITS.total,
    isFull:
      messages.length >= CHAT_LIMITS.turns || withoutNote > CHAT_LIMITS.total,
  };
}

/**
 * What a text action runs on: the selection when there is one, the note
 * otherwise, and nothing when neither has any text.
 *
 * Null rather than an empty string, so the caller has to decide what to say
 * about it — the box asks for a selection instead of sending a request the
 * server would refuse for being empty.
 */
export function actionSubject(
  selectedText: string | undefined,
  note: string
): string | null {
  const subject = (selectedText?.trim() || note.trim()).slice(
    0,
    CHAT_LIMITS.message - PROMPT_OVERHEAD
  );

  return subject.length > 0 ? subject : null;
}

/**
 * What to tell someone when a turn fails.
 *
 * The server's own messages are written to be shown — "too many chat messages,
 * try again in 3 minutes" says more than any generic line could — so a coded
 * error is passed through. What this adds is the cases the server never sends:
 * a cancelled request, and a network that never reached it.
 */
export function failureMessage(error: unknown): string {
  if (error instanceof TRPCClientError) {
    return error.message;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "Stopped.";
  }

  return "The assistant could not be reached. Check your connection and try again.";
}
