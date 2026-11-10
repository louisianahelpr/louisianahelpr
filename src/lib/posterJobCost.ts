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
 * + onboarding_fee_amount  the one-time $2 account setup fee, on the ONE job
 *                     whose checkout carried and kept it (Q1346)
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
 * THE ONE-TIME ACCOUNT SETUP FEE COUNTS (owner, 2026-10-12, Q1346: "the
 * poster's Spent total and their receipts count it"). It is billed as a line
 * item on the poster's first escrow checkout, and stripe-webhook stamps it on
 * THAT job (jobs.onboarding_fee_amount) only when the checkout kept it (a
 * duplicate is refunded and never stamped), so attributing it is a read, not
 * a guess.
 *
 * WHAT IS DELIBERATELY OUT: tips (a separate `tips` row, paid after the fact,
 * and not part of what the job cost).
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
  /** The one-time account setup fee this job's checkout kept (stripe-webhook stamps it; Q1346). */
  onboarding_fee_amount?: number | null;
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Total dollars charged to the poster for this job. */
export function posterPaidDollars(job: PosterChargedJob): number {
  return (
    num(job.budget) +
    num(job.customer_fee_amount) +
    num(job.urgent_fee) +
    num(job.sales_tax_amount) +
    num(job.onboarding_fee_amount)
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

/** "$10", "$1.20", "$1,524": whole dollars bare, cents only when there are some. */
function usd(n: number): string {
  const c = Math.round(n * 100);
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/**
 * F109 (owner UI audit 2026-11-09: the job page said $10 while Receipts said $11.20 for the same job): the job
 * page's one line for the poster, from the same stamped columns as posterPaidDollars and with the checkout's own
 * row names: "Total $11.20 ($10 job + $1.20 service fee)". Null when nothing was added to the budget. Display
 * only: it reads what was billed and changes no money.
 */
export function posterTotalLine(job: PosterChargedJob): string | null {
  if (!hasChargeBreakdown(job)) return null;
  const parts: [number, string][] = [
    [num(job.budget), "job"],
    [num(job.customer_fee_amount), "service fee"],
    [num(job.urgent_fee), "urgent bonus"],
    [num(job.sales_tax_amount), "sales tax"],
    [num(job.onboarding_fee_amount), "one-time account setup"],
  ];
  const named = parts.filter(([n]) => n > 0).map(([n, w]) => `${usd(n)} ${w}`);
  return `Total ${usd(posterPaidDollars(job))} (${named.join(" + ")})`;
}
