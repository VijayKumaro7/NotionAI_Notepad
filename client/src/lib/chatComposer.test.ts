import { describe, it, expect } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { CHAT_LIMITS, type ChatTurn } from "@shared/chat";
import {
  actionSubject,
  composerState,
  failureMessage,
  fits,
} from "./chatComposer";

const turns = (count: number, content = "hi"): ChatTurn[] =>
  Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content,
  }));

describe("composerState", () => {
  it("attaches a note that fits", () => {
    const state = composerState({
      draft: "what does this say?",
      messages: [],
      note: "a short note",
    });

    expect(state).toEqual({ noteFits: true, isFull: false, draftFits: true });
  });

  it("reports no note to attach when the note is empty", () => {
    // Not "does not fit" — there is nothing to fit, and the box says so
    // differently.
    expect(
      composerState({ draft: "hello", messages: [], note: "" }).noteFits
    ).toBe(false);
  });

  it("refuses a note that would push the request over the limit", () => {
    const state = composerState({
      draft: "summarise",
      messages: turns(2, "x".repeat(2_000)),
      note: "y".repeat(CHAT_LIMITS.noteContext),
    });

    expect(state.noteFits).toBe(false);
    // The conversation itself is still fine — only the note is too much, so
    // the box offers the checkbox rather than a new chat.
    expect(state.isFull).toBe(false);
  });

  it("calls a conversation full at the turn cap", () => {
    expect(
      composerState({
        draft: "hi",
        messages: turns(CHAT_LIMITS.turns),
        note: "",
      }).isFull
    ).toBe(true);

    expect(
      composerState({
        draft: "hi",
        messages: turns(CHAT_LIMITS.turns - 1),
        note: "",
      }).isFull
    ).toBe(false);
  });

  it("calls a conversation full on total size, whatever the turn count", () => {
    // Seven turns of four thousand characters: a third of the turn cap, and
    // past the total budget on its own.
    const state = composerState({
      draft: "hi",
      messages: turns(7, "x".repeat(CHAT_LIMITS.message)),
      note: "",
    });

    expect(state.isFull).toBe(true);
  });

  it("does not call a conversation full because of what is being typed", () => {
    // The box replaces the composer when isFull, so counting the draft would
    // delete the textarea out from under someone mid-sentence.
    const messages = turns(4, "x".repeat(1_000));
    const draft = "y".repeat(CHAT_LIMITS.message);

    const state = composerState({ draft, messages, note: "" });

    expect(state.isFull).toBe(false);
    expect(state.draftFits).toBe(true);
  });

  it("says a draft does not fit rather than removing the box", () => {
    const messages = turns(11, "x".repeat(2_000));
    const draft = "y".repeat(CHAT_LIMITS.message);

    const state = composerState({ draft, messages, note: "" });

    expect(state.isFull).toBe(false);
    expect(state.draftFits).toBe(false);
  });
});

describe("fits", () => {
  it("judges the message actually being sent, not the draft", () => {
    // A quick action builds its own message from the selection.
    const messages = turns(4, "x".repeat(2_000));

    expect(fits({ message: "short question", messages, note: "" })).toBe(true);
    expect(
      fits({
        message: "x".repeat(CHAT_LIMITS.message),
        messages,
        note: "y".repeat(15_000),
      })
    ).toBe(false);
  });
});

describe("actionSubject", () => {
  it("prefers the selection", () => {
    expect(actionSubject("  the selected part  ", "the whole note")).toBe(
      "the selected part"
    );
  });

  it("falls back to the note when nothing is selected", () => {
    expect(actionSubject(undefined, "the whole note")).toBe("the whole note");
    expect(actionSubject("   ", "the whole note")).toBe("the whole note");
  });

  it("has nothing to work on when both are empty", () => {
    expect(actionSubject(undefined, "")).toBeNull();
    expect(actionSubject("  ", "   ")).toBeNull();
  });

  it("leaves room for the lead-in the action wraps around it", () => {
    // Trimming to the whole message budget would send a request the server
    // then refuses for the sake of "Rewrite this:" in front of it.
    const subject = actionSubject(
      undefined,
      "x".repeat(CHAT_LIMITS.message * 2)
    );

    expect(subject).not.toBeNull();
    expect(subject!.length).toBeLessThan(CHAT_LIMITS.message);
    expect(`Rewrite this:\n\n${subject}`.length).toBeLessThanOrEqual(
      CHAT_LIMITS.message
    );
  });
});

describe("failureMessage", () => {
  it("passes the server's own words through", () => {
    // "Try again in 3 minutes" says more than any generic line could.
    const error = new TRPCClientError(
      "Too many chat messages. Try again in 3 minutes.",
      {
        result: {
          error: {
            message: "Too many chat messages. Try again in 3 minutes.",
            code: -32001,
            data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 },
          },
        },
      } as never
    );

    expect(failureMessage(error)).toBe(
      "Too many chat messages. Try again in 3 minutes."
    );
  });

  it("does not call a cancelled request a failure", () => {
    const aborted = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });

    expect(failureMessage(aborted)).toBe("Stopped.");
  });

  it("says what to do when the request never arrived", () => {
    // A network error carries nothing worth showing, so this is the one case
    // the client writes itself.
    expect(failureMessage(new TypeError("Failed to fetch"))).toContain(
      "Check your connection"
    );
  });

  it("does not show the browser's wording for a request that never landed", () => {
    // tRPC wraps a failed fetch in the same error type as a refusal from the
    // server. Passing every one of those through verbatim put "Failed to
    // fetch" in front of people and made this branch unreachable.
    const networkFailure = new TRPCClientError("Failed to fetch");

    expect(networkFailure.data).toBeUndefined();
    expect(failureMessage(networkFailure)).toContain("Check your connection");
  });
});
