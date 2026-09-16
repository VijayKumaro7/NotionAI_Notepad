import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@shared/password";
import { trpc } from "@/lib/trpc";

/**
 * Changing a password from inside the account panel.
 *
 * Three fields rather than two. The confirmation box is not ceremony: this form
 * signs every other device out, and a typo in a password nobody can read back
 * would do that while leaving the person unable to sign in again. The
 * confirmation is the only thing standing between a slipped keystroke and a
 * locked account.
 *
 * What it does not do is tell someone whether their current password was right
 * before they submit. Checking as they type would be a nicer form and a
 * password-guessing endpoint with a progress bar.
 */
export function ChangePassword({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const change = trpc.account.changePassword.useMutation({
    onSuccess: result => {
      setCurrent("");
      setNext("");
      setConfirm("");

      toast.success(
        result.otherSessionsRevoked > 0
          ? `Password changed. ${result.otherSessionsRevoked === 1 ? "One other device was" : `${result.otherSessionsRevoked} other devices were`} signed out.`
          : "Password changed."
      );
    },
    onError: error => toast.error(error.message),
  });

  // An account that signs in with Google or the portal has no password to
  // replace. Showing the form and refusing it would be a worse way to say so.
  if (!hasPassword) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
          {/* An explicit size: a bare h3 takes the landing-page display
              scale from index.css and renders at 36px in here. */}
          <h3 className="text-base font-medium text-foreground">Password</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          This account signs in without a password, so there is none to change.
        </p>
      </div>
    );
  }

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready =
    current.length > 0 &&
    next.length >= MIN_PASSWORD_LENGTH &&
    confirm === next &&
    !change.isPending;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
        {/* An explicit size: a bare h3 takes the landing-page display
            scale from index.css and renders at 36px in here. */}
        <h3 className="text-base font-medium text-foreground">
          Change password
        </h3>
      </div>

      <p className="text-sm text-muted-foreground">
        Every other signed-in device is signed out. This one stays.
      </p>

      <form
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          if (ready) {
            change.mutate({ currentPassword: current, newPassword: next });
          }
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="current-password" className="text-sm text-foreground">
            Current password
          </label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={event => setCurrent(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new-password" className="text-sm text-foreground">
            New password
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={event => setNext(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {tooShort
              ? `At least ${MIN_PASSWORD_LENGTH} characters.`
              : `${MIN_PASSWORD_LENGTH} characters or more — length matters more than symbols.`}
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm-password" className="text-sm text-foreground">
            New password again
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={event => setConfirm(event.target.value)}
          />
          {mismatch && (
            <p className="text-xs text-destructive">These two do not match.</p>
          )}
        </div>

        <Button type="submit" variant="outline" disabled={!ready}>
          {change.isPending && (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          )}
          Change password
        </Button>
      </form>
    </div>
  );
}
