import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

export async function handleTransferReversed(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  // A previously-settled transfer was reversed (manual reversal,
  // dispute, fraud, etc.). Mirror that in the ledger so finance
  // reconciliation matches Stripe's view.
  const transfer = event.data.object as Stripe.Transfer;
  logStep("Transfer REVERSED", { id: transfer.id, amount: transfer.amount });

  const { data: reversedLedger } = await supabase
    .from("payout_transfers")
    .update({ status: "reversed", reversed_at: new Date().toISOString() })
    .eq("stripe_transfer_id", transfer.id)
    .select("job_id")
    .maybeSingle();

  // transfer.created optimistically flipped the job to "released". A reversal
  // clawed those funds BACK out of the helper's account, so "released" is now a
  // false terminal state. Unlike a *failed* transfer (money never left, safe to
  // auto-retry), a reversal means money DID move and was pulled back — blindly
  // re-queuing to "payout_pending" would let process-scheduled-payouts pay the
  // helper a SECOND time (its dedupe guard only skips on pending/paid ledger
  // rows, and this row is now "reversed"). So we reset to "payout_pending" for
  // visibility but also stamp disputed_at, which the payout cron treats as a
  // hard block (.is("disputed_at", null)) — the payout freezes until an operator
  // reconciles manually. Scope to a currently-"released" job so we never regress
  // one an operator has already refunded / charged back.
  if (reversedLedger?.job_id) {
    await supabase
      .from("jobs")
      .update({
        payment_status: "payout_pending",
        disputed_at: new Date().toISOString(),
      })
      .eq("id", reversedLedger.job_id)
      .eq("payment_status", "released");
    logStep("Reversed transfer — job frozen (payout_pending + disputed_at) for manual reconciliation", {
      jobId: reversedLedger.job_id,
    });
  }

  postSlackOpsAlert({
    kind: "payout_reversed",
    severity: "warning",
    title: "Helpr payout reversed",
    message: `Stripe transfer ${transfer.id} was reversed. Investigate and reconcile.`,
    fields: {
      "Amount": `$${(transfer.amount / 100).toFixed(2)}`,
      "Destination": String(transfer.destination ?? "—"),
    },
  });
}
