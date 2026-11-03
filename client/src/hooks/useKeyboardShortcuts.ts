import { useEffect, useCallback } from "react";
import { matchesShortcut, SHORTCUTS, type Shortcut } from "@/lib/shortcuts";

/**
 * Chords a text field already uses: deleting a line, undoing typing, and the
 * formatting keys the editor's own `onKeyDown` turns into markdown. Taking them
 * globally would break typing or fight the editor.
 */
const FIELD_OWNED_IDS = new Set(["delete-note", "undo", "redo"]);

function ownedByTextField(shortcut: Shortcut): boolean {
  return shortcut.category === "Formatting" || FIELD_OWNED_IDS.has(shortcut.id);
}

interface ShortcutHandlers {
  [key: string]: () => void;
}

/**
 * Custom hook for handling keyboard shortcuts
 * Registers global keyboard event listeners and triggers callbacks
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const matchedShortcut = SHORTCUTS.find(s => matchesShortcut(event, s));
      if (!matchedShortcut || !handlers[matchedShortcut.id]) return;

      // A text field keeps the chords it already means something for. Everything
      // else is the app's: nearly every shortcut is pressed from inside the note
      // body, which is a textarea, and an allow-list of three left Cmd+S — the
      // one people reach for mid-sentence — to the browser's "save page".
      const target = event.target as HTMLElement;
      const inField =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (inField && ownedByTextField(matchedShortcut)) return;

      event.preventDefault();
      handlers[matchedShortcut.id]();
    },
    [handlers]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}
