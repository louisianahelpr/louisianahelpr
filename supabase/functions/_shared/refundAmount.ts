// refundAmount — THE one definition of how much of a charge a refund returns
// to the person who paid it, for every Stripe refund path in the edge runtime.
//
// OWNER DECISION, 2026-10-14: "if admin refunds we keep the fee also. we
// should never absorb any fee." Stripe keeps its processing fee on every
// captured charge and never returns it on a refund, so EVERY refund returns
// what was paid less that card fee (and less a first job's one-time $2 setup
// fee, which is "paid and done": Q1346/Q1674).
//
// TAX ON WHAT WE KEEP (owner pop-up 2026-10-18, Q2082 (a), "J3"): the sales
// tax that sits on a kept part (the card fee, a late-cancel fee paid to the
// Helpr, crew block fees, the setup fee) is kept from the refund too; we never
// pay it. Stripe Tax reverses a refund's tax in PROPORTION to what it returns
// (a Checkout charge's refund, and our flat-amount reversal of a recurring
// visit's Tax API transaction: Stripe docs "Partially refund a sale by a flat
// amount"), so the tax left collected on a charge is tax x kept / captured. A
// refund that keeps K therefore also keeps K x tax / (captured - tax): then
// the tax Stripe leaves collected is exactly the extra amount kept (proof in
// src/test/refundKeepsTaxOnKeptAmounts.test.ts). The rest of the tax comes
// back with the refund, as before.
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
  /**
   * The sales tax inside `capturedCents` (chargeTaxCents(pi)), in cents. The
   * tax on every kept part is kept too (owner, 2026-10-18, Q2082 (a)).
   * 0 / omitted = an untaxed charge, nothing extra kept.
   */
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
  /** The sales tax on the kept parts (taxOnKeptCents), also kept: the refund notice names it. */
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
 * (a)): kept x tax / (captured - tax), rounded UP to the cent, so the tax
 * Stripe leaves collected on what we keep (tax x (kept + this) / captured) is
 * never more than this. 0 on an untaxed charge, a charge that kept nothing, or
 * a nonsense capture (tax >= captured). Never more than the tax itself.
 */
export function taxOnKeptCents(i: { keptCents: number; taxCents: number | null | undefined; capturedCents: number }): number {
  const kept = cents(i.keptCents);
  const tax = cents(i.taxCents);
  const captured = cents(i.capturedCents);
  if (kept === 0 || tax === 0 || captured <= tax) return 0;
  return Math.min(tax, Math.ceil((kept * tax) / (captured - tax)));
}

/**
 * The sales tax inside a PaymentIntent's charge, in cents, when it is known
 * without another Stripe read: the PI's own `amount_details.tax.total_tax_amount`
 * when it is above 0 (only API versions from 2025-10-29.clover return it; the
 * edge functions pin 2025-08-27.basil, whose AmountDetails has only `tip`,
 * read from stripe@18.5.0's types, lh-money-escrow review of 461a6b724 #2), else
 * `fallbackCents` (a recurring visit's stored tax_cents: a visit's tax is a Tax
 * API transaction, never on the PI), else 0. A Checkout charge is priced with
 * chargeTaxCentsFor below, which asks the Checkout Session.
 */
export function chargeTaxCents(
  pi: { amount_details?: unknown } | null | undefined,
  fallbackCents?: number | null,
): number {
  const t = (pi?.amount_details as { tax?: { total_tax_amount?: unknown } } | null | undefined)?.tax?.total_tax_amount;
  if (typeof t === "number" && Number.isFinite(t) && t > 0) return cents(t);
  return cents(fallbackCents);
}

/** The one Stripe read chargeTaxCentsFor needs, typed structurally (this module has no imports). */
export interface CheckoutSessionLister {
  checkout: {
    sessions: {
      list(p: { payment_intent: string; limit: number }): Promise<{ data?: Array<{ total_details?: { amount_tax?: number | null } | null }> } | null | undefined>;
    };
  };
}

/**
 * The sales tax inside a Checkout charge, in cents: what the Checkout Session
 * that took it says it charged (`total_details.amount_tax`, the figure the
 * poster saw; a gift shortfall session prices its line untaxed, so it reads 0).
 * The PI's own figure wins when it is there (chargeTaxCents). No session, or a
 * read that fails, is 0: the refund then keeps no tax, the behaviour before
 * Q2082 (a), never more than the poster owes.
 */
export async function chargeTaxCentsFor(
  stripe: CheckoutSessionLister,
  pi: { id?: string | null; amount_details?: unknown } | null | undefined,
): Promise<number> {
  const tax = await checkoutChargeTaxCents(stripe, pi);
  // A failed read keeps no tax (the old refund), never over-keeps the
  // poster's money; checkoutChargeTaxCents said so in the function log.
  return tax ?? 0;
}

/**
 * chargeTaxCentsFor, but a failed Checkout Session read is null, not 0: a
 * checker (money-reconciliation's under-refund ceiling) must call that job
 * unverified rather than grade it against a ceiling with no tax in it
 * (lh-money-escrow delta review of 2e397597d #2).
 */
export async function checkoutChargeTaxCents(
  stripe: CheckoutSessionLister,
  pi: { id?: string | null; amount_details?: unknown } | null | undefined,
): Promise<number | null> {
  const own = chargeTaxCents(pi);
  if (own > 0 || !pi?.id) return own;
  try {
    const page = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
    return cents(page?.data?.[0]?.total_details?.amount_tax ?? 0);
  } catch (e) {
    console.warn(`[refundAmount] could not read the Checkout Session tax for ${pi.id}`, e);
    return null;
  }
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
 * Jobs poster-fee model (jobs.poster_fee_flat_cents set; owner-approved
 * wording 2026-10-18, Q2082 slice 4: "the poster gets back what they paid
 * (tax included) less the card-processing cost"): 0, so only Stripe's real
 * fee is kept and the rest of the 5% + 70c comes back. A gift-paid part of the
 * fee carries no card cost and comes back whole (restore_gift_card_for_job).
 * Every other job keeps the fee its poster paid at checkout, as it always has
 * (on a flat-model job that is 0; on a legacy job its card-cost service fee).
 */
export function posterCancelKeptFeeCents(
  job: { customer_fee_amount?: number | string | null; poster_fee_flat_cents?: number | string | null } | null | undefined,
): number {
  const stamp = job?.poster_fee_flat_cents;
  if (stamp != null && stamp !== "") return 0;
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

/**
 * What goes back to the payer when a fee WITHHELD from their cancellation
 * refund is released afterwards (Q1915: a crew member who deleted their
 * account): the withheld cents, plus the sales tax the cancellation refund kept
 * on them (taxOnKeptCents; 0 when none was kept), never more than the charge
 * still holds. Stripe's card fee is not in it: it stays kept.
 */
export function withheldFeeReturnCents(i: { withheldCents: number; keptTaxCents: number; capturedCents: number; refundedCents: number }): number {
  return Math.min(cents(i.withheldCents) + cents(i.keptTaxCents), Math.max(0, cents(i.capturedCents) - cents(i.refundedCents)));
}
