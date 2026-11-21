/**
 * The price on a Declutter item's link preview (api/share.ts og:title and product:price:amount).
 *
 * Owner 11-20 (site polish E, reverses the 11-09 F076 rule): the preview shows the SELLER's price ("$85"), not the
 * buyer's fee-inclusive total ("$89.95"). The item page still shows buyers the fee-inclusive line.
 *
 * Plain dependency-free ESM, like browseShellCards.mjs: the serverless function imports it with no TypeScript step.
 * Guard: src/test/declutterShareCard.test.ts.
 */

/** "Free" for $0, whole dollars without cents ("$85"), else dollars and cents ("$12.50"). */
export function shareCardPriceLabel(priceCents) {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return "Free";
  return priceCents % 100 === 0 ? `$${priceCents / 100}` : `$${(priceCents / 100).toFixed(2)}`;
}

/** The seller's price as product:price:amount wants it ("85.00"); null for a free item (no price to state). */
export function shareCardPriceAmount(priceCents) {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return null;
  return (priceCents / 100).toFixed(2);
}
