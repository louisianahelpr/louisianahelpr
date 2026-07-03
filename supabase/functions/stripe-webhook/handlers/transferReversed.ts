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

  await supabase
    .from("payout_transfers")
    .update({ status: "reversed", reversed_at: new Date().toISOString() })
    .eq("stripe_transfer_id", transfer.id);

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
