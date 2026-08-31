import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { MessageSquare, Lock, Eye, Wifi, WifiOff } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  getShareByToken,
  recordShareView,
  getNote,
  getShareComments,
  addComment,
  getOrCreateEncryptionKey,
  saveNote,
  Note,
  NoteShare,
  Comment,
} from "@/lib/storage";
import { useCollaboration } from "@/hooks/useCollaboration";
import { CollaborationUser } from "@/lib/collaboration";
import PresenceIndicators from "@/components/PresenceIndicators";
import LiveCursors from "@/components/LiveCursors";

/**
 * A shared note.
 *
 * A link is resolved server-side first, which is what lets it work on a device
 * that has never seen the note: the server checks the link, decides the role,
 * and hands back the document. Links minted before server-side sharing existed
 * still resolve from this browser's own IndexedDB, read-only of realtime — so
 * old links keep working rather than breaking.
 */
export default function SharedNoteView() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const { isAuthenticated } = useAuth();

  // Server-resolved access. Failing is normal — the link may be local-only, or
  // the visitor may not be signed in — so it falls through to the local path.
  const linkQuery = trpc.collaboration.byLink.useQuery(
    { token: shareToken ?? "" },
    { enabled: Boolean(shareToken), retry: false }
  );
  const serverDoc = linkQuery.data ?? null;
  const serverSettled = linkQuery.isSuccess || linkQuery.isError;

  const [localShare, setLocalShare] = useState<NoteShare | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [localLoading, setLocalLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef(noteContent);
  contentRef.current = noteContent;

  // Local-path persistence: the note, its key, and the last content written.
  const noteRef = useRef<Note | null>(null);
  const encryptionKeyRef = useRef<CryptoKey | null>(null);
  const lastPersistedRef = useRef<string | null>(null);

  const roleLabel = serverDoc?.role ?? localShare?.permission ?? null;
  // Editing a published note goes through the realtime socket, which requires
  // an account. A signed-out visitor following a link still reads it.
  const canEdit = serverDoc
    ? serverDoc.canEdit && isAuthenticated
    : localShare?.permission === "edit";
  const canComment = serverDoc
    ? true
    : localShare?.permission === "comment" || localShare?.permission === "edit";

  const collab = useCollaboration({
    room: serverDoc ? `note:${serverDoc.noteId}` : "",
    linkToken: shareToken,
    // Realtime needs a server-authorized room; a local-only link has none.
    enabled: Boolean(serverDoc) && isAuthenticated,
    onError: () => {
      /* surfaced through the connection badge rather than a toast */
    },
  });
  const { isConnected, presenceUsers, cursors, sendCursorUpdate, selfUserId } =
    collab;

  // On the collaborative path the CRDT document is the source of truth; the
  // local path keeps using component state.
  const displayedContent =
    serverDoc && isAuthenticated
      ? collab.text
      : serverDoc
        ? serverDoc.content
        : noteContent;

  const handleEdit = useCallback(
    (newValue: string) => {
      if (serverDoc && isAuthenticated) {
        collab.setText(newValue);
        return;
      }
      setNoteContent(newValue);
    },
    [serverDoc, isAuthenticated, collab]
  );

  const handleCursor = useCallback(
    (target: HTMLTextAreaElement) => {
      sendCursorUpdate(
        target.selectionStart,
        target.selectionStart,
        target.selectionEnd
      );
    },
    [sendCursorUpdate]
  );

  const presenceMap = new Map<string, CollaborationUser>(
    presenceUsers.map(u => [u.id, u])
  );

  // Title comes from the record; the body arrives through the CRDT document.
  useEffect(() => {
    if (!serverDoc) return;
    setNoteTitle(serverDoc.title);
    setError(null);
  }, [serverDoc]);

  // Local fallback, only once the server has declined.
  useEffect(() => {
    if (!serverSettled || serverDoc || !shareToken) return;

    let cancelled = false;
    const loadLocalShare = async () => {
      setLocalLoading(true);
      setError(null);
      try {
        const shareData = await getShareByToken(shareToken);
        if (cancelled) return;
        if (!shareData) {
          setError("Share link not found or has expired");
          return;
        }

        setLocalShare(shareData);
        void recordShareView(shareData);

        const key = await getOrCreateEncryptionKey("default-user");
        encryptionKeyRef.current = key;

        const note = await getNote(shareData.noteId, key);
        if (cancelled) return;
        if (!note) {
          setError("Note not found");
          return;
        }

        noteRef.current = note;
        lastPersistedRef.current = note.content;
        setNoteTitle(note.title);
        setNoteContent(note.content);

        if (shareData.permission !== "view") {
          setComments(await getShareComments(shareData.id));
        }
      } catch {
        if (!cancelled) setError("Failed to load shared note");
      } finally {
        if (!cancelled) setLocalLoading(false);
      }
    };

    void loadLocalShare();
    return () => {
      cancelled = true;
    };
  }, [serverSettled, serverDoc, shareToken]);

  // Local-path persistence. The server persists its own copy, so this only
  // applies to a link resolved from this browser's storage.
  useEffect(() => {
    if (serverDoc) return;
    const note = noteRef.current;
    const key = encryptionKeyRef.current;
    if (!canEdit || !note || !key) return;
    if (
      lastPersistedRef.current === null ||
      noteContent === lastPersistedRef.current
    ) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const updated = { ...note, content: noteContent };
        await saveNote(updated, key);
        noteRef.current = updated;
        lastPersistedRef.current = noteContent;
      } catch {
        toast.error("Failed to save changes to this note");
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [noteContent, canEdit, serverDoc]);

  const handleAddComment = async () => {
    if (!newComment.trim() || !localShare) return;

    setIsSubmitting(true);
    try {
      const comment = await addComment(
        localShare.noteId,
        localShare.id,
        "Anonymous",
        newComment
      );
      setComments([comment, ...comments]);
      setNewComment("");
      toast.success("Comment added");
    } catch {
      toast.error("Failed to add comment");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (linkQuery.isLoading || localLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Spinner className="size-8 mx-auto text-accent" />
          <p className="text-foreground font-medium">Loading shared note...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-md">
          <Lock className="w-12 h-12 text-destructive mx-auto opacity-50" />
          <div>
            <p className="text-foreground font-semibold text-lg">
              Access Denied
            </p>
            <p className="text-muted-foreground mt-2">{error}</p>
          </div>
          <Button
            onClick={() => (window.location.href = "/")}
            className="btn-notion"
          >
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  if (!serverDoc && !localShare) {
    return null;
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="bg-card/50 border-b border-border p-4 sm:p-6 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 sm:gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 rounded text-xs font-medium text-primary">
              {canEdit ? (
                <Lock className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              <span className="capitalize">{roleLabel}</span>
            </div>

            {serverDoc && isAuthenticated && (
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                  isConnected
                    ? "bg-accent/10 text-accent"
                    : "bg-muted text-muted-foreground"
                }`}
                title={
                  isConnected
                    ? "Connected — changes sync as you type"
                    : "Reconnecting — your changes are kept and sent when you are back"
                }
              >
                {isConnected ? (
                  <Wifi className="w-3 h-3" />
                ) : (
                  <WifiOff className="w-3 h-3" />
                )}
                {isConnected ? "Connected" : "Reconnecting…"}
              </div>
            )}

            {serverDoc && isAuthenticated && (
              <PresenceIndicators
                users={presenceUsers}
                currentUserId={selfUserId}
              />
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {noteTitle}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Shared note • {canEdit ? "You can edit" : "Read-only"}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 sm:p-6">
          {canEdit ? (
            <div
              ref={editorContainerRef}
              className="relative bg-card rounded-lg border border-border/50 mb-8"
            >
              <textarea
                value={displayedContent}
                onChange={e => handleEdit(e.target.value)}
                onSelect={e => handleCursor(e.currentTarget)}
                onKeyUp={e => handleCursor(e.currentTarget)}
                onClick={e => handleCursor(e.currentTarget)}
                spellCheck
                aria-label="Shared note editor"
                className="editor-textarea min-h-[50vh] font-mono text-sm rounded-lg bg-card"
              />
              {serverDoc && isAuthenticated && (
                <LiveCursors
                  cursors={cursors}
                  users={presenceMap}
                  editorRef={editorContainerRef}
                />
              )}
            </div>
          ) : (
            <div className="bg-card rounded-lg border border-border/50 p-6 sm:p-8 mb-8">
              <div className="text-foreground whitespace-pre-wrap font-mono text-sm leading-relaxed">
                {displayedContent}
              </div>
            </div>
          )}

          {/* Comments — stored in this browser, so only on the local path. */}
          {!serverDoc && canComment && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  Comments
                </h2>

                <div className="bg-card/50 rounded-lg border border-border/50 p-4 mb-6">
                  <textarea
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    aria-label="Add a comment"
                    className="w-full bg-background border border-border rounded px-3 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    rows={3}
                  />
                  <div className="flex justify-end mt-3">
                    <Button
                      onClick={handleAddComment}
                      disabled={!newComment.trim() || isSubmitting}
                      className="btn-notion"
                    >
                      {isSubmitting ? (
                        <Spinner className="mr-2" />
                      ) : (
                        <MessageSquare className="w-4 h-4 mr-2" />
                      )}
                      Post Comment
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  {comments.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No comments yet. Be the first to comment!
                    </div>
                  ) : (
                    comments.map(comment => (
                      <div
                        key={comment.id}
                        className="bg-card/50 rounded-lg border border-border/50 p-4"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-medium text-foreground">
                              {comment.author}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(comment.createdAt).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                            </p>
                          </div>
                        </div>
                        <p className="text-foreground whitespace-pre-wrap">
                          {comment.content}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-accent/10 border-t border-accent/20 p-4">
        <div className="max-w-4xl mx-auto text-sm text-foreground">
          <strong>Note:</strong>{" "}
          {canEdit
            ? "Everyone here edits the same note — changes appear as they happen."
            : "You have view-only access to this note."}
        </div>
      </div>
    </div>
  );
}
