import { describe, it, expect } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { CHAT_LIMITS, type ChatTurn } from "@shared/chat";
import { actionSubject, composerState, failureMessage } from "./chatComposer";

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

    expect(state).toEqual({ noteFits: true, isFull: false });
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
      "Too many chat messages. Try again in 3 minutes."
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
});
