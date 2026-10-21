/**
 * ShortcutsModal lists the whole Formatting category — Bold, Italic,
 * Underline, Code, Heading 1/2/3, Bullet List, Numbered List, Quote — with a
 * platform-correct key combo next to each, as though pressing it does
 * something. None of them did: the global handler in useKeyboardShortcuts
 * only lets `help`/`command-palette`/`open-search` through while focus sits
 * in a textarea, and NotesApp never registered the rest regardless. The
 * editor's own `<textarea>` is the one place focus for typing actually
 * reaches, so it is the one place that can make the advertised keys real.
 *
 * The toolbar buttons already did the right insertMarkdown call on click;
 * this is the same action, reached from the keyboard instead, through the
 * same `formattingActions` map the keyboard handler and the toolbar buttons
 * both read from.
 */

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RichTextEditor } from "./RichTextEditor";

const setPlatform = (platform: string) => {
  Object.defineProperty(navigator, "platform", {
    value: platform,
    configurable: true,
  });
};

const realPlatform = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "platform"
);

afterEach(() => {
  cleanup();
  if (realPlatform) {
    Object.defineProperty(navigator, "platform", realPlatform);
  }
});

function getTextarea() {
  return screen.getByPlaceholderText("Start typing...") as HTMLTextAreaElement;
}

describe("formatting shortcuts reaching the textarea", () => {
  it("Ctrl+B wraps the selection, the same as clicking Bold, on a non-Mac platform", () => {
    setPlatform("Win32");
    const onChange = vi.fn();
    render(<RichTextEditor content="hello world" onChange={onChange} />);

    const textarea = getTextarea();
    textarea.setSelectionRange(0, 5); // "hello"
    fireEvent.keyDown(textarea, { key: "b", ctrlKey: true });

    expect(onChange).toHaveBeenCalledWith("**hello** world");
  });

  it("Cmd+B (metaKey) wraps the selection on a Mac platform", () => {
    setPlatform("MacIntel");
    const onChange = vi.fn();
    render(<RichTextEditor content="hello world" onChange={onChange} />);

    const textarea = getTextarea();
    textarea.setSelectionRange(0, 5);
    fireEvent.keyDown(textarea, { key: "b", metaKey: true });

    expect(onChange).toHaveBeenCalledWith("**hello** world");
  });

  it("a bare 'b' with no modifier does not trigger Bold", () => {
    setPlatform("Win32");
    const onChange = vi.fn();
    render(<RichTextEditor content="hello world" onChange={onChange} />);

    const textarea = getTextarea();
    textarea.setSelectionRange(0, 5);
    fireEvent.keyDown(textarea, { key: "b" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("Ctrl+Alt+3 inserts a Heading 3 marker, though no toolbar button exists for it", () => {
    setPlatform("Win32");
    const onChange = vi.fn();
    render(<RichTextEditor content="note" onChange={onChange} />);

    const textarea = getTextarea();
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "3", ctrlKey: true, altKey: true });

    expect(onChange).toHaveBeenCalledWith("### note");
  });
});

describe("toolbar tooltips", () => {
  it("show the platform-correct key combo on a non-Mac platform", () => {
    setPlatform("Win32");
    render(<RichTextEditor content="" onChange={() => {}} />);

    expect(screen.getByTitle("Bold (Ctrl+B)")).toBeTruthy();
    expect(screen.getByTitle("Italic (Ctrl+I)")).toBeTruthy();
  });

  it("show the Mac symbol on a Mac platform", () => {
    setPlatform("MacIntel");
    render(<RichTextEditor content="" onChange={() => {}} />);

    expect(screen.getByTitle("Bold (⌘B)")).toBeTruthy();
  });

  it("falls back to the plain label for a button with no shortcut, like Undo", () => {
    setPlatform("Win32");
    render(<RichTextEditor content="" onChange={() => {}} />);

    expect(screen.getByTitle("Undo")).toBeTruthy();
  });
});

describe("undo and redo shortcuts reaching the textarea", () => {
  // The editor's history only grows through its own onChange, so it has to be
  // fed back the content it reports, the way NotesApp does.
  function Harness({ onChange }: { onChange: (c: string) => void }) {
    const [content, setContent] = useState("a");
    return (
      <RichTextEditor
        content={content}
        onChange={c => {
          setContent(c);
          onChange(c);
        }}
      />
    );
  }

  const type = (textarea: HTMLTextAreaElement, value: string) =>
    fireEvent.change(textarea, { target: { value } });

  it("Ctrl+Z steps back through edits and Ctrl+Shift+Z steps forward again", () => {
    setPlatform("Win32");
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const textarea = getTextarea();

    type(textarea, "ab");
    type(textarea, "abc");

    fireEvent.keyDown(textarea, { key: "z", ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith("ab");

    fireEvent.keyDown(textarea, { key: "z", ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith("a");

    fireEvent.keyDown(textarea, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith("ab");
  });

  it("Cmd+Z (metaKey) undoes on a Mac platform", () => {
    setPlatform("MacIntel");
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const textarea = getTextarea();

    type(textarea, "ab");
    fireEvent.keyDown(textarea, { key: "z", metaKey: true });

    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("undoing with nothing to undo changes nothing", () => {
    setPlatform("Win32");
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.keyDown(getTextarea(), { key: "z", ctrlKey: true });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("the character count follows an undo", () => {
    setPlatform("Win32");
    render(<Harness onChange={() => {}} />);
    const textarea = getTextarea();

    type(textarea, "abcd");
    expect(screen.getByText(/4 characters/i)).toBeTruthy();

    fireEvent.keyDown(textarea, { key: "z", ctrlKey: true });
    expect(screen.getByText(/1 characters/i)).toBeTruthy();
  });
});
