import React, { useState, useCallback, useMemo } from "react";
import { Folder, Note } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FolderPlus,
  FileText,
  ChevronDown,
  ChevronRight,
  Trash2,
  Edit2,
  Plus,
  GripVertical,
  Archive,
  Tag,
  X,
} from "lucide-react";
import { useDragDrop } from "@/hooks/useDragDrop";
import { sortByOrder } from "@/lib/dragDropUtils";

interface SidebarProps {
  folders: Folder[];
  notes: Note[];
  currentNote: Note | null;
  encryptionKey: CryptoKey | null;
  availableTags?: string[];
  activeTagFilter?: string | null;
  onSelectNote: (note: Note) => void;
  onCreateNote: (folderId: string) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onDeleteNote: (noteId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onUpdateFolder: (folderId: string, name: string) => void;
  onNotesChange: (notes: Note[]) => void;
  onFoldersChange: (folders: Folder[]) => void;
  onFilterByTag?: (tag: string | null) => void;
  onShowRecentlyDeleted?: () => void;
}

export function Sidebar({
  folders,
  notes,
  currentNote,
  encryptionKey,
  availableTags = [],
  activeTagFilter,
  onSelectNote,
  onCreateNote,
  onCreateFolder,
  onDeleteNote,
  onDeleteFolder,
  onUpdateFolder,
  onNotesChange,
  onFoldersChange,
  onFilterByTag,
  onShowRecentlyDeleted,
}: SidebarProps) {
  const [showTags, setShowTags] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set()
  );
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<{
    id: string;
    type: "note" | "folder";
  } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    folderId: string;
    position: "before" | "after";
    index: number;
  } | null>(null);

  const { reorderNotesInFolder, moveNoteToNewFolder, reorderSubFolders } =
    useDragDrop({
      notes,
      folders,
      encryptionKey,
      onNotesChange,
      onFoldersChange,
    });

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleCreateFolder = useCallback(() => {
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName, null);
      setNewFolderName("");
      setShowNewFolderInput(false);
    }
  }, [newFolderName, onCreateFolder]);

  const handleUpdateFolder = useCallback(
    (folderId: string) => {
      if (editingFolderName.trim()) {
        onUpdateFolder(folderId, editingFolderName);
        setEditingFolderId(null);
        setEditingFolderName("");
      }
    },
    [editingFolderName, onUpdateFolder]
  );

  const getFolderNotes = useCallback(
    (folderId: string) => {
      return notes.filter(note => note.folderId === folderId);
    },
    [notes]
  );

  const sortedFolderNotes = useCallback(
    (folderId: string) => {
      return sortByOrder(getFolderNotes(folderId));
    },
    [getFolderNotes]
  );

  const rootFolders = useMemo(() => {
    return sortByOrder(folders.filter(f => f.parentId === null));
  }, [folders]);

  // Drag handlers for notes
  const handleNoteDragStart = useCallback(
    (e: React.DragEvent, noteId: string) => {
      setDraggedItem({ id: noteId, type: "note" });
      e.dataTransfer.effectAllowed = "move";
    },
    []
  );

  const handleNoteDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDropIndicator(null);
  }, []);

  const handleNoteDragOver = useCallback(
    (e: React.DragEvent, folderId: string, noteIndex: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (draggedItem?.type === "note") {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const position = e.clientY < midpoint ? "before" : "after";

        setDropIndicator({
          folderId,
          position,
          index: noteIndex,
        });
      }
    },
    [draggedItem]
  );

  const handleNoteDrop = useCallback(
    async (e: React.DragEvent, targetFolderId: string, targetIndex: number) => {
      e.preventDefault();

      if (!draggedItem || draggedItem.type !== "note") return;

      const draggedNote = notes.find(n => n.id === draggedItem.id);
      if (!draggedNote) return;

      const targetNotes = sortedFolderNotes(targetFolderId);
      const adjustedIndex =
        dropIndicator?.position === "after" ? targetIndex + 1 : targetIndex;

      if (draggedNote.folderId === targetFolderId) {
        // Reorder within same folder
        const currentIndex = targetNotes.findIndex(
          n => n.id === draggedItem.id
        );
        if (currentIndex !== adjustedIndex) {
          await reorderNotesInFolder(
            targetFolderId,
            currentIndex,
            adjustedIndex
          );
        }
      } else {
        // Move to different folder
        await moveNoteToNewFolder(
          draggedItem.id,
          targetFolderId,
          adjustedIndex
        );
      }

      setDraggedItem(null);
      setDropIndicator(null);
    },
    [
      draggedItem,
      notes,
      sortedFolderNotes,
      dropIndicator,
      reorderNotesInFolder,
      moveNoteToNewFolder,
    ]
  );

  // Drag handlers for folders
  const handleFolderDragStart = useCallback(
    (e: React.DragEvent, folderId: string) => {
      setDraggedItem({ id: folderId, type: "folder" });
      e.dataTransfer.effectAllowed = "move";
    },
    []
  );

  const handleFolderDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDropIndicator(null);
  }, []);

  const handleFolderDragOver = useCallback(
    (e: React.DragEvent, folderId: string, folderIndex: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (draggedItem?.type === "folder") {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const position = e.clientY < midpoint ? "before" : "after";

        setDropIndicator({
          folderId,
          position,
          index: folderIndex,
        });
      }
    },
    [draggedItem]
  );

  const handleFolderDrop = useCallback(
    async (e: React.DragEvent, targetFolderId: string, targetIndex: number) => {
      e.preventDefault();

      if (!draggedItem || draggedItem.type !== "folder") return;

      const draggedFolder = folders.find(f => f.id === draggedItem.id);
      if (!draggedFolder) return;

      const targetFolders = sortByOrder(
        folders.filter(f => f.parentId === null)
      );
      const currentIndex = targetFolders.findIndex(
        f => f.id === draggedItem.id
      );
      const adjustedIndex =
        dropIndicator?.position === "after" ? targetIndex + 1 : targetIndex;

      if (currentIndex !== adjustedIndex && currentIndex !== -1) {
        await reorderSubFolders(null, currentIndex, adjustedIndex);
      }

      setDraggedItem(null);
      setDropIndicator(null);
    },
    [draggedItem, folders, dropIndicator, reorderSubFolders]
  );

  const renderFolder = (folder: Folder, folderIndex: number) => {
    const isExpanded = expandedFolders.has(folder.id);
    const folderNotes = sortedFolderNotes(folder.id);
    const isEditing = editingFolderId === folder.id;
    const isHovered = hoveredItemId === folder.id;
    const isDragging = draggedItem?.id === folder.id;
    const isDropTarget = dropIndicator?.folderId === folder.id;

    return (
      <div key={folder.id} className="mb-1">
        {/* Drop indicator - before */}
        {isDropTarget && dropIndicator.position === "before" && (
          <div className="h-0.5 bg-accent/50 rounded-full mb-1" />
        )}

        <div
          className={`flex items-center gap-1 group rounded-md transition-all duration-200 ${
            isDragging ? "opacity-50" : ""
          }`}
          draggable
          onDragStart={e => handleFolderDragStart(e, folder.id)}
          onDragEnd={handleFolderDragEnd}
          onDragOver={e => handleFolderDragOver(e, folder.id, folderIndex)}
          onDrop={e => handleFolderDrop(e, folder.id, folderIndex)}
          onMouseEnter={() => setHoveredItemId(folder.id)}
          onMouseLeave={() => setHoveredItemId(null)}
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleFolder(folder.id)}
            className="h-6 w-6 p-0 hover:bg-muted/50"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>

          {isHovered && (
            <div className="h-4 w-4 text-muted-foreground/50 cursor-grab active:cursor-grabbing">
              <GripVertical className="w-4 h-4" />
            </div>
          )}

          {isEditing ? (
            <Input
              value={editingFolderName}
              onChange={e => setEditingFolderName(e.target.value)}
              onBlur={() => handleUpdateFolder(folder.id)}
              onKeyDown={e => {
                if (e.key === "Enter") handleUpdateFolder(folder.id);
                if (e.key === "Escape") setEditingFolderId(null);
              }}
              autoFocus
              className="h-6 text-sm flex-1 input-notion"
            />
          ) : (
            <>
              <div className="flex items-center gap-2 flex-1 px-2 py-1 rounded-md hover:bg-muted/50 cursor-pointer transition-all duration-200">
                <FolderPlus className="w-4 h-4 text-accent flex-shrink-0" />
                <span className="text-sm font-medium flex-1 truncate">
                  {folder.name}
                </span>
              </div>
              {isHovered && (
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingFolderId(folder.id);
                      setEditingFolderName(folder.name);
                    }}
                    className="h-6 w-6 p-0 hover:bg-muted/50"
                  >
                    <Edit2 className="w-3 h-3 text-muted-foreground" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDeleteFolder(folder.id)}
                    className="h-6 w-6 p-0 hover:bg-destructive/10"
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onCreateNote(folder.id)}
                    className="h-6 w-6 p-0 hover:bg-muted/50"
                  >
                    <Plus className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Drop indicator - after */}
        {isDropTarget && dropIndicator.position === "after" && (
          <div className="h-0.5 bg-accent/50 rounded-full mt-1 mb-1" />
        )}

        {isExpanded && (
          <div className="ml-4 mt-1 space-y-0.5 border-l border-border/50 pl-2">
            {folderNotes.length > 0 ? (
              folderNotes.map((note, noteIndex) => {
                const isDraggingNote = draggedItem?.id === note.id;
                const isDropTargetNote = dropIndicator?.folderId === folder.id;

                return (
                  <div key={note.id}>
                    {isDropTargetNote &&
                      dropIndicator.index === noteIndex &&
                      dropIndicator.position === "before" && (
                        <div className="h-0.5 bg-accent/50 rounded-full mb-0.5" />
                      )}

                    <div
                      onClick={() => onSelectNote(note)}
                      onMouseEnter={() => setHoveredItemId(note.id)}
                      onMouseLeave={() => setHoveredItemId(null)}
                      draggable
                      onDragStart={e => handleNoteDragStart(e, note.id)}
                      onDragEnd={handleNoteDragEnd}
                      onDragOver={e =>
                        handleNoteDragOver(e, folder.id, noteIndex)
                      }
                      onDrop={e => handleNoteDrop(e, folder.id, noteIndex)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all duration-200 group ${
                        currentNote?.id === note.id
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted/50 text-foreground"
                      } ${isDraggingNote ? "opacity-50" : ""}`}
                    >
                      {hoveredItemId === note.id && (
                        <div className="h-3 w-3 text-muted-foreground/50 cursor-grab active:cursor-grabbing">
                          <GripVertical className="w-3 h-3" />
                        </div>
                      )}
                      <FileText
                        className={`w-4 h-4 flex-shrink-0 ${hoveredItemId === note.id ? "hidden" : ""}`}
                      />
                      <span className="text-sm truncate flex-1 font-medium">
                        {note.title || "Untitled"}
                      </span>
                      {hoveredItemId === note.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={e => {
                            e.stopPropagation();
                            onDeleteNote(note.id);
                          }}
                          className="h-5 w-5 p-0 hover:bg-destructive/10"
                        >
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      )}
                    </div>

                    {isDropTargetNote &&
                      dropIndicator.index === noteIndex &&
                      dropIndicator.position === "after" && (
                        <div className="h-0.5 bg-accent/50 rounded-full mt-0.5" />
                      )}
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-muted-foreground px-2 py-2 italic">
                No notes
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-64 h-full bg-sidebar border-r border-sidebar-border overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-sidebar-border sticky top-0 bg-sidebar/95 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg font-bold text-foreground">
            ✨ Workspace
          </span>
        </div>
        <Button
          onClick={() => setShowNewFolderInput(true)}
          className="w-full btn-notion text-sm"
          size="sm"
        >
          <FolderPlus className="w-4 h-4 mr-2" />
          New Folder
        </Button>
      </div>

      {/* New Folder Input */}
      {showNewFolderInput && (
        <div className="p-3 border-b border-sidebar-border space-y-2 bg-card/50">
          <Input
            placeholder="Folder name..."
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") handleCreateFolder();
              if (e.key === "Escape") setShowNewFolderInput(false);
            }}
            autoFocus
            className="input-notion text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleCreateFolder}
              className="flex-1 btn-notion text-xs"
            >
              Create
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setShowNewFolderInput(false);
                setNewFolderName("");
              }}
              className="btn-notion-secondary text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Folders List or Tag-Filtered Notes */}
      <div className="flex-1 p-3 space-y-1 overflow-y-auto">
        {activeTagFilter ? (
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs text-muted-foreground font-medium">
                #{activeTagFilter}
              </span>
              <button
                onClick={() => onFilterByTag?.(null)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            </div>
            {notes.length > 0 ? (
              notes.map(note => (
                <div
                  key={note.id}
                  onClick={() => onSelectNote(note)}
                  onMouseEnter={() => setHoveredItemId(note.id)}
                  onMouseLeave={() => setHoveredItemId(null)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all duration-200 group ${
                    currentNote?.id === note.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/50 text-foreground"
                  }`}
                >
                  <FileText className="w-4 h-4 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate font-medium">
                      {note.title || "Untitled"}
                    </p>
                    {note.tags.length > 0 && (
                      <p className="text-xs text-muted-foreground truncate">
                        {note.tags.map(t => `#${t}`).join(" ")}
                      </p>
                    )}
                  </div>
                  {hoveredItemId === note.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={e => {
                        e.stopPropagation();
                        onDeleteNote(note.id);
                      }}
                      className="h-5 w-5 p-0 hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground px-2 py-4 text-center italic">
                No notes with this tag
              </div>
            )}
          </div>
        ) : rootFolders.length > 0 ? (
          rootFolders.map((folder, index) => renderFolder(folder, index))
        ) : (
          <div className="text-sm text-muted-foreground text-center py-8 px-4">
            <p className="font-medium mb-2">No folders yet</p>
            <p className="text-xs">Create one to get started!</p>
          </div>
        )}
      </div>

      {/* Tags Section */}
      {availableTags.length > 0 && (
        <div className="border-t border-sidebar-border p-3">
          <button
            onClick={() => setShowTags(prev => !prev)}
            className="w-full flex items-center gap-2 px-1 py-1 rounded-md text-sm text-muted-foreground hover:text-foreground transition-all duration-200 mb-1"
          >
            <Tag className="w-4 h-4" />
            <span className="flex-1 text-left font-medium">Tags</span>
            {activeTagFilter && (
              <span className="text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">
                {activeTagFilter}
              </span>
            )}
            {showTags ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>

          {showTags && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {activeTagFilter && (
                <button
                  onClick={() => onFilterByTag?.(null)}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                  Clear
                </button>
              )}
              {availableTags.map(tag => (
                <button
                  key={tag}
                  onClick={() =>
                    onFilterByTag?.(activeTagFilter === tag ? null : tag)
                  }
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    activeTagFilter === tag
                      ? "bg-accent text-accent-foreground border-accent"
                      : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recently Deleted Folder */}
      <div className="border-t border-sidebar-border p-3">
        <button
          onClick={onShowRecentlyDeleted}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
        >
          <Archive className="w-4 h-4" />
          <span>Recently Deleted</span>
        </button>
      </div>
    </div>
  );
}
