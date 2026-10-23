// seed-policy: pages for seed/E2E jobs too, on purpose. Every alert here is money
// that moved (or failed to move) in Stripe while the DB says otherwise, or a Stripe
// event that could not be settled: a platform failure whoever owns the job. The
// nightly money journeys on seed jobs are how this path is proven, so their failures
// are real signal (2026-09-22: "transfer failed" on seed jobs = the empty test
// balance, Q3). Seed-only noise is routed in the detectors, not here (docs/OPEN.md Q2).
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { isCrewShareFeeTransfer, isSingleHelprFeeTransfer, noteFailedFeeTransfer, settleCancellationFeeTransfer } from "./_cancellationFeeLedger.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { requeueBlockers } from "./_chargebackHold.ts";
import { isDisputeSplitLeg, reopenDisputeSplit } from "./_splitLegFailed.ts";
import { tellCrewShareFailed, tellFeePayeeFailed, tellHelprPayoutFailed } from "./_payoutFailedNotice.ts";
import { cronRetriesPayout } from "./_payoutRetry.ts";

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

  // A single-Helpr cancellation fee is not a job payout (LOW-2): mark its own
  // ledger row failed, remember the transfer (Q2356: the retry never counts it as paid) and page.
  // It must not touch payout_transfers or re-queue the refunded job.
  if (isSingleHelprFeeTransfer(transfer)) {
    const rowId = await settleCancellationFeeTransfer(transfer, "failed", { supabase, logStep }, "transfer_canceled");
    if (rowId) {
      // Q2356: remembered on the row, so the hourly retry sends it again instead of counting it as paid.
      await noteFailedFeeTransfer(transfer, "fee", rowId, { supabase, logStep }, "transfer_canceled");
      // Tell the Helpr (lead 2026-10-22: only Slack heard before).
      await tellFeePayeeFailed(supabase, transfer, logStep);
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "critical",
        title: "Helpr cancellation-fee transfer canceled",
        message: `Stripe transfer ${transfer.id} (a Helpr's cancellation fee) was canceled before it settled. The fee ledger row is marked failed and remembers this transfer, so the hourly void-cancelled-payments run sends the fee again (Q2356). If it fails again, pay it by hand.`,
        fields: {
          "Transfer ID": transfer.id,
          "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
          "Job": String((transfer.metadata ?? {}).job_id ?? "—"),
        },
      });
    }
    return;
  }

  // Q2356: a crew cancellation-fee share is not a job payout either. Mark its share row failed and remember
  // the transfer (the hourly run's share retry then pays it), tell its Helpr and page ops. It must not touch
  // payout_transfers or re-queue the job.
  if (isCrewShareFeeTransfer(transfer)) {
    const shareId = String((transfer.metadata ?? {}).share_id);
    // A share id that is not a uuid matches no row (and would make the RPC throw forever): not recorded.
    const matched = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shareId)
      ? await noteFailedFeeTransfer(transfer, "share", shareId, { supabase, logStep }, "transfer_canceled")
      : null;
    await tellCrewShareFailed(supabase, transfer, { recorded: !!matched });
    return;
  }

  const { data: canceledLedger, error: ledgerErr } = await supabase
    .from("payout_transfers")
    .update({
      status: "canceled",
      failed_at: new Date().toISOString(),
      failure_reason: "transfer_canceled",
    })
    .eq("stripe_transfer_id", transfer.id)
    .select("job_id, helper_id, amount_cents, metadata")
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
  // A job with a live dispute is NOT re-queued (lh-money-escrow review N2,
  // 2026-09-14). This reset used to run with no dispute check, so a job
  // carrying an open chargeback, a lost one, or an unsettled internal dispute
  // became payable again — and release-payout's allow-list pays a settled
  // internal status over a card dispute. Such a job stays 'released' (a false
  // terminal state, but not a payable one) and ops is paged to reconcile.
  let requeueBlocked = false;
  // Whether the job really went back to payout_pending (the Helpr is told "we'll
  // try again" only then).
  let requeued = false;
  // Q2357: a dispute split's leg is never re-queued for a full payout; its dispute is re-opened so the
  // SPLIT is re-run (only the Helpr's share is sent again). See _splitLegFailed.ts.
  if (canceledLedger?.job_id && isDisputeSplitLeg((canceledLedger as { metadata?: unknown }).metadata)) {
    requeueBlocked = true;
    await reopenDisputeSplit(supabase, canceledLedger, transfer.id, String("transfer_canceled"), logStep);
  }
  if (canceledLedger?.job_id && !requeueBlocked) {
    const blockers = await requeueBlockers(supabase, canceledLedger.job_id);
    if (blockers.readError) {
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "critical",
        title: "Helpr payout canceled — dispute check FAILED, job not re-queued",
        message: `Stripe transfer ${transfer.id} canceled, but the job's dispute state could not be read, so it was not re-queued for payout. Stripe will retry this webhook.`,
        fields: {
          "Transfer ID": transfer.id,
          "Job ID": String(canceledLedger.job_id),
          "Read error": blockers.readError.slice(0, 200),
        },
        oncePerDayKey: `transfer-canceled-dispute-check-failed:${canceledLedger.job_id}`,
      });
      throw new Error(`Dispute check failed before re-queuing job ${canceledLedger.job_id} after canceled transfer ${transfer.id}: ${blockers.readError}`);
    }
    if (blockers.reasons.length > 0) {
      requeueBlocked = true;
      logStep("Canceled transfer on a job with a live dispute — NOT re-queued", {
        jobId: canceledLedger.job_id,
        reasons: blockers.reasons,
      });
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Helpr payout canceled on a job with a live dispute — NOT re-queued",
        message: `Stripe transfer ${transfer.id} canceled, so the Helpr was not paid. The job was left 'released' instead of going back to payout_pending because ${blockers.reasons.join("; ")}. Settle the dispute, then re-queue or refund by hand.`,
        fields: {
          "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
          "Transfer ID": transfer.id,
          "Job ID": String(canceledLedger.job_id),
        },
      });
    }
  }
  if (canceledLedger?.job_id && !requeueBlocked) {
    // `.select("id")`: a zero-row match returns a null error (Q244), so
    // without it a job that was not 'released' read as re-queued.
    const { data: resetRows, error: jobResetErr } = await supabase
      .from("jobs")
      .update({ payment_status: "payout_pending" })
      .eq("id", canceledLedger.job_id)
      .eq("payment_status", "released")
      .select("id, status, is_group_job, disputed_at, dispute_status");

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
    if ((resetRows?.length ?? 0) === 0) {
      // Zero rows: the job was not 'released' when this landed (refunded,
      // charged back, or the flip to released never happened), so it was NOT
      // re-queued. Retrying cannot change that, so page instead of throwing.
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "critical",
        title: "Helpr payout canceled — job reset matched ZERO rows, job not re-queued",
        message: `Stripe transfer ${transfer.id} canceled, but job ${canceledLedger.job_id} was not in 'released', so the reset to 'payout_pending' matched zero rows and the Helpr's payout was not re-queued. Read the job's payment_status and reconcile by hand.`,
        fields: {
          "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
          "Transfer ID": transfer.id,
          "Job ID": String(canceledLedger.job_id),
        },
        oncePerDayKey: `transfer-canceled-reset-zero-rows:${canceledLedger.job_id}`,
      });
    } else {
      // "We'll try again" only when the payout cron will really pick it up.
      requeued = cronRetriesPayout(resetRows?.[0]);
      logStep("Canceled transfer — job reset to payout_pending for retry", {
        jobId: canceledLedger.job_id,
      });
    }
  }

  // Tell the Helpr (lead 2026-10-22: a payout that did not settle used to reach only Slack).
  if (canceledLedger?.helper_id) {
    await tellHelprPayoutFailed(supabase, {
      userId: String(canceledLedger.helper_id),
      jobId: canceledLedger.job_id ? String(canceledLedger.job_id) : null,
      amountCents: Number(canceledLedger.amount_cents ?? transfer.amount ?? 0),
      requeued,
      transferId: transfer.id,
    });
  } else {
    // A transfer that matched no payout_transfers row. Since Q2356 a crew cancellation-fee share is handled
    // (recorded and retried) before the ledger update and never reaches here; this call is a fallback that
    // answers false, and does nothing, for any other transfer.
    await tellCrewShareFailed(supabase, transfer);
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
