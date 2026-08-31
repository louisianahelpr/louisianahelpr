import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuthReady } from "@/hooks/useAuthReady";
import { channelNonce } from "@/lib/realtimeChannel";
import { queryKeys } from "@/lib/queryKeys";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const PROFILE_QUERY_TIMEOUT_MS = 10000;
const DEBUG_AUTH = import.meta.env.DEV;

const withTimeout = async <T,>(promise: Promise<T>, ms = PROFILE_QUERY_TIMEOUT_MS): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error("Profile request timed out")), ms)),
  ]);
};

interface CurrentUser {
  user: ReturnType<typeof useAuthReady>["user"];
  profile: Profile | null;
  isAdmin: boolean;
  isLoading: boolean;
  /**
   * True when the profile query has finished (after all retries) and ended in
   * error. Distinct from `isLoading`: we are no longer waiting, the fetch
   * just failed. Callers (notably `ProtectedRoute`) use this to avoid
   * fail-open rendering when the profile can never arrive in this session
   * without a manual retry — see PR #303 follow-up.
   */
  isError: boolean;
  /** Force a re-fetch of the current user's profile (bypasses cache). */
  refresh: () => Promise<void>;
}

const fetchCurrentUser = async (userId: string): Promise<{ profile: Profile | null; isAdmin: boolean }> => {
  // The profile lookup and the admin-role lookup are independent, so they
  // run concurrently — this query gates the app shell on load, and waiting
  // on one round trip instead of two halves that blocking time.
  //
  // The admin-role query always runs (it is not gated behind `pathname ===
  // "/admin"`): the Profile settings list uses `isAdmin` to decide whether to
  // render the "Admin panel" row (it was the Dashboard app bar's Shield button
  // until that bar was removed), and gating it meant the entry point was
  // permanently invisible on every other page, so admins had no way to
  // *reach* /admin in the first place.
  // The profile lookup is essential — if it fails, the caller SHOULD see an
  // error (ProtectedRoute renders the retry card). It throws on error.
  const profilePromise = withTimeout(
    Promise.resolve(supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle()).then(({ data, error }) => {
      if (error) throw error;
      return data ?? null;
    }),
  );

  // The admin-role lookup must NEVER block the profile. It was previously in
  // the same `Promise.all`, so a `user_roles` RLS/permission/timeout failure
  // rejected the whole fetch and blanked the ENTIRE account screen with the
  // "We couldn't load this" card — even though the profile row was fine.
  // Fail-open to non-admin instead: catch its own error and resolve `false`.
  const isAdminPromise = withTimeout(
    Promise.resolve(supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle()).then(({ data, error }) => {
      if (error) throw error;
      return !!data;
    }),
  ).catch(() => false);

  const [profile, isAdmin] = await Promise.all([profilePromise, isAdminPromise]);

  return { profile, isAdmin };
};

/**
 * Refcounted, per-user subscription to the caller's OWN profiles row.
 *
 * Every consumer registers a listener; only the FIRST opens a realtime
 * channel and only the LAST closes it. Keyed by user id so a session switch
 * gets its own channel and the old one is torn down when its last listener
 * leaves.
 */
const ownProfileChannels = new Map<
  string,
  { channel: ReturnType<typeof supabase.channel>; listeners: Set<() => void> }
>();

function subscribeToOwnProfile(userId: string, onChange: () => void): () => void {
  let entry = ownProfileChannels.get(userId);

  if (!entry) {
    const listeners = new Set<() => void>();
    // channelNonce() keeps this in lockstep with the rest of the codebase —
    // a divergent inline impl would drift if the helper later picks up extra
    // guarantees (monotonic suffix, instance counter) we'd want everywhere.
    const channel = supabase
      .channel(`profile-self-${userId}-${channelNonce()}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Copy before iterating: a listener may unsubscribe on invalidation.
          for (const fn of [...listeners]) fn();
        },
      )
      .subscribe();
    entry = { channel, listeners };
    ownProfileChannels.set(userId, entry);
  }

  entry.listeners.add(onChange);

  return () => {
    const current = ownProfileChannels.get(userId);
    if (!current) return;
    current.listeners.delete(onChange);
    if (current.listeners.size === 0) {
      ownProfileChannels.delete(userId);
      supabase.removeChannel(current.channel);
    }
  };
}

export const useCurrentUser = (): CurrentUser => {
  const { user, isReady } = useAuthReady();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.currentUser.byId(user?.id),
    queryFn: () => fetchCurrentUser(user!.id),
    enabled: isReady && !!user,
    // Short staleTime so approval-status changes (made by an admin) get picked
    // up quickly even if realtime is unavailable.
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 2,
  });

  // Realtime: when the current user's profile row is updated (e.g. admin
  // flips approval_status from "pending" → "approved"), invalidate the cache
  // so the UI reflects the new status without a manual reload.
  //
  // ONE channel per user, refcounted — not one per hook consumer. 39 files
  // call useCurrentUser(), and this effect used to live in the hook body, so
  // every mounted instance opened its own websocket channel against the SAME
  // profiles row with the SAME filter. A runtime capture on 2026-08-31 found
  // 13 channels open on /dashboard, 7 of them identical `profile-self-*`
  // subscriptions (9 on /profile). channelNonce() made them all distinct, so
  // the "unique channel name" house rule technically held while the app quietly
  // burned 7-9x its share of Supabase's per-project concurrent-subscription
  // budget on every page load.
  useEffect(() => {
    if (!user?.id) return;
    return subscribeToOwnProfile(user.id, () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.byId(user.id) });
    });
  }, [user?.id, queryClient]);

  const refresh = async () => {
    if (!user?.id) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.byId(user.id) });
  };

  useEffect(() => {
    if (!DEBUG_AUTH) return;
    console.log("[auth] useCurrentUser", {
      isReady,
      hasUser: !!user,
      userId: user?.id ?? null,
      queryLoading: isLoading,
      hasProfile: !!data?.profile,
      route: window.location.pathname,
    });
  }, [data?.profile, isLoading, isReady, user?.id]);

  return {
    user,
    profile: data?.profile ?? null,
    isAdmin: data?.isAdmin ?? false,
    // After all retries fail, `useQuery` reports `isLoading: false` *and*
    // `data: undefined`. We must NOT treat the missing data as "still
    // loading" in that case — doing so leaves callers blocked on a state
    // that will never resolve in this session, and (worse) lets
    // `ProtectedRoute` fall through its `isLoading && !user` guard and
    // render with no profile-based gate. Surface the error to callers
    // explicitly via `isError` and stop reporting `isLoading` once the
    // query has settled.
    isLoading: !isReady || (!!user && !isError && (isLoading || !data)),
    isError: !!user && isError,
    refresh,
  };
};
