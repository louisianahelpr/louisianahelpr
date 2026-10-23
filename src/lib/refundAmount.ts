// refundAmount (client mirror) — THE refund-amount definition, mirrored for the
// admin console's previews (the dispute split panel). The edge module
// `supabase/functions/_shared/refundAmount.ts` is what actually computes every
// refund; app code must not import from `supabase/functions/`, so the body is
// duplicated here and `src/lib/refundAmount.parity.test.ts` fails the build if
// the two ever disagree. Owner decision 2026-10-14: every refund keeps the card
// fee; only refunds caused by our own mistakes go back in full.

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
  /** The sales tax inside `capturedCents`, in cents: the tax on every kept part is kept too (owner, 2026-10-18, Q2082 (a)). */
  taxCents?: number | null;
  /**
   * The part of `capturedCents` the tax was charged on, tax included, when it
   * is not the whole charge (a legacy recurring visit: its Stripe Tax
   * transaction holds the labor and its tax, not the card-cost fee). Only a
   * kept amount inside that part carries tax. Omitted = the whole capture.
   */
  taxBaseCents?: number | null;
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
  /** The sales tax on the kept parts (taxOnKeptCents), also kept. */
  taxKeptCents: number;
  /** The most this charge can ever return: captured less fee, setup, other kept amounts and the tax on them (before earlier refunds). */
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
  const keptCents = nonRefundableCents + cents(i.otherKeptCents);
  const taxBase = i.taxBaseCents == null ? captured : Math.min(captured, cents(i.taxBaseCents));
  const keptInBase = Math.max(0, keptCents - (captured - taxBase));
  const taxKeptCents = Math.min(Math.max(0, captured - keptCents), taxOnKeptCents({ keptCents: keptInBase, taxCents: i.taxCents ?? 0, capturedCents: taxBase }));
  const ceilingCents = Math.max(0, captured - keptCents - taxKeptCents);
  const remainingCents = Math.max(0, ceilingCents - cents(i.alreadyRefundedCents));
  const requested = i.requestedCents == null ? null : cents(i.requestedCents);
  const refundCents = requested == null ? remainingCents : Math.min(requested, remainingCents);
  return { refundCents, feeKeptCents, setupKeptCents, nonRefundableCents, taxKeptCents, ceilingCents, remainingCents };
}

/**
 * The sales tax on a kept part of a taxed charge (owner, 2026-10-18, Q2082
 * (a)): kept x tax / (captured - tax), rounded up, never more than the tax.
 * Mirrors supabase/functions/_shared/refundAmount.ts.
 */
function taxOnKeptCents(i: { keptCents: number; taxCents: number | null | undefined; capturedCents: number }): number {
  const kept = cents(i.keptCents);
  const tax = cents(i.taxCents);
  const captured = cents(i.capturedCents);
  if (kept === 0 || tax === 0 || captured <= tax) return 0;
  return Math.min(tax, Math.ceil((kept * tax) / (captured - tax)));
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
 * this: it uses posterCancelKeptFeeCents below.
 */
export function cardCostFeeCents(
  job: { customer_fee_amount?: number | string | null; platform_fee_percent?: number | string | null } | null | undefined,
): number {
  const pct = job?.platform_fee_percent;
  if (pct == null || pct === "" || Number(pct) !== 0) return 0;
  return cents(Math.round(Number(job?.customer_fee_amount ?? 0) * 100));
}

/**
 * The fee a POSTER's own cancel (create-payment cancel_escrow, the
 * void-cancelled-payments sweep) keeps besides Stripe's real fee, in cents.
 * A job keeps the fee its poster paid at checkout, as it always has (on a
 * flat-model job that is 0; on a legacy job its card-cost service fee). The
 * poster-fee model's "fee comes back less the card cost" branch was removed
 * with that model (owner 2026-10-23, #3556; no job was funded on it).
 */
export function posterCancelKeptFeeCents(
  job: { customer_fee_amount?: number | string | null } | null | undefined,
): number {
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
