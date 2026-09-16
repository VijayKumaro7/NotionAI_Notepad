import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Download,
  Loader2,
  Trash2,
  UserRound,
} from "lucide-react";
import { CONFIRMATION_PHRASE, matchesConfirmation } from "@shared/account";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ActiveSessions } from "@/components/ActiveSessions";
import { ChangePassword } from "@/components/ChangePassword";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  buildExportArchive,
  describeExport,
  exportFilename,
  serializeExport,
} from "@/lib/dataExport";
import { downloadBlob } from "@/lib/exportService";
import { eraseLocalData } from "@/lib/localErasure";
import type { Folder, Note } from "@/lib/storage";
import { trpc } from "@/lib/trpc";

interface AccountSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read with the encryption key, so the archive is not a file of ciphertext. */
  getNotes: () => Promise<Note[]>;
  folders: Folder[];
}

/**
 * The account panel, which is mostly one irreversible button.
 *
 * Two decisions worth knowing about:
 *
 * The proof is asked for up front. `account.requirements` says whether this
 * account has a second factor or a password, so the form can show the right
 * field the first time rather than refusing once and then explaining what it
 * actually wanted.
 *
 * The browser's own copy is offered, not assumed. Deleting the account removes
 * what the server holds — for notes, ciphertext it could never read — while the
 * readable copy sits in IndexedDB on this machine. Wiping it silently would
 * destroy notes that were never synced anywhere; not mentioning it would leave
 * someone believing their notes were gone when the plainest copy is still here.
 *
 * Downloading everything sits directly above deleting everything, on purpose.
 * They are the same question asked twice, and the only honest order to offer
 * them in is that one.
 */
export function AccountSettings({
  open,
  onOpenChange,
  getNotes,
  folders,
}: AccountSettingsProps) {
  const { user } = useAuth();
  const [armed, setArmed] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [secret, setSecret] = useState("");
  const [eraseHere, setEraseHere] = useState(false);

  const requirements = trpc.account.requirements.useQuery(undefined, {
    retry: false,
    enabled: open,
  });

  const reset = () => {
    setArmed(false);
    setConfirmation("");
    setSecret("");
    setEraseHere(false);
  };

  const remove = trpc.account.delete.useMutation({
    onSuccess: async summary => {
      if (eraseHere) {
        const result = await eraseLocalData();
        if (result === "blocked") {
          toast.warning(
            "Your account is deleted. The copy in this browser will go once the other tab using it is closed."
          );
        } else if (result === "failed") {
          toast.warning(
            "Your account is deleted, but this browser would not let go of its local copy. Clear this site's data to remove it."
          );
        }
      }

      toast.success(
        summary.notes === 1
          ? "Account deleted, along with 1 synced note."
          : `Account deleted, along with ${summary.notes} synced notes.`
      );

      // A full load rather than a route change: the app is holding notes, a
      // query cache and an encryption key for an account that no longer
      // exists, and the cheapest way to be sure none of it survives the next
      // render is not to have a next render.
      window.location.replace("/");
    },
    onError: error => toast.error(error.message),
  });

  const [exporting, setExporting] = useState(false);
  const utils = trpc.useUtils();

  const downloadEverything = async () => {
    setExporting(true);
    try {
      const notes = await getNotes();

      // The chats are the reason this exists, but a server that will not
      // answer must not silently turn into "you had none": the archive
      // records null, and says so in the toast.
      let chats = null;
      try {
        chats = (await utils.client.account.export.query()).chats;
      } catch (error) {
        console.warn("[Export] Could not fetch saved chats:", error);
      }

      const generatedAt = Date.now();
      const archive = buildExportArchive({
        notes,
        folders,
        chats,
        generatedAt,
      });

      downloadBlob(
        new Blob([serializeExport(archive)], { type: "application/json" }),
        exportFilename(generatedAt)
      );
      toast.success(`Downloaded ${describeExport(archive)}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not build the export."
      );
    } finally {
      setExporting(false);
    }
  };

  const proof = requirements.data?.proof;
  const typedPhrase = matchesConfirmation(confirmation);
  const needsSecret = proof === "password" || proof === "two_factor_code";
  const ready = typedPhrase && (!needsSecret || secret.trim().length > 0);

  const submit = () =>
    remove.mutate({
      confirmation,
      ...(proof === "password" ? { password: secret } : {}),
      ...(proof === "two_factor_code" ? { code: secret.trim() } : {}),
    });

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <UserRound className="w-5 h-5 text-primary" />
            </div>
            <DialogTitle className="text-xl">Account</DialogTitle>
          </div>
          <DialogDescription>
            {user?.email ?? user?.name ?? "Signed in"}
            {user?.loginMethod ? ` · signed in with ${user.loginMethod}` : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Above the export and the delete button, in that order: the two
              things someone does routinely come before the two they do once. */}
          <ChangePassword
            hasPassword={requirements.data?.hasPassword ?? false}
          />

          <ActiveSessions open={open} />

          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-muted-foreground shrink-0" />
              {/* An explicit size: a bare h3 takes the landing-page display
                  scale from index.css and renders at 36px in here. */}
              <h3 className="text-base font-medium text-foreground">
                Download everything
              </h3>
            </div>

            <p className="text-sm text-muted-foreground">
              One JSON file with your notes, your folders and your saved chats.
              The file lists what it holds and what it cannot — worth reading
              before you rely on it.
            </p>

            <Button
              variant="outline"
              onClick={downloadEverything}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Download my data
            </Button>
          </div>

          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              {/* An explicit size: a bare h3 takes the landing-page display
                  scale from index.css and renders at 36px in here. */}
              <h3 className="text-base font-medium text-foreground">
                Delete this account
              </h3>
            </div>

            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                Removes your synced notes, anything published for collaboration,
                your saved chats, your cloud backups and your two-step
                verification — permanently, with no recently-deleted list to
                recover from.
              </p>
              <p>
                The notes kept in this browser stay unless you ask for them to
                go too — there is a box for that below.
              </p>
              <p>
                Signing in again afterwards starts a new, empty account. Nothing
                deleted comes back with it.
              </p>
            </div>

            {!armed ? (
              <Button
                variant="destructive"
                onClick={() => setArmed(true)}
                disabled={requirements.isLoading}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete account
              </Button>
            ) : requirements.isError ? (
              // Without this the form would ask for nothing and the server
              // would refuse, which reads as a broken button rather than as a
              // panel that could not reach the server.
              <div className="space-y-3">
                <p className="text-sm text-foreground">
                  Could not reach your account settings, so this cannot ask for
                  the right confirmation. Nothing has been deleted.
                </p>
                <Button
                  variant="outline"
                  onClick={() => requirements.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={event => {
                  event.preventDefault();
                  if (ready) submit();
                }}
              >
                {proof === "password" && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="delete-secret"
                      className="text-sm text-foreground"
                    >
                      Your password
                    </label>
                    <Input
                      id="delete-secret"
                      type="password"
                      autoComplete="current-password"
                      value={secret}
                      onChange={event => setSecret(event.target.value)}
                    />
                  </div>
                )}

                {proof === "two_factor_code" && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="delete-secret"
                      className="text-sm text-foreground"
                    >
                      A current code, or an unused recovery code
                    </label>
                    <Input
                      id="delete-secret"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={secret}
                      onChange={event => setSecret(event.target.value)}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label
                    htmlFor="delete-confirmation"
                    className="text-sm text-foreground"
                  >
                    Type <strong>{CONFIRMATION_PHRASE}</strong> to confirm
                  </label>
                  <Input
                    id="delete-confirmation"
                    autoFocus
                    autoComplete="off"
                    value={confirmation}
                    onChange={event => setConfirmation(event.target.value)}
                  />
                </div>

                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-destructive"
                    checked={eraseHere}
                    onChange={event => setEraseHere(event.target.checked)}
                  />
                  <span>
                    Also erase the copy kept in this browser. Your notes are
                    readable here even though the server&apos;s copy is not —
                    but a note you never synced exists nowhere else, and this
                    cannot be undone either.
                  </span>
                </label>

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={reset}
                    disabled={remove.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="destructive"
                    className="flex-1"
                    disabled={!ready || remove.isPending}
                  >
                    {remove.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    Delete permanently
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
