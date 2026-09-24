import { useMemo } from "react";
import { useQueries, useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type Job, type EnrichedApplication } from "../../../components/job-card/activityConstants";

/**
 * An applicant's proximity to a job, as a band the server chose. `rank` is
 * 1 (nearest) to 4, for ordering; there is no distance, deliberately.
 */
export interface DistanceBand {
  label: string;
  rank: number;
}

/** Deduplicated helper ids, in application order — the batch query keys. */
export function applicantSignalHelperIds(applications: ReadonlyArray<{ helper_id: string }>): string[] {
  return [...new Set(applications.map((a) => a.helper_id))];
}

/**
 * The query options for every applicant signal, shared by the hook and by
 * `prefetchApplicantSignals` so the two can never disagree on a key (Q239).
 */
function applicantSignalQueries(helperIds: string[], jobId: string | undefined) {
  return {
    // Neighbor hire counts — one RPC call per applicant, keyed by helper_id.
    //
    // The job ID is passed, NOT the job's coordinates. That is a privacy
    // requirement, not a tidiness one: the previous signature took the probe
    // point AND the radius as arguments, so a caller could sweep a grid to
    // locate a helper's past customers, or hold the point still and
    // binary-search the radius until the count changed — recovering the EXACT
    // distance to the nearest one. Both were reproduced before the fix
    // (migration 20260907051731); the second recovered a true 3.219 km in 11
    // calls. The server now reads the point from a job the caller owns and
    // fixes the radius at one mile.
    neighborCount: (helperId: string) => ({
      queryKey: ["neighbor-count", helperId, jobId],
      queryFn: async (): Promise<number> => {
        if (!jobId) return 0;
        try {
          const { data, error } = await supabase.rpc("get_neighbor_hire_count", {
            p_helper_id: helperId,
            p_job_id: jobId,
          });
          if (error) return 0;
          return data ?? 0;
        } catch {
          return 0; // PGRST202 or network error — degrade gracefully
        }
      },
      staleTime: 300_000, // 5 min — neighborhood data is slow-moving
      // The server decides whether the job has usable coordinates, so this no
      // longer gates on them client-side. Counts below 2 come back as 0
      // (k-anonymity — one neighbour beside a known job location identifies a
      // household), so the badge starts at "2 neighbors hired them".
      enabled: !!jobId,
    }),

    // Batch-fetch completed job counts for all applicants in one RPC call.
    // Feeds the completedJobs dimension in scoreApplicant so the
    // "Recommended" sort can rank more experienced helpers higher.
    // Falls back to {} on PGRST202 (migration not yet deployed on prod)
    // or any other error so the panel is never blocked.
    completedCounts: {
      queryKey: ["helper-completed-counts", helperIds],
      queryFn: async (): Promise<Map<string, number>> => {
        if (helperIds.length === 0) return new Map();
        const { data, error } = await supabase.rpc("get_helper_completed_counts", {
          p_user_ids: helperIds,
        });
        if (error) return new Map(); // PGRST202 or any other error — degrade gracefully
        const map = new Map<string, number>();
        if (Array.isArray(data)) {
          for (const row of data) {
            map.set(row.user_id, Number(row.completed_jobs));
          }
        }
        return map;
      },
      staleTime: 5 * 60 * 1000, // 5 min — completed counts are slow-moving
      enabled: helperIds.length > 0,
    },

    // Batch-fetch repeat-hire percents for all applicants in one RPC call.
    // Returns the share of unique customers who hired a helper more than once.
    // Minimum 3 unique customers required before a result is emitted so the
    // stat isn't skewed by very sparse histories.
    // Falls back to an empty Map on PGRST202 or any other error.
    repeatHire: {
      queryKey: ["helper-repeat-hire-percents", helperIds],
      queryFn: async (): Promise<Map<string, number>> => {
        if (helperIds.length === 0) return new Map();
        const { data, error } = await supabase.rpc("get_helper_repeat_hire_percents", {
          p_user_ids: helperIds,
        });
        if (error) return new Map(); // PGRST202 or any other error — degrade gracefully
        const map = new Map<string, number>();
        if (Array.isArray(data)) {
          for (const row of data) {
            map.set(row.user_id, Number(row.repeat_hire_percent));
          }
        }
        return map;
      },
      staleTime: 10 * 60 * 1000, // 10 min — repeat-hire % is slow-moving
      enabled: helperIds.length > 0,
    },

    // Batch-fetch on-time arrival percents for all applicants in one RPC call.
    // Measures how often a helper arrived within 10 min of the scheduled start.
    // Minimum 5 timed jobs required before a result is emitted.
    // Falls back to an empty Map on PGRST202 or any other error.
    onTime: {
      queryKey: ["helper-on-time-percents", helperIds],
      queryFn: async (): Promise<Map<string, number>> => {
        if (helperIds.length === 0) return new Map();
        const { data, error } = await supabase.rpc("get_helper_on_time_percents", {
          p_user_ids: helperIds,
        });
        if (error) return new Map(); // PGRST202 or any other error — degrade gracefully
        const map = new Map<string, number>();
        if (Array.isArray(data)) {
          for (const row of data) {
            map.set(row.user_id, Number(row.on_time_percent));
          }
        }
        return map;
      },
      staleTime: 10 * 60 * 1000, // 10 min — on-time % is slow-moving
      enabled: helperIds.length > 0,
    },

    // Batch-fetch each applicant's proximity to the selected job as a BAND.
    //
    // Never a distance. Exact distances trilaterate: post three jobs at chosen
    // points, ask for the same applicant against each, intersect three circles
    // and you have their home. The ownership gate does not prevent that, because
    // the attacker owns the jobs. Bands are >= 5 miles wide so the intersection
    // stays an area, and the bucketing happens inside the SECURITY DEFINER
    // function — bucketing here would leave the number in the API response and
    // change nothing.
    //
    // Applicants who declined location are simply ABSENT from the result rather
    // than being placed at a shared ZIP centroid, so an absent entry means
    // "unknown", never "far away".
    distanceBands: {
      queryKey: ["helper-distance-bands", jobId, helperIds],
      queryFn: async (): Promise<Map<string, DistanceBand>> => {
        if (helperIds.length === 0 || !jobId) return new Map();
        const { data, error } = await supabase.rpc("get_helper_distances_from_job", {
          p_job_id: jobId,
          p_user_ids: helperIds,
        });
        if (error) return new Map(); // PGRST202 or any other error — degrade gracefully
        const map = new Map<string, DistanceBand>();
        if (Array.isArray(data)) {
          for (const row of data) {
            map.set(row.user_id, { label: String(row.band), rank: Number(row.band_rank) });
          }
        }
        return map;
      },
      staleTime: 5 * 60 * 1000, // 5 min — proximity is stable for a given job
      enabled: helperIds.length > 0 && !!jobId,
    },
  };
}

/**
 * Starts every signal RPC into the React Query cache as soon as the helper ids
 * are known — alongside the profiles read, not after it (Q239). The panel's
 * `useApplicantSignals` then finds them in flight or done under the same keys,
 * instead of opening a fifth round trip after the list has arrived. Never
 * awaited and never throws: every queryFn already degrades to empty.
 */
export function prefetchApplicantSignals(queryClient: QueryClient, helperIds: string[], jobId: string) {
  const opts = applicantSignalQueries(helperIds, jobId);
  void queryClient.prefetchQuery(opts.completedCounts);
  void queryClient.prefetchQuery(opts.repeatHire);
  void queryClient.prefetchQuery(opts.onTime);
  void queryClient.prefetchQuery(opts.distanceBands);
  for (const id of helperIds) void queryClient.prefetchQuery(opts.neighborCount(id));
}

/**
 * Batches the per-applicant trust-signal RPCs (neighbor hire counts,
 * completed-job counts, repeat-hire %, on-time %, distance from job) that
 * feed the applicant comparison panel's scoring. Every query falls back to
 * an empty result on PGRST202 (function not yet deployed) or any other
 * error so the panel is never blocked by a lagging migration.
 */
export function useApplicantSignals(
  applications: EnrichedApplication[],
  selectedJob: Job | null,
) {
  const jobId = selectedJob?.id;
  // Deduplicated helper ids — stable reference so the batch query keys don't
  // churn on every render. MUST be computed exactly as
  // `applicantSignalHelperIds` computes it, or the prefetch below misses.
  const helperIds = useMemo(() => applicantSignalHelperIds(applications), [applications]);
  const opts = applicantSignalQueries(helperIds, jobId);

  const neighborCountQueries = useQueries({
    queries: applications.map((app) => opts.neighborCount(app.helper_id)),
  });

  // Map helper_id → neighbor count for O(1) lookup in scoring + rendering.
  const neighborCountMap = useMemo(() => {
    const map = new Map<string, number>();
    applications.forEach((app, i) => {
      map.set(app.helper_id, neighborCountQueries[i]?.data ?? 0);
    });
    return map;
  }, [applications, neighborCountQueries]);

  const { data: completedCountsData, isPending: completedPending } = useQuery(opts.completedCounts);
  const completedCountsMap: Map<string, number> = completedCountsData ?? new Map();
  const { data: repeatHireData, isPending: repeatHirePending } = useQuery(opts.repeatHire);
  const repeatHireMap: Map<string, number> = repeatHireData ?? new Map();
  const { data: onTimeData, isPending: onTimePending } = useQuery(opts.onTime);
  const onTimeMap: Map<string, number> = onTimeData ?? new Map();
  const { data: distanceData, isPending: distancePending } = useQuery(opts.distanceBands);
  const distanceBandMap: Map<string, DistanceBand> = distanceData ?? new Map();

  // TRUE WHILE ANY RANKING INPUT IS STILL IN FLIGHT. The comparison panel
  // scores and sorts from these maps synchronously, so before this went out
  // the list rendered the instant the applications arrived — with every map
  // empty — and re-sorted as each RPC landed. Measured 2026-09-07 on a
  // two-applicant job: the first paint put the "Helpr Recommended" badge on
  // an unverified helper with no payout account, above an ID-verified helper
  // with 13 completed jobs; ~1s later the two swapped places and the badge
  // moved. A hiring recommendation that changes its mind in front of the
  // reader is worse than a skeleton. Disabled queries (no applicants yet)
  // report pending forever in React Query v5, hence the `enabled` guards.
  const signalsPending =
    (helperIds.length > 0 && (completedPending || repeatHirePending || onTimePending)) ||
    (helperIds.length > 0 && !!jobId && distancePending) ||
    (!!jobId && neighborCountQueries.some((q) => q.isPending));

  return {
    neighborCountMap,
    completedCountsMap,
    repeatHireMap,
    onTimeMap,
    distanceBandMap,
    signalsPending,
  };
}
