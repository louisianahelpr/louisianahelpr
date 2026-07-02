import type { User as SupaUser } from "@supabase/supabase-js";
import type { ActivityData } from "@/hooks/useActivityData";
import type {
  Job,
  Application,
  EnrichedApplication,
  AppliedApp,
} from "@/components/activity/activityConstants";

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
export interface OptimisticJobCache {
  optimisticallyPatchJob: (jobId: string, patch: Partial<Job>) => ActivityData | undefined;
  rollbackActivity: (snapshot: ActivityData | undefined) => void;
}

export type { Job, Application, EnrichedApplication, AppliedApp };
