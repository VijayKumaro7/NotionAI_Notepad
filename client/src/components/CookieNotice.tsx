import { useCallback, useState } from "react";
import { Link } from "wouter";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acknowledgeCookieNotice,
  shouldShowCookieNotice,
} from "@/lib/cookieNotice";
import { useServerPresence } from "@/hooks/useServerPresence";

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
 *
 * Both cookies are set by the server, so on a deploy that has none this said
 * "two cookies, both necessary" about cookies nothing had set — a page being
 * confidently specific about something that was not happening, which is worse
 * than vagueness because it can be checked. The notice still has something to
 * say there, and more of it: the only copy of the notes is the browser's own
 * storage.
 */
export function CookieNotice() {
  // Read once, at mount. Re-reading on every render would let the banner
  // reappear mid-session if another tab cleared storage.
  const [visible, setVisible] = useState(shouldShowCookieNotice);
  const server = useServerPresence();

  const dismiss = useCallback(() => {
    // Hide it either way. When the write fails — a private-mode browser — the
    // notice returns on the next load, which is the honest outcome: nothing
    // recorded the dismissal.
    acknowledgeCookieNotice();
    setVisible(false);
  }, []);

  // Waiting on the answer rather than assuming one. The router is already
  // blocked on this same query, so the notice appears with the page rather
  // than after it.
  if (!visible || server.pending) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-lg sm:flex-row sm:items-center sm:gap-4">
        <Cookie className="hidden h-5 w-5 shrink-0 text-primary sm:block" />
        <p className="flex-1 text-sm text-muted-foreground">
          {server.unreachable ? (
            <>
              <span className="font-medium text-foreground">
                No cookies on this deployment.
              </span>{" "}
              Both of this app&apos;s cookies are set by the server, and there
              is none running here, so nothing is stored under a cookie at all.
              No analytics, no telemetry, no third-party tracking either. Your
              notes are encrypted and kept in this browser&apos;s own storage,
              which is the only copy of them.{" "}
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">
                Two cookies, both necessary.
              </span>{" "}
              One keeps you signed in; the other secures a Google sign-in while
              it is in flight. No analytics, no telemetry, no third-party
              tracking — so there is nothing here to opt out of. Your notes are
              encrypted in this browser before they are stored anywhere.{" "}
            </>
          )}
          <Link
            href="/privacy"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            What we store
          </Link>
          .
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
