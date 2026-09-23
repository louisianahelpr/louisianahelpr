// seed-policy: pages for seed/E2E jobs too, on purpose. Every alert here is money
// that moved (or failed to move) in Stripe while the DB says otherwise, or a Stripe
// event that could not be settled: a platform failure whoever owns the job. The
// nightly money journeys on seed jobs are how this path is proven, so their failures
// are real signal (2026-09-22: "transfer failed" on seed jobs = the empty test
// balance, Q3). Seed-only noise is routed in the detectors, not here (docs/OPEN.md Q2).
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { requeueBlockers } from "./_chargebackHold.ts";

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
  // A job with a live dispute is NOT re-queued (lh-money-escrow review N2,
  // 2026-09-14). This reset used to run with no dispute check, so a job
  // carrying an open chargeback, a lost one, or an unsettled internal dispute
  // became payable again — and release-payout's allow-list pays a settled
  // internal status over a card dispute. Such a job stays 'released' (a false
  // terminal state, but not a payable one) and ops is paged to reconcile.
  let requeueBlocked = false;
  if (failedLedger?.job_id) {
    const blockers = await requeueBlockers(supabase, failedLedger.job_id);
    if (blockers.readError) {
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "critical",
        title: "Helpr payout failed — dispute check FAILED, job not re-queued",
        message: `Stripe transfer ${transfer.id} failed, but the job's dispute state could not be read, so it was not re-queued for payout. Stripe will retry this webhook.`,
        fields: {
          "Transfer ID": transfer.id,
          "Job ID": String(failedLedger.job_id),
          "Read error": blockers.readError.slice(0, 200),
        },
        oncePerDayKey: `transfer-failed-dispute-check-failed:${failedLedger.job_id}`,
      });
      throw new Error(`Dispute check failed before re-queuing job ${failedLedger.job_id} after failed transfer ${transfer.id}: ${blockers.readError}`);
    }
    if (blockers.reasons.length > 0) {
      requeueBlocked = true;
      logStep("Failed transfer on a job with a live dispute — NOT re-queued", {
        jobId: failedLedger.job_id,
        reasons: blockers.reasons,
      });
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Helpr payout failed on a job with a live dispute — NOT re-queued",
        message: `Stripe transfer ${transfer.id} failed, so the Helpr was not paid. The job was left 'released' instead of going back to payout_pending because ${blockers.reasons.join("; ")}. Settle the dispute, then re-queue or refund by hand.`,
        fields: {
          "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
          "Transfer ID": transfer.id,
          "Job ID": String(failedLedger.job_id),
        },
      });
    }
  }
  if (failedLedger?.job_id && !requeueBlocked) {
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
