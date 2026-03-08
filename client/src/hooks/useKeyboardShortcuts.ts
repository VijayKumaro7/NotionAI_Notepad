import { useEffect, useCallback } from 'react';
import { matchesShortcut, SHORTCUTS, getShortcutById } from '@/lib/shortcuts';

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
      // Don't trigger shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        // Allow only specific shortcuts in input fields
        const allowedInInput = ['help', 'command-palette', 'open-search'];
        const matchedShortcut = SHORTCUTS.find((s) => matchesShortcut(event, s));
        if (!matchedShortcut || !allowedInInput.includes(matchedShortcut.id)) {
          return;
        }
      }

      // Find matching shortcut
      const matchedShortcut = SHORTCUTS.find((s) => matchesShortcut(event, s));

      if (matchedShortcut && handlers[matchedShortcut.id]) {
        event.preventDefault();
        handlers[matchedShortcut.id]();
      }
    },
    [handlers]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

/**
 * Get a specific shortcut by ID
 */
export function useShortcut(id: string) {
  return getShortcutById(id);
}

/**
 * Check if a keyboard event matches a specific shortcut
 */
export function useShortcutMatch(event: KeyboardEvent, shortcutId: string): boolean {
  const shortcut = getShortcutById(shortcutId);
  return shortcut ? matchesShortcut(event, shortcut) : false;
}
