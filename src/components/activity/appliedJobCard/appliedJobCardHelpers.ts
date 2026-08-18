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
  // An accepted application whose JOB row is still `open` is not a data
  // anomaly — `accept_group_application` holds a group job open until its last
  // slot is filled, so every helper hired onto a partially-staffed roster looks
  // like this. Matching on `status === "accepted"` alone meant those cards hit
  // none of the six action sections and none of the minimal-card branches, so
  // they rendered with a status stripe, a meta row and then nothing: no
  // Withdraw, no Accept/Decline, no tracker. That is the "why doesn't the
  // bottom one have it" report. Treat the APPLICATION's own status as the
  // source of truth for "am I on this job", and use the job row only to decide
  // how far along it is.
  const isAssigned =
    app.status === "accepted" && (status === "accepted" || status === "open");
  const isOffered = isAssigned && !job.helper_confirmed_at;
  const isConfirmed = isAssigned && !!job.helper_confirmed_at;
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

  // Does ANY branch of the card own the action area? Every state above renders
  // its own section; this is the "none of the above" detector. Silence is the
  // defect the owner spotted — two cards in visibly the same state, one with a
  // control and one with a blank space where a control should be — so when
  // this is false the card says why instead of rendering nothing.
  const hasActionSection =
    isMinimalCard || isPending || isOffered || isConfirmed || isActive || isDisputed || isCompleted;

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
    hasActionSection,
  };
}
