import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { MessageSquare, Lock, Eye, Wifi, WifiOff } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import {
  getShareByToken,
  recordShareView,
  getNote,
  getShareComments,
  addComment,
  NoteShare,
  Comment,
} from '@/lib/storage';
import { useCollaboration } from '@/hooks/useCollaboration';
import {
  applyContentChange,
  computeContentChanges,
  CollaborationUser,
} from '@/lib/collaboration';
import PresenceIndicators from '@/components/PresenceIndicators';
import LiveCursors from '@/components/LiveCursors';

function getGuestName(): string {
  const existing = sessionStorage.getItem('collab-guest-name');
  if (existing) return existing;
  const name = `Guest-${Math.random().toString(36).slice(2, 6)}`;
  sessionStorage.setItem('collab-guest-name', name);
  return name;
}

export default function SharedNoteView() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [share, setShare] = useState<NoteShare | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userName] = useState(getGuestName);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef(noteContent);
  contentRef.current = noteContent;

  const {
    isConnected,
    presenceUsers,
    cursors,
    sendCursorUpdate,
    sendContentChange,
    getUserId,
  } = useCollaboration({
    shareToken: shareToken ?? '',
    userName,
    // Connect only once the share and its note have finished loading, so the
    // document we may be asked to seed the room with is the real one.
    enabled: !isLoading && !!share && !error,
    onContentChange: (change) => {
      setNoteContent((prev) => applyContentChange(prev, change));
    },
    getContent: () => contentRef.current,
    onSyncContent: (content) => setNoteContent(content),
  });

  const handleEdit = useCallback(
    (newValue: string) => {
      for (const change of computeContentChanges(contentRef.current, newValue)) {
        sendContentChange(change.type, change.position, change.content, change.length);
      }
      setNoteContent(newValue);
    },
    [sendContentChange]
  );

  const handleCursor = useCallback(
    (target: HTMLTextAreaElement) => {
      sendCursorUpdate(target.selectionStart, target.selectionStart, target.selectionEnd);
    },
    [sendCursorUpdate]
  );

  const presenceMap = new Map<string, CollaborationUser>(presenceUsers.map((u) => [u.id, u]));

  useEffect(() => {
    loadSharedNote();
  }, [shareToken]);

  const loadSharedNote = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!shareToken) {
        setError('Invalid share link');
        return;
      }

      const shareData = await getShareByToken(shareToken);
      if (!shareData) {
        setError('Share link not found or has expired');
        return;
      }

      setShare(shareData);
      // Log the visit for the note owner's sharing activity view.
      void recordShareView(shareData);

      const note = await getNote(shareData.noteId);
      if (!note) {
        setError('Note not found');
        return;
      }

      setNoteTitle(note.title);
      setNoteContent(note.content);

      if (shareData.permission === 'comment' || shareData.permission === 'edit') {
        const noteComments = await getShareComments(shareData.id);
        setComments(noteComments);
      }
    } catch (err) {
      setError('Failed to load shared note');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !share) return;

    setIsSubmitting(true);
    try {
      const comment = await addComment(
        share.noteId,
        share.id,
        'Anonymous',
        newComment
      );
      setComments([comment, ...comments]);
      setNewComment('');
      toast.success('Comment added');
    } catch (error) {
      toast.error('Failed to add comment');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
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
            <p className="text-foreground font-semibold text-lg">Access Denied</p>
            <p className="text-muted-foreground mt-2">{error}</p>
          </div>
          <Button onClick={() => window.location.href = '/'} className="btn-notion">
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  if (!share) {
    return null;
  }

  const canComment = share.permission === 'comment' || share.permission === 'edit';
  const canEdit = share.permission === 'edit';

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="bg-card/50 border-b border-border p-6 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 rounded text-xs font-medium text-primary">
              {share.permission === 'view' && <Eye className="w-4 h-4" />}
              {share.permission === 'comment' && <MessageSquare className="w-4 h-4" />}
              {share.permission === 'edit' && <Lock className="w-4 h-4" />}
              <span className="capitalize">{share.permission}</span>
            </div>
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                isConnected ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground'
              }`}
              title={isConnected ? 'Real-time collaboration connected' : 'Offline — changes are not shared'}
            >
              {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isConnected ? 'Live' : 'Offline'}
            </div>
            <PresenceIndicators users={presenceUsers} currentUserId={getUserId()} />
          </div>
          <h1 className="text-3xl font-bold text-foreground">{noteTitle}</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Shared note • {canEdit ? 'Collaborative editing' : 'Read-only view'} • You are {userName}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          {/* Note Content */}
          {canEdit ? (
            <div
              ref={editorContainerRef}
              className="relative bg-card rounded-lg border border-border/50 mb-8"
            >
              <textarea
                value={noteContent}
                onChange={(e) => handleEdit(e.target.value)}
                onSelect={(e) => handleCursor(e.currentTarget)}
                onKeyUp={(e) => handleCursor(e.currentTarget)}
                onClick={(e) => handleCursor(e.currentTarget)}
                spellCheck
                aria-label="Shared note editor"
                className="editor-textarea min-h-[50vh] font-mono text-sm rounded-lg bg-card"
              />
              <LiveCursors cursors={cursors} users={presenceMap} editorRef={editorContainerRef} />
            </div>
          ) : (
            <div className="bg-card rounded-lg border border-border/50 p-8 mb-8 prose prose-invert max-w-none">
              <div className="text-foreground whitespace-pre-wrap font-mono text-sm leading-relaxed">
                {noteContent}
              </div>
            </div>
          )}

          {/* Comments Section */}
          {canComment && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-4">Comments</h2>

                {/* Add Comment */}
                <div className="bg-card/50 rounded-lg border border-border/50 p-4 mb-6">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
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

                {/* Comments List */}
                <div className="space-y-4">
                  {comments.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No comments yet. Be the first to comment!
                    </div>
                  ) : (
                    comments.map((comment) => (
                      <div key={comment.id} className="bg-card/50 rounded-lg border border-border/50 p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-medium text-foreground">{comment.author}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(comment.createdAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </div>
                        <p className="text-foreground whitespace-pre-wrap">{comment.content}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-accent/10 border-t border-accent/20 p-4">
        <div className="max-w-4xl mx-auto text-sm text-foreground">
          <strong>Note:</strong> This is a shared view of a note. {canEdit ? 'You can edit this note directly.' : 'You cannot edit this note.'}
        </div>
      </div>
    </div>
  );
}
