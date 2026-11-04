/**
 * Q2083 part (b) / Q1727 option (a): a job's sales tax is sourced from the JOB
 * ADDRESS, never the poster's billing address.
 *
 * Louisiana sources a taxable service to where it is performed (the owner-
 * adopted tax memo, ~/.lh-wt/handoffs-1017/tax-research-memo.md; La. R.S.
 * 47:301.3 for which repairs/cleanings are taxable). Stripe Checkout's
 * automatic_tax can only use the Customer's address, and writing the job site
 * onto the shared Customer leaks into Pro/Plus subscriptions (Q1727 "TRIED").
 * So a taxable job's Checkout prices tax with a Stripe `tax.calculations` call
 * at the job ZIP, charges it as its own "Sales tax" line with automatic_tax
 * off, and the webhook commits that calculation (createFromCalculation). The
 * Post-a-Job preview (calculate-tax) and recurring visits
 * (charge-recurring-visits) make the same call with the same address shape,
 * so preview == charge.
 *
 * Pure: no Deno, no Stripe import, so vitest reads it directly.
 */

/** A Louisiana 5-digit ZIP: 70000-71499 (USPS prefixes 700-714). */
const LA_ZIP_RE = /^(?:70\d|71[0-4])\d{2}$/;

/**
 * The address shape every job-tax `tax.calculations` call sends. "billing" is
 * the label calculate-tax and charge-recurring-visits already send live; the
 * ADDRESS is the job site either way. Whether "shipping" is the better label
 * for a service performed at a place is a Stripe test-mode check (B62 PASS
 * packet), not changed blind.
 */
export const JOB_TAX_ADDRESS_SOURCE = "billing" as const;

export type JobTaxAddress = { postal_code: string; state: "LA"; country: "US" };

/** The job site as a Stripe tax address, or null when the ZIP is not a Louisiana ZIP. */
export function jobTaxAddress(zip: unknown): JobTaxAddress | null {
  if (typeof zip !== "string") return null;
  const five = zip.trim().slice(0, 5);
  if (!LA_ZIP_RE.test(five)) return null;
  if (zip.trim().length > 5 && !/^\d{5}-\d{4}$/.test(zip.trim())) return null;
  return { postal_code: five, state: "LA", country: "US" };
}

/** Metadata keys a job Checkout Session carries when its tax was precomputed at the job site. */
export const JOB_TAX_CALC_KEY = "tax_calculation_id";
export const JOB_TAX_CENTS_KEY = "job_tax_cents";
/**
 * Q2716: capture marks read by the webhook's tax commit (_jobTaxCommit.ts).
 * cardHold.ts stamps SETUP_FEE_LEFT_OUT_KEY with the exact cents a hire's
 * partial capture left out (the setup fee claimed elsewhere);
 * void-cancelled-payments stamps CANCEL_FEE_CAPTURE_KEY "1" on a cancelled
 * job's fee capture, whose tax is never committed.
 */
export const SETUP_FEE_LEFT_OUT_KEY = "setup_fee_left_out_cents";
export const CANCEL_FEE_CAPTURE_KEY = "cancel_fee_capture";
/** A gift-paid job-site-taxed checkout: the full taxable price the tax was figured on (the card took less). */
export const JOB_TAXABLE_CENTS_KEY = "job_taxable_cents";
/**
 * Q2717: stamped on a cancel refund of a job-site-taxed charge: the cents of job-site tax that refund returns.
 * charge.refunded (_visitTaxReversal.ts) then reverses exactly tax-back x (taxable + tax) / tax of a gift-reduced
 * charge's Stripe Tax transaction, instead of scaling the refund by tax / card (which over-reported the tax).
 */
export const JOB_TAX_BACK_KEY = "job_tax_back_cents";

type SessionLike = {
  metadata?: Record<string, string> | null;
  total_details?: { amount_tax?: number | null } | null;
};

/**
 * The sales tax a job Checkout Session charged, in cents.
 *
 * A session priced at the job site carries automatic_tax off, so Stripe's
 * total_details.amount_tax is 0 there: the tax is our own "Sales tax" line,
 * recorded in metadata[job_tax_cents]. Any other session (untaxed jobs,
 * sessions opened before this change) still reads Stripe's figure. null =
 * no information (never read as zero).
 */
export function sessionJobTaxCents(session: SessionLike | null | undefined): number | null {
  const md = session?.metadata ?? null;
  const calc = md?.[JOB_TAX_CALC_KEY];
  const raw = md?.[JOB_TAX_CENTS_KEY];
  if (typeof calc === "string" && calc.startsWith("taxcalc_") && typeof raw === "string" && /^\d+$/.test(raw)) {
    return Number(raw);
  }
  const st = session?.total_details?.amount_tax;
  return typeof st === "number" ? st : null;
}
