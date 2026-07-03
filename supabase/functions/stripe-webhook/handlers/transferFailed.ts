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

  await supabase
    .from("payout_transfers")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      failure_reason: failureReason,
    })
    .eq("stripe_transfer_id", transfer.id);

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
