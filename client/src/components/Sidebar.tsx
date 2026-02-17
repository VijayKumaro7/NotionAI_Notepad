import React, { useState, useCallback } from 'react';
import { Folder, Note } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FolderPlus,
  FileText,
  ChevronDown,
  ChevronRight,
  Trash2,
  Edit2,
  Plus,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react';

interface SidebarProps {
  folders: Folder[];
  notes: Note[];
  currentNote: Note | null;
  onSelectNote: (note: Note) => void;
  onCreateNote: (folderId: string) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onDeleteNote: (noteId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onUpdateFolder: (folderId: string, name: string) => void;
}

export function Sidebar({
  folders,
  notes,
  currentNote,
  onSelectNote,
  onCreateNote,
  onCreateFolder,
  onDeleteNote,
  onDeleteFolder,
  onUpdateFolder,
}: SidebarProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
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
      setNewFolderName('');
      setShowNewFolderInput(false);
    }
  }, [newFolderName, onCreateFolder]);

  const handleUpdateFolder = useCallback(
    (folderId: string) => {
      if (editingFolderName.trim()) {
        onUpdateFolder(folderId, editingFolderName);
        setEditingFolderId(null);
        setEditingFolderName('');
      }
    },
    [editingFolderName, onUpdateFolder]
  );

  const getFolderNotes = (folderId: string) => {
    return notes.filter((note) => note.folderId === folderId);
  };

  const renderFolder = (folder: Folder) => {
    const isExpanded = expandedFolders.has(folder.id);
    const folderNotes = getFolderNotes(folder.id);
    const isEditing = editingFolderId === folder.id;
    const isHovered = hoveredItemId === folder.id;

    return (
      <div key={folder.id} className="mb-1">
        <div
          className="flex items-center gap-1 group"
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

          {isEditing ? (
            <Input
              value={editingFolderName}
              onChange={(e) => setEditingFolderName(e.target.value)}
              onBlur={() => handleUpdateFolder(folder.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUpdateFolder(folder.id);
                if (e.key === 'Escape') setEditingFolderId(null);
              }}
              autoFocus
              className="h-6 text-sm flex-1 input-notion"
            />
          ) : (
            <>
              <div className="flex items-center gap-2 flex-1 px-2 py-1 rounded-md hover:bg-muted/50 cursor-pointer transition-all duration-200">
                <FolderPlus className="w-4 h-4 text-accent" />
                <span className="text-sm font-medium flex-1 truncate">{folder.name}</span>
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

        {isExpanded && (
          <div className="ml-4 mt-1 space-y-0.5 border-l border-border/50 pl-2">
            {folderNotes.length > 0 ? (
              folderNotes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => onSelectNote(note)}
                  onMouseEnter={() => setHoveredItemId(note.id)}
                  onMouseLeave={() => setHoveredItemId(null)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all duration-200 group ${
                    currentNote?.id === note.id
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted/50 text-foreground'
                  }`}
                >
                  <FileText className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm truncate flex-1 font-medium">{note.title || 'Untitled'}</span>
                  {hoveredItemId === note.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
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
              <div className="text-xs text-muted-foreground px-2 py-2 italic">No notes</div>
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
          <Sparkles className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-bold text-foreground">Workspace</h2>
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
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') setShowNewFolderInput(false);
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
                setNewFolderName('');
              }}
              className="btn-notion-secondary text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Folders List */}
      <div className="flex-1 p-3 space-y-1 overflow-y-auto">
        {folders.length > 0 ? (
          folders.map((folder) => renderFolder(folder))
        ) : (
          <div className="text-sm text-muted-foreground text-center py-8 px-4">
            <p className="font-medium mb-2">No folders yet</p>
            <p className="text-xs">Create one to get started!</p>
          </div>
        )}
      </div>
    </div>
  );
}
