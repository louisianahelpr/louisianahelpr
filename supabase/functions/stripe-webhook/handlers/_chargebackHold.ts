import { checkUnsettledDispute } from "../../_shared/unsettledDispute.ts";

/**
 * Who owns a job's dispute markers (`dispute_status`, `disputed_at`) when a
 * CARD dispute arrives — and which holds live somewhere other than the job row.
 *
 * `charge.dispute.created` used to write `dispute_status = 'stripe_chargeback'`
 * and a fresh `disputed_at` over whatever was already there, and a dismissed
 * inquiry (`warning_closed`) then cleared `disputed_at` — the only dispute guard
 * process-scheduled-payouts has. So it lifted holds the card dispute never
 * placed (OPEN.md, HIGH, d7a04acb9):
 *
 *   1. a decided internal dispute whose split has not executed —
 *      `rpc_decide_dispute` sets `dispute_status = 'resolved'` and leaves
 *      `disputed_at` — went back to payout_pending with no hold, and the Helpr
 *      was paid in full over the decided refund;
 *   2. a `transferReversed` job (`dispute_status = 'reversal_hold'`) lost its
 *      hold and became re-payable.
 *
 * The rule now: the card-dispute handlers write the markers only when they
 * own them, and a dismissal only clears `disputed_at` when no internal hold
 * exists on the `disputes` or `payout_transfers` rows either. Ownership is
 * derived from the markers themselves (no schema change): the handlers only
 * ever write the four statuses below, and no internal path writes any of them.
 */

/** Every dispute_status value the card-dispute handlers write. */
const CHARGEBACK_DISPUTE_STATUSES = [
  "stripe_chargeback",
  "warning_closed",
  "dispute_won",
  "dispute_lost",
] as const;

export function isChargebackDisputeStatus(status: string | null | undefined): boolean {
  return status != null && (CHARGEBACK_DISPUTE_STATUSES as readonly string[]).includes(status);
}

/**
 * charge.dispute.created may place its markers on this job.
 *
 * True when the job carries no dispute markers at all, or only markers a card
 * dispute placed. A null `dispute_status` beside a set `disputed_at` is a hold
 * of unknown origin, so it is NOT ours to overwrite (and a later dismissal must
 * not clear it).
 */
export function chargebackMayMarkJob(job: {
  dispute_status?: string | null;
  disputed_at?: string | null;
}): boolean {
  if (job.dispute_status == null) return job.disputed_at == null;
  return isChargebackDisputeStatus(job.dispute_status);
}

/**
 * The same rule as `chargebackMayMarkJob`, as a PostgREST `.or()` filter, so
 * the marker write is a compare-and-set: an internal dispute opened or decided
 * between the read and the write makes it match zero rows instead of being
 * overwritten.
 */
export const CHARGEBACK_MAY_MARK_FILTER =
  `dispute_status.in.(${CHARGEBACK_DISPUTE_STATUSES.join(",")}),` +
  `and(dispute_status.is.null,disputed_at.is.null)`;

/**
 * A `.or()` filter matching the dispute_status a decision was made from:
 * any card-dispute status when the job was read as card-dispute-owned (the
 * outcome write may already have moved it between two of them), else exactly
 * the value read.
 */
export function disputeStatusAsReadFilter(status: string | null | undefined): string {
  if (isChargebackDisputeStatus(status)) {
    return `dispute_status.in.(${CHARGEBACK_DISPUTE_STATUSES.join(",")})`;
  }
  return status == null ? "dispute_status.is.null" : `dispute_status.eq.${status}`;
}

/**
 * Internal dispute_status values that are a LIVE hold: a dispute still being
 * argued, or a clawed-back payout. 'resolved' / 'auto_resolved' are settled
 * (release-payout's allow-list) — except that 'resolved' is also what
 * rpc_decide_dispute writes before the split executes, which only the
 * `disputes` row can tell apart (see findInternalPayoutHold).
 */
const INTERNAL_HOLD_DISPUTE_STATUSES = [
  "open",
  "helper_responded",
  "escalated",
  "reversal_hold",
] as const;

/** Internal dispute_status values release-payout treats as closed. */
export const SETTLED_INTERNAL_DISPUTE_STATUSES = ["resolved", "auto_resolved"] as const;

export type InternalPayoutHold = {
  /** A decided dispute on this job whose split has not executed. */
  unsettledDisputeId?: string;
  /** A dispute on this job that is still open (not decided, not withdrawn). */
  openDisputeId?: string;
  /** A payout transfer on this job that Stripe reversed and no operator has cleared. */
  reversedTransferId?: string;
  /** Set when any read failed. Callers must fail closed. */
  readError?: string;
};

/**
 * Every reason this job must not be paid as if nothing were pending, from the
 * job row and the off-row holds together. Empty means no hold.
 *
 * `status = 'disputed'` counts on its own: the old created handler overwrote
 * 'open'/'escalated' with 'stripe_chargeback' on such jobs, and the escalation
 * only ever lived on jobs.dispute_status, so the job status is the last trace.
 */
export function holdReasons(
  job: { status?: string | null; dispute_status?: string | null },
  hold: InternalPayoutHold,
): string[] {
  const reasons: string[] = [];
  if (job.status === "disputed") reasons.push("the job is still in status 'disputed'");
  if (job.dispute_status && (INTERNAL_HOLD_DISPUTE_STATUSES as readonly string[]).includes(job.dispute_status)) {
    reasons.push(`the job's dispute_status is '${job.dispute_status}'`);
  }
  if (hold.unsettledDisputeId) reasons.push(`dispute ${hold.unsettledDisputeId} is decided and its split has not executed`);
  if (hold.openDisputeId) reasons.push(`dispute ${hold.openDisputeId} is still open`);
  if (hold.reversedTransferId) reasons.push(`payout transfer ${hold.reversedTransferId} was reversed`);
  return reasons;
}

/**
 * Holds that live OFF the job row, so they survive whatever the job's markers
 * say (including markers the old created handler overwrote).
 *
 * Mirrors process-scheduled-payouts' own defense-in-depth read of the same two
 * tables (kept there inline so a change here does not redeploy every function
 * through `_shared`).
 */
export async function findInternalPayoutHold(
  supabase: { from: (t: string) => any },
  jobId: string,
): Promise<InternalPayoutHold> {
  const settlement = await checkUnsettledDispute(supabase, jobId);
  if (settlement.readError) return { readError: `disputes: ${settlement.readError}` };

  const { data: openRows, error: openErr } = await supabase
    .from("disputes")
    .select("id, status, opener_id")
    .eq("job_id", jobId)
    .eq("status", "open")
    .limit(1);
  if (openErr) {
    return { readError: `disputes (open): ${(openErr as { message?: string }).message ?? "read failed"}` };
  }
  const open = ((openRows ?? []) as Array<{ id: string; status: string }>).find((r) => r.status === "open");

  const { data: reversedRows, error: reversedErr } = await supabase
    .from("payout_transfers")
    .select("id, status, stripe_transfer_id, helper_id")
    .eq("job_id", jobId)
    .eq("status", "reversed")
    .limit(1);
  if (reversedErr) {
    return { readError: `payout_transfers: ${(reversedErr as { message?: string }).message ?? "read failed"}` };
  }
  // Job-wide, not per helper: a reversed row whose helper_id was NULLed (or
  // that belongs to another roster member) is still money that moved and came
  // back. 'reversal_cleared' is an operator's explicit release and does not hold.
  const reversed = ((reversedRows ?? []) as Array<{ id: string; status: string; stripe_transfer_id: string | null }>)
    .find((r) => r.status === "reversed");

  return {
    unsettledDisputeId: settlement.blocked ? (settlement.dispute?.id ?? "unknown") : undefined,
    openDisputeId: open?.id,
    reversedTransferId: reversed ? (reversed.stripe_transfer_id ?? reversed.id) : undefined,
  };
}

/**
 * Before a failed or canceled transfer puts a 'released' job back into
 * payout_pending: every reason that job must NOT be re-queued.
 *
 * transfer.failed / transfer.canceled used to re-queue with no dispute check,
 * so a job carrying a live card dispute (or an unsettled internal one) became
 * payable again. The job-row rule mirrors release-payout's own guard (a set
 * disputed_at with a status off its allow-list), plus a lost chargeback, plus
 * the off-row holds.
 */
export async function requeueBlockers(
  supabase: { from: (t: string) => any },
  jobId: string,
): Promise<{ reasons: string[]; readError?: string }> {
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, status, dispute_status, disputed_at")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr) return { reasons: [], readError: `jobs: ${(jobErr as { message?: string }).message ?? "read failed"}` };
  // No job row: the reset below matches nothing either, so there is nothing to protect.
  if (!job) return { reasons: [] };

  const hold = await findInternalPayoutHold(supabase, jobId);
  if (hold.readError) return { reasons: [], readError: hold.readError };

  const row = job as { status?: string | null; dispute_status?: string | null; disputed_at?: string | null };
  const reasons = holdReasons(row, hold);
  const settled = row.dispute_status != null &&
    (SETTLED_INTERNAL_DISPUTE_STATUSES as readonly string[]).includes(row.dispute_status);
  if (row.dispute_status === "stripe_chargeback") reasons.push("a card dispute (chargeback) is open on the charge");
  else if (row.dispute_status === "dispute_lost") reasons.push("the card dispute on the charge was lost");
  else if (row.disputed_at != null && !settled && reasons.length === 0) {
    reasons.push(`the job carries a dispute marker (dispute_status '${row.dispute_status ?? "null"}')`);
  }
  return { reasons };
}
