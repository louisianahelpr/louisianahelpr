import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

/**
 * payout.paid (board 143a): a payout to the same account reached the bank, so
 * the member's earlier failures on that account are fixed and their Home card
 * goes away. Writes only `resolved_at`; moves no money. Idempotent: it only
 * touches rows still open, and only ones that failed before this payout.
 */
export async function handlePayoutPaid(event: Stripe.Event, { supabase, logStep }: WebhookContext) {
  const accountId = event.account;
  if (!accountId) return; // the platform's own payout
  const paidAt = new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  // Zero rows is the ordinary case (no failure was open), so no unwrapMutation.
  const { data, error } = await supabase
    .from("payout_failures")
    .update({ resolved_at: paidAt })
    .eq("stripe_account_id", accountId)
    .is("resolved_at", null)
    .lt("failed_at", paidAt)
    .select("id");
  if (error) throw new Error(`payout.paid: could not resolve failures on ${accountId}: ${error.message}`);
  if ((data?.length ?? 0) > 0) logStep("Payout failures resolved by a paid payout", { accountId, count: data!.length });
}
