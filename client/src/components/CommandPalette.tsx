import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatKeys, getShortcutById } from "@/lib/shortcuts";

export interface CommandAction {
  /** A `lib/shortcuts.ts` id, when this action has a declared keybinding to show. */
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Hidden from the list (and unreachable) rather than shown disabled — there is nothing useful to do with, say, "Share" before a note exists. */
  enabled: boolean;
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandAction[];
}

/**
 * Quick-actions palette, opened with Cmd+/.
 *
 * `lib/shortcuts.ts` has declared this shortcut since the list existed, and
 * `ShortcutsModal` has always advertised it — `useKeyboardShortcuts` even
 * special-cases it to fire while typing in a note, the same as Help and
 * Search. Nothing behind any of that ever opened anything; this is the
 * dialog that finally does.
 */
export function CommandPalette({
  isOpen,
  onClose,
  commands,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const available = useMemo(() => commands.filter(c => c.enabled), [commands]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter(c => c.label.toLowerCase().includes(q));
  }, [available, query]);

  // A fresh dialog should not greet someone with the filter or selection left
  // over from the last time they opened it.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [isOpen]);

  // Typing can shrink the list out from under a held selection; clamp rather
  // than point past the end of what is still showing.
  useEffect(() => {
    setActiveIndex(i => Math.min(i, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const run = (command: CommandAction | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex(i => (i + 1) % filtered.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex(i => (i - 1 + filtered.length) % filtered.length);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[activeIndex]);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-ring">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- a palette that
            // does not start focused for typing is not a palette.
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="w-full bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matching commands
            </p>
          ) : (
            filtered.map((command, index) => {
              const Icon = command.icon;
              const shortcut = getShortcutById(command.id);
              return (
                <button
                  key={command.id}
                  onClick={() => run(command)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    index === activeIndex
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{command.label}</span>
                  {shortcut && (
                    <kbd
                      className={`text-xs font-mono ${
                        index === activeIndex
                          ? "text-primary-foreground/80"
                          : "text-muted-foreground"
                      }`}
                    >
                      {formatKeys(shortcut.keys)}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
