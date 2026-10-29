import { formatPriceExact } from "@/lib/format";

/**
 * A Repeats job's money words, written once for Post a job's Review (CheckoutBudgetLine) and the poster's posted
 * card (PostedJobSeriesControls), A2-C36 (audit 2026-10-29). The posted job's budget is per visit; the first visit
 * is the post's own payment and every later one is charged to the saved card by charge-recurring-visits
 * FUND_LEAD_DAYS = 3 days ahead. Never "charged now": under card_hold_at_post (on for everyone, 20261027185147) a
 * card is only held at posting and charged at the hire.
 */
export const SERIES_LATER_VISITS_CHARGED = "each later visit is charged to your saved card about 3 days before it";

/** "a visit · 4 visits": what follows the per-visit amount. */
export function seriesVisitsSuffix(visitCount: number): string {
  return ` a visit · ${visitCount} visit${visitCount === 1 ? "" : "s"}`;
}

/** "$40 a visit · 4 visits. Each later visit is charged to your saved card about 3 days before it." */
export function seriesMoneySentence(budget: number, visitCount: number): string {
  const later = SERIES_LATER_VISITS_CHARGED;
  return `$${formatPriceExact(budget)}${seriesVisitsSuffix(visitCount)}. ${later.charAt(0).toUpperCase()}${later.slice(1)}.`;
}
