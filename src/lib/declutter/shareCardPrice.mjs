/**
 * The buyer's price for a Declutter item's link preview (api/share.ts), owner's UI audit 11-09, F076: the preview said
 * "$15" (the seller's price) while the site shows buyers "$16.45 incl. fee" (owner 11-07: Declutter shows the fee).
 *
 * Plain dependency-free ESM, like browseShellCards.mjs: the serverless function imports it with no TypeScript step.
 * The rule is src/lib/declutter/money.ts's buyNowTotalCents (the one declutter_start_checkout freezes: price + 5% +
 * 70 cents, rounded half away from zero); src/test/declutterShareCard.test.ts holds the two equal for every price
 * from 1 cent to $1,000, so this copy can never drift from what checkout charges.
 */

/** What Buy now on one item costs at checkout, in cents (money.ts buyNowTotalCents). */
export function shareCardBuyNowCents(priceCents) {
  return priceCents + Math.round(priceCents * 0.05) + 70;
}

/** "Free" for $0, else the buyer's price with cents ("$16.45"), as the item page's "incl. fee" line shows it. */
export function shareCardPriceLabel(priceCents) {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return "Free";
  return `$${(shareCardBuyNowCents(priceCents) / 100).toFixed(2)}`;
}
