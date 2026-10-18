// seed-policy: pages for seed/test Shops orders too, on purpose: the one alert here is a
// payment Stripe captured for an order that ended, which is money that moved whoever owns it.
//
// shopHolds — the two Stripe moves of a Shops order's card hold (Shops M1,
// migration 20261018044013_shops_orders_checkout; docs/specs/local-shops-prep.md
// L17/L18): CAPTURE when the maker accepts, CANCEL when the order ends unpaid.
// One copy, used by shop-checkout (the tap) and declutter-money (the 10-minute
// retry), so the two can never disagree.
//
// The SQL decides; this only moves what it is told and reports back:
//   capture -> shop_order_captured (Stripe's real card fee) | shop_order_capture_failed
//   cancel  -> shop_hold_released
// Cancelling an uncaptured PaymentIntent costs nothing (Stripe docs, "Refund and
// cancel payments"), so a dropped hold never keeps or absorbs a fee.
//
// Every Stripe call carries an idempotency key, so a tap and the cron racing
// each other make one capture and one cancel. The capture key is PER ATTEMPT
// (shop-capture-<order>-<capture_attempts>): Stripe replays a stored error for
// the same key for 24 hours, so a fixed key would turn one passing error into
// every retry failing (lh-money-escrow review, 2026-10-17). A second capture of
// an already-captured payment can only error, and the error is resolved by the
// PaymentIntent's state, so a new key never charges twice. A supabase error
// THROWS (the caller answers "try again" / records a cron defect): money that
// moved is never left unrecorded silently.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { sessionIdMode, type StripeMode } from "../_shared/stripeMode.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type ShopHoldRow = {
  order_id: string;
  buyer_id: string | null;
  seller_id: string | null;
  payment_intent_id: string | null;
  /** The payment's Stripe mode, recorded by the webhook (null: not recorded). */
  livemode: boolean | null;
  checkout_session_id: string | null;
};

/**
 * The Stripe mode an order's money sits in: the webhook's recorded livemode,
 * checked against the page id's cs_live_/cs_test_ prefix. Disagreement throws
 * (nothing moves); neither known -> null (the caller falls back to the parties).
 */
export function shopOrderMode(row: Pick<ShopHoldRow, "livemode" | "checkout_session_id">): StripeMode | null {
  const recorded: StripeMode | null = row.livemode === true ? "live" : row.livemode === false ? "test" : null;
  const byPage = sessionIdMode(row.checkout_session_id);
  if (recorded && byPage && recorded !== byPage) {
    throw new Error(`shop order says ${recorded} but its page is ${byPage}`);
  }
  return recorded ?? byPage;
}

/** Stripe's card fee on the captured charge (null: not readable; the SQL then estimates 2.9% + 30c). */
async function capturedFee(stripe: Stripe, paymentIntentId: string): Promise<number | null> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
    const charge = pi.latest_charge as Stripe.Charge | string | null;
    const bt = typeof charge === "object" && charge ? charge.balance_transaction : null;
    const fee = typeof bt === "object" && bt ? bt.fee : null;
    return typeof fee === "number" && Number.isInteger(fee) && fee >= 0 ? fee : null;
  } catch (e) {
    // Not fatal: the fee only matters for a later refund, and the SQL estimates it.
    console.log(JSON.stringify({ event: "shop_capture_fee_unreadable", pi: paymentIntentId, detail: String(e).slice(0, 200) }));
    return null;
  }
}

export type CaptureOutcome = "captured" | "will_retry" | "hold_lost";

/** The capture idempotency key of one attempt (the order's capture_attempts so far). */
function shopCaptureKey(orderId: string, attempt: number): string {
  return `shop-capture-${orderId}-${Number.isInteger(attempt) && attempt >= 0 ? attempt : 0}`;
}

/**
 * Capture an accepted order's hold and record the outcome. `attempt` is the
 * order's capture_attempts as read (a tap and the cron reading the same row
 * share the key, so they make one capture).
 */
export async function captureShopHold(
  stripe: Stripe, admin: Db, orderId: string, paymentIntentId: string, attempt: number,
): Promise<CaptureOutcome> {
  let captured = false;
  let lost = false;
  let why = "";
  try {
    const pi = await stripe.paymentIntents.capture(paymentIntentId, {}, { idempotencyKey: shopCaptureKey(orderId, attempt) });
    captured = pi.status === "succeeded";
    if (!captured) why = `capture left the payment ${pi.status}`;
  } catch (e) {
    why = String((e as { message?: string })?.message ?? e).slice(0, 300);
    // What happened is the PaymentIntent's state, not the error text. If even
    // that cannot be read, it is a retry (counted, so the next try gets a new key).
    try {
      const now = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (now.status === "succeeded") captured = true;
      else if (now.status === "canceled") lost = true;
    } catch (readErr) {
      why = `${why}; state unreadable: ${String((readErr as { message?: string })?.message ?? readErr).slice(0, 150)}`;
    }
  }
  if (captured) {
    const fee = await capturedFee(stripe, paymentIntentId);
    const { error } = await admin.rpc("shop_order_captured", { p_order_id: orderId, p_card_fee_cents: fee });
    if (error) throw new Error(`shop_order_captured failed for ${orderId}: ${error.message}`);
    return "captured";
  }
  const { data, error } = await admin.rpc("shop_order_capture_failed", { p_order_id: orderId, p_error: why, p_final: lost });
  if (error) throw new Error(`shop_order_capture_failed failed for ${orderId}: ${error.message}`);
  const result = (data as { result?: string } | null)?.result;
  return result === "cancelled" ? "hold_lost" : "will_retry";
}

export type ReleaseOutcome = "released" | "already_gone" | "captured_needs_refund";

/**
 * Cancel the hold of an order that ended unpaid (declined, no answer, withdrawn,
 * superseded) and record it. A payment Stripe shows as CAPTURED on a closed
 * order is never marked released: it is money taken for an order that ended,
 * so it pages ops (seed or not: money moved) and waits for a refund (M3).
 */
export async function releaseShopHold(stripe: Stripe, admin: Db, row: ShopHoldRow): Promise<ReleaseOutcome> {
  if (!row.payment_intent_id) return "already_gone";
  const piId = row.payment_intent_id;
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    let outcome: ReleaseOutcome;
    if (pi.status === "canceled") {
      outcome = "already_gone";
    } else if (pi.status === "succeeded") {
      await postSlackOpsAlert({
        kind: "money_at_risk", severity: "critical", oncePerDayKey: `shop-captured-closed-${row.order_id}`,
        title: "Shops: a closed order's payment was captured",
        message: "A Shops order ended without being accepted, but Stripe shows its payment captured. It needs a refund by hand until the Shops refunds slice lands.",
        fields: { Order: row.order_id, PaymentIntent: piId },
      });
      // Never marked released; counted, so it waits behind the cancels that can still happen.
      await recordReleaseFailure(admin, row.order_id, "payment captured on a closed order");
      return "captured_needs_refund";
    } else {
      await stripe.paymentIntents.cancel(piId, {}, { idempotencyKey: `shop-release-${row.order_id}` });
      outcome = "released";
    }
    const { error } = await admin.rpc("shop_hold_released", { p_order_id: row.order_id });
    if (error) throw new Error(`shop_hold_released failed for ${row.order_id}: ${error.message}`);
    return outcome;
  } catch (e) {
    await recordReleaseFailure(admin, row.order_id, String((e as { message?: string })?.message ?? e));
    throw e;
  }
}

/** Count a release that did not finish, so the row goes to the back of shop_holds_to_release. */
async function recordReleaseFailure(admin: Db, orderId: string, why: string): Promise<void> {
  const { error } = await admin.rpc("shop_hold_release_failed", { p_order_id: orderId, p_error: why.slice(0, 300) });
  if (error) {
    // The failure that brought us here is what the caller reports; this only orders the queue.
    console.error(JSON.stringify({ event: "shop_hold_release_failed_unrecorded", order: orderId, detail: error.message }));
  }
}
