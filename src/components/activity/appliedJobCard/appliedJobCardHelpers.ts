import { deriveEscrowStepFromJob } from "@/components/payment/EscrowProgressBar";
import { helperTakeHomeDollars } from "@/lib/helperEarnings";
import { HELPER_FEE_LEGACY_FALLBACK_PERCENT } from "@/lib/legacyFeeFallback";
import type { AppliedApp, Job } from "../activityConstants";

/**
 * Derived render state for an AppliedJobCard — the status flags, payout
 * math, and escrow step. Pure: computed entirely from the application row,
 * its embedded job, and the parent-owned expanded/reviewed sets. Extracted
 * verbatim from AppliedJobCard so the render function stays lean.
 */
export function deriveAppliedJobCardState(
  app: AppliedApp,
  job: Job & { revision_note?: string | null },
  helperReviewedJobIds: Set<string>,
  expandedJobId: string | null,
) {
  const status = job.status;
  const isOffered = app.status === "accepted" && status === "accepted" && !job.helper_confirmed_at;
  const isConfirmed = app.status === "accepted" && status === "accepted" && !!job.helper_confirmed_at;
  const isActive = app.status === "accepted" && (status === "in_progress" || status === "revision_requested");
  const isDisputed = app.status === "accepted" && status === "disputed";
  const isCompleted = app.status === "accepted" && status === "completed";
  const isCancelled = job.status === "cancelled";
  const isPending = app.status === "pending";
  const isRejected = app.status === "rejected";
  const isFullyDone = isCompleted && helperReviewedJobIds.has(app.job_id);
  const isExpanded = expandedJobId === app.job_id;

  // Payout calc — one shared definition (`helperEarnings.ts`) so this card, the
  // Earnings tab and /work-record can't drift. A group job's budget and urgent
  // fee are split across the roster there (#114). The fallback % here stays the
  // LEGACY constant rather than the helper's tier rate: this card renders jobs
  // that may not have reached escrow yet, so it must not restate an old row at
  // today's subscription rate.
  const commissionPercent = job.helper_fee_percent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT;
  const payout = helperTakeHomeDollars(job, HELPER_FEE_LEGACY_FALLBACK_PERCENT);

  const isMinimalCard = isRejected || isCancelled;

  // Escrow progress for the helper's view — same source of truth as the
  // customer's PostedJobCard. Hides for jobs where escrow doesn't apply
  // (pending applications, rejected/cancelled, no payment intent).
  const escrowStep = isMinimalCard || isPending ? null : deriveEscrowStepFromJob(job);

  return {
    status,
    isOffered,
    isConfirmed,
    isActive,
    isDisputed,
    isCompleted,
    isCancelled,
    isPending,
    isRejected,
    isFullyDone,
    isExpanded,
    commissionPercent,
    payout,
    isMinimalCard,
    escrowStep,
  };
}
