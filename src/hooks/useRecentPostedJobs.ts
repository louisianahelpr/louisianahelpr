import { useQuery } from "@tanstack/react-query";
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
export function useRecentPostedJobs(limit = 3): RecentPostedJob[] | null {
  const { user } = useCurrentUser();

  const { data, isPending } = useQuery({
    queryKey: ["recent-posted-jobs", user?.id, limit],
    enabled: !!user?.id,
    // The entry screen is opened repeatedly in one session (post a job, back
    // out, post another). A minute of staleness is invisible here — a job you
    // just posted is not something you are about to repost.
    staleTime: 60_000,
    queryFn: async (): Promise<RecentPostedJob[]> => {
      const rows = unwrap(
        await supabase
          .from("jobs")
          .select("id, title, category, budget, created_at")
          .eq("customer_id", user!.id)
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
    },
  });

  // A signed-out user is not "loading" — they simply have no posted jobs, and
  // the query never runs. Returning null there would leave the caller's
  // skeleton up forever.
  if (!user?.id) return [];
  return isPending ? null : (data ?? []);
}
