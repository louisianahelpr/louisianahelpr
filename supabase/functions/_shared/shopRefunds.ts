// seed-policy: pages for seed/test Shops refunds too, on purpose: the one alert here is a
// buyer's refund that Stripe kept refusing, which is money owed whoever owns it.
//
// shopRefunds — the one Stripe move of a Shops refund (Shops M3, migration
// 20261019071055_shops_refunds_cancels_strikes). One copy, used by shop-checkout
// (right after the member's tap committed the decision) and declutter-money (the
// 10-minute retry), so the two can never disagree.
//
// The SQL decides everything (reason -> fee policy -> amount are table CHECKs on
// shop_refunds, written under the order's row lock); this only sends what the
// row says and reports back with shop_refund_executed.
//
// Idempotent: first it RECONCILES (a refund on the payment already carrying
// metadata.shop_refund_id = this row is recorded, never sent again), then it
// sends with the key shop-refund-<row id> (-r<n> after n failed tries: Stripe
// replays a stored error for the same key for 24 hours, and the reconcile step
// is what stops a new key from refunding twice). A supabase error THROWS (the
// caller answers "pending" / records a cron defect): money that moved is never
// left unrecorded silently.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** A row of shop_refund_to_send / shop_refunds_due. */
export type ShopRefundRow = {
  refund_id: string;
  order_id: string;
  buyer_id: string | null;
  seller_id: string | null;
  payment_intent_id: string;
  refund_cents: number;
  livemode: boolean | null;
  checkout_session_id: string | null;
  attempts: number;
  /** How many times Stripe failed / canceled a refund this row had recorded (each starts fresh tries). */
  reversals?: number | null;
};

export type ShopRefundOutcome = "sent" | "reconciled" | "failed";

/** The most tries before the money step stops and ops refunds it by hand. */
const SHOP_REFUND_MAX_ATTEMPTS = 12;

/**
 * The idempotency key of one try: the row's failed attempts so far, and, once
 * Stripe reversed a refund the row recorded, which run of tries this is
 * (shop_refund_reversed resets attempts to 0 and adds a reversal, /code-review
 * of shops-m3-v1 #4), so a re-send never replays the reversed refund's key.
 */
function shopRefundKey(refundId: string, attempts: number, reversals = 0): string {
  const n = Number.isInteger(attempts) && attempts > 0 ? attempts : 0;
  const v = Number.isInteger(reversals) && reversals > 0 ? reversals : 0;
  return `shop-refund-${refundId}${v === 0 ? "" : `-v${v}`}${n === 0 ? "" : `-r${n}`}`;
}

/** Send (or find) one Shops refund and record it. */
export async function sendShopRefund(stripe: Stripe, admin: Db, row: ShopRefundRow): Promise<ShopRefundOutcome> {
  if (!Number.isInteger(row.refund_cents) || row.refund_cents <= 0) {
    throw new Error(`shop refund ${row.refund_id}: no amount to send`);
  }
  let refundId: string | null = null;
  let reconciled = false;
  let why = "";
  try {
    const existing = await stripe.refunds.list({ payment_intent: row.payment_intent_id, limit: 100 });
    const mine = existing.data.find((r) => r.metadata?.shop_refund_id === row.refund_id && r.status !== "failed" && r.status !== "canceled");
    if (mine) {
      refundId = mine.id;
      reconciled = true;
    } else {
      const made = await stripe.refunds.create(
        {
          payment_intent: row.payment_intent_id,
          amount: row.refund_cents,
          metadata: { kind: "shop_refund", shop_refund_id: row.refund_id, order_id: row.order_id },
        },
        { idempotencyKey: shopRefundKey(row.refund_id, row.attempts, Number(row.reversals ?? 0)) },
      );
      if (made.status === "failed" || made.status === "canceled") why = `refund ${made.id} is ${made.status}`;
      else refundId = made.id;
    }
  } catch (e) {
    why = String((e as { message?: string })?.message ?? e).slice(0, 300);
  }
  if (refundId) {
    const { error } = await admin.rpc("shop_refund_executed", {
      p_refund_id: row.refund_id, p_stripe_refund_id: refundId, p_succeeded: true, p_error: null,
    });
    if (error) throw new Error(`shop refund ${row.refund_id}: Stripe refund ${refundId} not recorded: ${error.message}`);
    return reconciled ? "reconciled" : "sent";
  }
  const { error } = await admin.rpc("shop_refund_executed", {
    p_refund_id: row.refund_id, p_stripe_refund_id: null, p_succeeded: false, p_error: why || "refund failed",
  });
  if (error) throw new Error(`shop refund ${row.refund_id}: failure not recorded: ${error.message}`);
  if (Number(row.attempts ?? 0) + 1 >= SHOP_REFUND_MAX_ATTEMPTS) {
    await postSlackOpsAlert({
      kind: "money_at_risk", severity: "critical", oncePerDayKey: `shop-refund-gave-up-${row.refund_id}`,
      title: "Shops: a buyer's refund gave up",
      message: `Stripe refused this Shops refund ${SHOP_REFUND_MAX_ATTEMPTS} times. Refund the buyer by hand in Stripe, then record it. Last reason: ${(why || "unknown").slice(0, 200)}.`,
      fields: { Refund: row.refund_id, Order: row.order_id, Cents: String(row.refund_cents) },
    });
  }
  return "failed";
}
