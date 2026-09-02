/**
 * What a POSTER actually paid for a job — the one number a "what it cost"
 * surface is allowed to print.
 *
 * `jobs.budget` is the agreed price of the WORK. It is not the cost. The
 * checkout (`supabase/functions/create-payment/index.ts`, the escrow branch)
 * bills the poster a Stripe line item per component:
 *
 *   budget              the work itself
 * + customer_fee_amount the tier service fee, stamped on the job at checkout
 * + urgent_fee          the urgent tip, passed through to the helper
 * + sales_tax_amount    Louisiana sales tax where the category is taxable
 *
 * ...so on a $640 job with an 11% service fee the card was charged $710.40 and
 * /home-history printed "$640" underneath a heading that reads "what it cost".
 * On a record a homeowner may hand a buyer, an insurer or an appraiser, that
 * is not a rounding difference — it is the wrong figure with the right label.
 *
 * NOT RE-DERIVED FROM PERCENTAGES. Every component is read from the columns the
 * charge path stamped, so this reports what was billed rather than recomputing
 * what should have been billed at today's rates. A legacy job with a null fee
 * column therefore degrades to exactly its budget, which is what that job's
 * poster was in fact charged.
 *
 * WHAT IS DELIBERATELY OUT: the one-time account-setup fee (charged once per
 * ACCOUNT, never stamped on a job row, so attributing it to any single job
 * would be a guess) and tips (a separate `tips` row, paid after the fact, and
 * not part of what the job cost).
 *
 * The admin money surfaces carry an inline `budget + customer_fee_amount +
 * sales_tax_amount` of their own (AdminUserSummaries, userDetail/JobsTab,
 * adminAnalyticsHelpers). They omit `urgent_fee`, so they under-report an
 * urgent job. Converging them is a separate change to admin-owned files; this
 * module is the correct expression and the place they should converge ON.
 */

/** Every money column the poster's escrow charge is assembled from. */
export interface PosterChargedJob {
  budget: number | null;
  /** The tier service fee, stamped by `create-payment` at checkout. */
  customer_fee_amount?: number | null;
  /** Poster-paid urgent bonus, gross dollars — a charged line item. */
  urgent_fee?: number | null;
  /** Louisiana sales tax collected on taxable labor. */
  sales_tax_amount?: number | null;
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Total dollars charged to the poster for this job. */
export function posterPaidDollars(job: PosterChargedJob): number {
  return (
    num(job.budget) +
    num(job.customer_fee_amount) +
    num(job.urgent_fee) +
    num(job.sales_tax_amount)
  );
}

/**
 * True when the total above is more than the bare budget — i.e. when the
 * charge columns are actually populated.
 *
 * Callers use this to decide whether a "$X paid" figure can carry a breakdown,
 * rather than showing a fee line of $0 on the pre-fee jobs that have none.
 */
export function hasChargeBreakdown(job: PosterChargedJob): boolean {
  return posterPaidDollars(job) > num(job.budget);
}
