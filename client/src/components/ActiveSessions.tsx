import { toast } from "sonner";
import { Loader2, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

/**
 * Where this account is signed in, and a way to end any of it.
 *
 * The list is the point rather than the buttons. A session used to be a cookie
 * with a one-year expiry and no record anywhere, which meant the honest answer
 * to "am I still signed in on that old laptop?" was that nobody could know.
 * Every row here is a row in the database, and revoking one takes effect on the
 * next request that session makes.
 *
 * The current session is labelled and has no revoke button. Signing yourself
 * out from here would work, and would look like a bug — "Sign out" in the menu
 * is the thing that does that, and it says so.
 */
export function ActiveSessions({ open }: { open: boolean }) {
  const utils = trpc.useUtils();

  const sessions = trpc.auth.sessions.list.useQuery(undefined, {
    enabled: open,
    retry: false,
  });

  const revoke = trpc.auth.sessions.revoke.useMutation({
    onSuccess: async () => {
      await utils.auth.sessions.list.invalidate();
      toast.success("That device was signed out.");
    },
    onError: error => toast.error(error.message),
  });

  const revokeOthers = trpc.auth.sessions.revokeOthers.useMutation({
    onSuccess: async result => {
      await utils.auth.sessions.list.invalidate();
      toast.success(
        result.revoked === 0
          ? "No other devices were signed in."
          : result.revoked === 1
            ? "One other device was signed out."
            : `${result.revoked} other devices were signed out.`
      );
    },
    onError: error => toast.error(error.message),
  });

  const rows = sessions.data ?? [];
  const others = rows.filter(row => !row.current).length;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MonitorSmartphone className="w-4 h-4 text-muted-foreground shrink-0" />
        {/* An explicit size: a bare h3 takes the landing-page display
            scale from index.css and renders at 36px in here. */}
        <h3 className="text-base font-medium text-foreground">
          Where you are signed in
        </h3>
      </div>

      {sessions.isLoading ? (
        <p className="text-sm text-muted-foreground">Looking…</p>
      ) : sessions.isError ? (
        // Said plainly rather than shown as an empty list. "No other devices"
        // and "we could not ask" look identical otherwise, and only one of
        // them means you are safe to stop worrying.
        <p className="text-sm text-muted-foreground">
          This list could not be loaded, so it is not telling you there are no
          other devices — only that it could not ask.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map(row => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">
                    {row.device ?? "Unknown device"}
                    {row.current && (
                      <span className="text-muted-foreground">
                        {" "}
                        · this device
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last used {relative(row.lastSeenAt)}
                  </p>
                </div>

                {!row.current && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ sessionId: row.id })}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {others > 0 && (
            <Button
              variant="outline"
              disabled={revokeOthers.isPending}
              onClick={() => revokeOthers.mutate()}
            >
              {revokeOthers.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Sign out everywhere else
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * "3 days ago", from a Date superjson has already revived.
 *
 * Deliberately coarse. The exact minute a session was last used is not what
 * anyone reads this for, and printing it invites the reader to trust a
 * precision the five-minute write threshold in the session store does not
 * actually have.
 */
function relative(at: Date | string): string {
  const then = typeof at === "string" ? new Date(at) : at;
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);

  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
