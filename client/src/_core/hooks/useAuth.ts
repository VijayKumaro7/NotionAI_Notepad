import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  // redirectPath defaults lazily to getLoginUrl() inside the redirect effect,
  // so simply calling useAuth() never touches OAuth configuration.
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    // Landing/NotesApp call useAuth() too, so each one mounts another observer.
    // Left on, a failed auth check would be retried by every mount, and the
    // refetch flips the router back to its loading branch — unmounting the page
    // that just mounted, which unmounts the observer, which starts over.
    retryOnMount: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  // Writing to localStorage is a side effect, so it belongs in an effect rather
  // than in render. Every useAuth() caller re-ran this write on every render,
  // and React may call a component's render body without committing it.
  useEffect(() => {
    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify(meQuery.data)
    );
  }, [meQuery.data]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      // Only the very first auth check should blank the app out. isLoading goes
      // true again on any refetch, and the router gates the whole tree on it.
      loading:
        (meQuery.isLoading && !meQuery.isFetched) || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isFetched,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;

    const target = redirectPath ?? getLoginUrl();
    if (window.location.pathname === target) return;

    window.location.href = target;
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
