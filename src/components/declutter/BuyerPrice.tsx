/**
 * The ONE price a Declutter buyer sees for an item (owner 11-27-2026 ~5:20 PM, polish audit #2: "One price, fee
 * included"): the one-item checkout total with the buyer fee already in it ("$26.95" for a $25 item), and no second
 * "$25 / $26.95 incl. fee" line. Cards, similar items, seller tiles, offer tiles, the map card, the landing grid and
 * the item page show only this figure; checkout still itemizes price and fee.
 *
 * It replaces the 11-07 "$X.XX incl. fee" line (PriceInclFee). The figure is buyNowTotalCents (checkoutAmounts, the
 * rule declutter_start_checkout freezes), so it always equals what checkout charges for this one item with free
 * pickup. Display only: no amount charged changes.
 *
 * - A free item says "Free" (no fee rides a $0 line).
 * - The one-time account setup fee is left out on purpose (lead 11-07; owner 11-20: no Declutter purchase carries it).
 * - No "plus tax": every Declutter line is untaxed today (declutter-checkout refuses an order with tax_cents != 0).
 *
 * Its own file, importing only the money rule, so the landing page's Declutter strip and the Browse grid pay for no
 * account hooks. Guard: src/test/declutterOnePriceFeeIncluded.test.tsx.
 */
import { buyNowTotalCents } from "@/lib/declutter/money";

/** Exact cents, always two decimals ("$3.85", "$21.70"). */
function exactDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "$14.88": the one-item checkout total (no setup fee, see above) as exact dollars. Built here so src/components keeps
 *  one buyNowTotalCents( caller per figure family (guard: src/test/declutterBuyNowShowsTotal.test.ts). */
export function oneItemTotalDollars(priceCents: number): string {
  return exactDollars(buyNowTotalCents(priceCents));
}

/** The buyer's one price for an item: "$26.95" (fee included), or `free` ("Free", or the reader's word for it) at $0. */
export function buyerPriceLabel(priceCents: number, free = "Free"): string {
  return priceCents > 0 ? oneItemTotalDollars(priceCents) : free;
}
