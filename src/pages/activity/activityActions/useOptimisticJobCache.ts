import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { queryKeys } from "@/lib/queryKeys";
import type { ActivityData } from "@/hooks/useActivityData";
import type { Job } from "@/components/activity/activityConstants";
import type { OptimisticJobCache } from "./types";

/**
 * Optimistic cache helpers extracted verbatim from useActivityActions.
 *
 * Money-path handlers patch the cached ActivityData *before* the Supabase
 * write lands so the card moves to its new state instantly. The helper
 * patches every place a job appears in the cache (the poster's `postedJobs`
 * row and any `appliedApps[].job` that references it), returns a snapshot for
 * rollback, and skips entirely if the cache is empty (the write still runs —
 * it just isn't optimistic). On error the caller restores the snapshot; on
 * success refresh()/realtime reconciles authoritative state.
 */
export function useOptimisticJobCache(user: SupaUser | null): OptimisticJobCache {
  const queryClient = useQueryClient();

  // --- Optimistic cache helper ---
  const optimisticallyPatchJob = useCallback(
    (jobId: string, patch: Partial<Job>): ActivityData | undefined => {
      if (!user) return undefined;
      const key = queryKeys.activity.byUser(user.id);
      const snapshot = queryClient.getQueryData<ActivityData>(key);
      if (!snapshot) return undefined;
      queryClient.setQueryData<ActivityData>(key, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          postedJobs: prev.postedJobs.map((j) =>
            j.id === jobId ? { ...j, ...patch } : j,
          ),
          appliedApps: prev.appliedApps.map((a) =>
            a.job_id === jobId && a.job
              ? { ...a, job: { ...a.job, ...patch } }
              : a,
          ),
        };
      });
      return snapshot;
    },
    [user, queryClient],
  );

  // Restore a snapshot taken before an optimistic patch (rollback on error).
  const rollbackActivity = useCallback(
    (snapshot: ActivityData | undefined) => {
      if (!user || !snapshot) return;
      queryClient.setQueryData<ActivityData>(queryKeys.activity.byUser(user.id), snapshot);
    },
    [user, queryClient],
  );

  return { optimisticallyPatchJob, rollbackActivity };
}
