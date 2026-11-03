import { describe, it, expect } from "vitest";
import { insertAtRange } from "./insertText";

describe("insertAtRange", () => {
  it("puts the text at a collapsed cursor", () => {
    expect(insertAtRange("hello world", { start: 5, end: 5 }, ",")).toBe(
      "hello, world"
    );
  });

  it("replaces a selection", () => {
    expect(insertAtRange("hello world", { start: 6, end: 11 }, "there")).toBe(
      "hello there"
    );
  });

  it("appends on a new line when nothing has reported a cursor", () => {
    expect(insertAtRange("hello", null, "world")).toBe("hello\nworld");
  });

  it("clamps a range left over from a longer version of the note", () => {
    expect(insertAtRange("hi", { start: 40, end: 50 }, "!")).toBe("hi!");
  });

  it("does not let a reversed range duplicate text", () => {
    expect(insertAtRange("abcdef", { start: 4, end: 2 }, "X")).toBe("abXef");
  });
});

import { prefixLines } from "./insertText";

describe("prefixLines", () => {
  it("marks the line the cursor is on and moves the cursor with the text", () => {
    expect(prefixLines("a\nbc", { start: 3, end: 3 }, "# ")).toEqual({
      content: "a\n# bc",
      range: { start: 5, end: 5 },
    });
  });

  it("marks every line a selection touches", () => {
    expect(prefixLines("a\nb\nc", { start: 0, end: 3 }, "- ")).toEqual({
      content: "- a\n- b\nc",
      range: { start: 2, end: 7 },
    });
  });

  it("leaves the next line alone when the selection ends after a newline", () => {
    expect(prefixLines("a\nb", { start: 0, end: 2 }, "> ").content).toBe(
      "> a\nb"
    );
  });
});
