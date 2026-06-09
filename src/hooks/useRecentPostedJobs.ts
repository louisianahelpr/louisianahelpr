import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
 * Fetches the current user's last N posted jobs for the
 * "Repost a recent task" quick-start tiles on the entry-choice
 * step. Returns `null` while loading and an empty array when the
 * user has never posted (so the caller can skip rendering the row).
 *
 * The query is one round-trip, scoped to the auth user, and limited
 * to a few fields so it's cheap enough to run on every entry-screen
 * mount. Failures degrade silently to an empty array — the entry
 * screen still works, it just doesn't show the row.
 */
export function useRecentPostedJobs(limit = 3): RecentPostedJob[] | null {
  const [jobs, setJobs] = useState<RecentPostedJob[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setJobs([]);
          return;
        }
        const { data, error } = await supabase
          .from("jobs")
          .select("id, title, category, budget, created_at")
          .eq("customer_id", user.id)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (cancelled) return;
        if (error || !data) {
          setJobs([]);
          return;
        }
        setJobs(
          data.map((r: any) => ({
            id: String(r.id),
            title: String(r.title ?? ""),
            category: String(r.category ?? "other"),
            budget: Number(r.budget ?? 0),
            created_at: String(r.created_at ?? ""),
          })),
        );
      } catch {
        if (!cancelled) setJobs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return jobs;
}
