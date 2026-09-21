import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Clock } from "lucide-react";

interface DemoExpiredDialogProps {
  open: boolean;
  /**
   * False when the API is not answering — a static-only deploy, where there is
   * no account to convert the demo into. The offer changes with it, because
   * "Sign in" there is a button that leads to a page explaining that signing
   * in is impossible.
   */
  canSignIn: boolean;
  onSignIn: () => void;
  onContinueLocally: () => void;
  onGoHome: () => void;
}

/**
 * Shown when a demo session runs out. There is no dismiss — closing it any way
 * other than taking one of the offers goes back to the landing page, which is
 * the whole point of the time limit.
 *
 * The limit exists to turn a visitor into an account, so where there is no
 * server to hold an account it is enforcing nothing and costing someone the
 * notes they just wrote. That case keeps the dialog but changes what it is
 * for: not "your time is up" but "here is what this deployment can do".
 */
export function DemoExpiredDialog({
  open,
  canSignIn,
  onSignIn,
  onContinueLocally,
  onGoHome,
}: DemoExpiredDialogProps) {
  return (
    <Dialog open={open} onOpenChange={next => !next && onGoHome()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <DialogTitle className="text-xl">Your demo has ended</DialogTitle>
          </div>
          <DialogDescription>
            {canSignIn
              ? "You have had 30 minutes to try things out. Sign in to keep working — the notes you wrote are still on this device and will be waiting."
              : "You have had 30 minutes to try things out. This deployment has no server running, so there is no account to sign in to — but the notepad itself needs one only for sync, sharing and AI. Keep going on this device and your notes stay encrypted in this browser."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button variant="outline" onClick={onGoHome} className="flex-1">
            Back to home
          </Button>
          {canSignIn ? (
            <Button onClick={onSignIn} className="flex-1">
              Sign in
            </Button>
          ) : (
            <Button onClick={onContinueLocally} className="flex-1">
              Keep using it here
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
