// jobCheckout (client mirror) — what a JOB Checkout Session may offer, and
// which fee model a checkout is on, for the app (Post a Job checkout, quotes).
//
// OWNER DECISIONS (2026-10-17/18, relayed by the lead):
// - Every job Checkout Session names its payment methods explicitly. Left
//   unset, Checkout offers the account's default configuration
//   (pmc_1RQbBF..., measured live 2026-10-17: card, Link, ACH, Klarna,
//   Afterpay, Affirm, Cash App, Amazon Pay), and Klarna/Afterpay/Affirm cost
//   about 6% + 30c, more than the 5% + 70c fee covers above a ~$28 job.
//   Card (Apple Pay / Google Pay ride on it), Link and ACH only. ACH counts
//   only once it settles (Q1970).
// - "Pay in 4" is a separate choice made BEFORE checkout: Klarna and Afterpay
//   only (never Affirm), at 9% + 70c, offered only where the provider takes the
//   amount (Klarna $1-$2,000, Afterpay $1-$4,000).
// - Adaptive Pricing (local-currency presentment) is ON for the account
//   (measured live 2026-10-17: adaptive_pricing.enabled = true on recent
//   sessions). It adds a 2-4% conversion fee to what the CUSTOMER pays, so a
//   job checkout turns it off: the poster pays the dollar total the app showed.
// - The poster-fee model (5% + 70c, Helpr keeps 100%) is behind ONE server
//   switch, `jobs_poster_fee`, created OFF. Until the gift-first and
//   recurring-visit slices land, a gift-funded or recurring checkout stays on
//   the flat model even with the switch on (jobFeeModelFor), so no job is ever
//   stamped poster-fee on a path that does not charge the fee.
// - Stale-client protection: a poster-fee checkout is refused unless the
//   request carries the fee model and the exact amounts the app showed
//   (feeQuoteRefusal). An installed app built before the change sends nothing,
//   so it is refused instead of charging a total its poster never saw.
//
// Client mirror of `supabase/functions/_shared/jobCheckout.ts` (app code must
// not import from supabase/functions/). `src/lib/jobCheckout.parity.test.ts`
// fails the build if the two diverge.

/** The feature switch the poster-fee model ships behind (feature_switches.key). */
export const JOBS_POSTER_FEE_SWITCH = "jobs_poster_fee";

/** The Stripe payment method types a job checkout may name (a subset of Stripe's PaymentMethodType). */
export type JobCheckoutMethod = "card" | "link" | "us_bank_account" | "klarna" | "afterpay_clearpay";

/** Card (incl. Apple Pay / Google Pay), Link, US bank account (ACH). Nothing else. */
export const JOB_CHECKOUT_PAYMENT_METHOD_TYPES: readonly JobCheckoutMethod[] = ["card", "link", "us_bank_account"];

/** Pay in 4: Klarna and Afterpay only. Never Affirm. */
export const PAY_IN_FOUR_PAYMENT_METHOD_TYPES: readonly JobCheckoutMethod[] = ["klarna", "afterpay_clearpay"];

/** Pay in 4's poster fee percent (plus the same 70c), because those providers cost about 6% + 30c. */
export const PAY_IN_FOUR_FEE_PERCENT = 9;

/** Each Pay-in-4 provider's accepted charge range, in cents (USD). */
export const PAY_IN_FOUR_LIMITS: Readonly<Record<string, { minCents: number; maxCents: number }>> = {
  klarna: { minCents: 100, maxCents: 200_000 },
  afterpay_clearpay: { minCents: 100, maxCents: 400_000 },
};

/** The Pay-in-4 methods that accept a charge of `totalCents`; empty = Pay in 4 is not offered. */
export function payInFourMethodsFor(totalCents: number): JobCheckoutMethod[] {
  const t = Math.round(Number(totalCents) || 0);
  return PAY_IN_FOUR_PAYMENT_METHOD_TYPES.filter((m) => {
    const lim = PAY_IN_FOUR_LIMITS[m];
    return !!lim && t >= lim.minCents && t <= lim.maxCents;
  });
}

/** The fee model a checkout is priced and stamped on. */
export type JobFeeModel = "poster" | "flat";

export interface JobFeeModelInputs {
  /** feature_enabled_for_user('jobs_poster_fee', poster) answered exactly true. */
  switchOn: boolean;
  /** The checkout redeems a gift card (gift-first pricing is a later slice). */
  giftFunded: boolean;
  /** The job is a recurring series (recurrence_days set; per-visit fee is a later slice). */
  recurring: boolean;
}

/** Which model a NEW checkout is on. Already-funded jobs keep their stamped model. */
export function jobFeeModelFor(i: JobFeeModelInputs): JobFeeModel {
  return i.switchOn && !i.giftFunded && !i.recurring ? "poster" : "flat";
}

/** The poster's service fee percent on a poster-fee checkout. */
export function posterFeePercentFor(payInFour: boolean): number {
  return payInFour ? PAY_IN_FOUR_FEE_PERCENT : 5;
}

/** What the app showed the poster, sent with the escrow request. */
export interface JobFeeQuote {
  model: JobFeeModel;
  payInFour: boolean;
  /**
   * false on a screen that shows no total (the quote booking screens say
   * "Checkout shows your total before you pay"): only the model and the Pay-in-4
   * choice are checked. Otherwise both amounts must match.
   */
  totalShown?: boolean;
  /** Budget + urgent bonus, in cents. */
  jobPriceCents?: number;
  /** The service fee line the app showed, in cents (0 on the flat model). */
  serviceFeeCents?: number;
}

/** The sentence a refused stale quote answers with. */
export const STALE_FEE_QUOTE_MESSAGE =
  "The price of this job has changed since this screen loaded. Refresh (or update the app) to see the new total before you pay.";

/** The service fee a checkout on `model` charges on `jobPriceCents`. */
export function serviceFeeCentsFor(model: JobFeeModel, jobPriceCents: number, payInFour: boolean): number {
  if (model !== "poster") return 0;
  const base = Math.max(0, Math.round(Number(jobPriceCents) || 0));
  if (base === 0) return 0;
  return Math.round((base * posterFeePercentFor(payInFour)) / 100) + 70;
}

function wholeCents(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * null when the request may be charged; the refusal sentence otherwise.
 * A missing quote is accepted ONLY on the flat model (an older app quoting the
 * flat price is quoting what the flat checkout charges). Any quote that is
 * present must match the server's model, Pay-in-4 choice and both amounts
 * exactly, both ways: a client showing a higher or a lower total is refused.
 */
export function feeQuoteRefusal(
  quote: unknown,
  expected: { model: JobFeeModel; payInFour: boolean; jobPriceCents: number },
): string | null {
  if (quote === undefined || quote === null) {
    return expected.model === "flat" && !expected.payInFour ? null : STALE_FEE_QUOTE_MESSAGE;
  }
  if (typeof quote !== "object") return STALE_FEE_QUOTE_MESSAGE;
  const q = quote as Record<string, unknown>;
  const price = wholeCents(q.jobPriceCents);
  const fee = wholeCents(q.serviceFeeCents);
  if (q.model !== expected.model) return STALE_FEE_QUOTE_MESSAGE;
  if ((q.payInFour === true) !== expected.payInFour) return STALE_FEE_QUOTE_MESSAGE;
  if (q.totalShown === false) return null;
  if (price === null || price !== Math.round(expected.jobPriceCents)) return STALE_FEE_QUOTE_MESSAGE;
  if (fee === null || fee !== serviceFeeCentsFor(expected.model, expected.jobPriceCents, expected.payInFour)) {
    return STALE_FEE_QUOTE_MESSAGE;
  }
  return null;
}

/** The quote a screen sends with its escrow request (see JobFeeQuote). */
export function buildFeeQuote(i: JobFeeModelInputs & { payInFour?: boolean; jobPriceCents?: number }): JobFeeQuote {
  const model = jobFeeModelFor(i);
  const payInFour = model === "poster" && i.payInFour === true;
  if (i.jobPriceCents === undefined) return { model, payInFour, totalShown: false };
  const jobPriceCents = Math.max(0, Math.round(Number(i.jobPriceCents) || 0));
  return { model, payInFour, totalShown: true, jobPriceCents, serviceFeeCents: serviceFeeCentsFor(model, jobPriceCents, payInFour) };
}

/** A charge's card country, when the charge was paid by card (else null). */
export function chargeCardCountry(charge: unknown): string | null {
  const c = charge as { payment_method_details?: { type?: string; card?: { country?: string | null } } } | null;
  const country = c?.payment_method_details?.card?.country;
  return typeof country === "string" && country.length > 0 ? country.toUpperCase() : null;
}

/**
 * Owner 2026-10-18: non-US cards are blocked by a Radar rule
 * (`Block if :card_country: != 'US'`). A card from anywhere else reaching a
 * completed checkout means the rule is missing: page ops (no auto-refund).
 */
export function nonUsCardCountry(charge: unknown): string | null {
  const country = chargeCardCountry(charge);
  return country !== null && country !== "US" ? country : null;
}

/** The same check on a PaymentMethod object (`pm.card.country`), as the webhook reads it. */
export function nonUsPaymentMethodCountry(paymentMethod: unknown): string | null {
  const country = (paymentMethod as { card?: { country?: string | null } } | null)?.card?.country;
  if (typeof country !== "string" || country.length === 0) return null;
  const c = country.toUpperCase();
  return c === "US" ? null : c;
}
