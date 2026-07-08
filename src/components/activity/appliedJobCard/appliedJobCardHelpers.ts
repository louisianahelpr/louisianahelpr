import { deriveEscrowStepFromJob } from "@/components/payment/EscrowProgressBar";
import { netUrgentFeeDollars } from "@/lib/stripeFees";
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

  // Payout calc
  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const perHelper = job.budget / helpers;
  const commissionPercent = job.helper_fee_percent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT;
  const commission = (perHelper * commissionPercent) / 100;
  // Urgent fee splits across the roster like the budget (#114).
  const payout = perHelper - commission + netUrgentFeeDollars(job.urgent_fee) / helpers;

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
