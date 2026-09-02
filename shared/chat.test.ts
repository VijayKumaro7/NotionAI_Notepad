import { describe, it, expect } from "vitest";
import { CHAT_LIMITS, chatPayloadSize } from "./chat";

describe("chatPayloadSize", () => {
  it("counts the message on its own", () => {
    expect(chatPayloadSize({ message: "hello" })).toBe(5);
  });

  it("counts the turns that will be resent", () => {
    expect(
      chatPayloadSize({
        message: "hello",
        history: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hey" },
        ],
      })
    ).toBe(10);
  });

  it("counts the note, which is what usually fills the budget", () => {
    expect(
      chatPayloadSize({ message: "summarise", noteContext: "x".repeat(1_000) })
    ).toBe(1_009);
  });

  it("leaves room for a message once a full-size note is attached", () => {
    const spare =
      CHAT_LIMITS.total -
      chatPayloadSize({
        message: "",
        noteContext: "x".repeat(CHAT_LIMITS.noteContext),
      });
    expect(spare).toBeGreaterThanOrEqual(CHAT_LIMITS.message);
  });
});
