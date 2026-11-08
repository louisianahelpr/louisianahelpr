/**
 * The small "$X.XX incl. fee" line under a Declutter item's price (owner 11-07 ~5:10 PM, Vinted review: cards and
 * the item page show "$3.00" with "$3.85 incl. fee"; Declutter only). The figure is buyNowTotalCents
 * (checkoutAmounts, the rule declutter_start_checkout freezes), so it always equals what checkout charges for this
 * one item with free pickup.
 *
 * - Nothing for a free item: its price already says "Free".
 * - The one-time account setup fee is left out on purpose (lead 11-07): it is per account, not per item; the
 *   checkout summary and the Buy now button (BuyerTotal) show it.
 * - No "plus tax": every Declutter line is untaxed today (declutter-checkout refuses an order with tax_cents != 0).
 *
 * Its own file, importing only the money rule, so the landing page's Declutter strip and the Browse grid pay for
 * no account hooks (BuyerTotal reads the viewer's setup fee). Guard: src/test/declutterPriceInclFee.test.ts.
 */
import { buyNowTotalCents } from "@/lib/declutter/money";

const INCL_FEE_WORDS = "incl. fee";

/** Exact cents, always two decimals ("$3.85", "$21.70"). */
function exactDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PriceInclFee({
  priceCents,
  className = "block text-ds-12 font-medium leading-snug tabular-nums text-muted-foreground",
  wordsClassName,
}: {
  /** The item's current price in cents, before the fee. */
  priceCents: number;
  className?: string;
  /** Owner pick 2 (11-08): where the incl. price is the loud one, "incl. fee" is its own small label (primary colour). */
  wordsClassName?: string;
}) {
  if (!(priceCents > 0)) return null;
  return (
    <span data-price-incl-fee="" className={className}>
      {exactDollars(buyNowTotalCents(priceCents))}{" "}
      {wordsClassName ? <span data-incl-fee-words="" className={wordsClassName}>{INCL_FEE_WORDS}</span> : INCL_FEE_WORDS}
    </span>
  );
}
