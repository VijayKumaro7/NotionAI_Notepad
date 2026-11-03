/**
 * Which shortcuts reach the app while focus is in a text field.
 *
 * Nearly every shortcut is pressed from inside the note body, which is a
 * `<textarea>`. The hook used to let three through there (`help`,
 * `command-palette`, `open-search`) and drop the rest, so Cmd+S, the one
 * people reach for mid-sentence, did nothing in the app and left the browser's
 * own "save page" to run. The rule is the other way round now: a field keeps
 * the chords it already means something for, and the app gets everything else.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

type Init = KeyboardEventInit;

/** Press a key on an element and say whether the page's default was prevented. */
function press(target: Element, init: Init): boolean {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function field(tag: "textarea" | "input") {
  const element = document.createElement(tag);
  document.body.appendChild(element);
  return element;
}

describe("a shortcut pressed inside a text field", () => {
  it.each([
    ["save", { key: "s", ctrlKey: true }],
    ["share-note", { key: "s", ctrlKey: true, shiftKey: true }],
    ["version-history", { key: "h", ctrlKey: true }],
    ["new-note", { key: "n", ctrlKey: true }],
    ["new-folder", { key: "n", ctrlKey: true, shiftKey: true }],
    ["toggle-theme", { key: "t", ctrlKey: true, shiftKey: true }],
    ["open-search", { key: "f", ctrlKey: true }],
    ["command-palette", { key: "/", ctrlKey: true }],
  ])("still reaches the app: %s", (id, init) => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts({ [id]: handler }));

    const prevented = press(field("textarea"), init);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it("reaches the app from a single-line input too", () => {
    const save = vi.fn();
    renderHook(() => useKeyboardShortcuts({ save }));

    press(field("input"), { key: "s", ctrlKey: true });

    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["delete-note", { key: "Delete", ctrlKey: true }],
    ["undo", { key: "z", ctrlKey: true }],
    ["redo", { key: "z", ctrlKey: true, shiftKey: true }],
    ["bold", { key: "b", ctrlKey: true }],
    ["italic", { key: "i", ctrlKey: true }],
  ])(
    "is left to the field when it already means something there: %s",
    (id, init) => {
      const handler = vi.fn();
      renderHook(() => useKeyboardShortcuts({ [id]: handler }));

      const prevented = press(field("textarea"), init);

      expect(handler).not.toHaveBeenCalled();
      expect(prevented).toBe(false);
    }
  );

  it("does not take a plain letter, which is just typing", () => {
    const save = vi.fn();
    renderHook(() => useKeyboardShortcuts({ save }));

    press(field("textarea"), { key: "s" });

    expect(save).not.toHaveBeenCalled();
  });
});

describe("a shortcut pressed outside a text field", () => {
  it("reaches the app", () => {
    const save = vi.fn();
    renderHook(() => useKeyboardShortcuts({ save }));

    const prevented = press(document.body, { key: "s", ctrlKey: true });

    expect(save).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it("leaves a chord alone when the app has no handler for it", () => {
    renderHook(() => useKeyboardShortcuts({}));

    expect(press(document.body, { key: "s", ctrlKey: true })).toBe(false);
  });
});
