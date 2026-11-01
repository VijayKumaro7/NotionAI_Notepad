import React, { useRef, useCallback, useMemo, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Code,
  Quote,
  Link,
  Undo2,
  Redo2,
  MoreHorizontal,
  Clock,
  Share2,
} from "lucide-react";
import {
  SHORTCUTS,
  getShortcutById,
  matchesShortcut,
  formatKeys,
} from "@/lib/shortcuts";

interface RichTextEditorProps {
  /**
   * Which note this is. The editor is mounted once and shown for whichever note
   * is open, so this is the only thing that tells it the text in front of it is
   * a different document and its undo history belongs to the last one.
   */
  noteId: string;
  /**
   * What is selected in the note, reported whenever the selection changes by
   * mouse, keyboard or code, and as an empty string once it collapses. Read from
   * the textarea's own range, because `window.getSelection()` does not report
   * text inside a textarea in every browser.
   */
  onSelectionChange?: (text: string) => void;
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  onShowVersionHistory?: () => void;
  onShowShare?: () => void;
}

export function RichTextEditor({
  noteId,
  onSelectionChange,
  content,
  onChange,
  placeholder = "Start typing...",
  onShowVersionHistory,
  onShowShare,
}: RichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [history, setHistory] = useState<string[]>([content]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // A new note starts a new history. Done while rendering rather than in an
  // effect, so the first render of the new note never sees the old note's
  // history: React re-renders at once with the state reset.
  const [historyNoteId, setHistoryNoteId] = useState(noteId);
  if (historyNoteId !== noteId) {
    setHistoryNoteId(noteId);
    setHistory([content]);
    setHistoryIndex(0);
  } else if (content !== history[historyIndex]) {
    // The parent changed the content and the editor did not type it: an AI
    // insertion, a voice transcription, a restored version, a sync. It is a
    // step of its own, so undo can take it back; left out, undo stepped over it,
    // and with nothing typed yet it was disabled and the change could not be
    // undone at all. Anything the editor does itself leaves the history and the
    // content equal on the next render, so only an outside change gets here.
    const next = [...history.slice(0, historyIndex + 1), content];
    setHistory(next);
    setHistoryIndex(next.length - 1);
  }

  // Read off the content, never kept as state of their own: the parent changes
  // the content without going through this editor (an AI insertion, a voice
  // transcription, a restored version, a sync), and a count that only updated
  // when this component typed described a note that was no longer there.
  const charCount = content.length;
  const wordCount = useMemo(
    () => content.split(/\s+/).filter(Boolean).length,
    [content]
  );

  const updateContent = useCallback(
    (newContent: string) => {
      onChange(newContent);

      // Update history
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newContent);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [history, historyIndex, onChange]
  );

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const { value, selectionStart, selectionEnd } = e.currentTarget;
      onSelectionChange?.(value.slice(selectionStart, selectionEnd));
    },
    [onSelectionChange]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateContent(e.target.value);
    },
    [updateContent]
  );

  const insertMarkdown = useCallback(
    (before: string, after: string = "") => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = content.substring(start, end);
      const newContent =
        content.substring(0, start) +
        before +
        selectedText +
        after +
        content.substring(end);

      updateContent(newContent);

      // Restore cursor position
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(
          start + before.length,
          start + before.length + selectedText.length
        );
      }, 0);
    },
    [content, updateContent]
  );

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      onChange(history[newIndex]);
    }
  }, [history, historyIndex, onChange]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      onChange(history[newIndex]);
    }
  }, [history, historyIndex, onChange]);

  // One action per Formatting-category shortcut in lib/shortcuts.ts, so the
  // keyboard handler below and the toolbar buttons call the exact same
  // function rather than two copies of the same insertMarkdown call drifting
  // apart. heading3 has no toolbar button (H1/H2 are all the toolbar offers)
  // but is wired here anyway: ShortcutsModal advertises it like any other
  // Formatting shortcut, and a keyboard-only action is enough to make that
  // advertisement true.
  const formattingActions: Record<string, () => void> = {
    bold: () => insertMarkdown("**", "**"),
    italic: () => insertMarkdown("*", "*"),
    underline: () => insertMarkdown("__", "__"),
    code: () => insertMarkdown("`", "`"),
    heading1: () => insertMarkdown("# ", ""),
    heading2: () => insertMarkdown("## ", ""),
    heading3: () => insertMarkdown("### ", ""),
    "bullet-list": () => insertMarkdown("- ", ""),
    "numbered-list": () => insertMarkdown("1. ", ""),
    quote: () => insertMarkdown("> ", ""),
  };

  // Undo and redo are the Editing-category shortcuts whose state lives here,
  // so the textarea is where they can run; the others are NotesApp's.
  const historyActions: Record<string, () => void> = { undo, redo };

  /**
   * ShortcutsModal lists every Formatting shortcut (Cmd+B, Cmd+Alt+1, ...) as
   * though pressing it does something. None of them did: the global handler
   * in useKeyboardShortcuts only lets `help`/`command-palette`/`open-search`
   * through while focus is in a textarea, and NotesApp never registered the
   * rest anyway. This is the one place that focus actually reaches, so it is
   * the one place that can make the advertised keys real.
   */
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    for (const shortcut of SHORTCUTS) {
      const action =
        shortcut.category === "Formatting"
          ? formattingActions[shortcut.id]
          : historyActions[shortcut.id];
      if (action && matchesShortcut(e.nativeEvent, shortcut)) {
        e.preventDefault();
        action();
        return;
      }
    }
  };

  const toolbarButtons = [
    {
      icon: Bold,
      label: "Bold",
      onClick: formattingActions.bold,
      shortcutId: "bold",
    },
    {
      icon: Italic,
      label: "Italic",
      onClick: formattingActions.italic,
      shortcutId: "italic",
    },
    {
      icon: Underline,
      label: "Underline",
      onClick: formattingActions.underline,
      shortcutId: "underline",
    },
    { divider: true },
    {
      icon: Heading1,
      label: "Heading 1",
      onClick: formattingActions.heading1,
      shortcutId: "heading1",
    },
    {
      icon: Heading2,
      label: "Heading 2",
      onClick: formattingActions.heading2,
      shortcutId: "heading2",
    },
    { divider: true },
    {
      icon: List,
      label: "Bullet List",
      onClick: formattingActions["bullet-list"],
      shortcutId: "bullet-list",
    },
    {
      icon: ListOrdered,
      label: "Numbered List",
      onClick: formattingActions["numbered-list"],
      shortcutId: "numbered-list",
    },
    { divider: true },
    {
      icon: Code,
      label: "Code",
      onClick: formattingActions.code,
      shortcutId: "code",
    },
    {
      icon: Quote,
      label: "Quote",
      onClick: formattingActions.quote,
      shortcutId: "quote",
    },
    { divider: true },
    {
      icon: Undo2,
      label: "Undo",
      onClick: undo,
      disabled: historyIndex === 0,
    },
    {
      icon: Redo2,
      label: "Redo",
      onClick: redo,
      disabled: historyIndex === history.length - 1,
    },
    { divider: true },
    {
      icon: Clock,
      label: "Version History",
      onClick: onShowVersionHistory,
    },
    {
      icon: Share2,
      label: "Share",
      onClick: onShowShare,
    },
  ];

  return (
    <div className="flex flex-col h-full bg-card rounded-lg border border-border overflow-hidden focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-ring">
      {/* Toolbar */}
      <div className="editor-toolbar">
        {toolbarButtons.map((btn, idx) => {
          if ("divider" in btn) {
            return (
              <div
                key={`divider-${idx}`}
                className="h-6 w-px bg-border/50 mx-1"
              />
            );
          }

          const Icon = btn.icon;
          const shortcut = btn.shortcutId
            ? getShortcutById(btn.shortcutId)
            : undefined;
          return (
            <button
              key={btn.label}
              onClick={btn.onClick}
              disabled={btn.disabled}
              title={
                shortcut
                  ? `${btn.label} (${formatKeys(shortcut.keys)})`
                  : btn.label
              }
              className="editor-toolbar-button"
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>

      {/* Editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleEditorKeyDown}
        onSelect={handleSelect}
        placeholder={placeholder}
        className="editor-textarea flex-1"
        spellCheck="true"
      />

      {/* Footer Stats */}
      <div className="flex items-center justify-between px-4 py-2 bg-card/50 border-t border-border text-xs text-muted-foreground">
        <div className="flex gap-4">
          <span>{charCount} characters</span>
          <span>{wordCount} words</span>
        </div>
        <div className="text-xs">
          Tip: Use **bold**, *italic*, # heading, - list
        </div>
      </div>
    </div>
  );
}
