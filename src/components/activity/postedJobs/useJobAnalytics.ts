import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Job, type EnrichedApplication } from "../activityConstants";
import { callUntypedRpc } from "./postedJobsHelpers";

export type JobAnalytics = {
  viewCount: number;
  applicantCount: number;
  conversionRate: number | null;
};

/**
 * Batch-fetches per-job view counts and derives the analytics mini-panel
 * data shown on each PostedJobCard (views, applicants, conversion).
 * Falls back to {} on PGRST202 so the feed still renders.
 *
 * `_inlineApplicants` is vestigial: it existed only to derive the bid
 * min/max/avg for accept_bids jobs, and bidding is gone (zero production
 * usage). Kept as a parameter so the caller's arity still matches until
 * PostedJobsTab drops the argument.
 */
export function useJobAnalytics(
  jobs: Job[],
  applicantCounts: Record<string, number>,
  _inlineApplicants?: Record<string, EnrichedApplication[]>,
) {
  // Batch-fetch view counts for all posted jobs so each PostedJobCard
  // can show "Seen by X helprs" without N+1 queries. Falls back to {}
  // on PGRST202 (function not yet deployed to production).
  const jobIds = useMemo(() => jobs.map((j) => j.id), [jobs]);
  const { data: viewCountsData } = useQuery({
    queryKey: ["job-view-counts", jobIds],
    queryFn: async (): Promise<Record<string, number>> => {
      if (jobIds.length === 0) return {};
      const { data, error } = await callUntypedRpc<
        { p_job_ids: string[] },
        Array<{ job_id: string; view_count: number }>
      >("get_job_view_counts", {
        p_job_ids: jobIds,
      });
      if (error) {
        // PGRST202 = function not yet deployed to production — degrade gracefully
        if (error.code === "PGRST202") return {};
        // Other errors: swallow so the feed still renders
        return {};
      }
      const result: Record<string, number> = {};
      if (Array.isArray(data)) {
        for (const row of data) {
          result[row.job_id] = Number(row.view_count);
        }
      }
      return result;
    },
    staleTime: 60_000, // 1 min — view counts are informational, not real-time
    enabled: jobIds.length > 0,
  });
  const viewCounts: Record<string, number> = viewCountsData ?? {};

  // Build per-job analytics for the PostedJobCard mini-panel.
  // Uses the already-fetched viewCounts + applicantCounts. No extra
  // queries needed.
  const jobAnalyticsMap = useMemo(() => {
    const map: Record<string, JobAnalytics> = {};
    for (const job of jobs) {
      const views = viewCounts[job.id] ?? 0;
      const appCount = applicantCounts[job.id] ?? 0;
      // Views and applications come from two unrelated sources — the
      // `get_job_view_counts` RPC (which degrades to 0 for every job on any
      // error) and the applications table — so `appCount` can legitimately
      // exceed `views`: a helper reached the job from a notification or a
      // shared link that recorded no view, or the RPC failed. Unclamped, the
      // header rendered "200% applied" off 2 applicants and 1 view. A share
      // of a whole cannot exceed the whole, and a number that obviously
      // cannot be true discredits the ones beside it, so cap the RATE at 100
      // and suppress it entirely where it would be a lie rather than a
      // rounding: if there are more applicants than recorded views the
      // denominator is wrong, and "100%" would be an invention too.
      const conversionRate =
        views > 0 && appCount <= views ? Math.round((appCount / views) * 100) : null;

      map[job.id] = {
        viewCount: views,
        applicantCount: appCount,
        conversionRate,
      };
    }
    return map;
  }, [jobs, viewCounts, applicantCounts]);

  return { viewCounts, jobAnalyticsMap };
}
