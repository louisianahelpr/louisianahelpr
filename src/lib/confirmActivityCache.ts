/**
 * A confirm the server has just CONFIRMED ("the job is still on" for the poster,
 * "I'll be there" for the Helpr) is written into every cached copy of that job
 * at once, and the caches are then revalidated.
 *
 * WHY THIS EXISTS (owner, 2026-10-31, LEAD-NEEDSYOU-MISSING). The owner's "Mow and
 * Weed Eat" job (7b1da54b, prod read 2026-10-31 15:39Z: poster_confirmed_at
 * 15:31:41Z, helper_dayof_confirmed_at null) showed "Confirm the job is still on"
 * in Home's Next up while Jobs > Posted filed it under Waiting with Needs you
 * empty. Both screens use one rule (postedActivityBucket via deriveNeedsYouTodos);
 * fed the same row they agree (homeAgreesWithNeedsYou.test.ts). They disagreed
 * because they held DIFFERENT copies of the row: JobConfirmation wrote the stamp
 * and told no cache, so Home's to-do kept the pre-confirm copy (persisted to
 * IndexedDB, fresh for 60 s) while the Posted list had refetched.
 *
 * Every client confirm write calls this (confirmWritesUpdateActivityCache.test.ts).
 */
import type { QueryClient } from "@tanstack/react-query";
import { queryClient as sharedQueryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import type { AppliedActivity, PostedActivity } from "@/hooks/useActivityData";

export type ConfirmField = "poster_confirmed_at" | "helper_dayof_confirmed_at";

export function recordConfirmInActivityCache(
  jobId: string,
  field: ConfirmField,
  at: string,
  qc: QueryClient = sharedQueryClient,
): void {
  // Poster side: Home's to-do, the nav badge and Jobs > Posted all read this core.
  qc.setQueriesData<PostedActivity>({ queryKey: [...queryKeys.activity.all, "posted"] }, (old) => {
    if (!old?.postedJobs?.some((j) => j.id === jobId)) return old;
    return { ...old, postedJobs: old.postedJobs.map((j) => (j.id === jobId ? { ...j, [field]: at } : j)) };
  });
  // Helpr side: Home's to-do and Jobs > Working read this core.
  qc.setQueriesData<AppliedActivity>({ queryKey: [...queryKeys.activity.all, "applied"] }, (old) => {
    if (!old?.appliedApps?.some((a) => a.job?.id === jobId)) return old;
    return {
      ...old,
      appliedApps: old.appliedApps.map((a) => (a.job?.id === jobId ? { ...a, job: { ...a.job, [field]: at } } : a)),
    };
  });
  // Then read the truth back: the activity cores and the job page's own reads.
  void qc.invalidateQueries({ queryKey: queryKeys.activity.all });
  void qc.invalidateQueries({ queryKey: [...queryKeys.jobs.all, "page"] });
}
