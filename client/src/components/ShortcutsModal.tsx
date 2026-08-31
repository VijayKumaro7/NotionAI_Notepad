import { useState } from "react";
import { X, Search } from "lucide-react";
import {
  SHORTCUTS,
  groupShortcutsByCategory,
  formatKeys,
  ShortcutCategory,
} from "@/lib/shortcuts";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ShortcutsModal({
  isOpen,
  onClose,
}: ShortcutsModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    ShortcutCategory | "All"
  >("All");

  const grouped = groupShortcutsByCategory();
  const categories: (ShortcutCategory | "All")[] = [
    "All",
    "Navigation",
    "Editing",
    "Formatting",
    "General",
    "Search",
  ];

  const filteredShortcuts = SHORTCUTS.filter(shortcut => {
    const matchesSearch =
      shortcut.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      shortcut.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === "All" || shortcut.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-3xl max-h-[80vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl flex flex-col animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              Keyboard Shortcuts
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Master these shortcuts to work faster
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pt-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search shortcuts..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="px-6 pt-2 pb-4 flex gap-2 overflow-x-auto">
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors whitespace-nowrap ${
                selectedCategory === category
                  ? "bg-blue-500 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Shortcuts List */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {filteredShortcuts.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-500 dark:text-slate-400">
              <p>No shortcuts found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedCategory === "All"
                ? categories
                    .filter(cat => cat !== "All")
                    .map(category => {
                      const categoryShortcuts = grouped[
                        category as ShortcutCategory
                      ].filter(s => filteredShortcuts.includes(s));
                      if (categoryShortcuts.length === 0) return null;

                      return (
                        <div key={category}>
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 uppercase tracking-wide">
                            {category}
                          </h3>
                          <div className="space-y-2">
                            {categoryShortcuts.map(shortcut => (
                              <div
                                key={shortcut.id}
                                className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                              >
                                <div className="flex-1">
                                  <p className="font-medium text-slate-900 dark:text-white">
                                    {shortcut.name}
                                  </p>
                                  <p className="text-sm text-slate-600 dark:text-slate-400">
                                    {shortcut.description}
                                  </p>
                                </div>
                                <div className="ml-4 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg font-mono text-sm font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                  {formatKeys(shortcut.keys)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                : filteredShortcuts.map(shortcut => (
                    <div
                      key={shortcut.id}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <div className="flex-1">
                        <p className="font-medium text-slate-900 dark:text-white">
                          {shortcut.name}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          {shortcut.description}
                        </p>
                      </div>
                      <div className="ml-4 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg font-mono text-sm font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatKeys(shortcut.keys)}
                      </div>
                    </div>
                  ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-b-xl">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            💡 Tip: Press{" "}
            <kbd className="px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded font-mono text-xs">
              Cmd+?
            </kbd>{" "}
            anytime to open this help
          </p>
        </div>
      </div>
    </div>
  );
}
