import { useParams, useLocation } from 'wouter';
import { ArrowLeft, Eye, Lock, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { trpc } from '@/lib/trpc';
import { useCollaboration } from '@/hooks/useCollaboration';
import { CollaborationBar } from '@/components/CollaborationBar';

/**
 * A note someone else shared with you, opened by its id rather than a link.
 *
 * An invited collaborator has no copy of the note in their own browser, so
 * this reads the server's document directly. Access is checked server-side on
 * both the query and the socket.
 */
export default function CollaborativeNote() {
  const params = useParams<{ noteId: string }>();
  const [, navigate] = useLocation();
  const noteId = Number(params.noteId);
  const valid = Number.isSafeInteger(noteId) && noteId > 0;

  const document = trpc.collaboration.document.useQuery(
    { noteId: valid ? noteId : 0 },
    { enabled: valid, retry: false }
  );

  const collab = useCollaboration({
    room: `note:${noteId}`,
    enabled: valid && document.isSuccess,
  });

  if (!valid || document.isError) {
    return (
      <div className="h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center space-y-4 max-w-md">
          <Lock className="w-12 h-12 text-destructive mx-auto opacity-50" />
          <div>
            <p className="text-foreground font-semibold text-lg">
              You cannot open this note
            </p>
            <p className="text-muted-foreground mt-2">
              {document.error?.message ??
                'That note does not exist, or it is not shared with you.'}
            </p>
          </div>
          <Button onClick={() => navigate('/app')} className="btn-notion">
            Back to your notes
          </Button>
        </div>
      </div>
    );
  }

  if (document.isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Spinner className="size-8 mx-auto text-accent" />
          <p className="text-foreground font-medium">Opening shared note…</p>
        </div>
      </div>
    );
  }

  const canEdit = collab.canEdit;
  const text = collab.isConnected ? collab.text : (document.data?.content ?? '');

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="bg-card/50 border-b border-border p-4 sm:p-6 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Button
              onClick={() => navigate('/app')}
              className="btn-notion-secondary"
              size="sm"
              aria-label="Back to your notes"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>

            <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 rounded text-xs font-medium text-primary">
              {canEdit ? <Lock className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              <span className="capitalize">{collab.role ?? 'viewer'}</span>
            </div>

            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                collab.isConnected
                  ? 'bg-accent/10 text-accent'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {collab.isConnected ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {collab.isConnected ? 'Connected' : 'Reconnecting…'}
            </div>

            <CollaborationBar
              users={collab.presenceUsers}
              currentUserId={collab.selfUserId}
              isConnected={collab.isConnected}
              role={collab.role}
            />
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {document.data?.title || 'Untitled Note'}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Shared with you • {canEdit ? 'You can edit' : 'Read-only'}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 sm:p-6">
          {canEdit ? (
            <div className="bg-card rounded-lg border border-border/50">
              <textarea
                value={text}
                onChange={e => collab.setText(e.target.value)}
                onSelect={e =>
                  collab.sendCursorUpdate(
                    e.currentTarget.selectionStart,
                    e.currentTarget.selectionStart,
                    e.currentTarget.selectionEnd
                  )
                }
                spellCheck
                aria-label="Shared note editor"
                className="editor-textarea min-h-[60vh] font-mono text-sm rounded-lg bg-card"
              />
            </div>
          ) : (
            <div className="bg-card rounded-lg border border-border/50 p-6 sm:p-8">
              <div className="text-foreground whitespace-pre-wrap font-mono text-sm leading-relaxed">
                {text}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
