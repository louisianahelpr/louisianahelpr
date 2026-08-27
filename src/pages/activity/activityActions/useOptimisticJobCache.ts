import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { queryKeys } from "@/lib/queryKeys";
import type { PostedActivity, AppliedActivity } from "@/hooks/useActivityData";
import type { Job } from "@/components/activity/activityConstants";
import type { ActivitySnapshot, OptimisticJobCache } from "./types";

/**
 * Optimistic cache helpers for the Activity page.
 *
 * Money-path handlers patch the cached activity data *before* the Supabase
 * write lands so the card moves to its new state instantly. The helper patches
 * every place a job appears in the cache — the poster's `postedJobs` row in the
 * "posted" core AND any `appliedApps[].job` referencing it in the "applied"
 * core — returns a snapshot of both for rollback, and skips a cache that isn't
 * there (the write still runs, it just isn't optimistic). On error the caller
 * restores the snapshot; on success refresh()/realtime reconciles the truth.
 *
 * Both cores are patched even though only one tab is on screen: the other tab's
 * core is warmed on idle, and a stale job row there would be shown the moment
 * the user switched.
 */
export function useOptimisticJobCache(user: SupaUser | null): OptimisticJobCache {
  const queryClient = useQueryClient();

  const optimisticallyPatchJob = useCallback(
    (jobId: string, patch: Partial<Job>): ActivitySnapshot | undefined => {
      if (!user) return undefined;
      const postedKey = queryKeys.activity.posted(user.id);
      const appliedKey = queryKeys.activity.applied(user.id);
      const posted = queryClient.getQueryData<PostedActivity>(postedKey);
      const applied = queryClient.getQueryData<AppliedActivity>(appliedKey);
      if (!posted && !applied) return undefined;

      if (posted) {
        queryClient.setQueryData<PostedActivity>(postedKey, (prev) =>
          prev
            ? { ...prev, postedJobs: prev.postedJobs.map((j) => (j.id === jobId ? { ...j, ...patch } : j)) }
            : prev,
        );
      }
      if (applied) {
        queryClient.setQueryData<AppliedActivity>(appliedKey, (prev) =>
          prev
            ? {
                ...prev,
                appliedApps: prev.appliedApps.map((a) =>
                  a.job_id === jobId && a.job ? { ...a, job: { ...a.job, ...patch } } : a,
                ),
              }
            : prev,
        );
      }
      return { posted, applied };
    },
    [user, queryClient],
  );

  // Restore a snapshot taken before an optimistic patch (rollback on error).
  const rollbackActivity = useCallback(
    (snapshot: ActivitySnapshot | undefined) => {
      if (!user || !snapshot) return;
      if (snapshot.posted) {
        queryClient.setQueryData<PostedActivity>(queryKeys.activity.posted(user.id), snapshot.posted);
      }
      if (snapshot.applied) {
        queryClient.setQueryData<AppliedActivity>(queryKeys.activity.applied(user.id), snapshot.applied);
      }
    },
    [user, queryClient],
  );

  return { optimisticallyPatchJob, rollbackActivity };
}
