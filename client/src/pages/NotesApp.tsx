import React, { useState, useCallback, useEffect } from 'react';
import { useNotes } from '@/hooks/useNotes';
import { Sidebar } from '@/components/Sidebar';
import { RichTextEditor } from '@/components/RichTextEditor';
import { AIAssistant } from '@/components/AIAssistant';
import { VoiceMemo } from '@/components/VoiceMemo';
import { RecentlyDeleted } from '@/components/RecentlyDeleted';
import VersionHistory from '@/components/VersionHistory';
import ShareModal from '@/components/ShareModal';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import ShortcutsModal from '@/components/ShortcutsModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Download,
  Search,
  Lock,
  Cloud,
  Loader2,
  FileText,
  X,
} from 'lucide-react';
import { BrandedLoader } from '@/components/BrandedLoader';
import { toast } from 'sonner';
import {
  exportNote,
  downloadFile,
  getFileExtension,
  getMimeType,
  createBackup,
} from '@/lib/exportService';

export default function NotesApp() {
  const {
    notes,
    folders,
    currentNote,
    deletedNotes,
    isLoading,
    error,
    encryptionKey,
    setNotes,
    setFolders,
    createNote,
    updateCurrentNote,
    loadNote,
    loadNotesByFolder,
    removeNote,
    performSearch,
    createFolder,
    updateFolder,
    removeFolder,
    getAllNotesForExport,
    restoreDeletedNote,
    permanentlyDelete,
  } = useNotes();

  const [searchQuery, setSearchQuery] = useState('');
  const [exportFormat, setExportFormat] = useState<'markdown' | 'plaintext' | 'html' | 'json'>('markdown');
  const [isSearching, setIsSearching] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [templateInitialized, setTemplateInitialized] = useState(false);
  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<number>(Date.now());

  // Keyboard shortcuts
  useKeyboardShortcuts({
    'new-note': () => {
      if (folders.length > 0) {
        createNote(folders[0].id);
      }
    },
    'help': () => setShowShortcuts(true),
    'open-search': () => {
      const searchInput = document.querySelector('input[placeholder="Search notes..."]') as HTMLInputElement;
      if (searchInput) searchInput.focus();
    },
    'save': () => {
      toast.success('Note saved');
    },
    'version-history': () => setShowVersionHistory(true),
    'share-note': () => setShowShare(true),
  });

  useEffect(() => {
    // Check for template selection from landing page
    const templateData = sessionStorage.getItem('selectedTemplate');
    if (templateData && folders.length > 0) {
      try {
        const { template, customName } = JSON.parse(templateData);
        const defaultFolder = folders[0].id;
        
        // Create note with template
        const createTemplateNote = async () => {
          const newNote = await createNote(defaultFolder, customName || template.name);
          if (newNote) {
            updateCurrentNote({
              content: template.content,
              tags: [template.category],
            });
          }
        };
        
        createTemplateNote();
        sessionStorage.removeItem('selectedTemplate');
      } catch (error) {
        console.error('Failed to initialize template:', error);
      }
    }
  }, [createNote, updateCurrentNote, folders]);

  useEffect(() => {
    if (folders.length > 0 && notes.length === 0) {
      loadNotesByFolder(folders[0].id);
    }
  }, [folders, notes.length, loadNotesByFolder]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      if (folders.length > 0) {
        loadNotesByFolder(folders[0].id);
      }
      return;
    }

    setIsSearching(true);
    try {
      await performSearch(searchQuery);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, performSearch, loadNotesByFolder, folders]);

  const handleExport = useCallback(() => {
    if (!currentNote) {
      toast.error('No note selected');
      return;
    }

    try {
      const content = exportNote(currentNote, exportFormat);
      const ext = getFileExtension(exportFormat);
      const filename = `${currentNote.title || 'note'}.${ext}`;
      const mimeType = getMimeType(exportFormat);

      downloadFile(content, filename, mimeType);
      toast.success(`Note exported as ${exportFormat}`);
    } catch (error) {
      toast.error('Export failed');
    }
  }, [currentNote, exportFormat]);

  const handleBackup = useCallback(async () => {
    setIsBackingUp(true);
    try {
      const allNotes = await getAllNotesForExport();
      const backup = createBackup(allNotes, folders);
      const filename = `notes-backup-${new Date().toISOString().split('T')[0]}.json`;

      downloadFile(backup, filename, 'application/json');
      toast.success('Backup created successfully');
    } catch (error) {
      toast.error('Backup failed');
    } finally {
      setIsBackingUp(false);
    }
  }, [getAllNotesForExport, folders]);

  const handleTextSelection = useCallback(() => {
    const selected = window.getSelection()?.toString() || '';
    setSelectedText(selected);
  }, []);

  const handleVoiceTranscription = useCallback(
    (text: string) => {
      if (currentNote) {
        updateCurrentNote({
          content: currentNote.content + '\n' + text,
        });
      }
    },
    [currentNote, updateCurrentNote]
  );

  const handleAIInsert = useCallback(
    (text: string) => {
      if (currentNote) {
        const textarea = document.querySelector('textarea');
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const newContent =
            currentNote.content.substring(0, start) +
            text +
            currentNote.content.substring(end);
          updateCurrentNote({ content: newContent });
        } else {
          updateCurrentNote({
            content: currentNote.content + '\n' + text,
          });
        }
      }
    },
    [currentNote, updateCurrentNote]
  );

  if (isLoading) {
    return <BrandedLoader message="Initializing your workspace…" />;
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <p className="text-destructive font-semibold text-lg">Error</p>
          <p className="text-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-background" onMouseUp={handleTextSelection}>
      {/* Sidebar */}
      <Sidebar
        folders={folders}
        notes={notes}
        currentNote={currentNote}
        encryptionKey={encryptionKey}
        onSelectNote={(note) => loadNote(note.id)}
        onCreateNote={createNote}
        onCreateFolder={createFolder}
        onDeleteNote={removeNote}
        onDeleteFolder={removeFolder}
        onUpdateFolder={(folderId, name) => updateFolder(folderId, { name })}
        onNotesChange={setNotes}
        onFoldersChange={setFolders}
        onShowRecentlyDeleted={() => setShowRecentlyDeleted(true)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-card/50 border-b border-border p-4 space-y-3 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="flex-1 flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch();
                  }}
                  className="input-notion pl-10"
                />
              </div>
              <Button
                onClick={handleSearch}
                disabled={isSearching}
                className="btn-notion-secondary"
                size="sm"
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </Button>
            </div>

            {currentNote && (
              <>
                {/* Export Button */}
                <Dialog>
                  <DialogTrigger asChild>
                    <Button className="btn-notion-secondary" size="sm">
                      <Download className="w-4 h-4 mr-2" />
                      Export
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-card border-border">
                    <DialogHeader>
                      <DialogTitle className="text-foreground">Export Note</DialogTitle>
                      <DialogDescription className="text-muted-foreground">
                        Choose a format to export your note
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-foreground">Format</label>
                        <Select
                          value={exportFormat}
                          onValueChange={(value) => setExportFormat(value as any)}
                        >
                          <SelectTrigger className="input-notion">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="markdown">📝 Markdown (.md)</SelectItem>
                            <SelectItem value="plaintext">📄 Plain Text (.txt)</SelectItem>
                            <SelectItem value="html">🌐 HTML (.html)</SelectItem>
                            <SelectItem value="json">⚙️ JSON (.json)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleExport} className="w-full btn-notion">
                        Download
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Backup Button */}
                <Button
                  onClick={handleBackup}
                  disabled={isBackingUp}
                  className="btn-notion-secondary"
                  size="sm"
                >
                  {isBackingUp ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Cloud className="w-4 h-4 mr-2" />
                  )}
                  Backup
                </Button>
              </>
            )}
          </div>

          {/* Note Info */}
          {currentNote && (
            <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
              <div className="flex gap-4">
                <span>Created: {new Date(currentNote.createdAt).toLocaleDateString()}</span>
                <span>Updated: {new Date(currentNote.updatedAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2">
                {encryptionKey && (
                  <div className="flex items-center gap-1 text-accent">
                    <Lock className="w-3 h-3" />
                    <span>Encrypted</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Editor Area or Recently Deleted */}
        {showRecentlyDeleted ? (
          <div className="flex-1 flex overflow-hidden p-4">
            <div className="flex-1 bg-card rounded-lg border border-border/50 overflow-hidden flex flex-col">
              <div className="p-4 border-b border-border/50 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Recently Deleted</h2>
                  <p className="text-sm text-muted-foreground">Notes are automatically deleted after 30 days</p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => setShowRecentlyDeleted(false)}
                  aria-label="Close Recently Deleted"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <RecentlyDeleted
                deletedNotes={deletedNotes}
                onRestore={restoreDeletedNote}
                onPermanentlyDelete={permanentlyDelete}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden gap-4 p-4">
            {/* Main Editor */}
            <div className="flex-1 flex flex-col">
              {currentNote ? (
                <>
                  <Input
                    value={currentNote.title}
                    onChange={(e) =>
                      updateCurrentNote({ title: e.target.value })
                    }
                    placeholder="Note title..."
                    className="mb-3 text-2xl font-bold input-notion"
                  />
                  <RichTextEditor
                    content={currentNote.content}
                    onChange={(content) =>
                      updateCurrentNote({ content })
                    }
                    placeholder="Start typing your note..."
                    onShowVersionHistory={() => setShowVersionHistory(true)}
                    onShowShare={() => setShowShare(true)}
                  />
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-card rounded-lg border border-border/50">
                  <div className="text-center space-y-4">
                    <FileText className="w-12 h-12 text-muted-foreground mx-auto opacity-50" />
                    <div>
                      <p className="text-foreground font-medium">No note selected</p>
                      <p className="text-sm text-muted-foreground">
                        Create a new note or select one from the sidebar
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Sidebar with AI and Voice */}
            <div className="w-80 flex flex-col gap-4 overflow-y-auto">
              {currentNote && (
                <>
                  <AIAssistant
                    selectedText={selectedText}
                    noteContent={currentNote.content}
                    onInsert={handleAIInsert}
                  />
                  <VoiceMemo onTranscription={handleVoiceTranscription} />
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Version History Modal */}
      {showVersionHistory && currentNote && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg border border-border w-11/12 h-5/6 max-w-4xl flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Version History</h2>
              <button
                onClick={() => setShowVersionHistory(false)}
                aria-label="Close version history"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <VersionHistory
                noteId={currentNote.id}
                onRestore={async () => {
                  await loadNote(currentNote.id);
                  setShowVersionHistory(false);
                  toast.success('Note restored to previous version');
                }}
                onClose={() => setShowVersionHistory(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShare && currentNote && (
        <ShareModal
          noteId={currentNote.id}
          noteTitle={currentNote.title || 'Untitled Note'}
          onClose={() => setShowShare(false)}
        />
      )}

      {/* Shortcuts Modal */}
      <ShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
}
