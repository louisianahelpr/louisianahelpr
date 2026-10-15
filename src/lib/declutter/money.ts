/**
 * Declutter checkout amounts, the same rule the server freezes in
 * declutter_start_checkout (declutter_buyer_fee_cents) and the
 * declutter_orders_premium_rule constraint enforces. Owner decision F1
 * (docs/specs/louisiana-hub-roadmap.md, 2026-10-14) replaced rows 20-21: the
 * buyer's fee is 5% of the item total + 70 cents, once per seller checkout
 * (row 38), and the card cost comes out of it (the buyer sees one number). The
 * seller keeps every cent of the item prices (row 22); no tax on a casual
 * seller's sale (row 54). The server's numbers are the ones charged; this is the
 * preview the cart shows before checkout starts.
 */
const BUYER_FEE_RATE = 0.05;
const BUYER_FEE_FIXED_CENTS = 70;

export function checkoutAmounts(itemPricesCents: number[]): { itemsCents: number; premiumCents: number; totalCents: number } {
  const itemsCents = itemPricesCents.reduce((a, b) => a + b, 0);
  // Postgres round() on numeric rounds half away from zero; Math.round agrees for positives.
  const premiumCents = Math.round(itemsCents * BUYER_FEE_RATE) + BUYER_FEE_FIXED_CENTS;
  return { itemsCents, premiumCents, totalCents: itemsCents + premiumCents };
}

/** The lowest offer the server accepts (row 58): at least half the current price, in whole cents. */
export function minOfferCents(currentPriceCents: number): number {
  return Math.max(100, Math.ceil(currentPriceCents / 2));
}
