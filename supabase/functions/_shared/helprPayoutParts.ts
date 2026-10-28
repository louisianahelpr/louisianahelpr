// helprPayoutParts — how ONE Helpr task payout is funded when the buyer
// raised the delivery's pay (Q1929, spec row 40; migration
// 20261021185418_declutter_delivery_raise_pay).
//
// A Stripe transfer made with source_transaction may not exceed its source
// charge (and all transfers from one charge together may not either). A raise
// is its own charge, so the part of the payout the raise paid for is sent from
// the raise's charge, and the rest from the order's charge, as before. Each
// raise part is the WHOLE raise: the Helpr's fee is charged on the original
// pay only (owner 2026-10-22: the Helpr gets the whole raise, no 5% + 70c on
// it), so the order part is the original pay minus its fee and is never
// negative. Raises are whole dollars, so a payout rounded down to the dollar
// keeps every raise part whole and only the order part rounds.
// A payout with no raise is ONE part, the whole amount, from the order's
// charge: exactly what declutter-money sent before raises existed.
//
// Zero imports on purpose (the edge harness and vitest import it directly).

/** One applied raise, as helpr_task_payouts_due names it. */
type RaisePart = { raise_id: string; payment_intent_id: string; cents: number };

/** One transfer of the payout: from the order's charge (raiseId null) or from one raise's charge. */
export type PayoutPart = { raiseId: string | null; paymentIntentId: string; amountCents: number; tipId?: string | null };

/** One held delivery tip (owner #3706), as helpr_task_payouts_due names it. */
type TipPart = { tip_id: string; payment_intent_id: string; cents: number };

/**
 * Held delivery tips (owner 2026-10-28, issue #3706; migration 20261028014848): a tip for a Helpr
 * with no payout account was charged on the platform and is paid WITH the delivery pay, each tip
 * as its own transfer of EXACTLY the tip from the tip's own charge. They are outside the payout's
 * amount_cents (the delivery pay, rounded down, with its fee): the Helpr gets every cent of a tip.
 * Throws on a malformed part (a data defect: never paid by a guess).
 */
export function heldTipParts(tipParts: unknown): PayoutPart[] {
  const tips = tipParts == null ? [] : tipParts;
  if (!Array.isArray(tips)) throw new Error("tip_parts is not a list");
  return (tips as TipPart[]).map((t) => {
    if (!t || typeof t.tip_id !== "string" || !t.tip_id || typeof t.payment_intent_id !== "string"
      || !t.payment_intent_id.startsWith("pi_") || !Number.isInteger(t.cents) || t.cents < 300 || t.cents > 100_000) {
      throw new Error("a tip part is malformed");
    }
    return { raiseId: null, tipId: t.tip_id, paymentIntentId: t.payment_intent_id, amountCents: t.cents };
  });
}

/**
 * The transfers that make up a payout of `amountCents`. Throws (a data defect:
 * the row is never paid by a guess) when the raise parts are malformed, do not
 * add up to the task's raised pay, or exceed the payout.
 */
export function helprPayoutParts(
  amountCents: number,
  orderPaymentIntentId: string,
  raisedCents: number | null | undefined,
  raiseParts: unknown,
): PayoutPart[] {
  const raises = raiseParts == null ? [] : raiseParts;
  if (!Array.isArray(raises)) throw new Error("raise_parts is not a list");
  const parts: PayoutPart[] = [];
  let raised = 0;
  for (const r of raises as RaisePart[]) {
    if (!r || typeof r.raise_id !== "string" || !r.raise_id || typeof r.payment_intent_id !== "string"
      || !r.payment_intent_id.startsWith("pi_") || !Number.isInteger(r.cents) || r.cents <= 0) {
      throw new Error("a raise part is malformed");
    }
    raised += r.cents;
    parts.push({ raiseId: r.raise_id, paymentIntentId: r.payment_intent_id, amountCents: r.cents });
  }
  if (raised !== Number(raisedCents ?? 0)) {
    throw new Error(`the raise parts (${raised}) do not add up to the task's raised pay (${Number(raisedCents ?? 0)})`);
  }
  const orderPart = amountCents - raised;
  if (orderPart < 0) throw new Error(`the raises (${raised}) are more than the payout (${amountCents})`);
  return orderPart > 0 ? [{ raiseId: null, paymentIntentId: orderPaymentIntentId, amountCents: orderPart }, ...parts] : parts;
}
