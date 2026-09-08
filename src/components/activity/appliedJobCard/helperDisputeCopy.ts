/**
 * What the HELPER's dispute panel says, and which of its controls apply.
 *
 * Every sentence on that panel used to assume the POSTER had filed. The helper
 * can file too — the same "Something Wrong? Open a Dispute" link sits on their
 * completed job (AppliedJobCard, via DisputeLink) — and production has one:
 * job 8133a907-f36f-4278-96c4-41d4ce1d56c8 on 2026-09-06, `disputed_by` =
 * `helper_id`. On that card the panel:
 *
 *   · headlined "Both sides are talking it out",
 *   · captioned the countdown "If the poster doesn't resolve or escalate,
 *     payment auto-releases to you after the deadline" — a promise of payment,
 *     read by the person who had just complained about not being paid, and
 *   · offered a box to RESPOND to their own complaint, whose text lands on the
 *     poster's card under the heading "Helpr's response".
 *
 * The caption was not even inaccurate — `auto-resolve-disputes` settles every
 * non-escalated expired dispute with `_outcome: "helper"` and flips the job to
 * payout_pending. It had to be RE-AIMED, not softened: say the same mechanism
 * without dressing "wait it out" up as a win, and name the move that actually
 * ends it.
 *
 * Pure and separate from the component so `helperDisputeCopy.test.ts` can walk
 * the state space. The poster's half lives in
 * postedJobCard/posterDisputeControls.ts and was split out for the same reason.
 */

/** The subset of a `jobs` row this decision reads. */
export interface HelperDisputeJob {
  disputed_by?: string | null;
  dispute_status?: string | null;
}

export interface HelperDisputeCopy {
  disputeStatus: string;
  /** Escalated or under review: an admin owns the outcome now. */
  awaitingAdmin: boolean;
  /** Did THIS helper open it? Drives every sentence below. */
  iOpenedIt: boolean;
  /** The headline inside the tinted panel. */
  headline: string;
  /** Prefix on the stored reason — "Reason:" reads as an accusation when it is yours. */
  reasonLabel: string;
  /** Caption under the live deadline countdown. */
  consequenceText: string;
  /**
   * Offer the response box. False when this helper opened it: there is nothing
   * to respond to, their words are already in `dispute_reason`, and the box
   * writes `dispute_helper_response`, which the poster's card renders under
   * "Helpr's response".
   */
  canRespond: boolean;
  /**
   * Offer "Withdraw Dispute" — the helper's only exit that is not an admin.
   *
   * Until 2026-09-07 this panel had no such control, and the poster's card
   * said so out loud: "Your Helpr opened this, so only they can withdraw it."
   * Nobody could. `rpc_withdraw_dispute` is opener-only by design, so a
   * helper-opened dispute could be closed by exactly one party — who was
   * offered no button — and every one of them had to reach an admin.
   *
   * The gate mirrors the poster's `canResolve` deliberately: opener, and one
   * of the two PRE-DECISION values of the mirror column. `disputes.status`
   * stays 'open' through both, which is what the RPC looks for. 'escalated'
   * and 'under_review' are excluded — an admin owns the outcome then, and
   * `helper_abort_job` opens its dispute escalated on purpose so a walked-off
   * job cannot be closed out from under the poster.
   */
  canWithdraw: boolean;
}

export function helperDisputeCopy(
  job: HelperDisputeJob,
  helperId: string,
): HelperDisputeCopy {
  const disputeStatus = job.dispute_status || "open";
  const awaitingAdmin = disputeStatus === "escalated" || disputeStatus === "under_review";
  const iOpenedIt = !!job.disputed_by && job.disputed_by === helperId;

  // The helper keeps their voice after escalation — this was `=== "open"`,
  // so the control vanished the moment the poster escalated, and
  // `helper_abort_job` opens its dispute ESCALATED from the start, so a helper
  // who took the sanctioned exit never saw it at all. The server does not
  // forbid it: `dispute_helper_response` is on
  // enforce_helper_jobs_column_whitelist's ALLOW-list in every dispute state.
  const respondableStatus = ["open", "escalated", "under_review"].includes(disputeStatus);

  // See `canWithdraw` above. Same two values the poster's `canResolve` reads.
  const disputeLive = disputeStatus === "open" || disputeStatus === "helper_responded";

  return {
    disputeStatus,
    awaitingAdmin,
    iOpenedIt,
    headline: awaitingAdmin
      ? "An admin is on it."
      : iOpenedIt
        ? "You opened this. The poster can answer it."
        : "Both sides are talking it out.",
    reasonLabel: iOpenedIt ? "Your reason: " : "Reason: ",
    consequenceText: iOpenedIt
      ? // Names the move the panel actually offers. The old tail ("Talk it
        // through, or ask an admin to decide") was written when withdrawing
        // was not reachable from this card, and sent a helper whose issue was
        // already settled to an admin for no reason.
        `Waiting it out isn't a win — if nobody resolves this and the poster doesn't escalate, the hold just lapses and the payment releases on its normal schedule. Talk it through, ${
          disputeLive ? "withdraw it if it's sorted, " : ""
        }or ask an admin to decide.`
      : "If the poster doesn't resolve or escalate, payment auto-releases to you after the deadline.",
    canRespond: respondableStatus && !iOpenedIt,
    canWithdraw: iOpenedIt && disputeLive,
  };
}
