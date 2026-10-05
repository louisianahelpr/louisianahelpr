import { helperDisplayFeePercent, helperTakeHomeDollars, isSettledForDisplay } from "@/lib/helperEarnings";
import { HELPER_FEE_LEGACY_FALLBACK_PERCENT } from "@/lib/legacyFeeFallback";
import type { AppliedApp, Job } from "../../../components/job-card/activityConstants";

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
  expandedJobIds: Set<string>,
  /**
   * The VIEWING helper's own current fee rate, from their subscription tier.
   * Used only when the job has no rate stamped on it yet.
   */
  viewerTierFeePercent?: number | null,
  /** One-time setup fee still due from the viewer's first payout (Q753), in dollars. */
  firstPayoutFeeDollars = 0,
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
  // A CREW MEMBER'S LIVE JOB (Q1382). A crew has no lead (Q407): this member's
  // steps are on their own roster row, so the three single-Helpr sections
  // below (which read and write the JOB's scalar stamps, nobody's on a crew)
  // never render for them. CrewMemberSection owns the card instead, from
  // hire until the job leaves the live states; disputed and completed crew
  // jobs keep the shared sections.
  const isCrewLive =
    job.is_group_job === true &&
    app.status === "accepted" &&
    (status === "open" || status === "accepted" || status === "in_progress" || status === "revision_requested");
  const isOffered = isDirectOffer || (!isCrewLive && isAssigned && !job.helper_confirmed_at);
  const isConfirmed = !isCrewLive && isAssigned && !!job.helper_confirmed_at;
  const isActive =
    !isCrewLive && app.status === "accepted" && (status === "in_progress" || status === "revision_requested");
  const isDisputed = app.status === "accepted" && status === "disputed";
  const isCompleted = app.status === "accepted" && status === "completed";
  const isCancelled = job.status === "cancelled";
  const isPending = app.status === "pending" && !isDirectOffer;
  const isRejected = app.status === "rejected";
  const isFullyDone = isCompleted && helperReviewedJobIds.has(app.job_id);
  const isExpanded = expandedJobIds.has(app.job_id);

  // Payout calc — one shared definition (`helperEarnings.ts`) so this card, the
  // Earnings tab and /work-record can't drift. A group job's budget and urgent
  // fee are split across the roster there (#114).
  //
  // FEE PRECEDENCE (owner decision, 2026-08-20): "the price on their dashboard
  // and the ones they post should always match their tier."
  //
  // The rate that matches their tier is the HELPER'S LIVE TIER, resolved the
  // same way every payout path resolves it (`getHelperFeePercent` in
  // supabase/functions/_shared/helperFees.ts). `job.helper_fee_percent` is NOT
  // "the rate locked when they were accepted" — this comment used to claim that
  // and the claim is false. `create-payment` stamps that column from the GLOBAL
  // `platform_settings.helper_fee_percent` at ESCROW time, which is before any
  // helper is assigned, so it cannot possibly encode a specific helper's tier.
  // Only a RELEASED job carries a stamp worth trusting: the payout functions
  // re-stamp it with the live tier as they transfer.
  //
  // Measured on one $120 job, Elite helper: this card said $108 (stamped 10)
  // while Stripe transferred $110.40 (live 8). In the FREE direction it is
  // worse — the card said $108 against a real $105.60, a displayed take-home
  // HIGHER than the payout, which `JobPrice.tsx` states must never happen.
  //
  // `isSettledForDisplay`/`helperDisplayFeePercent` (helperEarnings.ts) own the
  // rule; this card only supplies the viewer's tier as the live rate.
  const fallbackFeePercent = viewerTierFeePercent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT;
  const commissionPercent = helperDisplayFeePercent(job, fallbackFeePercent);
  // The fee is still ahead only while the job's money has not moved: a released
  // job already paid it (or not), so its figure is the record, not a preview.
  const payout = helperTakeHomeDollars(
    job,
    fallbackFeePercent,
    isSettledForDisplay(job) ? 0 : firstPayoutFeeDollars,
  );

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
    isMinimalCard || isPending || isOffered || isConfirmed || isActive || isCrewLive || isDisputed || isCompleted;

  return {
    status,
    isDirectOffer,
    isOffered,
    isConfirmed,
    isActive,
    isCrewLive,
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

/**
 * Who cancelled a job, as the viewer should read it. The card said only
 * "Job was cancelled" — the same three words whether the poster pulled the
 * job, the viewer withdrew it themselves, the listing expired, or support
 * stepped in. `jobs.cancelled_by` records the actor (NULL for a sweep), so
 * the card can say which.
 *
 * Never role-based: the viewer is compared by id, so an account that both
 * posts and works reads "You cancelled" only when it was actually them.
 */
export function describeCancellation(
  job: Pick<Job, "cancelled_by" | "customer_id" | "cancellation_reason">,
  viewerId: string | null | undefined,
): string {
  const by = job.cancelled_by;
  if (by == null) {
    // Sweeps write a fixed reason; "expired" is the only automatic path that
    // reaches an applicant's card. Keep the generic line for anything else.
    return /expired/i.test(job.cancellation_reason ?? "")
      ? "Cancelled automatically — the scheduled time passed before anyone was hired"
      : "Cancelled automatically";
  }
  if (viewerId && by === viewerId) return "You cancelled this job";
  if (job.customer_id && by === job.customer_id) return "Cancelled by the person who posted it";
  return "Cancelled by Helpr support";
}

/** Headline on a closed card whose job details are gone (Q1207: a swept offer says it expired). */
export function closedCardLabel(app: { closed_reason?: string | null; status?: string | null }): string {
  if (app.closed_reason === "job_cancelled") return "Job cancelled";
  if (app.closed_reason === "offer_expired") return "Offer expired";
  return app.status === "rejected" ? "Not selected" : "Job no longer available";
}
