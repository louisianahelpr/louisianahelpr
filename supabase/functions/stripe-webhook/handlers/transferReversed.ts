// seed-policy: pages for seed/E2E jobs too, on purpose. Every alert here is money
// that moved (or failed to move) in Stripe while the DB says otherwise, or a Stripe
// event that could not be settled: a platform failure whoever owns the job. The
// nightly money journeys on seed jobs are how this path is proven, so their failures
// are real signal (2026-09-22: "transfer failed" on seed jobs = the empty test
// balance, Q3). Seed-only noise is routed in the detectors, not here (docs/OPEN.md Q2).
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { clawbackForTransfer } from "./_chargebackClawback.ts";

export async function handleTransferReversed(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  // A previously-settled transfer was reversed (manual reversal,
  // dispute, fraud, etc.). Mirror that in the ledger so finance
  // reconciliation matches Stripe's view.
  const transfer = event.data.object as Stripe.Transfer;
  logStep("Transfer REVERSED", { id: transfer.id, amount: transfer.amount });

  const { data: reversedLedger, error: ledgerUpdateErr } = await supabase
    .from("payout_transfers")
    .update({ status: "reversed", reversed_at: new Date().toISOString() })
    .eq("stripe_transfer_id", transfer.id)
    .select("job_id")
    .maybeSingle();

  if (ledgerUpdateErr) {
    // Without a successful ledger flip the freeze block below is never entered
    // (reversedLedger is null on error), so the job stays "released" with no
    // hard-block markers and the Slack alert fires at "warning" severity rather
    // than "critical". Alert ops NOW before throwing so the critical-severity
    // page has full context, then throw so the idempotency row is rolled back
    // and Stripe retries once the DB recovers.
    await postSlackOpsAlert({
      kind: "payout_reversed",
      severity: "critical",
      title: "Helpr payout reversed — LEDGER UPDATE FAILED, job NOT frozen",
      message: `Stripe transfer ${transfer.id} was reversed but the payout_transfers status flip to 'reversed' failed (DB error). The job freeze was skipped — the job may remain in 'released' state. Stripe will retry this webhook.`,
      fields: {
        "Transfer ID": transfer.id,
        "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
        "Destination": String(transfer.destination ?? "—"),
        "DB error": ledgerUpdateErr.message.slice(0, 200),
      },
    });
    throw new Error(`payout_transfers status flip failed for reversed transfer ${transfer.id}: ${ledgerUpdateErr.message}`);
  }

  // OUR OWN reversal: a card-dispute clawback (Q202, _chargebackClawback.ts).
  // chargeDisputeCreated already moved the job to payment_status='chargeback'
  // before reversing, and the chargeback_clawbacks row is the record a won
  // dispute pays back from, so there is nothing to freeze and nothing for ops
  // to investigate. The ledger flip above still happened (it mirrors Stripe).
  // A failed lookup falls through to the ordinary, more cautious path.
  const ours = await clawbackForTransfer(supabase, transfer.id);
  if (ours.error) {
    logStep("Clawback lookup failed on transfer.reversed; treating as an unexplained reversal", { error: ours.error });
  } else if (ours.disputeId) {
    logStep("Transfer reversed by a card-dispute clawback — no freeze", { transferId: transfer.id, disputeId: ours.disputeId });
    await postSlackOpsAlert({
      kind: "payout_reversed",
      severity: "info",
      title: "Helpr payout reversed for a card dispute (automatic clawback)",
      message: `Stripe transfer ${transfer.id} was reversed by the clawback for card dispute ${ours.disputeId}. A won dispute pays it back automatically.`,
      fields: {
        "Amount reversed": `$${((transfer.amount_reversed ?? transfer.amount) / 100).toFixed(2)}`,
        "Dispute ID": ours.disputeId,
        ...(reversedLedger?.job_id ? { "Job": String(reversedLedger.job_id) } : {}),
      },
      link: `https://dashboard.stripe.com/disputes/${ours.disputeId}`,
    });
    return;
  }

  // transfer.created optimistically flipped the job to "released". A reversal
  // clawed those funds BACK out of the helper's account, so "released" is now a
  // false terminal state. Unlike a *failed* transfer (money never left, safe to
  // auto-retry), a reversal means money DID move and was pulled back — blindly
  // re-queuing to "payout_pending" would let process-scheduled-payouts pay the
  // helper a SECOND time (its dedupe guard only skips on pending/paid ledger
  // rows, and this row is now "reversed"). So we reset to "payout_pending" for
  // visibility but also stamp disputed_at AND set dispute_status to a hard-block
  // value. disputed_at alone is NOT enough: if this job previously had a dispute
  // that closed as resolved/auto_resolved, release-payout's guard allows payout
  // when dispute_status ∈ {resolved, auto_resolved} — the stale closed status
  // would let a re-run pay the helper a second time. 'reversal_hold' is in no
  // allow-list, so both payout paths freeze until an operator reconciles
  // manually. Scope to a currently-"released" job so we never regress one an
  // operator has already refunded / charged back.
  let freezeFailed = false;
  let zeroRowFreeze = false;
  if (reversedLedger?.job_id) {
    // This write is the freeze — it MUST NOT be fire-and-forget. If it fails,
    // the job stays "released" with no hard-block markers and the next payout
    // run could pay the helper a SECOND time on money that was already clawed
    // back. Check the error and escalate the ops alert so a human reconciles
    // manually rather than trusting a silent success.
    // `.select("id")`: a zero-row match returns a null error (Q244), so
    // without it a job that was not 'released' read as frozen.
    const { data: frozenRows, error: freezeErr } = await supabase
      .from("jobs")
      .update({
        payment_status: "payout_pending",
        disputed_at: new Date().toISOString(),
        dispute_status: "reversal_hold",
      })
      .eq("id", reversedLedger.job_id)
      .eq("payment_status", "released")
      .select("id");
    if (freezeErr) {
      freezeFailed = true;
      console.error(
        `[transferReversed] FREEZE FAILED for job ${reversedLedger.job_id} after transfer ${transfer.id} reversal — job may still be re-payable:`,
        freezeErr,
      );
      // Alert ops immediately with full context BEFORE throwing below, so the
      // critical page has the job/amount details. The outer catch fires its own
      // generic "webhook processing error" alert and rolls back the idempotency
      // row → Stripe retries → freeze re-runs once the DB recovers.
      await postSlackOpsAlert({
        kind: "payout_reversed",
        severity: "critical",
        title: "Helpr payout reversed — FREEZE FAILED, double-pay risk",
        message: `Stripe transfer ${transfer.id} was reversed but the job freeze write FAILED — the job may still be re-payable by the payout cron. Manually set the job to payout_pending / dispute_status='reversal_hold' NOW. Stripe will retry this webhook.`,
        fields: {
          "Transfer ID": transfer.id,
          "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
          "Destination": String(transfer.destination ?? "—"),
          "Job": String(reversedLedger.job_id),
          "DB error": freezeErr.message.slice(0, 200),
        },
      });
    } else if ((frozenRows?.length ?? 0) === 0) {
      // Zero rows: the job was not 'released', so it got NO reversal_hold
      // marker. If it sits in 'payout_pending' a payout run could pay the
      // clawed-back money again. Retrying cannot change the match, so page
      // instead of throwing, and skip the routine warning below.
      zeroRowFreeze = true;
      await postSlackOpsAlert({
        kind: "payout_reversed",
        severity: "critical",
        title: "Helpr payout reversed — freeze matched ZERO rows, job NOT frozen",
        message: `Stripe transfer ${transfer.id} was reversed, but job ${reversedLedger.job_id} was not in 'released', so the freeze matched zero rows and no reversal_hold was set. Read the job's payment_status NOW; if it is payable, set dispute_status='reversal_hold' before the next payout run.`,
        fields: {
          "Transfer ID": transfer.id,
          "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
          "Destination": String(transfer.destination ?? "—"),
          "Job": String(reversedLedger.job_id),
        },
        oncePerDayKey: `transfer-reversed-freeze-zero-rows:${reversedLedger.job_id}`,
      });
    } else {
      logStep("Reversed transfer — job frozen (payout_pending + disputed_at) for manual reconciliation", {
        jobId: reversedLedger.job_id,
      });
    }
  }

  // If the freeze succeeded (or there was no job_id), emit the standard ops alert.
  // When the freeze failed we already fired a critical alert above; skip the
  // duplicate here and throw instead so the outer handler rolls back the
  // idempotency row and returns 500 — letting Stripe retry and re-run the freeze
  // once the DB recovers.
  if (zeroRowFreeze) {
    return;
  }
  if (!freezeFailed) {
    await postSlackOpsAlert({
      kind: "payout_reversed",
      severity: "warning",
      title: "Helpr payout reversed",
      message: `Stripe transfer ${transfer.id} was reversed. Investigate and reconcile.`,
      fields: {
        "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
        "Destination": String(transfer.destination ?? "—"),
        ...(reversedLedger?.job_id ? { "Job": String(reversedLedger.job_id) } : {}),
      },
    });
  } else {
    // freezeFailed is only set inside `if (reversedLedger?.job_id)`, so
    // job_id is always present here. Throw so the outer handler returns 500
    // and Stripe retries once the DB recovers.
    throw new Error(
      `Job freeze failed after reversed transfer ${transfer.id} (job ${reversedLedger?.job_id}) — see Slack alert for DB error details`,
    );
  }
}
