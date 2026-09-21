import { Button } from "@/components/ui/button";
import { Check, CloudOff, Minus } from "lucide-react";

interface NoServerNoticeProps {
  onContinue: () => void;
}

/**
 * What the login page shows when the API does not answer at all.
 *
 * This used to be the end of the road: a paragraph explaining that the
 * deployment has no server, on a page whose every other control goes through
 * that server. Correct, and a dead end — the app was unreachable from its own
 * sign-in page, even though notes are written and encrypted in the browser and
 * need nothing behind them.
 *
 * So it says the same thing and then offers the way in that actually exists.
 * The two lists are the point: what is missing here is missing for good on
 * this deploy, and someone should know which half they are getting before
 * they start writing in it.
 */
export function NoServerNotice({ onContinue }: NoServerNoticeProps) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
          <CloudOff className="w-4 h-4 text-muted-foreground" />
        </div>
        <p className="font-medium text-foreground">
          This deployment has no server running.
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Its API is not answering, so there is no account to sign in to. A
        static-only deploy serves the app but nothing behind it — see Deployment
        in the README for how to run the server. You can still use the notepad
        on this device.
      </p>

      <ul className="space-y-1.5 text-sm">
        <li className="flex gap-2 text-foreground">
          <Check className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <span>
            Notes, folders, search, templates, version history and export
          </span>
        </li>
        <li className="flex gap-2 text-muted-foreground">
          <Minus className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            No sync, sharing, collaboration or AI — all of those are the server
          </span>
        </li>
      </ul>

      <Button size="lg" className="w-full" onClick={onContinue}>
        Use Notepad AI on this device
      </Button>

      <p className="text-xs text-muted-foreground">
        Your notes are encrypted and stay in this browser. Nothing leaves it,
        and clearing site data erases them — export anything you want to keep.
      </p>
    </div>
  );
}
