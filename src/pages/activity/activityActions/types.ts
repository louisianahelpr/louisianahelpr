import type { User as SupaUser } from "@supabase/supabase-js";
import type { PostedActivity, AppliedActivity } from "@/hooks/useActivityData";
import type { Job, AppliedApp } from "@/components/activity/activityConstants";

/**
 * useActivityActions — data-loading + all action handlers for the Activity
 * page (accept / decline / complete / no-show / start / arrival / etc.),
 * plus the dialog and per-action UI state those handlers own.
 *
 * Handlers call `setStatusFilter` to jump the filter after a state
 * transition, and `refresh` (from useActivityData) to reconcile the cache.
 */
export interface UseActivityActionsArgs {
  user: SupaUser | null;
  postedJobs: Job[];
  appliedApps: AppliedApp[];
  refresh: () => void | Promise<unknown>;
  setStatusFilter: (filter: string) => void;
  helperNames?: Record<string, string>;
  completedJobMeta?: Record<string, { tipped: boolean; reviewed: boolean }>;
}

/**
 * Optimistic cache helpers shared by every money-path handler. Kept as a
 * discrete shape so the handler builders can be typed without re-deriving it.
 */
export interface ActivitySnapshot {
  posted: PostedActivity | undefined;
  applied: AppliedActivity | undefined;
}

export interface OptimisticJobCache {
  optimisticallyPatchJob: (jobId: string, patch: Partial<Job>) => ActivitySnapshot | undefined;
  rollbackActivity: (snapshot: ActivitySnapshot | undefined) => void;
}
