// seed-policy: pages for seed/test Shops orders too, on purpose: the one alert here is a
// captured payment no order recorded, which is money that moved whoever owns it. Every
// other failure THROWS so Stripe redelivers, for seed and real orders alike.
//
// SHOPS M1 (migration 20261018164442_shops_orders_checkout; docs/specs/
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
import { captureShopHold, releaseShopHold } from "../../_shared/shopHolds.ts";
import { sessionJobTaxCents } from "../../_shared/jobTaxAddress.ts";
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
  // H6: a page priced at the pickup address carries automatic_tax off, so Stripe's total_details.amount_tax is
  // 0 there and the tax charged is our own "Sales tax" line, named in the metadata (tax_calculation_id +
  // job_tax_cents). A page opened before H6 still reads Stripe's figure. shop_mark_order_held checks the total
  // against items + fee + this tax (+ the setup fee), so a wrong figure cancels the hold.
  const taxCents = sessionJobTaxCents(session) ?? 0;
  // DIGITAL DOWNLOADS (20261108185110): nobody accepts a download. shop_digital_mark_paid makes the same amount and
  // setup-fee checks as shop_mark_order_held and records the order accepted; the hold is captured here at once with
  // the reviewed captureShopHold (a capture that does not answer is retried by declutter-money's shop_captures_due).
  // The SQL refuses a non-digital order, so the metadata flag alone never routes a normal order here.
  if (meta.digital === "1") {
    const { data: paid, error: paidErr } = await supabase.rpc("shop_digital_mark_paid", {
      p_session_id: session.id,
      p_payment_intent_id: piId,
      p_amount_total: session.amount_total,
      p_tax_cents: taxCents,
      p_livemode: event.livemode === true,
    });
    if (paidErr) throw new Error(`shop_digital_mark_paid failed: ${paidErr.message}`);
    const ans = paid as { result?: string; order_id?: string; captured?: boolean; capture_attempts?: number; reason?: string } | null;
    if (!ans?.result) throw new Error(`shop_digital_mark_paid returned nothing for ${session.id}`);
    if (ans.result === "accepted" || ans.result === "already_accepted") {
      if (ans.captured || !ans.order_id) return;
      const outcome = await captureShopHold(stripe, supabase, ans.order_id, piId, Number(ans.capture_attempts ?? 0));
      logStep("Shop download captured", { order: ans.order_id, outcome });
      return;
    }
    const releasedDigital = await releaseShopHold(stripe, supabase, {
      order_id: ans.order_id ?? meta.order_id, buyer_id: meta.buyer_id ?? null, seller_id: meta.seller_id ?? null,
      payment_intent_id: piId, livemode: event.livemode === true, checkout_session_id: session.id,
    });
    logStep("Shop download hold cancelled", { order: ans.order_id ?? null, reason: ans.reason ?? null, released: releasedDigital });
    return;
  }
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
    // Custom orders slice 2b: a 50% deposit order's page saved the card for the rest (setup_future_usage off_session,
    // shop-checkout). It is recorded on the order once (shop_order_record_saved_card answers not_deposit for any other
    // order). A page that saved no card leaves none: the rest then goes to the buyer's pay-the-rest page.
    if (meta.payment_plan === "deposit_50") {
      const pm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
      const cus = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
      if (pm && cus) {
        const { error: cardErr } = await supabase.rpc("shop_order_record_saved_card", {
          p_order_id: answer.order_id, p_customer_id: cus, p_payment_method_id: pm,
        });
        if (cardErr) throw new Error(`shop_order_record_saved_card failed for ${answer.order_id}: ${cardErr.message}`);
      } else {
        logStep("Deposit order held with no saved card; the rest goes to the buyer's page", { order: answer.order_id });
      }
    }
    return;
  }
  // 'cancel_hold': the order closed, the amount was wrong, or the day filled.
  const released = await releaseShopHold(stripe, supabase, {
    order_id: answer.order_id ?? meta.order_id, buyer_id: meta.buyer_id ?? null, seller_id: meta.seller_id ?? null,
    payment_intent_id: piId, livemode: event.livemode === true, checkout_session_id: session.id,
  });
  logStep("Shop hold cancelled", { order: answer.order_id ?? null, reason: answer.reason, released });
}
