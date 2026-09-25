/**
 * A review the server has just CONFIRMED (the insert came back with its row,
 * or 23505 said one already exists) is written into the activity cache at that
 * moment, and the cache is then revalidated.
 *
 * WHY THIS EXISTS (e2e-journeys run 36164148002, 2026-09-25, nightly-red #1719).
 * The poster's Done card draws "Review" vs "Reviewed" from
 * `completedJobMeta`, which lives in the My Posts DETAIL query. That query is
 * persisted to IndexedDB, fresh for 60s, and deliberately NOT revalidated on
 * mount (useActivityData: it re-keys when the core changes). Writing a review
 * changes neither the core nor the detail's key, and `reviews` is not in the
 * realtime publication, so nothing told the cache. Two write paths also never
 * refreshed at all:
 *   - ReviewForm's 5-star + canTip branch opens the tip prompt and returns
 *     before `onClose` (the only place the parent's `onRefresh` ran);
 *   - CompletionPrompts' `onDone` only clears the prompt.
 * So after a 5-star review the card kept offering "Review", a reload inside
 * the 60s window repainted the persisted "Review", and pressing it answered
 * "You've already reviewed this job."
 *
 * Every client write to `reviews` calls this (src/test/reviewWritesUpdateActivityCache.test.ts).
 */
import type { QueryClient } from "@tanstack/react-query";
import { queryClient as sharedQueryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import type { AppliedActivity, PostedActivityDetail } from "@/hooks/useActivityData";

export function recordReviewInActivityCache(jobId: string, qc: QueryClient = sharedQueryClient): void {
  // Poster side: the Done card's Reviewed chip.
  qc.setQueriesData<PostedActivityDetail>({ queryKey: [...queryKeys.activity.all, "postedDetail"] }, (old) => {
    const meta = old?.completedJobMeta?.[jobId];
    if (!old || !meta || meta.reviewed) return old;
    return { ...old, completedJobMeta: { ...old.completedJobMeta, [jobId]: { ...meta, reviewed: true } } };
  });
  // Helper side: My Jobs reads the jobs this user has reviewed from its core.
  qc.setQueriesData<AppliedActivity>({ queryKey: [...queryKeys.activity.all, "applied"] }, (old) => {
    if (!old || !(old.helperReviewedJobIds instanceof Set) || old.helperReviewedJobIds.has(jobId)) return old;
    return { ...old, helperReviewedJobIds: new Set([...old.helperReviewedJobIds, jobId]) };
  });
  // Then read the truth back, so anything else the review moved is refetched.
  void qc.invalidateQueries({ queryKey: queryKeys.activity.all });
}
