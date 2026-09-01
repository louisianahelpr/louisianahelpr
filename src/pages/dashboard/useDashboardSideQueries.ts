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
  /** Signed-in user's email — matches gifts named to them but not yet claimed. */
  userEmail: string | undefined;
  allJobs: EnrichedJob[];
};

/** Statuses a gift can be spent from — the gate in `redeem_pif_credit`. */
const CLAIMABLE_GIFT_STATUSES = new Set(["sent", "available"]);

// Secondary dashboard data — the assorted read-only queries and the
// saved/dismissed job-id state that hang off the dashboard but aren't part of
// the primary feed pipeline (useDashboardData) or the apply flow.
export function useDashboardSideQueries({ userId, userEmail, allJobs }: UseDashboardSideQueriesArgs) {
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());

  /**
   * Gift cards this user can actually spend, for the dashboard teaser.
   *
   * This used to count `status='available' AND parish=<user's parish>` —
   * a counter that could not be non-zero. `parish` is NULL on every directed
   * gift (the column belongs to the world-readable "parish pool" model that
   * migration 20260705190000 replaced), and migration 20260831233515 then
   * normalised every paid, directed 'available' row to 'sent'. Both halves of
   * the predicate now select nothing, so the banner read 0 forever and a
   * recipient holding a real $75 gift was told nothing on the screen they
   * open first.
   *
   * A counter that structurally cannot be non-zero is a defect class here,
   * not a cosmetic one — it renders an outage as an all-clear. So this now
   * counts the thing that exists: gifts addressed to THIS user (by resolved
   * id, or by the email they were sent to before claiming), funded, unspent,
   * and unexpired — the same conditions `redeem_pif_credit` will check when
   * they go to use one.
   *
   * The status/expiry filtering happens in JS rather than as a second
   * PostgREST `.or()`: gift rows per user are a handful, and stacking two
   * `or=` params to express "(mine) AND (unexpired)" is exactly the kind of
   * grammar that fails quietly and takes the count to zero again.
   */
  const { data: pifCount = 0 } = useQuery({
    queryKey: ["pif-count", userId, userEmail],
    queryFn: async () => {
      if (!userId) return 0;
      try {
        // Quote the email so a reserved char in the local part can't break
        // the .or() grammar — same guard PayItForward's received-gifts query
        // uses. RLS constrains the rows regardless.
        const orClause = userEmail
          ? `recipient_id.eq.${userId},recipient_email.eq."${userEmail.replace(/(["\\])/g, "\\$1")}"`
          : `recipient_id.eq.${userId}`;
        const { data, error } = await supabase
          .from("pif_credits" as never)
          .select("id, status, payment_status, expires_at")
          .or(orClause);
        if (error && (error as { code?: string }).code === "PGRST202") return 0;
        // 0 stays the safe default, but the failure has to be observable —
        // a dropped error made a broken count look like "no credits here".
        if (error) {
          report(error, { severity: "warning", tags: { source: "useDashboardSideQueries.pifCount" } });
          return 0;
        }
        const rows = (data ?? []) as Array<{
          status: string;
          payment_status: string | null;
          expires_at: string | null;
        }>;
        const now = Date.now();
        return rows.filter(
          (r) =>
            r.payment_status === "paid" &&
            CLAIMABLE_GIFT_STATUSES.has(r.status) &&
            (!r.expires_at || new Date(r.expires_at).getTime() > now),
        ).length;
      } catch { return 0; }
    },
    enabled: !!userId,
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
