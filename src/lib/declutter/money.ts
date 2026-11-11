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

/**
 * F236/F258 (audit 11-10): Help and the Terms name the buyer's fee from THESE numbers, the ones checkoutAmounts
 * charges, never a hand-typed copy. Owner 11-07: Declutter shows its fee (the 10-25 no-fee-words rule stays for Jobs).
 */
export const DECLUTTER_BUYER_FEE_PERCENT = Math.round(BUYER_FEE_RATE * 100);
export const DECLUTTER_BUYER_FEE_FIXED_CENTS = BUYER_FEE_FIXED_CENTS;
/** "5% of the item price plus 70 cents". */
export const DECLUTTER_BUYER_FEE_WORDS = `${DECLUTTER_BUYER_FEE_PERCENT}% of the item price plus ${
  DECLUTTER_BUYER_FEE_FIXED_CENTS < 100 ? `${DECLUTTER_BUYER_FEE_FIXED_CENTS} cents` : `$${(DECLUTTER_BUYER_FEE_FIXED_CENTS / 100).toFixed(2)}`
}`;

export function checkoutAmounts(itemPricesCents: number[]): { itemsCents: number; premiumCents: number; totalCents: number } {
  const itemsCents = itemPricesCents.reduce((a, b) => a + b, 0);
  // Postgres round() on numeric rounds half away from zero; Math.round agrees for positives.
  const premiumCents = Math.round(itemsCents * BUYER_FEE_RATE) + BUYER_FEE_FIXED_CENTS;
  return { itemsCents, premiumCents, totalCents: itemsCents + premiumCents };
}

/**
 * What Buy now on one item costs at checkout, in cents: the price plus the
 * buyer's fee, from checkoutAmounts (the same rule declutter_start_checkout
 * freezes). The Buy now button shows this, never the bare price (Cowork design
 * audit 2026-10-20, D6). Buying more from the same seller shares one 70c.
 */
export function buyNowTotalCents(priceCents: number): number {
  return checkoutAmounts([priceCents]).totalCents;
}

/** The lowest offer the server accepts (row 58): at least half the current price, in whole cents. */
export function minOfferCents(currentPriceCents: number): number {
  return Math.max(100, Math.ceil(currentPriceCents / 2));
}

/** The offer sheet's quick chips (owner 11-07, Vinted review): "10% off" and "20% off" the current price. */
export const OFFER_CHIP_PERCENTS = [10, 20] as const;

/**
 * What a "N% off" chip offers, in whole cents (rounded to the cent), or null when the server would refuse it: under
 * the lowest offer (minOfferCents) or not under the price. The server checks again (declutter_make_offer).
 */
export function offerChipCents(currentPriceCents: number, percentOff: number): number | null {
  const cents = Math.round((currentPriceCents * (100 - percentOff)) / 100);
  return cents >= minOfferCents(currentPriceCents) && cents < currentPriceCents ? cents : null;
}

/** Dollars as typed -> whole cents, or null. */
export function dollarsToCents(v: string): number | null {
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Cents -> dollars for an input ("38", "38.50"). */
export const centsToDollars = (c: number) => (c / 100).toFixed(2).replace(/\.00$/, "");

/** "$12.50" -> 1250; null for anything that is not a positive amount with at most 2 decimals. */
export function dollarsInputToCents(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return cents > 0 ? cents : null;
}
