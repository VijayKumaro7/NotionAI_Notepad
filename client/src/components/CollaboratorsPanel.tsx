import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Copy, Link2, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';

type GrantableRole = 'editor' | 'viewer';

interface CollaboratorsPanelProps {
  /** The browser-side note id; the server maps it to its own record. */
  clientId: string;
  noteTitle: string;
  noteContent: string;
}

const ROLE_HINT: Record<GrantableRole, string> = {
  editor: 'Can edit the note with you',
  viewer: 'Can read the note, but not change it',
};

/**
 * People and links for one note.
 *
 * A private note is end-to-end encrypted and unreadable by the server, so it
 * cannot be collaborated on until it is published. That is an explicit,
 * stated step rather than something that happens quietly on first share.
 */
export function CollaboratorsPanel({
  clientId,
  noteTitle,
  noteContent,
}: CollaboratorsPanelProps) {
  const utils = trpc.useUtils();
  // These are protected procedures, and a 401 from any query trips the global
  // unauthorized handler, which would send a demo visitor to the login page.
  const { isAuthenticated } = useAuth();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<GrantableRole>('editor');
  const [linkRole, setLinkRole] = useState<GrantableRole>('viewer');

  const status = trpc.collaboration.status.useQuery(
    { clientId },
    { retry: false, enabled: isAuthenticated }
  );
  const noteId = status.data?.published ? status.data.noteId : null;

  const collaborators = trpc.collaboration.collaborators.useQuery(
    { noteId: noteId ?? 0 },
    { enabled: noteId !== null, retry: false }
  );
  const links = trpc.collaboration.links.useQuery(
    { noteId: noteId ?? 0 },
    { enabled: noteId !== null, retry: false }
  );

  const refresh = async () => {
    await Promise.all([
      utils.collaboration.status.invalidate({ clientId }),
      noteId === null
        ? Promise.resolve()
        : utils.collaboration.collaborators.invalidate({ noteId }),
      noteId === null
        ? Promise.resolve()
        : utils.collaboration.links.invalidate({ noteId }),
    ]);
  };

  const showError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : 'Something went wrong'
    );

  const publish = trpc.collaboration.publish.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success('Note published for collaboration');
    },
    onError: showError,
  });

  const invite = trpc.collaboration.invite.useMutation({
    onSuccess: async person => {
      setInviteEmail('');
      await refresh();
      toast.success(`Invited ${person.name || person.email}`);
    },
    onError: showError,
  });

  const setRole = trpc.collaboration.setRole.useMutation({
    onSuccess: refresh,
    onError: showError,
  });

  const removeCollaborator = trpc.collaboration.removeCollaborator.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success('Collaborator removed');
    },
    onError: showError,
  });

  const createLink = trpc.collaboration.createLink.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success('Share link created');
    },
    onError: showError,
  });

  const revokeLink = trpc.collaboration.revokeLink.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success('Link revoked');
    },
    onError: showError,
  });

  const copyLink = (token: string) => {
    void navigator.clipboard.writeText(
      `${window.location.origin}/shared/${token}`
    );
    toast.success('Link copied to clipboard');
  };

  if (!isAuthenticated) {
    return (
      <div className="bg-card/50 rounded-lg border border-border/50 p-4 text-sm text-muted-foreground">
        Sign in to invite people to edit this note with you.
      </div>
    );
  }

  if (status.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Spinner /> Checking sharing status…
      </div>
    );
  }

  // Signed-out (or offline): the local link section below still works.
  if (status.isError) {
    return (
      <div className="bg-card/50 rounded-lg border border-border/50 p-4 text-sm text-muted-foreground">
        Sign in to invite people to edit this note with you.
      </div>
    );
  }

  if (!status.data?.published) {
    return (
      <div className="bg-card/50 rounded-lg border border-border/50 p-4 space-y-3">
        <h3 className="font-medium text-foreground flex items-center gap-2">
          <Users className="w-4 h-4 text-accent" />
          Collaborate with others
        </h3>
        <p className="text-sm text-muted-foreground">
          This note is encrypted on your device, so no one else can open it yet.
          Publishing stores a copy the people you invite can read and edit
          together in real time.
        </p>
        <Button
          onClick={() =>
            publish.mutate({
              clientId,
              title: noteTitle,
              content: noteContent,
            })
          }
          disabled={publish.isPending}
          className="btn-notion"
        >
          {publish.isPending ? <Spinner className="mr-2" /> : <Users className="w-4 h-4 mr-2" />}
          Publish for collaboration
        </Button>
      </div>
    );
  }

  // Capture the narrowed id: reading status.data inside a callback widens it
  // back to possibly-undefined.
  const publishedNoteId = status.data.noteId;
  const people = collaborators.data ?? [];

  return (
    <div className="space-y-4">
      {/* Invite */}
      <div className="bg-card/50 rounded-lg border border-border/50 p-4 space-y-3">
        <h3 className="font-medium text-foreground flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-accent" />
          Invite someone
        </h3>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <label
              htmlFor="invite-email"
              className="text-sm font-medium text-foreground block mb-2"
            >
              Email address
            </label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="person@example.com"
              className="input-notion"
            />
          </div>
          <Select
            value={inviteRole}
            onValueChange={value => setInviteRole(value as GrantableRole)}
          >
            <SelectTrigger className="input-notion sm:w-36" aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() =>
              invite.mutate({
                noteId: publishedNoteId,
                email: inviteEmail.trim(),
                role: inviteRole,
              })
            }
            disabled={!inviteEmail.trim() || invite.isPending}
            className="btn-notion"
          >
            {invite.isPending ? <Spinner className="mr-2" /> : null}
            Invite
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{ROLE_HINT[inviteRole]}</p>
      </div>

      {/* People with access */}
      <div>
        <h3 className="font-medium text-foreground mb-3">
          People with access ({people.length})
        </h3>
        {collaborators.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading…
          </div>
        ) : (
          <div className="space-y-2">
            {people.map(person => (
              <div
                key={person.userId}
                className="bg-card/50 rounded-lg border border-border/50 p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {person.name || person.email}
                  </p>
                  {person.name && person.email && (
                    <p className="text-xs text-muted-foreground truncate">
                      {person.email}
                    </p>
                  )}
                </div>

                {person.role === 'owner' ? (
                  <span className="text-xs font-medium text-muted-foreground px-2 py-1">
                    Owner
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select
                      value={person.role}
                      onValueChange={value =>
                        setRole.mutate({
                          noteId: publishedNoteId,
                          userId: person.userId,
                          role: value as GrantableRole,
                        })
                      }
                    >
                      <SelectTrigger
                        className="input-notion h-8 w-28"
                        aria-label={`Role for ${person.name || person.email}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="btn-notion-secondary"
                      aria-label={`Remove ${person.name || person.email}`}
                      onClick={() =>
                        removeCollaborator.mutate({
                          noteId: publishedNoteId,
                          userId: person.userId,
                        })
                      }
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Links */}
      <div className="bg-card/50 rounded-lg border border-border/50 p-4 space-y-3">
        <h3 className="font-medium text-foreground flex items-center gap-2">
          <Link2 className="w-4 h-4 text-accent" />
          Share links
        </h3>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <Select
            value={linkRole}
            onValueChange={value => setLinkRole(value as GrantableRole)}
          >
            <SelectTrigger className="input-notion sm:w-36" aria-label="Link role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="viewer">Viewer</SelectItem>
              <SelectItem value="editor">Editor</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() =>
              createLink.mutate({
                noteId: publishedNoteId,
                role: linkRole,
                expiresInDays: 30,
              })
            }
            disabled={createLink.isPending}
            className="btn-notion"
          >
            {createLink.isPending ? <Spinner className="mr-2" /> : null}
            Create link
          </Button>
        </div>

        {(links.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No active links.</p>
        ) : (
          <div className="space-y-2">
            {(links.data ?? []).map(link => (
              <div
                key={link.token}
                className="flex items-center justify-between gap-2 bg-background rounded p-2"
              >
                <div className="min-w-0">
                  <code className="text-xs font-mono text-foreground/70 truncate block">
                    /shared/{link.token.slice(0, 12)}…
                  </code>
                  <span className="text-xs text-muted-foreground capitalize">
                    {link.role}
                    {link.expiresAt
                      ? ` • expires ${new Date(link.expiresAt).toLocaleDateString()}`
                      : ' • no expiry'}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="btn-notion-secondary"
                    aria-label="Copy link"
                    onClick={() => copyLink(link.token)}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    className="btn-notion-secondary"
                    aria-label="Revoke link"
                    onClick={() =>
                      revokeLink.mutate({
                        noteId: publishedNoteId,
                        token: link.token,
                      })
                    }
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
