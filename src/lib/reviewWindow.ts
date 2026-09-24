/**
 * DH-003: the reviews INSERT policy ("Users can create reviews for eligible
 * jobs") refuses a review once the job finished more than 30 days ago, or
 * while a dispute is open and unresolved. The Review chip mirrors it, so it is
 * never offered for a review the server will reject.
 */
export const REVIEW_WINDOW_DAYS = 30;

type ReviewWindowJob = {
  poster_completed_at?: string | null;
  helper_completed_at?: string | null;
  updated_at?: string | null;
  has_active_dispute?: boolean | null;
  dispute_resolved_at?: string | null;
};

export function reviewWindowOpen(job: ReviewWindowJob, now: number = Date.now()): boolean {
  if (job.has_active_dispute && !job.dispute_resolved_at) return false;
  // Same COALESCE order as the policy.
  const finishedAt = job.poster_completed_at ?? job.helper_completed_at ?? job.updated_at;
  if (!finishedAt) return false;
  return new Date(finishedAt).getTime() > now - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
