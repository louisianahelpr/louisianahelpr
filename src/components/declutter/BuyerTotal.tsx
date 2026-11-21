/**
 * What a Declutter buyer pays for one item with pickup, in exact cents: the checkout total
 * (buyNowTotalCents = checkoutAmounts, the rule declutter_start_checkout freezes). Owner 2026-11-20:
 * no one-time account setup fee rides a Declutter purchase any more (it was added here from
 * 2026-10-29, A1-B2). The ONE place a buyer-total figure is built in src/components
 * (src/test/declutterBuyNowShowsTotal.test.ts allows no bare buyNowTotalCents( elsewhere).
 */
import type { ReactNode } from "react";
import { formatPrice } from "@/lib/declutter/distance";
import { buyNowTotalCents } from "@/lib/declutter/money";

export function BuyerTotal({
  priceCents,
  suffix = "",
  className,
  addCents = 0,
}: {
  /** The item price (or offer) in cents, before the buyer fee. */
  priceCents: number;
  /** Words after the figure inside the same span, e.g. " total" (or a screen-reader-only span of them). */
  suffix?: ReactNode;
  className?: string;
  /**
   * Audit BUY-3: cents added on top of the checkout total, carrying no buyer fee of their own: the least a Helpr
   * delivery can cost (deliveryPriceCents at one road mile) on an item the seller
   * offers only delivered. 0 everywhere else.
   */
  addCents?: number;
}) {
  return <span data-buy-total="" className={className}>{formatPrice(buyNowTotalCents(priceCents) + addCents)}{suffix}</span>;
}
