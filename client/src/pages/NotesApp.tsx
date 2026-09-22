import { useState, useCallback, useEffect } from "react";
import { useNotes } from "@/hooks/useNotes";
import { Sidebar } from "@/components/Sidebar";
import { RichTextEditor } from "@/components/RichTextEditor";
import { AIAssistant } from "@/components/AIAssistant";
import { AIChatBox } from "@/components/AIChatBox";
import { VoiceMemo } from "@/components/VoiceMemo";
import { RecentlyDeleted } from "@/components/RecentlyDeleted";
import VersionHistory from "@/components/VersionHistory";
import ShareModal from "@/components/ShareModal";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import ShortcutsModal from "@/components/ShortcutsModal";
import { TemplateSelector } from "@/components/TemplateSelector";
import type { NoteTemplate } from "@shared/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  ShieldCheck,
  UserRound,
  LayoutTemplate,
  Menu,
  CloudOff,
} from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { DemoExpiredDialog } from "@/components/DemoExpiredDialog";
import {
  adoptServerDeadline,
  demoTimeRemaining,
  endDemoSession,
  formatTimeRemaining,
  isDemoSessionActive,
} from "@/lib/demoSession";
import {
  disableLocalMode,
  enableLocalMode,
  isLocalModeActive,
} from "@/lib/localMode";
import { AccountSettings } from "@/components/AccountSettings";
import { SyncIndicator } from "@/components/SyncIndicator";
import { ConflictNotice, UnreadableNotice } from "@/components/ConflictNotice";
import { TwoFactorSettings } from "@/components/TwoFactorSettings";
import {
  encryptBackup,
  decryptBackup,
  restoreArchive,
  formatBackupSize,
} from "@/lib/cloudBackup";
import {
  exportNote,
  downloadFile,
  downloadBlob,
  exportAsPDF,
  getFileExtension,
  getMimeType,
  createBackup,
} from "@/lib/exportService";

export default function NotesApp() {
  const {
    sync,
    syncNow,
    conflicts,
    dismissConflicts,
    unreadable,
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
    loadAllNotes,
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
      navigate("/");
    } catch {
      toast.error("Sign out failed — please try again");
    } finally {
      setIsSigningOut(false);
    }
  }, [logout, navigate]);

  // Local-only mode: this deployment has no server, so there is no demo to
  // run out and no account to run out into. Held in state rather than read
  // at render because the expired-demo dialog can turn it on, and the rest of
  // this page has to notice.
  const [localOnly, setLocalOnly] = useState(isLocalModeActive);

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

  /**
   * Whether there is a server here at all, from the one public query this page
   * already makes rather than a second one asking the same thing.
   *
   * Left enabled during local-only mode on purpose, and this is the whole
   * reason: someone who took the local-only offer has no sign-in control
   * anywhere, so if the deployment later grows a backend — the /api proxy in
   * netlify.toml, most likely — nothing would ever tell them, and the mode
   * would be a door that only locks. An answer to this query is the app
   * noticing, and the header offers signing in from that moment.
   */
  const serverUnreachable = serverDemo.isError;
  const serverAnswered = serverDemo.isSuccess;

  useEffect(() => {
    if (isAuthenticated || localOnly) return;

    const status = serverDemo.data;
    if (!status?.tracked || !status.expiresAt) return;

    // Adopt it whether it is in the future or already past — an expired
    // deadline is precisely what a fresh browser profile needs to be told.
    adoptServerDeadline(status.expiresAt);
    const remaining = Math.max(0, status.expiresAt - Date.now());
    setDemoRemaining(remaining);
    setDemoExpired(remaining <= 0);
  }, [isAuthenticated, localOnly, serverDemo.data]);

  useEffect(() => {
    if (isAuthenticated) {
      // Signing in during a demo retires it rather than leaving a timer
      // running — and retires local-only mode too, which only ever existed
      // because there was no account to be signed in to.
      endDemoSession();
      disableLocalMode();
      setLocalOnly(false);
      setDemoRemaining(0);
      setDemoExpired(false);
      return;
    }

    // No clock in local-only mode. The demo counts down towards signing in,
    // and on a deployment with no server that is counting down to nothing.
    if (localOnly) {
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
  }, [isAuthenticated, localOnly]);

  const handleDemoSignIn = useCallback(() => {
    // The demo record is left in place; it expires on its own and signing in
    // clears it. Wiping it here would let a cancelled sign-in start a new one.
    navigate("/login");
  }, [navigate]);

  const handleDemoGoHome = useCallback(() => {
    navigate("/");
  }, [navigate]);

  /**
   * The way out of an expired demo when signing in is not one.
   *
   * The demo record goes rather than being left to sit expired: local-only
   * mode is what lets this browser into /app now, and a stale deadline behind
   * it would only be something to trip over later.
   */
  const handleContinueLocally = useCallback(() => {
    enableLocalMode();
    endDemoSession();
    setLocalOnly(true);
    setDemoExpired(false);
    setDemoRemaining(0);
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const [exportFormat, setExportFormat] = useState<
    "markdown" | "plaintext" | "html" | "json" | "pdf"
  >("markdown");
  const [isSearching, setIsSearching] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Whether the sidebar is a static column rather than a drawer. CSS handles
  // the layout on its own, but `inert` cannot be set from a stylesheet, and an
  // off-canvas drawer whose buttons are still in the tab order is a trap: you
  // tab off the header and focus disappears to something nobody can see.
  const [sidebarIsStatic, setSidebarIsStatic] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setSidebarIsStatic(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const [showCloudBackups, setShowCloudBackups] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
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
    enabled:
      isAuthenticated &&
      showCloudBackups &&
      backupStatus.data?.configured === true,
    retry: false,
  });
  const createCloudBackup = trpc.backups.create.useMutation();
  const utils = trpc.useUtils();

  const handleCloudBackup = useCallback(async () => {
    if (!encryptionKey) {
      toast.error("Encryption key not ready yet");
      return;
    }

    setIsBackingUp(true);
    try {
      const allNotes = await getAllNotesForExport();
      const payload = await encryptBackup(allNotes, folders, encryptionKey);

      await createCloudBackup.mutateAsync({ payload });
      await utils.backups.list.invalidate();
      toast.success("Encrypted backup uploaded");
    } catch (error) {
      toast.error("Cloud backup failed");
    } finally {
      setIsBackingUp(false);
    }
  }, [encryptionKey, getAllNotesForExport, folders, createCloudBackup, utils]);

  const handleRestore = useCallback(
    async (backupId: string) => {
      if (!encryptionKey) {
        toast.error("Encryption key not ready yet");
        return;
      }

      setRestoringId(backupId);
      try {
        const payload = await utils.backups.restore.fetch({ backupId });
        if (!payload) {
          toast.error("That backup is no longer there");
          return;
        }

        const archive = await decryptBackup(payload, encryptionKey);
        const restored = await restoreArchive(archive, encryptionKey);

        if (folders.length > 0) await loadAllNotes();
        toast.success(
          `Restored ${restored.notes} notes and ${restored.folders} folders`
        );
      } catch (error) {
        // A wrong key fails here, and that is worth saying plainly.
        toast.error("Restore failed — the backup could not be decrypted");
      } finally {
        setRestoringId(null);
      }
    },
    [encryptionKey, utils, folders, loadAllNotes]
  );

  // Keyboard shortcuts
  useKeyboardShortcuts({
    "new-note": () => {
      if (folders.length > 0) {
        createNote(folders[0].id);
      }
    },
    help: () => setShowShortcuts(true),
    "open-search": () => {
      const searchInput = document.querySelector(
        'input[placeholder="Search notes..."]'
      ) as HTMLInputElement;
      if (searchInput) searchInput.focus();
    },
    save: () => {
      toast.success("Note saved");
    },
    "version-history": () => setShowVersionHistory(true),
    "share-note": () => setShowShare(true),
  });

  /**
   * Turn a chosen template into a note.
   *
   * One path for both entry points — the picker in this page's header, and the
   * hand-off from the landing page via sessionStorage. They used to be the same
   * code written twice, which is how they would drift.
   */
  const applyTemplate = useCallback(
    async (template: NoteTemplate, customName?: string) => {
      const defaultFolder = folders[0]?.id;
      if (!defaultFolder) {
        toast.error("Create a folder before adding a note");
        return;
      }

      const newNote = await createNote(
        defaultFolder,
        customName || template.name
      );
      if (newNote) {
        updateCurrentNote({
          content: template.content,
          tags: [template.category],
        });
      }
    },
    [createNote, updateCurrentNote, folders]
  );

  useEffect(() => {
    // A template chosen on the landing page, before this page existed to ask.
    const templateData = sessionStorage.getItem("selectedTemplate");
    if (!templateData || folders.length === 0) return;

    // Removed before the await, not after: the effect re-runs whenever folders
    // change, and an entry still sitting in storage would create the note twice.
    sessionStorage.removeItem("selectedTemplate");

    try {
      const { template, customName } = JSON.parse(templateData);
      void applyTemplate(template, customName);
    } catch (error) {
      console.error("Failed to initialize template:", error);
    }
  }, [applyTemplate, folders]);

  // The whole workspace, not the first folder's notes: the sidebar draws a
  // tree, and a note in any folder but folders[0] was never loaded into it.
  useEffect(() => {
    if (folders.length > 0 && notes.length === 0) {
      loadAllNotes();
    }
  }, [folders, notes.length, loadAllNotes]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      if (folders.length > 0) {
        loadAllNotes();
      }
      return;
    }

    setIsSearching(true);
    try {
      await performSearch(searchQuery);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, performSearch, loadAllNotes, folders]);

  const handleExport = useCallback(async () => {
    if (!currentNote) {
      toast.error("No note selected");
      return;
    }

    try {
      const filename = `${currentNote.title || "note"}.${getFileExtension(exportFormat)}`;

      // PDF is binary, so it comes back as a Blob rather than a string. The
      // await also covers fetching the jsPDF chunk on first use.
      if (exportFormat === "pdf") {
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
      toast.error("Export failed");
    }
  }, [currentNote, exportFormat]);

  const handleBackup = useCallback(async () => {
    setIsBackingUp(true);
    try {
      const allNotes = await getAllNotesForExport();
      const backup = createBackup(allNotes, folders);
      const filename = `notes-backup-${new Date().toISOString().split("T")[0]}.json`;

      downloadFile(backup, filename, "application/json");
      toast.success("Backup created successfully");
    } catch (error) {
      toast.error("Backup failed");
    } finally {
      setIsBackingUp(false);
    }
  }, [getAllNotesForExport, folders]);

  const handleTextSelection = useCallback(() => {
    const selected = window.getSelection()?.toString() || "";
    setSelectedText(selected);
  }, []);

  const handleVoiceTranscription = useCallback(
    (text: string) => {
      if (currentNote) {
        updateCurrentNote({
          content: currentNote.content + "\n" + text,
        });
      }
    },
    [currentNote, updateCurrentNote]
  );

  const handleAIInsert = useCallback(
    (text: string) => {
      if (currentNote) {
        const textarea = document.querySelector("textarea");
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
            content: currentNote.content + "\n" + text,
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
    <div
      className="h-screen flex bg-background"
      onMouseUp={handleTextSelection}
    >
      {/* Backdrop for the sidebar drawer. Below md the sidebar sits over the
          content rather than beside it — 256px of a 375px phone leaves no room
          to write in. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        inert={!sidebarIsStatic && !sidebarOpen}
      >
        <Sidebar
          folders={folders}
          notes={notes}
          currentNote={currentNote}
          encryptionKey={encryptionKey}
          availableTags={availableTags}
          activeTagFilter={activeTagFilter}
          onSelectNote={note => {
            loadNote(note.id);
            // On a phone the sidebar covers the note it just opened.
            setSidebarOpen(false);
          }}
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
      </div>

      {/* Main Content. min-w-0 is load-bearing: a flex child defaults to
          min-width:auto and refuses to shrink below its content, which is what
          pushed the search box and the buttons off the screen. */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-card/50 border-b border-border p-2 sm:p-4 space-y-3 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              onClick={() => setSidebarOpen(open => !open)}
              className="btn-notion-secondary btn-notion-sm shrink-0 md:hidden"
              aria-label={sidebarOpen ? "Hide notes list" : "Show notes list"}
              aria-expanded={sidebarOpen}
              title="Notes"
            >
              <Menu className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate("/")}
              className="btn-notion-secondary shrink-0 btn-notion-sm"
              aria-label="Go to home page"
              title="Home"
            >
              <Home className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowTemplates(true)}
              className="btn-notion-secondary shrink-0 btn-notion-sm"
              aria-label="New note from a template"
              title="New note from a template"
            >
              <LayoutTemplate className="w-4 h-4" />
            </button>
            {/* basis-full below sm puts search on its own row rather than
                squeezing it to nothing next to the buttons. */}
            <div className="order-last basis-full flex min-w-0 gap-2 sm:order-none sm:basis-auto sm:flex-1">
              <div className="flex-1 min-w-0 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search notes..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleSearch();
                  }}
                  variant="notion"
                  className="pl-10"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={isSearching}
                className="btn-notion-secondary shrink-0 btn-notion-sm"
                aria-label="Search notes"
              >
                {isSearching ? <Spinner /> : <Search className="w-4 h-4" />}
              </button>
            </div>

            {currentNote && (
              <>
                {/* Export Button */}
                <Dialog>
                  <DialogTrigger asChild>
                    <button
                      className="btn-notion-secondary shrink-0 btn-notion-sm"
                      aria-label="Export note"
                    >
                      <Download className="w-4 h-4 sm:mr-2" />
                      <span className="hidden sm:inline">Export</span>
                    </button>
                  </DialogTrigger>
                  <DialogContent className="bg-card border-border">
                    <DialogHeader>
                      <DialogTitle className="text-foreground">
                        Export Note
                      </DialogTitle>
                      <DialogDescription className="text-muted-foreground">
                        Choose a format to export your note
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-foreground">
                          Format
                        </label>
                        <Select
                          value={exportFormat}
                          onValueChange={value => setExportFormat(value as any)}
                        >
                          <SelectTrigger variant="notion">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="markdown">
                              📝 Markdown (.md)
                            </SelectItem>
                            <SelectItem value="plaintext">
                              📄 Plain Text (.txt)
                            </SelectItem>
                            <SelectItem value="html">
                              🌐 HTML (.html)
                            </SelectItem>
                            <SelectItem value="json">
                              ⚙️ JSON (.json)
                            </SelectItem>
                            <SelectItem value="pdf">📕 PDF (.pdf)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <button
                        onClick={handleExport}
                        className="w-full btn-notion"
                      >
                        Download
                      </button>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Backup Button — downloads an encrypted archive locally */}
                <button
                  onClick={handleBackup}
                  disabled={isBackingUp}
                  className="btn-notion-secondary shrink-0 btn-notion-sm"
                  aria-label="Download an encrypted backup"
                >
                  {isBackingUp ? (
                    <Spinner className="sm:mr-2" />
                  ) : (
                    <Download className="w-4 h-4 sm:mr-2" />
                  )}
                  <span className="hidden sm:inline">Backup</span>
                </button>

                {/* Cloud backup — only offered when the server has S3 set up */}
                {backupStatus.data?.configured && (
                  <Dialog
                    open={showCloudBackups}
                    onOpenChange={setShowCloudBackups}
                  >
                    <DialogTrigger asChild>
                      <button
                        className="btn-notion-secondary shrink-0 btn-notion-sm"
                        aria-label="Cloud backups"
                      >
                        <Cloud className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">Cloud</span>
                      </button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Cloud backup</DialogTitle>
                        <DialogDescription>
                          Archives are encrypted in this browser before upload.
                          Only this device's key can read them back — if you
                          lose it, the backup cannot be recovered.
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-4">
                        <button
                          onClick={handleCloudBackup}
                          disabled={isBackingUp}
                          className="w-full btn-notion"
                        >
                          {isBackingUp ? (
                            <Spinner className="mr-2" />
                          ) : (
                            <Cloud className="w-4 h-4 mr-2" />
                          )}
                          Back up now
                        </button>

                        <div>
                          <h3 className="text-sm font-semibold mb-2">
                            Previous backups
                          </h3>
                          {cloudBackups.isLoading ? (
                            <Spinner />
                          ) : cloudBackups.data?.length ? (
                            <ul className="space-y-2 max-h-56 overflow-y-auto">
                              {cloudBackups.data.map(backup => (
                                <li
                                  key={backup.id}
                                  className="flex items-center justify-between gap-3 text-sm border-b border-border pb-2 last:border-0"
                                >
                                  <div className="min-w-0">
                                    <div className="text-foreground">
                                      {new Date(
                                        backup.createdAt
                                      ).toLocaleString()}
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
                                    {restoringId === backup.id ? (
                                      <Spinner />
                                    ) : (
                                      "Restore"
                                    )}
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
            {!isAuthenticated && !localOnly && demoRemaining > 0 && (
              <>
                <span
                  className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md bg-primary/10 text-primary"
                  title="Time left in your demo"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Demo {formatTimeRemaining(demoRemaining)}
                </span>
                {/* Only where there is a server to sign in to. A deployment
                    with no API answers this button with the login page's own
                    "there is no server here", which is a round trip to a dead
                    end from inside a session that was working. */}
                {!serverUnreachable && (
                  <button
                    onClick={handleDemoSignIn}
                    className="btn-notion btn-notion-sm"
                    aria-label="Sign in to keep your notes"
                  >
                    Sign In
                  </button>
                )}
              </>
            )}

            {/* Local-only mode has no countdown to show, but it does have
                something worth saying: these notes are in this browser and
                nowhere else, so clearing site data is deleting them. */}
            {localOnly && !isAuthenticated && (
              <>
                <span
                  className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md bg-muted text-muted-foreground"
                  title={
                    serverAnswered
                      ? "Your notes are encrypted and kept in this browser. Sign in to sync them."
                      : "This deployment has no server. Your notes are encrypted and kept in this browser only — export anything you want to keep."
                  }
                >
                  <CloudOff className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">On this device</span>
                </span>

                {/* Appears the moment the API starts answering, which is the
                    only way out of a mode that was entered because it did
                    not. Signing in retires the mode and keeps the notes. */}
                {serverAnswered && (
                  <button
                    onClick={handleDemoSignIn}
                    className="btn-notion btn-notion-sm"
                    aria-label="Sign in to sync your notes"
                  >
                    Sign In
                  </button>
                )}
              </>
            )}

            {/* Security, where two-step verification is set up */}
            {isAuthenticated && (
              <button
                onClick={() => setShowSecurity(true)}
                className="btn-notion-secondary shrink-0 btn-notion-sm"
                aria-label="Security settings"
                title="Security"
              >
                <ShieldCheck className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Security</span>
              </button>
            )}

            {/* Whether the notes on this device are actually on the server */}
            {isAuthenticated && <SyncIndicator sync={sync} onRetry={syncNow} />}

            {/* Account, where the account can be deleted */}
            {isAuthenticated && (
              <button
                onClick={() => setShowAccount(true)}
                className="btn-notion-secondary shrink-0 btn-notion-sm"
                aria-label="Account settings"
                title="Account"
              >
                <UserRound className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Account</span>
              </button>
            )}

            {/* Sign Out */}
            {isAuthenticated && (
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="btn-notion-secondary shrink-0 btn-notion-sm"
                aria-label="Sign out and return to home page"
                title="Sign out"
              >
                {isSigningOut ? (
                  <Spinner className="sm:mr-2" />
                ) : (
                  <LogOut className="w-4 h-4 sm:mr-2" />
                )}
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            )}
          </div>

          {/* Both versions of a note were kept — where the other one went */}
          <ConflictNotice count={conflicts} onDismiss={dismissConflicts} />

          {/* Notes the server holds that this browser has no key for */}
          <UnreadableNotice count={unreadable} />

          {/* Note Info */}
          {currentNote && (
            <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
              <div className="flex gap-4">
                <span>
                  Created:{" "}
                  {new Date(currentNote.createdAt).toLocaleDateString()}
                </span>
                <span>
                  Updated:{" "}
                  {new Date(currentNote.updatedAt).toLocaleDateString()}
                </span>
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
          <div className="flex-1 flex overflow-hidden p-2 sm:p-4">
            <div className="flex-1 min-w-0 bg-card rounded-lg border border-border/50 overflow-hidden flex flex-col">
              <div className="p-4 border-b border-border/50 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Recently Deleted
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Notes are automatically deleted after 30 days
                  </p>
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
          // Editor and the AI/voice column. Side by side needs roughly 1024px
          // to leave the editor a usable width, so below lg they stack and the
          // whole area scrolls instead of being clipped.
          <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden gap-4 p-2 sm:p-4">
            {/* Main Editor */}
            <div className="flex-1 min-w-0 flex flex-col min-h-[60vh] lg:min-h-0">
              {currentNote ? (
                <>
                  <Input
                    value={currentNote.title}
                    onChange={e => updateCurrentNote({ title: e.target.value })}
                    placeholder="Note title..."
                    variant="notion"
                    className="mb-3 text-2xl font-bold"
                  />
                  <RichTextEditor
                    content={currentNote.content}
                    onChange={content => updateCurrentNote({ content })}
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
                      <p className="text-foreground font-medium">
                        No note selected
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Create a new note or select one from the sidebar
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Sidebar with AI and Voice. Full width when stacked; the
                fixed 320px only applies once there is room beside the editor.

                Signed in only. Every card here calls an `ai.*` procedure, and
                those are protected — a demo visitor pressing any of the
                buttons got a 401, which the global handler turns into a trip
                to the login page. Offering a control that cannot work and
                ejects you for trying is worse than not offering it. The column
                itself goes too, rather than leaving a 320px gutter. */}
            {currentNote && isAuthenticated && (
              <div className="w-full lg:w-80 shrink-0 flex flex-col gap-4 lg:overflow-y-auto">
                <AIAssistant
                  selectedText={selectedText}
                  noteContent={currentNote.content}
                  onInsert={handleAIInsert}
                />
                <AIChatBox
                  noteContent={currentNote.content}
                  selectedText={selectedText}
                  onInsert={handleAIInsert}
                />
                <VoiceMemo onTranscription={handleVoiceTranscription} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Version History Modal */}
      <Dialog
        open={showVersionHistory && !!currentNote}
        onOpenChange={open => !open && setShowVersionHistory(false)}
      >
        <DialogContent className="max-w-4xl h-5/6 flex flex-col bg-background border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Version History
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {currentNote && (
              <VersionHistory
                noteId={currentNote.id}
                encryptionKey={encryptionKey}
                onRestore={async () => {
                  await loadNote(currentNote.id);
                  setShowVersionHistory(false);
                  toast.success("Note restored to previous version");
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
          noteTitle={currentNote.title || "Untitled Note"}
          noteContent={currentNote.content}
          onClose={() => setShowShare(false)}
        />
      )}

      {/* Shortcuts Modal */}
      <ShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      {/* Templates. Only mounted while open — its AI drafting panel calls a
          protected procedure, and mounting it permanently would put that query
          on every render of the workspace. */}
      {showTemplates && (
        <TemplateSelector
          isOpen={showTemplates}
          onClose={() => setShowTemplates(false)}
          onSelectTemplate={(template, customName) => {
            void applyTemplate(template, customName);
          }}
        />
      )}

      {/* Demo ran out — sign in, or back to the landing page. Where there is
          no server, signing in is not on offer and carrying on locally is. */}
      <DemoExpiredDialog
        open={demoExpired && !isAuthenticated && !localOnly}
        canSignIn={!serverUnreachable}
        onSignIn={handleDemoSignIn}
        onContinueLocally={handleContinueLocally}
        onGoHome={handleDemoGoHome}
      />

      {/* Both only mounted when open: each opens with a protected query, and a
          401 from one sends the browser to the login page. */}
      {showAccount && isAuthenticated && (
        <AccountSettings
          open={showAccount}
          onOpenChange={setShowAccount}
          getNotes={getAllNotesForExport}
          folders={folders}
        />
      )}

      {showSecurity && isAuthenticated && (
        <TwoFactorSettings open={showSecurity} onOpenChange={setShowSecurity} />
      )}
    </div>
  );
}
