/**
 * What a Declutter buyer pays for one item with pickup, in exact cents: the checkout total
 * (buyNowTotalCents = checkoutAmounts, the rule declutter_start_checkout freezes) PLUS the
 * one-time account setup fee a first purchase carries (useFirstPayoutFeeCents; checkout's
 * payCents adds the same hook's answer and declutter-checkout charges total_cents +
 * setup_fee_cents). A1-B2 (Declutter audit, prod 2026-10-29): the item page said $32.20 while
 * Stripe charged $34.20.
 *
 * Until that answer is in (useFirstPayoutFeeKnown), it adds "+ any one-time setup fee" rather
 * than show a figure $2 low. The ONE place a buyer-total figure is built in src/components
 * (src/test/declutterBuyNowShowsTotal.test.ts allows no bare buyNowTotalCents( elsewhere).
 */
import { useFirstPayoutFeeCents, useFirstPayoutFeeKnown } from "@/hooks/useFirstPayoutFee";
import { formatPrice } from "@/lib/declutter/distance";
import { buyNowTotalCents } from "@/lib/declutter/money";

export const SETUP_FEE_PENDING_WORDS = "+ any one-time setup fee";

export function BuyerTotal({
  priceCents,
  suffix = "",
  className,
  pendingClassName = "block text-ds-12 font-medium text-muted-foreground",
}: {
  /** The item price (or offer) in cents, before the buyer fee. */
  priceCents: number;
  /** Words after the figure inside the same span, e.g. " total". */
  suffix?: string;
  className?: string;
  pendingClassName?: string;
}) {
  const setupFeeCents = useFirstPayoutFeeCents();
  const setupFeeKnown = useFirstPayoutFeeKnown();
  return (
    <>
      <span data-buy-total="" className={className}>{formatPrice(buyNowTotalCents(priceCents) + setupFeeCents)}{suffix}</span>
      {!setupFeeKnown && " "}
      {!setupFeeKnown && <span data-buy-setup-fee-pending="" className={pendingClassName}>{SETUP_FEE_PENDING_WORDS}</span>}
    </>
  );
}
