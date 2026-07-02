import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Job, type EnrichedApplication } from "../activityConstants";
import { callUntypedRpc, type ApplicantBidFields } from "./postedJobsHelpers";

export type JobAnalytics = {
  viewCount: number;
  applicantCount: number;
  conversionRate: number | null;
  bidMin: number | null;
  bidMax: number | null;
  bidAvg: number | null;
};

/**
 * Batch-fetches per-job view counts and derives the analytics mini-panel
 * data shown on each PostedJobCard (views, applicants, conversion, bid
 * range). Falls back to {} on PGRST202 so the feed still renders.
 */
export function useJobAnalytics(
  jobs: Job[],
  applicantCounts: Record<string, number>,
  inlineApplicants: Record<string, EnrichedApplication[]>,
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
  // Uses the already-fetched viewCounts + applicantCounts + inlineApplicants
  // (for bid prices on accept_bids jobs). No extra queries needed.
  const jobAnalyticsMap = useMemo(() => {
    const map: Record<string, JobAnalytics> = {};
    for (const job of jobs) {
      const views = viewCounts[job.id] ?? 0;
      const appCount = applicantCounts[job.id] ?? 0;
      const conversionRate = views > 0 ? Math.round((appCount / views) * 100) : null;

      // Bid prices — derive from inline applicants if loaded; otherwise null
      const apps = inlineApplicants[job.id] ?? [];
      const bids = apps
        .map((a) => (a as EnrichedApplication & ApplicantBidFields).proposed_price)
        .filter((p): p is number => typeof p === "number" && p > 0);

      map[job.id] = {
        viewCount: views,
        applicantCount: appCount,
        conversionRate,
        bidMin: bids.length > 0 ? Math.min(...bids) : null,
        bidMax: bids.length > 0 ? Math.max(...bids) : null,
        bidAvg: bids.length > 0 ? bids.reduce((a, b) => a + b, 0) / bids.length : null,
      };
    }
    return map;
  }, [jobs, viewCounts, applicantCounts, inlineApplicants]);

  return { viewCounts, jobAnalyticsMap };
}
