import React, { useState, useCallback, useEffect } from 'react';
import { useNotes } from '@/hooks/useNotes';
import { Sidebar } from '@/components/Sidebar';
import { RichTextEditor } from '@/components/RichTextEditor';
import { AIAssistant } from '@/components/AIAssistant';
import { VoiceMemo } from '@/components/VoiceMemo';
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
  Sparkles,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  exportNote,
  downloadFile,
  getFileExtension,
  getMimeType,
  exportNotesAsJSON,
  createBackup,
} from '@/lib/exportService';

export default function NotesApp() {
  const {
    notes,
    folders,
    currentNote,
    isLoading,
    error,
    encryptionKey,
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
  } = useNotes();

  const [searchQuery, setSearchQuery] = useState('');
  const [exportFormat, setExportFormat] = useState<'markdown' | 'plaintext' | 'html' | 'json'>('markdown');
  const [isSearching, setIsSearching] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [selectedText, setSelectedText] = useState('');

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
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-accent" />
          <p className="text-foreground font-medium">Initializing your workspace...</p>
        </div>
      </div>
    );
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
        onSelectNote={(note) => loadNote(note.id)}
        onCreateNote={createNote}
        onCreateFolder={createFolder}
        onDeleteNote={removeNote}
        onDeleteFolder={removeFolder}
        onUpdateFolder={(folderId, name) => updateFolder(folderId, { name })}
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

        {/* Editor Area */}
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
      </div>
    </div>
  );
}
