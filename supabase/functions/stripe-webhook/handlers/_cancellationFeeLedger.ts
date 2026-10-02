// The single-Helpr cancellation-fee ledger, seen from the Stripe transfer
// webhooks (LOW-2).
//
// void-cancelled-payments sends a cancelled job's fee to its Helpr as a Stripe
// transfer with metadata.type = "cancellation_fee" and records it in
// cancellation_fee_transfers (claim row first; metadata.fee_transfer_id is that
// row's id). It is NOT a payout_transfers row on purpose: a row there is a job
// payout, and transfer.created would flip the job to released, and the payout
// handlers would re-queue or freeze a job whose escrow was refunded.
//
// So each transfer handler asks this module first. A cancellation-fee transfer
// moves its own ledger row and NOTHING else: no job flip, no payout re-queue.
// Crew shares (metadata.share_id, crew_cancellation_fee_shares) are not this
// ledger; they fall through to the handlers' existing path unchanged.
//
// Every write matches on a status precondition and selects the row back, so a
// redelivered or out-of-order event never walks a final row back, and a write
// that matched nothing is visible rather than silent.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

type FeeOutcome = "paid" | "failed" | "reversed";

/** A single-Helpr cancellation fee (not a crew share). */
export function isSingleHelprFeeTransfer(transfer: Stripe.Transfer): boolean {
  const md = (transfer.metadata ?? {}) as Record<string, string | undefined>;
  return md.type === "cancellation_fee" && !md.share_id;
}

/** Which statuses each outcome may move a row FROM. */
const FROM: Record<FeeOutcome, string[]> = {
  // A run that died after Stripe accepted the transfer leaves 'pending' (or
  // 'failed', when the create call threw on a timeout that still went
  // through); 'paid' is the ordinary re-confirm.
  paid: ["pending", "failed", "paid"],
  failed: ["pending", "paid", "failed"],
  // A reversal is final whatever the row said before.
  reversed: ["pending", "paid", "failed", "reversed"],
};

/**
 * Move the fee ledger row for `transfer` to `outcome`.
 * Throws on a DB error so the webhook returns 500 and Stripe redelivers.
 * Returns the row id it moved, or null when no row matched (paged).
 */
export async function settleCancellationFeeTransfer(
  transfer: Stripe.Transfer,
  outcome: FeeOutcome,
  { supabase, logStep }: Pick<WebhookContext, "supabase" | "logStep">,
  failureReason?: string,
): Promise<string | null> {
  const md = (transfer.metadata ?? {}) as Record<string, string | undefined>;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> =
    outcome === "paid"
      ? { status: "paid", stripe_transfer_id: transfer.id, paid_at: now, failure_reason: null }
      : outcome === "failed"
        ? { status: "failed", stripe_transfer_id: transfer.id, failure_reason: (failureReason ?? "transfer_failed").slice(0, 500) }
        : { status: "reversed", stripe_transfer_id: transfer.id };

  let q = supabase.from("cancellation_fee_transfers").update(patch).in("status", FROM[outcome]);
  if (md.fee_transfer_id) {
    // The row this transfer was claimed against.
    q = q.eq("id", md.fee_transfer_id);
  } else if (md.job_id && md.helper_id) {
    // A transfer sent before the ledger existed carries no row id; at most one
    // row a (job, Helpr) pair (UNIQUE), so this is the same row.
    q = q.eq("job_id", md.job_id).eq("helper_id", md.helper_id);
  } else {
    q = q.eq("stripe_transfer_id", transfer.id);
  }
  // Never re-point a row that already records a DIFFERENT transfer.
  q = q.or(`stripe_transfer_id.is.null,stripe_transfer_id.eq.${transfer.id}`);
  const { data, error } = await q.select("id");

  if (error) {
    throw new Error(
      `cancellation_fee_transfers ${outcome} write failed for transfer ${transfer.id}: ${error.message}`,
    );
  }
  const rowId = (data ?? [])[0]?.id ?? null;
  if (!rowId) {
    logStep("Cancellation fee ledger not advanced: no matching open row", {
      transferId: transfer.id,
      outcome,
      feeTransferId: md.fee_transfer_id ?? null,
    });
    // Money moved in Stripe that the fee ledger does not show in this state.
    // money-reconciliation's two-way check pages on it too; this is the
    // immediate signal. A redelivery of a final state also lands here, so it
    // pages once a day per transfer, not on every delivery.
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: outcome === "paid" ? "warning" : "critical",
      title: `Cancellation-fee transfer ${outcome} with no matching ledger row`,
      message: `Stripe transfer ${transfer.id} (a Helpr's cancellation fee) is ${outcome}, but no open cancellation_fee_transfers row matched it. Reconcile the row against Stripe.`,
      fields: {
        "Transfer ID": transfer.id,
        "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
        "Job": String(md.job_id ?? "—"),
        "Fee row": String(md.fee_transfer_id ?? "—"),
      },
      oncePerDayKey: `fee-ledger-no-row:${transfer.id}:${outcome}`,
    });
    return null;
  }
  logStep(`Cancellation fee ledger row ${outcome}`, { transferId: transfer.id, rowId });
  return rowId;
}
