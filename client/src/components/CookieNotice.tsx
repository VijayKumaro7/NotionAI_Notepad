import { useCallback, useState } from "react";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acknowledgeCookieNotice,
  shouldShowCookieNotice,
} from "@/lib/cookieNotice";

/**
 * What this site stores on the visitor's machine, said once.
 *
 * A notice, not a consent gate — see lib/cookieNotice.ts for why, and for the
 * version to bump if that ever stops being true.
 *
 * Not a modal: it announces something, it does not ask a question, so it takes
 * no focus and blocks nothing. `role="region"` with a label puts it in a screen
 * reader's landmark list, reachable when the person chooses rather than the
 * moment the page loads.
 */
export function CookieNotice() {
  // Read once, at mount. Re-reading on every render would let the banner
  // reappear mid-session if another tab cleared storage.
  const [visible, setVisible] = useState(shouldShowCookieNotice);

  const dismiss = useCallback(() => {
    // Hide it either way. When the write fails — a private-mode browser — the
    // notice returns on the next load, which is the honest outcome: nothing
    // recorded the dismissal.
    acknowledgeCookieNotice();
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-lg sm:flex-row sm:items-center sm:gap-4">
        <Cookie className="hidden h-5 w-5 shrink-0 text-primary sm:block" />
        <p className="flex-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            Two cookies, both necessary.
          </span>{" "}
          One keeps you signed in; the other secures a Google sign-in while it
          is in flight. No analytics, no telemetry, no third-party tracking — so
          there is nothing here to opt out of. Your notes are encrypted in this
          browser before they are stored anywhere.
        </p>
        <Button
          size="sm"
          onClick={dismiss}
          className="btn-premium shrink-0 self-start sm:self-auto"
        >
          Got it
        </Button>
      </div>
    </div>
  );
}
