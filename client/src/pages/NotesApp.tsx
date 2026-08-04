import { useState, useCallback, useEffect } from 'react';
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
  FileText,
  X,
  Home,
  LogOut,
  Clock,
} from 'lucide-react';
import { BrandedLoader } from '@/components/BrandedLoader';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { DemoExpiredDialog } from '@/components/DemoExpiredDialog';
import {
  adoptServerDeadline,
  demoTimeRemaining,
  endDemoSession,
  formatTimeRemaining,
  isDemoSessionActive,
} from '@/lib/demoSession';
import { getLoginUrl } from '@/const';
import {
  encryptBackup,
  decryptBackup,
  restoreArchive,
  formatBackupSize,
} from '@/lib/cloudBackup';
import {
  exportNote,
  downloadFile,
  downloadBlob,
  exportAsPDF,
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
    availableTags,
    activeTagFilter,
    setNotes,
    setFolders,
    createNote,
    updateCurrentNote,
    loadNote,
    loadNotesByFolder,
    removeNote,
    performSearch,
    filterByTag,
    createFolder,
    updateFolder,
    removeFolder,
    getAllNotesForExport,
    restoreDeletedNote,
    permanentlyDelete,
  } = useNotes();

  const { logout, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await logout();
      navigate('/');
    } catch {
      toast.error('Sign out failed — please try again');
    } finally {
      setIsSigningOut(false);
    }
  }, [logout, navigate]);

  // Demo session. Only relevant while signed out — signing in ends it, so an
  // authenticated user never sees the countdown or the dialog.
  const [demoRemaining, setDemoRemaining] = useState(() =>
    isAuthenticated ? 0 : demoTimeRemaining()
  );
  const [demoExpired, setDemoExpired] = useState(false);

  // The server holds this visitor's deadline when DEMO_LIMIT_SALT is set. Its
  // answer overrides the local record, which is what closes the cleared-site-
  // data hole. Public procedure, so no 401 for a signed-out visitor.
  const serverDemo = trpc.demo.status.useQuery(undefined, {
    enabled: !isAuthenticated,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isAuthenticated) return;

    const status = serverDemo.data;
    if (!status?.tracked || !status.expiresAt) return;

    // Adopt it whether it is in the future or already past — an expired
    // deadline is precisely what a fresh browser profile needs to be told.
    adoptServerDeadline(status.expiresAt);
    const remaining = Math.max(0, status.expiresAt - Date.now());
    setDemoRemaining(remaining);
    setDemoExpired(remaining <= 0);
  }, [isAuthenticated, serverDemo.data]);

  useEffect(() => {
    if (isAuthenticated) {
      // Signing in during a demo retires it rather than leaving a timer running.
      endDemoSession();
      setDemoRemaining(0);
      setDemoExpired(false);
      return;
    }

    if (!isDemoSessionActive()) {
      setDemoExpired(true);
      return;
    }

    // Ticking from an absolute deadline, so a sleeping tab cannot gain time.
    const tick = () => {
      const remaining = demoTimeRemaining();
      setDemoRemaining(remaining);
      if (remaining <= 0) setDemoExpired(true);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isAuthenticated]);

  const handleDemoSignIn = useCallback(() => {
    // The demo record is left in place; it expires on its own and signing in
    // clears it. Wiping it here would let a cancelled sign-in start a new one.
    window.location.href = getLoginUrl();
  }, []);

  const handleDemoGoHome = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const [searchQuery, setSearchQuery] = useState('');
  const [exportFormat, setExportFormat] = useState<'markdown' | 'plaintext' | 'html' | 'json' | 'pdf'>('markdown');
  const [isSearching, setIsSearching] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCloudBackups, setShowCloudBackups] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  // Reports false when S3 is unconfigured, so the UI can hide the feature
  // rather than offer a button that always errors.
  //
  // Gated on being signed in: these are protected procedures, and a 401 from
  // any query trips the global handler in main.tsx, which sends the browser to
  // the login page. During a demo that would end the session on arrival.
  const backupStatus = trpc.backups.status.useQuery(undefined, {
    retry: false,
    enabled: isAuthenticated,
  });
  const cloudBackups = trpc.backups.list.useQuery(undefined, {
    enabled: isAuthenticated && showCloudBackups && backupStatus.data?.configured === true,
    retry: false,
  });
  const createCloudBackup = trpc.backups.create.useMutation();
  const utils = trpc.useUtils();

  const handleCloudBackup = useCallback(async () => {
    if (!encryptionKey) {
      toast.error('Encryption key not ready yet');
      return;
    }

    setIsBackingUp(true);
    try {
      const allNotes = await getAllNotesForExport();
      const payload = await encryptBackup(allNotes, folders, encryptionKey);

      await createCloudBackup.mutateAsync({ payload });
      await utils.backups.list.invalidate();
      toast.success('Encrypted backup uploaded');
    } catch (error) {
      toast.error('Cloud backup failed');
    } finally {
      setIsBackingUp(false);
    }
  }, [encryptionKey, getAllNotesForExport, folders, createCloudBackup, utils]);

  const handleRestore = useCallback(
    async (backupId: string) => {
      if (!encryptionKey) {
        toast.error('Encryption key not ready yet');
        return;
      }

      setRestoringId(backupId);
      try {
        const payload = await utils.backups.restore.fetch({ backupId });
        if (!payload) {
          toast.error('That backup is no longer there');
          return;
        }

        const archive = await decryptBackup(payload, encryptionKey);
        const restored = await restoreArchive(archive, encryptionKey);

        if (folders.length > 0) await loadNotesByFolder(folders[0].id);
        toast.success(`Restored ${restored.notes} notes and ${restored.folders} folders`);
      } catch (error) {
        // A wrong key fails here, and that is worth saying plainly.
        toast.error('Restore failed — the backup could not be decrypted');
      } finally {
        setRestoringId(null);
      }
    },
    [encryptionKey, utils, folders, loadNotesByFolder]
  );

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

  const handleExport = useCallback(async () => {
    if (!currentNote) {
      toast.error('No note selected');
      return;
    }

    try {
      const filename = `${currentNote.title || 'note'}.${getFileExtension(exportFormat)}`;

      // PDF is binary, so it comes back as a Blob rather than a string. The
      // await also covers fetching the jsPDF chunk on first use.
      if (exportFormat === 'pdf') {
        downloadBlob(await exportAsPDF(currentNote), filename);
      } else {
        downloadFile(
          exportNote(currentNote, exportFormat),
          filename,
          getMimeType(exportFormat)
        );
      }
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
        availableTags={availableTags}
        activeTagFilter={activeTagFilter}
        onSelectNote={(note) => loadNote(note.id)}
        onCreateNote={createNote}
        onCreateFolder={createFolder}
        onDeleteNote={removeNote}
        onDeleteFolder={removeFolder}
        onUpdateFolder={(folderId, name) => updateFolder(folderId, { name })}
        onNotesChange={setNotes}
        onFoldersChange={setFolders}
        onFilterByTag={filterByTag}
        onShowRecentlyDeleted={() => setShowRecentlyDeleted(true)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-card/50 border-b border-border p-4 space-y-3 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Button
              onClick={() => navigate('/')}
              className="btn-notion-secondary"
              size="sm"
              aria-label="Go to home page"
              title="Home"
            >
              <Home className="w-4 h-4" />
            </Button>
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
                  <Spinner />
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
                            <SelectItem value="pdf">📕 PDF (.pdf)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleExport} className="w-full btn-notion">
                        Download
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Backup Button — downloads an encrypted archive locally */}
                <Button
                  onClick={handleBackup}
                  disabled={isBackingUp}
                  className="btn-notion-secondary"
                  size="sm"
                >
                  {isBackingUp ? (
                    <Spinner className="mr-2" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Backup
                </Button>

                {/* Cloud backup — only offered when the server has S3 set up */}
                {backupStatus.data?.configured && (
                  <Dialog open={showCloudBackups} onOpenChange={setShowCloudBackups}>
                    <DialogTrigger asChild>
                      <Button className="btn-notion-secondary" size="sm">
                        <Cloud className="w-4 h-4 mr-2" />
                        Cloud
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Cloud backup</DialogTitle>
                        <DialogDescription>
                          Archives are encrypted in this browser before upload. Only
                          this device's key can read them back — if you lose it, the
                          backup cannot be recovered.
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-4">
                        <Button
                          onClick={handleCloudBackup}
                          disabled={isBackingUp}
                          className="w-full btn-notion"
                        >
                          {isBackingUp ? <Spinner className="mr-2" /> : <Cloud className="w-4 h-4 mr-2" />}
                          Back up now
                        </Button>

                        <div>
                          <h3 className="text-sm font-semibold mb-2">Previous backups</h3>
                          {cloudBackups.isLoading ? (
                            <Spinner />
                          ) : cloudBackups.data?.length ? (
                            <ul className="space-y-2 max-h-56 overflow-y-auto">
                              {cloudBackups.data.map((backup) => (
                                <li
                                  key={backup.id}
                                  className="flex items-center justify-between gap-3 text-sm border-b border-border pb-2 last:border-0"
                                >
                                  <div className="min-w-0">
                                    <div className="text-foreground">
                                      {new Date(backup.createdAt).toLocaleString()}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {formatBackupSize(backup.sizeBytes)}
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={restoringId !== null}
                                    onClick={() => handleRestore(backup.id)}
                                  >
                                    {restoringId === backup.id ? <Spinner /> : 'Restore'}
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              No cloud backups yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </>
            )}

            {/* Demo countdown, so the limit is visible rather than a surprise */}
            {!isAuthenticated && demoRemaining > 0 && (
              <>
                <span
                  className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md bg-primary/10 text-primary"
                  title="Time left in your demo"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Demo {formatTimeRemaining(demoRemaining)}
                </span>
                <Button
                  onClick={handleDemoSignIn}
                  className="btn-notion"
                  size="sm"
                  aria-label="Sign in to keep your notes"
                >
                  Sign In
                </Button>
              </>
            )}

            {/* Sign Out */}
            {isAuthenticated && (
              <Button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="btn-notion-secondary"
                size="sm"
                aria-label="Sign out and return to home page"
                title="Sign out"
              >
                {isSigningOut ? (
                  <Spinner className="mr-2" />
                ) : (
                  <LogOut className="w-4 h-4 mr-2" />
                )}
                Sign Out
              </Button>
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
      <Dialog
        open={showVersionHistory && !!currentNote}
        onOpenChange={(open) => !open && setShowVersionHistory(false)}
      >
        <DialogContent className="max-w-4xl h-5/6 flex flex-col bg-background border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Version History</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {currentNote && (
              <VersionHistory
                noteId={currentNote.id}
                onRestore={async () => {
                  await loadNote(currentNote.id);
                  setShowVersionHistory(false);
                  toast.success('Note restored to previous version');
                }}
                onClose={() => setShowVersionHistory(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

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

      {/* Demo ran out — sign in, or back to the landing page */}
      <DemoExpiredDialog
        open={demoExpired && !isAuthenticated}
        onSignIn={handleDemoSignIn}
        onGoHome={handleDemoGoHome}
      />
    </div>
  );
}
