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
