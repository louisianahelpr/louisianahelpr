// seed-policy: no alerts here; every failure is returned or THROWN to the caller (declutter-money records a defect,
// shop-checkout answers "try again"), for seed and real orders alike.
//
// shopBalance — the rest of a Shops custom order paid as a 50% deposit (slice 2b, migrations 20261106215722 +
// 20261106221300; plan ~/.lh-shots/handoffs-1106/builder4-shops.md; OWNER 11-06 balance-failure rule; LEAD 11-06 tax
// rule). One copy, used by declutter-money (the 10-minute clock), shop-checkout (the shop's "Handed over" tap) and
// stripe-webhook (a payment that lands later), so they can never disagree. The SQL decides; this only moves money:
//   chargeShopBalance  -> off-session PaymentIntent on the card saved at Checkout -> shop_balance_paid | shop_balance_failed
//   recordShopBalance  -> shop_balance_paid; an answer of 'refund' (paid twice, or the order closed) gives it back in full
//   settleUnpaidCloseTax -> Stripe Tax FULL reversal of the order's transaction, then shop_lapse_tax_done (which queues
//                          the deposit's tax refund as the order's unpaid_close_tax shop_refunds row)
// Never charged twice: one key per order and attempt (shop-balance-<order>-<attempt>), shop_balances_due never lists a
// paid order, and a second payment is answered 'refund' by the SQL and refunded here under one key per PaymentIntent.
import type Stripe from "https://esm.sh/stripe@18.5.0";

// deno-lint-ignore no-explicit-any
type Db = any;

/** PaymentIntent / Checkout metadata kind of the rest's payment (off-session or the buyer's page). */
export const SHOP_BALANCE_KIND = "shop_balance";
/** PaymentIntent metadata key the full reversal of an unpaid close stamps (stripe-webhook's refund reversal skips it). */
export const SHOP_UNPAID_CLOSE_TAX_REV_KEY = "tax_rev_unpaid_close";

export type ShopBalanceDueRow = {
  order_id: string;
  buyer_id: string | null;
  seller_id: string | null;
  balance_cents: number;
  customer_id: string | null;
  payment_method_id: string | null;
  attempts: number;
  livemode: boolean | null;
  checkout_session_id: string | null;
};

export type BalanceOutcome = "paid" | "already_paid" | "refunded" | "buyer_pays" | "will_retry";

/** The off-session key of one attempt (the order's balance_attempts as read). */
function shopBalanceKey(orderId: string, attempt: number): string {
  return `shop-balance-${orderId}-${Number.isInteger(attempt) && attempt >= 0 ? attempt : 0}`;
}

/** A card error that only the buyer can fix (declined, or the bank wants them to confirm): OWNER rule, the buyer pays. */
function isBuyerCardError(e: unknown): boolean {
  const err = e as { type?: string; code?: string; rawType?: string } | null;
  if (!err) return false;
  if (err.code === "authentication_required" || err.code === "card_declined" || err.code === "expired_card"
      || err.code === "insufficient_funds" || err.code === "incorrect_cvc") return true;
  return err.type === "StripeCardError" || err.rawType === "card_error";
}

function feeOf(pi: Stripe.PaymentIntent): number | null {
  const charge = pi.latest_charge as Stripe.Charge | string | null;
  const bt = typeof charge === "object" && charge ? charge.balance_transaction : null;
  const fee = typeof bt === "object" && bt ? bt.fee : null;
  return typeof fee === "number" && Number.isInteger(fee) && fee >= 0 ? fee : null;
}

/**
 * Record a succeeded rest payment. The SQL answers 'refund' for a payment the order no longer owes (a second one, or
 * the order closed): it is refunded in full here, once (key per PaymentIntent). A supabase error THROWS.
 */
export async function recordShopBalance(
  stripe: Stripe, admin: Db, orderId: string, pi: Stripe.PaymentIntent,
): Promise<Exclude<BalanceOutcome, "buyer_pays" | "will_retry">> {
  const { data, error } = await admin.rpc("shop_balance_paid", {
    p_order_id: orderId, p_payment_intent_id: pi.id, p_card_fee_cents: feeOf(pi),
  });
  if (error) throw new Error(`shop_balance_paid failed for ${orderId}: ${error.message}`);
  const result = (data as { result?: string } | null)?.result;
  if (result === "paid") return "paid";
  if (result === "already_paid") return "already_paid";
  if (result === "refund") {
    // own-mistake full refund (owner, 2026-10-14): a payment the order no longer owed (a second one, or one that landed
    // after the order closed) is a payment we could not use; it goes back whole, card fee included.
    await stripe.refunds.create(
      { payment_intent: pi.id, metadata: { kind: "shop_balance_refund", order_id: orderId } },
      { idempotencyKey: `shop-balance-refund-${pi.id}` },
    );
    return "refunded";
  }
  throw new Error(`shop_balance_paid answered ${String(result)} for ${orderId}`);
}

/** Charge the rest off-session on the card saved at Checkout, and record what happened. */
export async function chargeShopBalance(stripe: Stripe, admin: Db, row: ShopBalanceDueRow): Promise<BalanceOutcome> {
  if (!row.customer_id || !row.payment_method_id || !Number.isInteger(row.balance_cents) || row.balance_cents <= 0) {
    throw new Error(`shop order ${row.order_id}: no saved card or no rest to charge`);
  }
  let pi: Stripe.PaymentIntent | null = null;
  let why = "";
  let buyer = false;
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount: row.balance_cents, currency: "usd",
        customer: row.customer_id, payment_method: row.payment_method_id,
        off_session: true, confirm: true,
        transfer_group: `shop_order_${row.order_id}`,
        description: "Rest of your custom order",
        metadata: { kind: SHOP_BALANCE_KIND, order_id: row.order_id, buyer_id: row.buyer_id ?? "", seller_id: row.seller_id ?? "" },
        expand: ["latest_charge.balance_transaction"],
      },
      { idempotencyKey: shopBalanceKey(row.order_id, Number(row.attempts ?? 0)) },
    );
    if (pi.status !== "succeeded") why = `the payment is ${pi.status}`;
  } catch (e) {
    // Not swallowed: the failure is recorded below (shop_balance_failed with this text), and counted for the retry.
    why = String((e as { message?: string })?.message ?? e).slice(0, 300);
    buyer = isBuyerCardError(e);
  }
  if (pi && pi.status === "succeeded") return await recordShopBalance(stripe, admin, row.order_id, pi);
  // Not taken (processing, or an error). A processing payment that succeeds later lands through stripe-webhook's
  // payment_intent.succeeded (recordShopBalance); a second one is answered 'refund'. Counted, so the next try has a new key.
  const { error } = await admin.rpc("shop_balance_failed", { p_order_id: row.order_id, p_error: why, p_buyer: buyer });
  if (error) throw new Error(`shop_balance_failed failed for ${row.order_id}: ${error.message}`);
  return buyer ? "buyer_pays" : "will_retry";
}

export type UnpaidCloseTaxRow = {
  order_id: string;
  payment_intent_id: string | null;
  deposit_tax_cents: number;
};

function referenceTaken(e: unknown): boolean {
  const err = e as { param?: string; message?: string } | null;
  const msg = String(err?.message ?? "");
  return (err?.param === "reference" || /reference/i.test(msg)) && /already/i.test(msg);
}

/**
 * LEAD 11-06: an order that closed with the rest unpaid handed nothing over, so no taxable sale: its Stripe Tax
 * transaction (committed in full at the deposit capture, _jobTaxCommit.ts) is reversed IN FULL, stamped on the
 * PaymentIntent (so the deposit-tax refund's own refund event reverses nothing more), then shop_lapse_tax_done queues
 * the deposit's tax back to the buyer. An order with no committed transaction (no tax) only records the step.
 */
export async function settleUnpaidCloseTax(stripe: Stripe, admin: Db, row: UnpaidCloseTaxRow): Promise<"reversed" | "no_transaction"> {
  let outcome: "reversed" | "no_transaction" = "no_transaction";
  if (row.payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(row.payment_intent_id);
    const md = (pi.metadata ?? {}) as Record<string, string>;
    const txId = md.tax_transaction_id;
    if (md[SHOP_UNPAID_CLOSE_TAX_REV_KEY]) {
      outcome = "reversed";
    } else if (typeof txId === "string" && txId.startsWith("tax_")) {
      const reference = `unpaid_close:${row.order_id}`;
      let stamp = `reference:${reference}`;
      try {
        const rev = await stripe.tax.transactions.createReversal(
          { mode: "full", original_transaction: txId, reference, metadata: { order_id: row.order_id, reason: "unpaid_close" } },
          { idempotencyKey: `shop-unpaid-close-tax-${row.order_id}` },
        );
        stamp = rev.id;
      } catch (e) {
        // Already reversed under this reference (a run that died before the stamp): the reversal stands.
        if (!referenceTaken(e)) throw e;
      }
      await stripe.paymentIntents.update(row.payment_intent_id, { metadata: { [SHOP_UNPAID_CLOSE_TAX_REV_KEY]: stamp } });
      outcome = "reversed";
    }
  }
  const { error } = await admin.rpc("shop_lapse_tax_done", { p_order_id: row.order_id });
  if (error) throw new Error(`shop_lapse_tax_done failed for ${row.order_id}: ${error.message}`);
  return outcome;
}
