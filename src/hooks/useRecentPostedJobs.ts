import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * The shape of a recently-posted job used by the entry-choice
 * "Repost" tiles. A minimal slice of the jobs row so the query
 * stays cheap and the prop surface tiny.
 */
export interface RecentPostedJob {
  id: string;
  title: string;
  category: string;
  budget: number;
  created_at: string;
}

const DEFAULT_LIMIT = 3;

/** One key family, so the hook and the nav's prefetch cannot disagree. */
export const recentPostedJobsKey = (userId: string | undefined, limit: number) =>
  ["recent-posted-jobs", userId, limit] as const;

/** A minute of staleness is invisible here — a job you just posted is not
 *  something you are about to repost. Shared with the prefetch so a warmed
 *  entry is actually reused rather than immediately refetched on mount. */
const RECENT_POSTED_STALE_MS = 60_000;

/** Hoisted to module scope so it can be called WITHOUT mounting the PostJob
 *  chunk — see `prefetchRecentPostedJobs`. */
async function fetchRecentPostedJobs(
  userId: string,
  limit: number,
): Promise<RecentPostedJob[]> {
  const rows = unwrap(
    await supabase
      .from("jobs")
      .select("id, title, category, budget, created_at")
      .eq("customer_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    category: String(r.category ?? "other"),
    budget: Number(r.budget ?? 0),
    created_at: String(r.created_at ?? ""),
  }));
}

/**
 * Warm the "Repost a recent job" data while the user is still on whatever
 * screen they are on, so the row is already in cache when PostJob mounts.
 *
 * WHY THIS EXISTS (measured, 375px, production build, mocked backend at
 * 200ms/request). Tapping the nav's "+" from the dashboard, the request could
 * not be ISSUED until the lazily-imported PostJob chunk had loaded and
 * mounted: static tiles painted at 129ms, the request left at 109ms after
 * chunk-load, and the Repost row landed at 422ms — 293ms after the tiles
 * either side of it. The query itself was never the problem; nothing could
 * start it earlier because nothing that runs earlier knew about it.
 *
 * The chunk itself was the other half: `/post-job` is reached from the FAB,
 * which is NOT in `leftItems`/`rightItems`, so it was the one authed
 * destination `prefetchRoutesWhenIdle` never warmed.
 *
 * Cheap and idle-scheduled by the caller: one indexed
 * (`idx_jobs_customer_status_created`) LIMIT-3 read per session, deduped by
 * React Query against the hook's own key, and skipped entirely when a fresh
 * entry is already cached.
 */
export function prefetchRecentPostedJobs(
  queryClient: QueryClient,
  userId: string | undefined,
  limit = DEFAULT_LIMIT,
): void {
  if (!userId) return;
  void queryClient.prefetchQuery({
    queryKey: recentPostedJobsKey(userId, limit),
    staleTime: RECENT_POSTED_STALE_MS,
    queryFn: () => fetchRecentPostedJobs(userId, limit),
  });
}

/**
 * Fetches the current user's last N posted jobs for the "Repost a recent job"
 * tiles on the entry-choice step. Returns `null` while loading and an empty
 * array when the user has never posted, so the caller can skip the row.
 *
 * WHY THIS IS A QUERY AND NOT A useEffect
 *
 * It used to be `useState` + `useEffect`, and "Repost a recent job" was
 * visibly slower to appear than the tiles either side of it. Two reasons,
 * both structural rather than a slow query:
 *
 *   1. It opened with `await supabase.auth.getUser()`, which is a NETWORK
 *      round-trip to /auth/v1/user — so the jobs query could not even start
 *      until a second request had come back. The user is already resolved and
 *      cached by `useCurrentUser`, so that first trip bought nothing.
 *   2. Nothing was cached. Every mount of the entry screen paid both
 *      round-trips again, so the row was late every single time rather than
 *      only on a cold start.
 *
 * The database was never the problem — `idx_jobs_customer_status_created`
 * covers this exact access path (customer_id, then created_at DESC).
 *
 * Failures no longer degrade silently: `unwrap()` throws so the query enters
 * `isError` rather than the caller being handed `[]` and rendering "you have
 * never posted a job" at someone who has. CLAUDE.md: never drop the Supabase
 * `error`.
 */
export function useRecentPostedJobs(limit = DEFAULT_LIMIT): RecentPostedJob[] | null {
  const { user } = useCurrentUser();

  const { data, isPending } = useQuery({
    // Same key + staleTime the nav's idle prefetch uses, so a warmed entry is
    // served straight from cache instead of being refetched on mount.
    queryKey: recentPostedJobsKey(user?.id, limit),
    enabled: !!user?.id,
    staleTime: RECENT_POSTED_STALE_MS,
    queryFn: () => fetchRecentPostedJobs(user!.id, limit),
  });

  // A signed-out user is not "loading" — they simply have no posted jobs, and
  // the query never runs. Returning null there would leave the caller's
  // skeleton up forever.
  if (!user?.id) return [];
  return isPending ? null : (data ?? []);
}
