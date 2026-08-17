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

  const { data: failedLedger, error: ledgerErr } = await supabase
    .from("payout_transfers")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      failure_reason: failureReason,
    })
    .eq("stripe_transfer_id", transfer.id)
    .select("job_id")
    .maybeSingle();

  if (ledgerErr) {
    // The ledger row wasn't flipped to 'failed'. Without that flip the job's
    // ledger shows 'paid' (from the release-payout insert) while the transfer
    // never settled — a money↔ledger divergence the retry can fix.
    // More critically: without ledgerRow.job_id, the job stays in "released"
    // state (false terminal) and the payout cron won't re-queue it — the helper
    // never gets paid. Throw so the idempotency row is rolled back and Stripe
    // retries once the DB recovers, with all context logged below.
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Helpr payout failed — ledger update FAILED, job may be stranded",
      message: `Stripe transfer ${transfer.id} failed AND the payout_transfers ledger update failed. The job may stay in "released" state with no real payment — the payout cron will not retry it. Stripe will retry this webhook; if retries exhaust, manually set payout_transfers.status='failed' and jobs.payment_status='payout_pending'.`,
      fields: {
        "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
        "Destination": String(transfer.destination ?? "—"),
        "Transfer ID": transfer.id,
        "Failure reason": failureReason,
        "DB error": ledgerErr.message.slice(0, 200),
      },
    });
    throw new Error(`Failed to update payout_transfers ledger for failed transfer ${transfer.id}: ${ledgerErr.message}`);
  }

  // transfer.created optimistically flipped the job to "released". A failed
  // transfer never delivered funds, so leaving it "released" is a false
  // terminal state that strands the payout. Reset to "payout_pending" so
  // process-scheduled-payouts retries: its duplicate guard only skips on
  // pending/paid ledger rows, and this row is now "failed", so a fresh
  // transfer is correctly issued. Scope to a currently-"released" job so we
  // never regress a job an operator has since refunded / charged back.
  if (failedLedger?.job_id) {
    const { error: jobResetErr } = await supabase
      .from("jobs")
      .update({ payment_status: "payout_pending" })
      .eq("id", failedLedger.job_id)
      .eq("payment_status", "released");
    if (jobResetErr) {
      // The job is stuck in "released" with no real payment — the payout cron
      // won't re-queue it. Throw so Stripe retries the delivery.
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "critical",
        title: "Helpr payout failed — job reset FAILED, job stranded in 'released'",
        message: `Stripe transfer ${transfer.id} failed AND the jobs.payment_status reset to 'payout_pending' failed. Job ${failedLedger.job_id} is stuck in "released" with no real payment — the helper is unpaid but the payout cron won't retry it. Stripe will retry this webhook; if retries exhaust, manually set jobs.payment_status='payout_pending' on the job.`,
        fields: {
          "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
          "Destination": String(transfer.destination ?? "—"),
          "Transfer ID": transfer.id,
          "Job ID": String(failedLedger.job_id),
          "DB error": jobResetErr.message.slice(0, 200),
        },
      });
      throw new Error(`Failed to reset job ${failedLedger.job_id} to payout_pending after failed transfer ${transfer.id}: ${jobResetErr.message}`);
    }
    logStep("Failed transfer — job reset to payout_pending for retry", { jobId: failedLedger.job_id });
  }

  // Operator alert — failed payouts always need human eyes.
  await postSlackOpsAlert({
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
