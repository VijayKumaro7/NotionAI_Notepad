import { ArrowLeft, Check, FileText, Mail, X } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

const ROLE_LABEL = { editor: "Editor", viewer: "Viewer" } as const;

/** A list that failed to load must not read as a list with nothing in it. */
function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p className="text-sm text-muted-foreground">
      Could not load {what}. This is not the same as there being none.{" "}
      <button className="underline" onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}

/**
 * Notes other people have offered or given you.
 *
 * An invitation is addressed to an email address and grants nothing until it
 * is accepted here, by an account that has verified that address. Declining
 * removes it. Notes already accepted are listed below so there is a way back
 * into them, since only a share link had one before.
 */
export default function SharedWithMe() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { isAuthenticated, loading } = useAuth();

  const invitations = trpc.collaboration.myInvitations.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const shared = trpc.collaboration.sharedWithMe.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });

  const refresh = () =>
    Promise.all([
      utils.collaboration.myInvitations.invalidate(),
      utils.collaboration.sharedWithMe.invalidate(),
    ]);
  const showError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong"
    );

  const accept = trpc.collaboration.acceptInvitation.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Invitation accepted");
    },
    onError: async error => {
      // It may have expired or been withdrawn since the list was loaded.
      await refresh();
      showError(error);
    },
  });
  const decline = trpc.collaboration.declineInvitation.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Invitation declined");
    },
    onError: async error => {
      await refresh();
      showError(error);
    },
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="size-8 text-accent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center space-y-4 max-w-md">
          <p className="text-foreground font-semibold text-lg">
            Sign in to see what has been shared with you
          </p>
          <p className="text-muted-foreground">
            Invitations are sent to an email address. Sign in with that address
            to accept them.
          </p>
          <button className="btn-notion" onClick={() => navigate("/login")}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const pending = invitations.data ?? [];
  const notes = shared.data ?? [];
  const busy = accept.isPending || decline.isPending;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <button
            className="btn-notion-secondary btn-notion-sm"
            onClick={() => navigate("/app")}
            aria-label="Back to my notes"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-2xl font-semibold text-foreground">
            Shared with you
          </h1>
        </div>

        <section aria-labelledby="invitations-heading" className="space-y-3">
          <h2
            id="invitations-heading"
            className="text-sm font-medium text-foreground flex items-center gap-2"
          >
            <Mail className="w-4 h-4 text-accent" />
            Invitations ({pending.length})
          </h2>

          {invitations.isLoading ? (
            <Spinner />
          ) : invitations.isError ? (
            <LoadFailed
              what="your invitations"
              onRetry={() => void invitations.refetch()}
            />
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No invitations right now. They arrive at the email address you
              verified for this account.
            </p>
          ) : (
            pending.map(invitation => (
              <div
                key={invitation.id}
                className="bg-card/50 rounded-lg border border-border/50 p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {invitation.title || "Untitled note"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {invitation.ownerName || "Someone"} invited you as{" "}
                    {ROLE_LABEL[invitation.role].toLowerCase()} · expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    className="btn-notion btn-notion-sm"
                    disabled={busy}
                    onClick={() =>
                      accept.mutate({ invitationId: invitation.id })
                    }
                    aria-label={`Accept invitation to ${invitation.title || "Untitled note"}`}
                  >
                    <Check className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">Accept</span>
                  </button>
                  <button
                    className="btn-notion-secondary btn-notion-sm"
                    disabled={busy}
                    onClick={() =>
                      decline.mutate({ invitationId: invitation.id })
                    }
                    aria-label={`Decline invitation to ${invitation.title || "Untitled note"}`}
                  >
                    <X className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">Decline</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <section aria-labelledby="notes-heading" className="space-y-3">
          <h2
            id="notes-heading"
            className="text-sm font-medium text-foreground flex items-center gap-2"
          >
            <FileText className="w-4 h-4 text-accent" />
            Notes ({notes.length})
          </h2>

          {shared.isLoading ? (
            <Spinner />
          ) : shared.isError ? (
            <LoadFailed
              what="the notes shared with you"
              onRetry={() => void shared.refetch()}
            />
          ) : notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing has been shared with you yet.
            </p>
          ) : (
            notes.map(note => (
              <button
                key={note.noteId}
                onClick={() => navigate(`/note/${note.noteId}`)}
                className="w-full text-left bg-card/50 rounded-lg border border-border/50 p-4 hover:bg-card transition-colors"
              >
                <p className="font-medium text-foreground truncate">
                  {note.title || "Untitled note"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABEL[note.role]} · from {note.ownerName || "someone"}
                </p>
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
