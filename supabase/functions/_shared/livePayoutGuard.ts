/**
 * "Has this job already paid its Helpr?" — the one question every refund path
 * must ask before it returns money to the poster.
 *
 * ─── The double-pay this closes ─────────────────────────────────────────────
 *
 * A job that completed and released its escrow has paid the Helpr via a
 * separate Stripe transfer (`payout_transfers.status='paid'`, or 'pending' with
 * a real `stripe_transfer_id` in the brief window before the row is stamped
 * paid). If a refund is then issued against the ORIGINAL escrow charge — from
 * the admin panel (`admin_refund_general`), from the Stripe Dashboard
 * (`charge.refunded`), or anywhere else — with no reversal of that transfer,
 * the platform pays the budget twice: once to the Helpr (never clawed back) and
 * once back to the poster. `money-reconciliation` treats `payment_status`
 * 'refunded' as settled, so the divergence is also invisible to the nightly
 * reconciler (this is exactly the `refunded_with_live_payout` check's remit).
 *
 * The rule: a refund path that finds a live payout must NOT silently succeed.
 * It either reverses the transfer first, or it refuses and pages ops critical.
 *
 * The "live" test here is byte-for-byte the same as money-reconciliation's
 * `isSettledTransfer`: money is out and stayed out iff a row is 'paid', or
 * 'pending' WITH a real Stripe transfer id. 'reversed'/'reversal_cleared'
 * clawed money back, 'failed'/'canceled' moved nothing, and a 'pending' row
 * with a NULL id is an unfired claim.
 */

/** Minimal shape read from a `payout_transfers` row. */
interface PayoutTransferRow {
  id: string;
  status: string | null;
  stripe_transfer_id: string | null;
  helper_id?: string | null;
}

export interface LivePayoutCheck {
  /** True when at least one live (paid / pending-with-id) transfer exists. */
  hasLivePayout: boolean;
  /** The live transfers' Stripe ids (or row ids when the transfer id is null). */
  transferIds: string[];
  /** One human-readable line for a Slack alert or an error message. */
  reason?: string;
  /** Set on ANY read failure — callers MUST fail closed (refuse / retry). */
  readError?: string;
}

/**
 * A payout row is LIVE when money left the platform to the Helpr and stayed
 * there. Kept identical to money-reconciliation's `isSettledTransfer`.
 */
export function isLivePayoutRow(
  t: { status: unknown; stripe_transfer_id?: unknown },
): boolean {
  return (
    String(t.status) === "paid" ||
    (String(t.status) === "pending" && t.stripe_transfer_id != null)
  );
}

/**
 * Every live payout on a job, read from `payout_transfers`. Job-wide (not
 * per-helper): a live row whose `helper_id` was NULLed on deletion is still
 * money that moved. On a read error the result carries `readError` and callers
 * must treat the job as unsafe to refund (fail closed).
 */
export async function findLivePayout(
  supabase: { from: (t: string) => any },
  jobId: string,
): Promise<LivePayoutCheck> {
  const { data: rows, error } = await supabase
    .from("payout_transfers")
    .select("id, status, stripe_transfer_id, helper_id")
    .eq("job_id", jobId);
  if (error) {
    return {
      hasLivePayout: false,
      transferIds: [],
      readError: (error as { message?: string }).message ?? "payout_transfers read failed",
    };
  }
  const live = ((rows ?? []) as PayoutTransferRow[]).filter(isLivePayoutRow);
  const transferIds = live.map((r) => r.stripe_transfer_id ?? r.id);
  return {
    hasLivePayout: live.length > 0,
    transferIds,
    reason: live.length
      ? `${live.length} live payout transfer${live.length > 1 ? "s" : ""} exist${live.length > 1 ? "" : "s"} for this job (${transferIds.join(", ")}) — the Helpr was paid and the transfer has not been reversed`
      : undefined,
  };
}
