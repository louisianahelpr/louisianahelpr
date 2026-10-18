// seed-policy: pages for seed/test Shops orders too, on purpose: the one alert here is a
// captured payment no order recorded, which is money that moved whoever owns it. Every
// other failure THROWS so Stripe redelivers, for seed and real orders alike.
//
// SHOPS M1 (migration 20261018154737_shops_orders_checkout; docs/specs/
// local-shops-prep.md L17/L18): the Checkout Session shop-checkout opens with
// capture_method=manual (metadata.kind = "shop_order"). When the buyer
// finishes it the card is HELD (PaymentIntent requires_capture), not charged.
// shop_mark_order_held decides from the order's own state whether the hold
// stands ('held': the maker now has 24 h) or goes back ('cancel_hold', with a
// reason); a hold that goes back is cancelled here at no cost and recorded
// with shop_hold_released.
//
// Idempotent: a replayed event finds 'already_held', and cancelling an
// already-cancelled hold is a no-op (_shared/shopHolds.ts). Any failure
// THROWS, so stripe-webhook rolls back its dedupe row and Stripe redelivers.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { releaseShopHold } from "../../_shared/shopHolds.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

/** True for a Checkout Session shop-checkout created. */
export function isShopSession(session: { metadata?: unknown } | null | undefined): boolean {
  return (session?.metadata as Record<string, unknown> | null | undefined)?.kind === "shop_order";
}

type HeldAnswer =
  | { result: "held"; order_id: string }
  | { result: "already_held"; order_id: string }
  | { result: "cancel_hold"; reason: string; order_id?: string | null };

export async function settleShopSession(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const meta = (session.metadata ?? {}) as Record<string, string>;
  if (session.mode !== "payment" || !meta.order_id || session.client_reference_id !== meta.order_id) {
    // shop-checkout always sets all three; anything else is not ours to apply.
    logStep("Shop session ignored (shape)", { id: session.id, mode: session.mode });
    return;
  }
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!piId) throw new Error(`shop session ${session.id} has no payment_intent`);
  const pi = await stripe.paymentIntents.retrieve(piId);
  if (pi.status !== "requires_capture") {
    // A hold that is not a hold (canceled, or already captured) is never marked held.
    logStep("Shop session's payment is not an open hold", { id: session.id, pi: piId, status: pi.status });
    if (pi.status === "canceled") return;
    if (pi.status === "succeeded") {
      // A redelivery after the maker accepted and the hold was captured: the
      // order already carries this payment, nothing to apply. Anything else is
      // money taken that no order recorded: page ops instead of throwing, which
      // would only make Stripe redeliver the same event for days.
      const { data: row, error: readErr } = await supabase.from("shop_orders")
        .select("id, status, stripe_payment_intent_id").eq("stripe_checkout_session_id", session.id).maybeSingle();
      if (readErr) throw new Error(`shop order read failed for ${session.id}: ${readErr.message}`);
      const applied = (row as { stripe_payment_intent_id?: string | null } | null)?.stripe_payment_intent_id === piId;
      if (applied) return;
      await postSlackOpsAlert({
        kind: "money_at_risk", severity: "critical", oncePerDayKey: `shop-captured-unrecorded-${piId}`,
        title: "Shops: a captured payment no order recorded",
        message: "Stripe shows a Shops checkout's payment captured, but no Shops order carries it. Refund it by hand until the Shops refunds slice lands.",
        fields: { Session: session.id, PaymentIntent: piId, Order: meta.order_id },
      });
      return;
    }
    throw new Error(`shop session ${session.id}: payment ${piId} is ${pi.status}, not requires_capture`);
  }
  const taxCents = session.total_details?.amount_tax ?? 0;
  const { data, error } = await supabase.rpc("shop_mark_order_held", {
    p_session_id: session.id,
    p_payment_intent_id: piId,
    p_amount_total: session.amount_total,
    p_tax_cents: taxCents,
    p_livemode: event.livemode === true,
  });
  if (error) throw new Error(`shop_mark_order_held failed: ${error.message}`);
  const answer = data as HeldAnswer | null;
  if (!answer) throw new Error(`shop_mark_order_held returned nothing for ${session.id}`);
  if (answer.result === "held" || answer.result === "already_held") {
    logStep("Shop order held", { order: answer.order_id, result: answer.result });
    return;
  }
  // 'cancel_hold': the order closed, the amount was wrong, or the day filled.
  const released = await releaseShopHold(stripe, supabase, {
    order_id: answer.order_id ?? meta.order_id, buyer_id: meta.buyer_id ?? null, seller_id: meta.seller_id ?? null,
    payment_intent_id: piId, livemode: event.livemode === true, checkout_session_id: session.id,
  });
  logStep("Shop hold cancelled", { order: answer.order_id ?? null, reason: answer.reason, released });
}
