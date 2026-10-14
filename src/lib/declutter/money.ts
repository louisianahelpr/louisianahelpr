/**
 * Declutter checkout amounts (rows 20-22, 38), the same rule the server
 * freezes in declutter_start_checkout and the declutter_orders_premium_rule
 * constraint enforces: the seller keeps every cent of the item prices; the
 * buyer adds a 15% buyer's premium, at least $1 once per checkout; the card
 * fee comes out of the premium (the buyer sees one number); no tax on a
 * casual seller's sale (row 54). The server's numbers are the ones charged;
 * this is the preview the cart shows before checkout starts.
 */
const BUYER_PREMIUM_RATE = 0.15;
const MIN_PREMIUM_CENTS = 100;

export function checkoutAmounts(itemPricesCents: number[]): { itemsCents: number; premiumCents: number; totalCents: number } {
  const itemsCents = itemPricesCents.reduce((a, b) => a + b, 0);
  // Postgres round() on numeric rounds half away from zero; Math.round agrees for positives.
  const premiumCents = Math.max(Math.round(itemsCents * BUYER_PREMIUM_RATE), MIN_PREMIUM_CENTS);
  return { itemsCents, premiumCents, totalCents: itemsCents + premiumCents };
}

/** The lowest offer the server accepts (row 58): at least half the current price, in whole cents. */
export function minOfferCents(currentPriceCents: number): number {
  return Math.max(100, Math.ceil(currentPriceCents / 2));
}
