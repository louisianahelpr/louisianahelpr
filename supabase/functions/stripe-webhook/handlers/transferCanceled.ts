import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

export async function handleTransferCanceled(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  // Fires when a Connect transfer is canceled before it settles (e.g. Stripe
  // revokes it, or the destination account is closed before settlement). Like
  // transfer.failed, a canceled transfer means the helper never received funds,
  // so the job must NOT stay in "released" — that would be a false terminal
  // state that hides an unpaid helper from ops and from the payout cron.
  const transfer = event.data.object as Stripe.Transfer;
  logStep("Transfer CANCELED", { id: transfer.id, amount: transfer.amount });

  const { data: canceledLedger, error: ledgerErr } = await supabase
    .from("payout_transfers")
    .update({
      status: "canceled",
      failed_at: new Date().toISOString(),
      failure_reason: "transfer_canceled",
    })
    .eq("stripe_transfer_id", transfer.id)
    .select("job_id")
    .maybeSingle();

  if (ledgerErr) {
    // Without a ledger flip the job stays "released" while the helper has no
    // funds — a money↔ledger divergence. More critically: the job's
    // payment_status stays "released" (the state transfer.created set), so
    // the payout cron never re-queues it and the helper is permanently unpaid.
    // Throw so the outer handler rolls back the idempotency row and returns 500,
    // letting Stripe retry once the DB recovers.
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Helpr payout canceled — ledger update FAILED, job may be stranded",
      message: `Stripe transfer ${transfer.id} was canceled AND the payout_transfers ledger update failed. The job may stay in "released" state with no real payment — the payout cron will not retry it. Stripe will retry this webhook; if retries exhaust, manually set payout_transfers.status='canceled' and jobs.payment_status='payout_pending'.`,
      fields: {
        "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
        "Destination": String(transfer.destination ?? "—"),
        "Transfer ID": transfer.id,
        "DB error": ledgerErr.message.slice(0, 200),
      },
    });
    throw new Error(
      `Failed to update payout_transfers ledger for canceled transfer ${transfer.id}: ${ledgerErr.message}`,
    );
  }

  // transfer.created optimistically flipped the job to "released". A canceled
  // transfer never delivered funds, so "released" is a false terminal state.
  // Reset to "payout_pending" so process-scheduled-payouts retries: its
  // duplicate guard only skips on pending/paid ledger rows, and this row is now
  // "canceled", so a fresh transfer is correctly issued.
  // Scope to a currently-"released" job so we never regress one an operator has
  // since refunded / charged back.
  if (canceledLedger?.job_id) {
    const { error: jobResetErr } = await supabase
      .from("jobs")
      .update({ payment_status: "payout_pending" })
      .eq("id", canceledLedger.job_id)
      .eq("payment_status", "released");

    if (jobResetErr) {
      // The job is stuck in "released" with no real payment and the payout cron
      // won't re-queue it. Throw so Stripe retries the delivery.
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "critical",
        title: "Helpr payout canceled — job reset FAILED, job stranded in 'released'",
        message: `Stripe transfer ${transfer.id} was canceled AND the jobs.payment_status reset to 'payout_pending' failed. Job ${canceledLedger.job_id} is stuck in "released" with no real payment — the helper is unpaid but the payout cron won't retry it. Stripe will retry this webhook; if retries exhaust, manually set jobs.payment_status='payout_pending' on the job.`,
        fields: {
          "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
          "Destination": String(transfer.destination ?? "—"),
          "Transfer ID": transfer.id,
          "Job ID": String(canceledLedger.job_id),
          "DB error": jobResetErr.message.slice(0, 200),
        },
      });
      throw new Error(
        `Failed to reset job ${canceledLedger.job_id} to payout_pending after canceled transfer ${transfer.id}: ${jobResetErr.message}`,
      );
    }
    logStep("Canceled transfer — job reset to payout_pending for retry", {
      jobId: canceledLedger.job_id,
    });
  }

  await postSlackOpsAlert({
    kind: "payout_failed",
    severity: "warning",
    title: "Helpr payout canceled",
    message: `Stripe transfer ${transfer.id} was canceled before settling.`,
    fields: {
      "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
      "Destination": String(transfer.destination ?? "—"),
    },
  });
}
