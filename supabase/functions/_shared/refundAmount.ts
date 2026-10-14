// refundAmount — THE one definition of how much of a charge a refund returns
// to the person who paid it, for every Stripe refund path in the edge runtime.
//
// OWNER DECISION, 2026-10-14: "if admin refunds we keep the fee also. we
// should never absorb any fee." Stripe keeps its processing fee on every
// captured charge and never returns it on a refund, so EVERY refund returns
// what was paid less that card fee (and less a first job's one-time $2 setup
// fee, which is "paid and done": Q1346/Q1674). Tax is NOT withheld: it sits
// inside the captured amount and comes back with the rest.
//
// The ONE exception (same decision, asked twice, same answer): a refund caused
// by OUR OWN mistake goes back IN FULL, card fee included. Those call sites do
// not use this module; each carries an `own-mistake full refund (owner,
// 2026-10-14)` comment, and src/test/refundsKeepTheCardFee.test.ts holds every
// `stripe.refunds.create` in the edge functions to one or the other.
//
// Zero imports on purpose: the edge harness points at the real module, and the
// callers pass in the fee they read (`actualOrEstimatedFeeCents` from
// stripeFees.ts, which needs the PaymentIntent retrieved with
// `expand: ["latest_charge.balance_transaction"]`).

export interface RefundToPayerInput {
  /** What the charge captured, in cents (pi.amount_received). */
  capturedCents: number;
  /** Stripe's real fee on this charge (actualOrEstimatedFeeCents), in cents. */
  actualFeeCents: number;
  /**
   * The fee the payer was charged at checkout that this path keeps
   * (jobs.customer_fee_amount in cents), or 0. The card fee kept is the larger
   * of this and `actualFeeCents`, so the platform never keeps less than Stripe
   * took. A dispute path or an admin refund passes `cardCostFeeCents(job)`
   * here instead, which is never a legacy service fee.
   */
  customerFeeCents?: number;
  /** A first job's kept one-time setup fee (setupFeeKeptCents), in cents. */
  setupFeeCents?: number;
  /** Anything else this path keeps from the charge (a cancellation fee paid to the Helpr, crew block fees), in cents. */
  otherKeptCents?: number;
  /** What earlier refunds on this charge already returned, in cents. */
  alreadyRefundedCents?: number;
  /** A requested amount (an admin's partial refund), in cents; null/undefined = everything refundable. */
  requestedCents?: number | null;
}

export interface RefundToPayerResult {
  /** What to send to Stripe now, in cents (0 = send nothing). */
  refundCents: number;
  /** The card fee kept: max(customerFeeCents, actualFeeCents). */
  feeKeptCents: number;
  /** The setup fee kept. */
  setupKeptCents: number;
  /** Card fee + setup fee: what is never refundable on this charge. */
  nonRefundableCents: number;
  /** The most this charge can ever return: captured less fee, setup and other kept amounts (before earlier refunds). */
  ceilingCents: number;
  /** What is still refundable after earlier refunds: ceiling less already refunded. */
  remainingCents: number;
}

function cents(n: number | null | undefined): number {
  const v = Math.round(Number(n ?? 0));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * How much of a charge goes back to the payer. Never negative, never more than
 * what is still refundable, never the card fee.
 */
export function refundToPayerCents(i: RefundToPayerInput): RefundToPayerResult {
  const captured = cents(i.capturedCents);
  const feeKeptCents = Math.max(cents(i.customerFeeCents), cents(i.actualFeeCents));
  const setupKeptCents = cents(i.setupFeeCents);
  const nonRefundableCents = feeKeptCents + setupKeptCents;
  const ceilingCents = Math.max(0, captured - nonRefundableCents - cents(i.otherKeptCents));
  const remainingCents = Math.max(0, ceilingCents - cents(i.alreadyRefundedCents));
  const requested = i.requestedCents == null ? null : cents(i.requestedCents);
  const refundCents = requested == null ? remainingCents : Math.min(requested, remainingCents);
  return { refundCents, feeKeptCents, setupKeptCents, nonRefundableCents, ceilingCents, remainingCents };
}

/**
 * The fee a DISPUTE path or an ADMIN refund may keep besides Stripe's real
 * fee, in cents: only the CARD cost, never a service fee. Dispute paths: owner
 * rule via the lead, 2026-10-14 (a poster who WON a dispute is not charged a
 * legacy 12% service fee). Admin refunds (admin_refund_general): owner pop-up,
 * 2026-10-14 ~3 PM CT ("an admin full refund keeps ONLY the card fee, like
 * disputes, not the old 12%"). On a job priced after the no-service-fee change
 * (platform_fee_percent = 0, owner 2026-10-11) customer_fee_amount IS the card
 * cost the poster paid, so it counts; on a legacy job (platform_fee_percent > 0,
 * or unknown) it is a service fee and counts as 0, leaving Stripe's real fee as
 * what is kept. Example: a $100 legacy job with a $12 fee: the card fee
 * (~$3.55) is kept, not $12. A poster's own cancel (cancel_escrow) does NOT use
 * this: it keeps the fee the poster paid, as it always has.
 */
export function cardCostFeeCents(
  job: { customer_fee_amount?: number | string | null; platform_fee_percent?: number | string | null } | null | undefined,
): number {
  const pct = job?.platform_fee_percent;
  if (pct == null || pct === "" || Number(pct) !== 0) return 0;
  return cents(Math.round(Number(job?.customer_fee_amount ?? 0) * 100));
}

/**
 * A crew's unfilled-spot refund (process-scheduled-payouts, owner MQ31(C)):
 * the fee comes back in proportion to the unfilled share, but never the card
 * fee (owner, 2026-10-14). What may come back is the fee the payer paid less
 * Stripe's real fee on the whole charge, capped at the pro-rata share. On a
 * job priced after 2026-10-11 the fee IS the card cost, so this is ~0.
 */
export function crewFeeShareReturnCents(i: { customerFeeCents: number; actualFeeCents: number; proRataCents: number }): number {
  return Math.min(cents(i.proRataCents), Math.max(0, cents(i.customerFeeCents) - cents(i.actualFeeCents)));
}
