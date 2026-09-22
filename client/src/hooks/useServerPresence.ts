import { trpc } from "@/lib/trpc";

/**
 * Whether there is a server behind this deployment at all.
 *
 * Some builds of this app are the client bundle and nothing else — a static
 * host publishing `dist/public`, where `/api/*` answers 404 by design. Pages
 * that describe what the server does are wrong on those deploys unless they
 * can tell, and "wrong" here means telling someone their session is kept in a
 * cookie that nothing ever set.
 *
 * `auth.me` is the question to ask, for two reasons. The router already makes
 * it on every page, so a second caller shares the cache entry and costs no
 * extra request. And it is a public procedure that answers `null` for a
 * signed-out visitor rather than refusing — so an error from it means the
 * request never arrived, not that nobody is signed in.
 *
 * `pending` is worth waiting on rather than treating as "server present": a
 * notice that says "two cookies" and then corrects itself to "none" has
 * already told the person the wrong thing.
 */
export function useServerPresence(): {
  pending: boolean;
  unreachable: boolean;
} {
  const me = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    // Matches useAuth: every mount retrying a failed auth check would restart
    // the loading branch that unmounts the page that just mounted.
    retryOnMount: false,
  });

  return { pending: me.isPending, unreachable: me.isError };
}
