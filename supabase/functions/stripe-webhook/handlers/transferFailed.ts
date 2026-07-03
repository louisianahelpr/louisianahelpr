import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

export async function handleTransferFailed(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  // Rare — Stripe usually validates capability + balance up front, so
  // this fires only on edge cases (e.g. destination account
  // de-activated between create and settlement). Flip the ledger row
  // to 'failed' so the operator sees it and can retry / refund manually.
  const transfer = event.data.object as Stripe.Transfer;
  logStep("Transfer FAILED", { id: transfer.id, amount: transfer.amount });

  const failureReason = (transfer as { failure_message?: string }).failure_message
    ?? (transfer as { failure_code?: string }).failure_code
    ?? "unknown";

  const { data: failedLedger } = await supabase
    .from("payout_transfers")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      failure_reason: failureReason,
    })
    .eq("stripe_transfer_id", transfer.id)
    .select("job_id")
    .maybeSingle();

  // transfer.created optimistically flipped the job to "released". A failed
  // transfer never delivered funds, so leaving it "released" is a false
  // terminal state that strands the payout. Reset to "payout_pending" so
  // process-scheduled-payouts retries: its duplicate guard only skips on
  // pending/paid ledger rows, and this row is now "failed", so a fresh
  // transfer is correctly issued. Scope to a currently-"released" job so we
  // never regress a job an operator has since refunded / charged back.
  if (failedLedger?.job_id) {
    await supabase
      .from("jobs")
      .update({ payment_status: "payout_pending" })
      .eq("id", failedLedger.job_id)
      .eq("payment_status", "released");
    logStep("Failed transfer — job reset to payout_pending for retry", { jobId: failedLedger.job_id });
  }

  // Operator alert — failed payouts always need human eyes.
  postSlackOpsAlert({
    kind: "payout_failed",
    severity: "warning",
    title: "Helpr payout failed",
    message: `Stripe transfer ${transfer.id} did not succeed.`,
    fields: {
      "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
      "Destination": String(transfer.destination ?? "—"),
      "Reason": failureReason,
    },
  });
}
