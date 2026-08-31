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
  onSignIn: () => void;
  onGoHome: () => void;
}

/**
 * Shown when a demo session runs out. There is no dismiss — closing it any way
 * other than signing in goes back to the landing page, which is the whole point
 * of the time limit.
 */
export function DemoExpiredDialog({
  open,
  onSignIn,
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
            You have had 30 minutes to try things out. Sign in to keep working —
            the notes you wrote are still on this device and will be waiting.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button variant="outline" onClick={onGoHome} className="flex-1">
            Back to home
          </Button>
          <Button onClick={onSignIn} className="flex-1">
            Sign in
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
