import { formatPriceExact } from "@/lib/format";

/**
 * A Repeats job's money words, written once for Post a job's Review (CheckoutBudgetLine) and the poster's posted
 * card (PostedJobSeriesControls), A2-C36 (audit 2026-10-29). The posted job's budget is per visit; the first visit
 * is the post's own payment and every later one is charged to the saved card by charge-recurring-visits
 * FUND_LEAD_DAYS = 3 days ahead. Never "charged now": under card_hold_at_post (on for everyone, 20261027185147) a
 * card is only held at posting and charged at the hire.
 */
const SERIES_LATER_VISITS_CHARGED = "each later visit is charged to your saved card about 3 days before it";

/**
 * JOBS-28 (Jobs audit 10-30): a taxable category's later visits are charged their Louisiana sales tax too
 * (charge-recurring-visits runs the same Stripe tax calculation for each visit when isLaborTaxable), and the line
 * said nothing about it. Untaxed categories keep the plain words.
 */
const SERIES_LATER_VISITS_CHARGED_TAXED = "each later visit, plus its sales tax, is charged to your saved card about 3 days before it";

/** The later-visits clause for this job: with "plus its sales tax" only when the category's labor is taxed. */
export function seriesLaterVisitsCharged(taxable: boolean): string {
  return taxable ? SERIES_LATER_VISITS_CHARGED_TAXED : SERIES_LATER_VISITS_CHARGED;
}

/** "a visit · 4 visits": what follows the per-visit amount. */
export function seriesVisitsSuffix(visitCount: number): string {
  return ` a visit · ${visitCount} visit${visitCount === 1 ? "" : "s"}`;
}

/** "$40 a visit · 4 visits. Each later visit is charged to your saved card about 3 days before it." */
export function seriesMoneySentence(budget: number, visitCount: number, taxable = false): string {
  const later = seriesLaterVisitsCharged(taxable);
  return `$${formatPriceExact(budget)}${seriesVisitsSuffix(visitCount)}. ${later.charAt(0).toUpperCase()}${later.slice(1)}.`;
}
