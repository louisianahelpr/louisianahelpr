import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { queryKeys } from "@/lib/queryKeys";
import { safeStorage } from "@/lib/safeStorage";
import type { EnrichedJob } from "@/components/dashboard/types";

type UseDashboardSideQueriesArgs = {
  userId: string | undefined;
  userParish: string | null;
  allJobs: EnrichedJob[];
};

// Secondary dashboard data — the assorted read-only queries and the
// saved/dismissed job-id state that hang off the dashboard but aren't part of
// the primary feed pipeline (useDashboardData) or the apply flow.
export function useDashboardSideQueries({ userId, userParish, allJobs }: UseDashboardSideQueriesArgs) {
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());

  // Pay It Forward — count of available credits in the user's parish.
  // Shown as a teaser banner above the community teaser when > 0.
  // PGRST202-safe: table may not be on prod yet between merge + db push.
  const { data: pifCount = 0 } = useQuery({
    queryKey: ["pif-count", userParish],
    queryFn: async () => {
      if (!userParish) return 0;
      try {
        const { count, error } = await supabase
          .from("pif_credits" as never)
          .select("id", { count: "exact", head: true })
          .eq("status", "available")
          .eq("parish", userParish);
        if (error && (error as { code?: string }).code === "PGRST202") return 0;
        // 0 stays the safe default, but the failure has to be observable —
        // a dropped error made a broken count look like "no credits here".
        if (error) {
          report(error, { severity: "warning", tags: { source: "useDashboardSideQueries.pifCount" } });
          return 0;
        }
        return count ?? 0;
      } catch { return 0; }
    },
    enabled: !!userParish,
    staleTime: 5 * 60 * 1000,
  });

  // Inactive subscriber nudge — if a paid helper hasn't applied to
  // anything in 7+ days, surface a gentle "your sub is paying for
  // itself when you apply" banner. Caps the cost-justification at the
  // moment the user is checking the feed.
  //
  // Only paid, non-expired subscribers should trigger the lookup — that
  // gate becomes the query's `enabled` flag so free/expired users never
  // pay for the `applications` fetch.
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(() => {
    try {
      const stored = safeStorage.getItem("helpr_dismissed_jobs");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  // Prune stale dismissed IDs that no longer correspond to any live job.
  // Stops the "I dismissed this 6 months ago and now it's silently hiding
  // a new feed" failure mode AND keeps localStorage from growing forever.
  // Runs once `allJobs` is populated.
  useEffect(() => {
    if (allJobs.length === 0 || dismissedJobIds.size === 0) return;
    const liveIds = new Set(allJobs.map((j) => j.id));
    const pruned = new Set<string>();
    let didPrune = false;
    for (const id of dismissedJobIds) {
      if (liveIds.has(id)) {
        pruned.add(id);
      } else {
        didPrune = true;
      }
    }
    if (didPrune) {
      setDismissedJobIds(pruned);
      safeStorage.setItem("helpr_dismissed_jobs", JSON.stringify([...pruned]));
    }

  }, [allJobs.length]);

  // Load saved job IDs — cached via React Query so the lookup isn't
  // re-run on every Dashboard mount. The result seeds the local
  // `savedJobIds` state (below), which handleToggleSave mutates
  // optimistically as the user saves/unsaves jobs.
  const { data: savedJobsData } = useQuery({
    queryKey: queryKeys.dashboard.savedJobs(userId),
    queryFn: async () => {
      const data = unwrap(await supabase
        .from("saved_jobs")
        .select("job_id")
        .eq("user_id", userId!));
      return (data ?? []).map((d: { job_id: string }) => d.job_id);
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
  useEffect(() => {
    if (savedJobsData) setSavedJobIds(new Set(savedJobsData));
  }, [savedJobsData]);

  // Upcoming booked job — nearest accepted or in-progress job where the
  // current user is the helper. Surfaced as a reminder card on the dashboard
  // so helpers don't forget their active commitments.
  const { data: upcomingJob = null } = useQuery({
    queryKey: ["helper_upcoming_job", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, date_needed, start_time, status")
        .eq("helper_id", userId!)
        .in("status", ["accepted", "in_progress"])
        .order("date_needed", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) {
        // Null (no reminder card) is the safe degrade, but warn-report it —
        // silently dropping the error hid a broken query behind "no
        // upcoming jobs".
        report(error, { severity: "warning", tags: { source: "useDashboardSideQueries.upcomingJob" } });
        return null;
      }
      return data;
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });

  return {
    pifCount,
    upcomingJob,
    savedJobIds,
    setSavedJobIds,
    dismissedJobIds,
    setDismissedJobIds,
  };
}
