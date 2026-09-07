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

const UNREACHABLE =
  "The assistant could not be reached. Check your connection and try again.";

export type ComposerState = {
  /** The note can be attached without pushing the request over the limit. */
  noteFits: boolean;
  /**
   * The conversation itself cannot take another turn — too many turns, or too
   * much stored text. The box offers a new chat rather than a send that would
   * be refused.
   *
   * Judged on what has already been said, never on what is being typed: the
   * box replaces the composer when this is true, so counting the draft would
   * delete the textarea out from under someone mid-sentence.
   */
  isFull: boolean;
  /** This particular message still fits. Says whether Send can do anything. */
  draftFits: boolean;
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
  const conversationOnly = chatPayloadSize({ message: "", history: messages });
  const noteFits = note.length > 0 && withNote <= CHAT_LIMITS.total;

  return {
    noteFits,
    isFull:
      messages.length >= CHAT_LIMITS.turns ||
      conversationOnly >= CHAT_LIMITS.total,
    draftFits:
      (noteFits
        ? withNote
        : chatPayloadSize({ message: draft, history: messages })) <=
      CHAT_LIMITS.total,
  };
}

/**
 * Whether a message can be sent as things stand.
 *
 * The quick actions build their message from the selection rather than from
 * the box, so what Send was allowed to do says nothing about them — this is
 * asked with the message actually about to go.
 */
export function fits(payload: {
  message: string;
  messages: ChatTurn[];
  note: string;
}): boolean {
  return (
    chatPayloadSize({
      message: payload.message,
      history: payload.messages,
      noteContext: payload.note,
    }) <= CHAT_LIMITS.total
  );
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
  if (error instanceof Error && error.name === "AbortError") {
    return "Stopped.";
  }

  if (error instanceof TRPCClientError) {
    // tRPC wraps a failed fetch in the same error type as a refusal from the
    // server, so "did the server answer at all" is the question — not the
    // error's class. Without `data` there was no reply to read, and the
    // browser's own wording ("Failed to fetch") tells nobody anything.
    return error.data ? error.message : UNREACHABLE;
  }

  return UNREACHABLE;
}
