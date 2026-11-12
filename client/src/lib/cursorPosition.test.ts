/**
 * `cursorPixelPosition` exists because a `<textarea>`'s text is never DOM
 * content: `LiveCursors` used to read `editor.textContent` off the textarea's
 * wrapper, which is always empty, so every collaborator's cursor rendered at
 * a fixed point regardless of where they actually were.
 *
 * jsdom does not lay out real text, so none of this can prove where a
 * wrapped line actually breaks — that is left to a real browser, same as
 * other text-reflow bugs in this codebase. What is tested here is the
 * plumbing around that: which element's text and scroll position feed the
 * measurement, and the arithmetic that turns a raw screen measurement into a
 * position relative to the positioned ancestor `LiveCursors` draws into.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cursorPixelPosition } from "./cursorPosition";

const CHAR_WIDTH = 8;

function rectAt(left: number, top: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width: 0,
    height: 0,
    right: left,
    bottom: top,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

/**
 * Lays text out as `CHAR_WIDTH` px per character on one line — enough to
 * tell which text and how much of it was measured, without claiming to
 * reproduce a real browser's word-wrap. One spy for the whole test: a second
 * `vi.spyOn` on an instance whose method already resolves to this one would
 * not layer on top of it, it would reconfigure the same shared mock.
 */
function stubLayout(container: HTMLElement, containerRect?: DOMRect) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this === container) return containerRect ?? rectAt(0, 0);
      if (this.tagName === "SPAN") {
        const before = this.previousSibling?.textContent ?? "";
        return rectAt(before.length * CHAR_WIDTH, 0);
      }
      return rectAt(0, 0);
    }
  );
}

/**
 * `getComputedStyle` reads an empty string for every property of an element
 * that was never attached to the document — not "0px", an empty string,
 * which `parseFloat` turns into `NaN` and the `|| 0` fallback then hides as
 * if nothing had been set. Padding and border only resolve once attached.
 */
function buildTextarea(value: string): {
  container: HTMLDivElement;
  textarea: HTMLTextAreaElement;
} {
  const container = document.createElement("div");
  const textarea = document.createElement("textarea");
  container.appendChild(textarea);
  document.body.appendChild(container);
  textarea.value = value;
  return { container, textarea };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("cursorPixelPosition", () => {
  it("measures the textarea's own value, not the container's text content", () => {
    const { container, textarea } = buildTextarea("hello world");
    stubLayout(container);

    // A textarea's value never shows up as text content anywhere in the DOM
    // — this is what the fixed-position bug came from. Proving the function
    // used `.value` is proving the bug is gone.
    expect(container.textContent).toBe("");

    const { x, y } = cursorPixelPosition(textarea, container, 5);

    expect(x).toBe(5 * CHAR_WIDTH);
    expect(y).toBe(0);
  });

  it("positions relative to the container, not the viewport", () => {
    const { container, textarea } = buildTextarea("abc");
    stubLayout(container, rectAt(100, 40));

    const { x, y } = cursorPixelPosition(textarea, container, 2);

    expect(x).toBe(2 * CHAR_WIDTH - 100);
    expect(y).toBe(0 - 40);
  });

  it("subtracts the container's own border, not just its position", () => {
    const { container, textarea } = buildTextarea("abc");
    container.style.borderStyle = "solid"; // a width with no style computes to 0
    container.style.borderLeftWidth = "3px";
    container.style.borderTopWidth = "1px";
    stubLayout(container);

    const { x, y } = cursorPixelPosition(textarea, container, 0);

    expect(x).toBe(-3);
    expect(y).toBe(-1);
  });

  it("subtracts how far the textarea has scrolled", () => {
    const { container, textarea } = buildTextarea("a very long line of text");
    textarea.scrollLeft = 40;
    textarea.scrollTop = 12;
    stubLayout(container);

    const { x, y } = cursorPixelPosition(textarea, container, 3);

    expect(x).toBe(3 * CHAR_WIDTH - 40);
    expect(y).toBe(0 - 12);
  });

  it("clamps a position past the end of the text rather than throwing", () => {
    const { container, textarea } = buildTextarea("short");
    stubLayout(container);

    const { x } = cursorPixelPosition(textarea, container, 999);

    expect(x).toBe("short".length * CHAR_WIDTH);
  });

  it("does not leave the measuring element behind", () => {
    const { container, textarea } = buildTextarea("abc");
    stubLayout(container);

    cursorPixelPosition(textarea, container, 1);

    expect(container.children.length).toBe(1);
    expect(container.firstElementChild).toBe(textarea);
  });
});
