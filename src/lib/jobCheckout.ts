// jobCheckout (client mirror) — what a JOB Checkout Session may offer, and the
// stale-quote check, for the app (Post a Job checkout, quotes).
//
// OWNER DECISIONS (2026-10-17/18, relayed by the lead):
// - Every job Checkout Session names its payment methods explicitly. Left
//   unset, Checkout offers the account's default configuration
//   (pmc_1RQbBF..., measured live 2026-10-17: card, Link, ACH, Klarna,
//   Afterpay, Affirm, Cash App, Amazon Pay), and Klarna/Afterpay/Affirm cost
//   about 6% + 30c, more than the 5% + 70c fee covers above a ~$28 job.
//   Card (Apple Pay / Google Pay ride on it), Link and ACH only. ACH counts
//   only once it settles (Q1970).
// - Pay in 4 (Klarna / Afterpay at 9% + 70c) and the poster-fee model (5% +
//   70c, Helpr keeps 100%, behind the `jobs_poster_fee` switch) were REMOVED
//   (owner 2026-10-23, #3556: "remove it from the app entirely"). Neither was
//   ever switched on; no job was funded on them. Every job checkout is on the
//   flat model: the poster pays the job price, the Helpr pays 5% + 70c.
// - Adaptive Pricing (local-currency presentment) is ON for the account
//   (measured live 2026-10-17: adaptive_pricing.enabled = true on recent
//   sessions). It adds a 2-4% conversion fee to what the CUSTOMER pays, so a
//   job checkout turns it off: the poster pays the dollar total the app showed.
// - Stale-client protection: a request that carries a fee quote must quote the
//   flat model and the job price the server reads (feeQuoteRefusal), so no
//   poster is charged a total the app never showed them.
//
// Client mirror of `supabase/functions/_shared/jobCheckout.ts` (app code must
// not import from supabase/functions/). `src/lib/jobCheckout.parity.test.ts`
// fails the build if the two diverge.

/** The Stripe payment method types a job checkout may name (a subset of Stripe's PaymentMethodType). */
export type JobCheckoutMethod = "card" | "link" | "us_bank_account";

/** Card (incl. Apple Pay / Google Pay), Link, US bank account (ACH). Nothing else. */
export const JOB_CHECKOUT_PAYMENT_METHOD_TYPES: readonly JobCheckoutMethod[] = ["card", "link", "us_bank_account"];

/** The only fee model a checkout is on since the poster-fee model was removed (owner 2026-10-23). */
export type JobFeeModel = "flat";

/** What the app showed the poster, sent with the escrow request. */
export interface JobFeeQuote {
  model: JobFeeModel;
  payInFour: false;
  /**
   * false on a screen that shows no total (the quote booking screens say
   * "Checkout shows your total before you pay"): only the model is checked.
   * Otherwise the job price must match.
   */
  totalShown?: boolean;
  /** Budget + urgent bonus, in cents. */
  jobPriceCents?: number;
  /** The service fee line the app showed, in cents: always 0 on the flat model. */
  serviceFeeCents?: number;
}

/** The sentence a refused stale quote answers with. */
export const STALE_FEE_QUOTE_MESSAGE =
  "The price of this job has changed since this screen loaded. Refresh (or update the app) to see the new total before you pay.";

function wholeCents(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * null when the request may be charged; the refusal sentence otherwise. A
 * missing quote is accepted (an older app quoting the flat price is quoting what
 * the checkout charges). A quote that is present must be the flat model, no
 * Pay in 4, a service fee of 0 and the job price exactly, both ways.
 */
export function feeQuoteRefusal(quote: unknown, expected: { jobPriceCents: number }): string | null {
  if (quote === undefined || quote === null) return null;
  if (typeof quote !== "object") return STALE_FEE_QUOTE_MESSAGE;
  const q = quote as Record<string, unknown>;
  if (q.model !== "flat") return STALE_FEE_QUOTE_MESSAGE;
  if (q.payInFour === true) return STALE_FEE_QUOTE_MESSAGE;
  if (q.totalShown === false) return null;
  const price = wholeCents(q.jobPriceCents);
  const fee = wholeCents(q.serviceFeeCents);
  if (price === null || price !== Math.round(expected.jobPriceCents)) return STALE_FEE_QUOTE_MESSAGE;
  if (fee !== 0) return STALE_FEE_QUOTE_MESSAGE;
  return null;
}

/** The quote a screen sends with its escrow request (see JobFeeQuote). */
export function buildFeeQuote(i: { jobPriceCents?: number } = {}): JobFeeQuote {
  if (i.jobPriceCents === undefined) return { model: "flat", payInFour: false, totalShown: false };
  const jobPriceCents = Math.max(0, Math.round(Number(i.jobPriceCents) || 0));
  return { model: "flat", payInFour: false, totalShown: true, jobPriceCents, serviceFeeCents: 0 };
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
