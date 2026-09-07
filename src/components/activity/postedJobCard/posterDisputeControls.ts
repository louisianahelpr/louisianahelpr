/**
 * What the POSTER can do about an open dispute, and the sentence that says so.
 *
 * These two used to live apart. The controls were gated on
 * `isDisputer && dispute_status === "open"` inside PostedJobActions' JSX; the
 * caption under the countdown said "Confirm the issue is fixed or escalate to
 * admin. If no action is taken, payment auto-releases to the Helpr." with no
 * gate at all. So the card promised two actions to a poster who had neither,
 * in two ordinary states — external QA, 2026-09-06, enumerated every `<button>`
 * on that card and got exactly: Timeline & Evidence, Message, Contact Admin.
 *
 * The two states, both reproduced against production data:
 *
 *   · THE HELPER FILED. `disputed_by` is the helper, `isDisputer` is false, and
 *     the poster — the party whose money is held — got no control at all while
 *     the clock ran down to an auto-release in the helper's favour.
 *   · THE HELPER REPLIED. DisputedSection stamps
 *     `dispute_status = 'helper_responded'`, which is not `'open'`, so both of
 *     the poster's controls disappeared at the exact moment the poster had
 *     something new to weigh.
 *
 * Production job 8133a907-f36f-4278-96c4-41d4ce1d56c8 sat in both at once.
 *
 * Deriving the copy from the same flags that render the chips is the whole
 * point of this module: `posterDisputeCopy.test.ts` walks the full state space
 * and asserts no caption can name an action the same call did not enable.
 * Keeping them in the JSX made that untestable without a render, which is why
 * they drifted.
 */

/** The subset of a `jobs` row this decision reads. */
export interface PosterDisputeJob {
  disputed_by?: string | null;
  dispute_status?: string | null;
  dispute_deadline?: string | null;
}

export interface PosterDisputeControls {
  /** The mirror column, defaulted the way the card has always defaulted it. */
  disputeStatus: string;
  /** Escalated: nothing auto-releases and there is nothing for the poster to do. */
  awaitingAdmin: boolean;
  /** Render the live countdown rather than the static policy paragraph. */
  showDeadline: boolean;
  /** Show "Resolve & Pay" — withdraw the dispute and release escrow. */
  canResolve: boolean;
  /** Show "Escalate" — hand the decision to an admin. */
  canEscalate: boolean;
  /** Caption under the live countdown. */
  consequenceText: string;
  /** The static fallback, used only when there is no live deadline to count. */
  policyText: string;
}

export function posterDisputeControls(
  job: PosterDisputeJob,
  userId: string,
): PosterDisputeControls {
  const disputeStatus = job.dispute_status || "open";
  const isDisputer = !!job.disputed_by && job.disputed_by === userId;

  // Once escalated, nothing auto-releases and there is nothing for the poster
  // to do — `auto-resolve-disputes` skips escalated disputes and only nags
  // admins. Both the countdown and the static policy paragraph have to stay
  // quiet, or they promise a deadline that will never fire. Load-bearing since
  // `helper_abort_job` (20260825190000), which opens ESCALATED disputes on
  // purpose so a helper who walked off a started job cannot be paid in full by
  // a timeout.
  const awaitingAdmin = disputeStatus === "escalated";
  const showDeadline = !!job.dispute_deadline && disputeStatus !== "resolved" && !awaitingAdmin;

  // The two pre-decision values of the MIRROR column. `disputes.status` stays
  // 'open' through both of them — 'helper_responded' exists only on `jobs` —
  // which is why rpc_withdraw_dispute still finds the record in either.
  const disputeLive = disputeStatus === "open" || disputeStatus === "helper_responded";

  // Resolve & Pay is a WITHDRAWAL, and `rpc_withdraw_dispute` refuses anyone
  // but the opener by design ("the other party's route out is the admin
  // decision path, not a unilateral close"). So it stays opener-only: offering
  // it to a poster the server will refuse is the same defect one layer down.
  // What it gains here is 'helper_responded'.
  const canResolve = isDisputer && disputeLive;

  // Escalation is the move EITHER party can make, and the one the poster most
  // needs when the helper filed: a non-escalated dispute that reaches its
  // deadline is settled by auto-resolve-disputes with `_outcome: "helper"` and
  // the full escrow goes out. Without this the accused poster's only move was
  // to wait and lose. Writable from this seat — the poster's UPDATE policy is
  // `auth.uid() = customer_id` with no column clause, `dispute_status` is on
  // neither enforce_poster_jobs_money_lock's nor prevent_job_field_escalation's
  // locked list, and nothing keys on `disputed_by`.
  const canEscalate = disputeLive;

  const consequenceText = canResolve
    ? "Resolve & Pay to close this out, or escalate to admin. If no action is taken, payment auto-releases to the Helpr."
    : canEscalate
      ? "Your Helpr opened this, so only they can withdraw it. Escalate to have an admin decide — otherwise the payment auto-releases to the Helpr when the clock runs out."
      : "Payment stays on hold until this is decided. If no action is taken, payment auto-releases to the Helpr.";

  // The clock is stated ONCE, in the trailing sentence, and the branch says
  // only what this poster can do inside it. Three copies of "72 hours" in one
  // paragraph is what escrowTiming.copyParity.test.ts exists to stop.
  const policyText = canResolve
    ? "Resolve this and release the payment, or escalate it to an admin."
    : canEscalate
      ? "Your Helpr opened this dispute, so only they can withdraw it — escalate it if you want an admin to decide."
      : "The payment stays on hold until this dispute is decided.";

  return {
    disputeStatus,
    awaitingAdmin,
    showDeadline,
    canResolve,
    canEscalate,
    consequenceText,
    policyText,
  };
}
