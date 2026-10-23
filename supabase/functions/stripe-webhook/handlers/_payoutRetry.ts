// Zero imports on purpose: the unit test imports it directly (tsconfig.app.json).
/**
 * Whether process-scheduled-payouts will pick a job reset to payout_pending
 * back up: its query also needs status 'completed', and a disputed job only
 * when it is a crew whose dispute closed (resolved / auto_resolved). A single
 * Helpr's job with any dispute is paid by release-payout, not the cron, so its
 * Helpr is never promised "we'll try again" (lh-money-escrow review, must-fix 1).
 * Keep in step with process-scheduled-payouts' `.eq("status", "completed")`
 * and `.or("disputed_at.is.null,and(is_group_job.is.true,dispute_status.in.(resolved,auto_resolved))")`.
 */
export function cronRetriesPayout(job: {
  status?: unknown; is_group_job?: unknown; disputed_at?: unknown; dispute_status?: unknown;
} | null | undefined): boolean {
  if (!job || job.status !== "completed") return false;
  if (job.disputed_at == null) return true;
  return job.is_group_job === true && (job.dispute_status === "resolved" || job.dispute_status === "auto_resolved");
}
