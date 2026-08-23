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
  /**
   * The VIEWING helper's own current fee rate, from their subscription tier.
   * Used only when the job has no rate stamped on it yet.
   */
  viewerTierFeePercent?: number | null,
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
  // A DIRECT offer is the other way a job can be sitting on this helper's
  // decision, and it looks nothing like an accepted application: the poster
  // stamps the offer on the JOB and no `applications` row is created at all,
  // so useActivityData fabricates one with `status: "pending"` just to have a
  // card to hang it on. That synthetic row used to fall through to `isPending`
  // — which rendered the Edit-message / Withdraw controls, every one of them
  // addressing an application id of `direct-<jobId>` that no table contains.
  // The stripe already said "Offered to you · respond" while the card below it
  // offered no way to respond.
  const isDirectOffer =
    job.direct_offer_status === "pending" && job.offered_to_helper_id === app.helper_id;
  const isOffered = isDirectOffer || (isAssigned && !job.helper_confirmed_at);
  const isConfirmed = isAssigned && !!job.helper_confirmed_at;
  const isActive = app.status === "accepted" && (status === "in_progress" || status === "revision_requested");
  const isDisputed = app.status === "accepted" && status === "disputed";
  const isCompleted = app.status === "accepted" && status === "completed";
  const isCancelled = job.status === "cancelled";
  const isPending = app.status === "pending" && !isDirectOffer;
  const isRejected = app.status === "rejected";
  const isFullyDone = isCompleted && helperReviewedJobIds.has(app.job_id);
  const isExpanded = expandedJobId === app.job_id;

  // Payout calc — one shared definition (`helperEarnings.ts`) so this card, the
  // Earnings tab and /work-record can't drift. A group job's budget and urgent
  // fee are split across the roster there (#114).
  //
  // FEE PRECEDENCE (owner decision, 2026-08-20): "the price on their dashboard
  // and the ones they post should always match their tier — helper's tier at
  // acceptance, but also make it correct in their dash."
  //   1. `job.helper_fee_percent` — the rate LOCKED when they were accepted.
  //      That is the tier-at-acceptance rate, and it must win once set.
  //   2. otherwise the viewer's CURRENT tier rate — this card also renders jobs
  //      that have not reached escrow, where no rate exists yet.
  //   3. only then the legacy constant, for a signed-out/unknown-tier render.
  //
  // This previously went straight from (1) to (3). Every job in production has
  // a NULL helper_fee_percent, so EVERY helper was quoted the legacy 10%
  // regardless of tier — a Free helper who owes 12% was shown 10% on their own
  // dashboard while the job sheet, which computes from tier, said 12%.
  const fallbackFeePercent = viewerTierFeePercent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT;
  const commissionPercent = job.helper_fee_percent ?? fallbackFeePercent;
  const payout = helperTakeHomeDollars(job, fallbackFeePercent);

  const isMinimalCard = isRejected || isCancelled;

  // Escrow progress for the helper's view — same source of truth as the
  // customer's PostedJobCard. Hides for jobs where escrow doesn't apply
  // (pending applications, rejected/cancelled, no payment intent).

  // Does ANY branch of the card own the action area? Every state above renders
  // its own section; this is the "none of the above" detector. Silence is the
  // defect the owner spotted — two cards in visibly the same state, one with a
  // control and one with a blank space where a control should be — so when
  // this is false the card says why instead of rendering nothing.
  const hasActionSection =
    isMinimalCard || isPending || isOffered || isConfirmed || isActive || isDisputed || isCompleted;

  return {
    status,
    isDirectOffer,
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
    hasActionSection,
  };
}
