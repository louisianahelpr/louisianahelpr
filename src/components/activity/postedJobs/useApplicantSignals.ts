import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type Job, type EnrichedApplication } from "../activityConstants";
import { callUntypedRpc } from "./postedJobsHelpers";

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
  // Neighbor hire counts — one RPC call per applicant, keyed by helper_id.
  // Runs only when the selected job has coordinates (many jobs have
  // approximate coords from geocoding at post time). Falls back to 0
  // on PGRST202 (function not yet deployed) or any other error so the
  // panel is never blocked by the trust-graph migration.
  const neighborCountQueries = useQueries({
    queries: applications.map((app) => ({
      queryKey: ["neighbor-count", app.helper_id, selectedJob?.latitude, selectedJob?.longitude],
      queryFn: async (): Promise<number> => {
        if (!selectedJob?.latitude || !selectedJob?.longitude) return 0;
        try {
          const { data, error } = await supabase.rpc("get_neighbor_hire_count", {
            p_helper_id: app.helper_id,
            p_lat: selectedJob.latitude,
            p_lng: selectedJob.longitude,
          });
          if (error) return 0;
          return (data as number) ?? 0;
        } catch {
          return 0; // PGRST202 or network error — degrade gracefully
        }
      },
      staleTime: 300_000, // 5 min — neighborhood data is slow-moving
      enabled: !!selectedJob?.latitude && !!selectedJob?.longitude,
    })),
  });

  // Map helper_id → neighbor count for O(1) lookup in scoring + rendering.
  const neighborCountMap = useMemo(() => {
    const map = new Map<string, number>();
    applications.forEach((app, i) => {
      map.set(app.helper_id, neighborCountQueries[i]?.data ?? 0);
    });
    return map;
  }, [applications, neighborCountQueries]);

  // Deduplicated helper ids — stable reference so the completed-counts
  // query key doesn't churn on every render.
  const helperIds = useMemo(
    () => [...new Set(applications.map((a) => a.helper_id))],
    [applications],
  );

  // Batch-fetch completed job counts for all applicants in one RPC call.
  // Feeds the completedJobs dimension in scoreApplicant so the
  // "Recommended" sort can rank more experienced helpers higher.
  // Falls back to {} on PGRST202 (migration not yet deployed on prod)
  // or any other error so the panel is never blocked.
  const { data: completedCountsData } = useQuery({
    queryKey: ["helper-completed-counts", helperIds],
    queryFn: async (): Promise<Map<string, number>> => {
      if (helperIds.length === 0) return new Map();
      const { data, error } = await callUntypedRpc<
        { p_user_ids: string[] },
        Array<{ user_id: string; completed_jobs: number }>
      >("get_helper_completed_counts", {
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
    enabled: applications.length > 0,
  });
  const completedCountsMap: Map<string, number> = completedCountsData ?? new Map();

  // Batch-fetch repeat-hire percents for all applicants in one RPC call.
  // Returns the share of unique customers who hired a helper more than once.
  // Minimum 3 unique customers required before a result is emitted so the
  // stat isn't skewed by very sparse histories.
  // Falls back to an empty Map on PGRST202 or any other error.
  const { data: repeatHireData } = useQuery({
    queryKey: ["helper-repeat-hire-percents", helperIds],
    queryFn: async (): Promise<Map<string, number>> => {
      if (helperIds.length === 0) return new Map();
      const { data, error } = await callUntypedRpc<
        { p_user_ids: string[] },
        Array<{ user_id: string; repeat_hire_percent: number }>
      >("get_helper_repeat_hire_percents", {
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
    enabled: applications.length > 0,
  });
  const repeatHireMap: Map<string, number> = repeatHireData ?? new Map();

  // Batch-fetch on-time arrival percents for all applicants in one RPC call.
  // Measures how often a helper arrived within 10 min of the scheduled start.
  // Minimum 5 timed jobs required before a result is emitted.
  // Falls back to an empty Map on PGRST202 or any other error.
  const { data: onTimeData } = useQuery({
    queryKey: ["helper-on-time-percents", helperIds],
    queryFn: async (): Promise<Map<string, number>> => {
      if (helperIds.length === 0) return new Map();
      const { data, error } = await callUntypedRpc<
        { p_user_ids: string[] },
        Array<{ user_id: string; on_time_percent: number }>
      >("get_helper_on_time_percents", {
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
    enabled: applications.length > 0,
  });
  const onTimeMap: Map<string, number> = onTimeData ?? new Map();

  // Batch-fetch distances (km) from the selected job to each applicant.
  // Requires profiles.latitude/longitude (trust-graph migration) and
  // jobs.latitude/longitude (set at post time via geocoding).
  // Falls back to an empty Map on PGRST202 or any other error.
  // Only enabled when a job is selected and has coordinates.
  const { data: distanceData } = useQuery({
    queryKey: ["helper-distances-from-job", selectedJob?.id, helperIds],
    queryFn: async (): Promise<Map<string, number>> => {
      if (helperIds.length === 0 || !selectedJob?.id) return new Map();
      const { data, error } = await callUntypedRpc<
        { p_job_id: string; p_user_ids: string[] },
        Array<{ user_id: string; distance_km: number }>
      >("get_helper_distances_from_job", {
        p_job_id: selectedJob.id,
        p_user_ids: helperIds,
      });
      if (error) return new Map(); // PGRST202 or any other error — degrade gracefully
      const map = new Map<string, number>();
      if (Array.isArray(data)) {
        for (const row of data) {
          map.set(row.user_id, Number(row.distance_km));
        }
      }
      return map;
    },
    staleTime: 5 * 60 * 1000, // 5 min — distance is stable for a given job
    enabled: helperIds.length > 0 && !!selectedJob?.id && selectedJob.latitude != null,
  });
  const distanceMap: Map<string, number> = distanceData ?? new Map();

  return {
    neighborCountMap,
    completedCountsMap,
    repeatHireMap,
    onTimeMap,
    distanceMap,
  };
}
