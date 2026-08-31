/**
 * Keyboard Shortcuts Configuration
 * Defines all available keyboard shortcuts for the application
 */

export type ShortcutCategory =
  "Navigation" | "Editing" | "Formatting" | "General" | "Search";

export interface Shortcut {
  id: string;
  name: string;
  description: string;
  keys: string[];
  category: ShortcutCategory;
  action?: () => void;
}

export const SHORTCUTS: Shortcut[] = [
  // Navigation
  {
    id: "new-note",
    name: "New Note",
    description: "Create a new note",
    keys: ["Cmd", "N"],
    category: "Navigation",
  },
  {
    id: "new-folder",
    name: "New Folder",
    description: "Create a new folder",
    keys: ["Cmd", "Shift", "N"],
    category: "Navigation",
  },
  {
    id: "open-search",
    name: "Search Notes",
    description: "Open search to find notes",
    keys: ["Cmd", "F"],
    category: "Navigation",
  },
  {
    id: "command-palette",
    name: "Command Palette",
    description: "Open command palette for quick actions",
    keys: ["Cmd", "/"],
    category: "Navigation",
  },
  {
    id: "help",
    name: "Help",
    description: "Open keyboard shortcuts help",
    keys: ["Cmd", "?"],
    category: "General",
  },

  // Editing
  {
    id: "save",
    name: "Save Note",
    description: "Save current note (auto-saves)",
    keys: ["Cmd", "S"],
    category: "Editing",
  },
  {
    id: "undo",
    name: "Undo",
    description: "Undo last action",
    keys: ["Cmd", "Z"],
    category: "Editing",
  },
  {
    id: "redo",
    name: "Redo",
    description: "Redo last undone action",
    keys: ["Cmd", "Shift", "Z"],
    category: "Editing",
  },
  {
    id: "delete-note",
    name: "Delete Note",
    description: "Delete current note",
    keys: ["Cmd", "Delete"],
    category: "Editing",
  },

  // Formatting
  {
    id: "bold",
    name: "Bold",
    description: "Make text bold",
    keys: ["Cmd", "B"],
    category: "Formatting",
  },
  {
    id: "italic",
    name: "Italic",
    description: "Make text italic",
    keys: ["Cmd", "I"],
    category: "Formatting",
  },
  {
    id: "underline",
    name: "Underline",
    description: "Underline text",
    keys: ["Cmd", "U"],
    category: "Formatting",
  },
  {
    id: "code",
    name: "Code",
    description: "Format as code",
    keys: ["Cmd", "E"],
    category: "Formatting",
  },
  {
    id: "heading1",
    name: "Heading 1",
    description: "Format as heading 1",
    keys: ["Cmd", "Alt", "1"],
    category: "Formatting",
  },
  {
    id: "heading2",
    name: "Heading 2",
    description: "Format as heading 2",
    keys: ["Cmd", "Alt", "2"],
    category: "Formatting",
  },
  {
    id: "heading3",
    name: "Heading 3",
    description: "Format as heading 3",
    keys: ["Cmd", "Alt", "3"],
    category: "Formatting",
  },
  {
    id: "bullet-list",
    name: "Bullet List",
    description: "Create bullet list",
    keys: ["Cmd", "Shift", "B"],
    category: "Formatting",
  },
  {
    id: "numbered-list",
    name: "Numbered List",
    description: "Create numbered list",
    keys: ["Cmd", "Shift", "L"],
    category: "Formatting",
  },
  {
    id: "quote",
    name: "Quote",
    description: "Format as quote",
    keys: ["Cmd", "Shift", "Q"],
    category: "Formatting",
  },

  // General
  {
    id: "toggle-theme",
    name: "Toggle Theme",
    description: "Switch between light and dark mode",
    keys: ["Cmd", "Shift", "T"],
    category: "General",
  },
  {
    id: "version-history",
    name: "Version History",
    description: "Open version history",
    keys: ["Cmd", "H"],
    category: "General",
  },
  {
    id: "share-note",
    name: "Share Note",
    description: "Open share dialog",
    keys: ["Cmd", "Shift", "S"],
    category: "General",
  },
];

/**
 * Group shortcuts by category
 */
export function groupShortcutsByCategory(): Record<
  ShortcutCategory,
  Shortcut[]
> {
  const grouped: Record<ShortcutCategory, Shortcut[]> = {
    Navigation: [],
    Editing: [],
    Formatting: [],
    General: [],
    Search: [],
  };

  SHORTCUTS.forEach(shortcut => {
    grouped[shortcut.category].push(shortcut);
  });

  return grouped;
}

/**
 * Get shortcut by ID
 */
export function getShortcutById(id: string): Shortcut | undefined {
  return SHORTCUTS.find(s => s.id === id);
}

/**
 * Format keys for display
 */
export function formatKeys(keys: string[]): string {
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  return keys
    .map(key => {
      if (key === "Cmd") return isMac ? "⌘" : "Ctrl";
      if (key === "Shift") return isMac ? "⇧" : "Shift";
      if (key === "Alt") return isMac ? "⌥" : "Alt";
      if (key === "Delete") return isMac ? "⌫" : "Delete";
      return key;
    })
    .join(isMac ? "" : "+");
}

/**
 * Check if a keyboard event matches a shortcut
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: Shortcut
): boolean {
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey;

  const wants = (modifier: string) => shortcut.keys.includes(modifier);

  // A modifier the shortcut does not name has to be absent.
  //
  // This used to check only the modifiers a shortcut declared, which made every
  // shortcut a prefix of its own Shift variant: Cmd+Shift+S matched Save as
  // well as Share, Cmd+Shift+N matched New note as well as New folder, and
  // Cmd+Shift+Z matched Undo as well as Redo. Whichever the handler reached
  // first won, so the Shift variants were effectively unreachable.
  if (isCtrlOrCmd !== wants("Cmd")) return false;
  if (event.altKey !== wants("Alt")) return false;

  const mainKey = shortcut.keys.find(
    key => key !== "Cmd" && key !== "Shift" && key !== "Alt"
  );
  if (!mainKey) return false;

  // Shift is only enforced for alphanumeric keys. On most layouts Cmd+? is
  // physically Cmd+Shift+/, so the character already carries the shift;
  // demanding shiftKey be false there would make the shortcut unreachable.
  if (/^[a-z0-9]$/i.test(mainKey) && event.shiftKey !== wants("Shift")) {
    return false;
  }

  return mainKey === "Delete"
    ? event.key === "Delete"
    : event.key.toLowerCase() === mainKey.toLowerCase();
}

/**
 * Parse keyboard event to shortcut string
 */
export function eventToShortcutString(event: KeyboardEvent): string {
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const parts: string[] = [];

  if (isMac ? event.metaKey : event.ctrlKey) {
    parts.push("Cmd");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  if (event.altKey) {
    parts.push("Alt");
  }

  const keyMap: Record<string, string> = {
    "?": "?",
    "/": "/",
    Delete: "Delete",
  };

  const key = keyMap[event.key] || event.key.toUpperCase();
  if (
    key &&
    key !== "META" &&
    key !== "SHIFT" &&
    key !== "ALT" &&
    key !== "CONTROL"
  ) {
    parts.push(key);
  }

  return parts.join("+");
}
