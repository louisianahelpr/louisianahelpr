/**
 * The checkout's price summary (owner 11-07, item 2 of the Vinted-inspired buyer money changes): every line the
 * buyer pays for, each with a small info tip, then the Total. Lines: the item(s), a bundle discount, the service fee
 * (owner 11-07 ~5:10 PM: Declutter shows its fee like Vinted, named "Service fee", replacing the 10-25 no-fee-words
 * rule for Declutter only), how they get it (pickup is Free), a one-time setup fee, and sales tax. Every figure comes
 * from PayForSeller, which computes the total exactly as declutter_start_checkout and declutter-checkout charge it;
 * the service fee is the total less every other line, so the lines always add up to the Total.
 *
 * Kept apart from DeclutterTradeViews (the component-size ratchet). Guard: src/test/declutterCheckoutSummary.test.tsx.
 */
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPrice } from "@/lib/declutter/distance";
import type { Handover } from "@/lib/declutter/api";

/** Exact cents with two decimals, as a receipt prints them ("$0.85", "$12.00"). */
const exact = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The words each info tip holds, in the buyer's words. */
export const SUMMARY_TIPS = {
  items: "What the seller asked. The seller keeps all of it.",
  discount: "The seller's bundle discount for buying more than one item.",
  // Audit 11-10 F354: how the fee is worked out, as declutter_start_checkout charges it (declutter_buyer_fee_cents:
  // 5% of the items after any bundle discount, plus 70c; the seller's delivery rate or the shipping counts too).
  serviceFee: "$0.70 plus 5% of the items, once per checkout, however many items you buy from this seller. It pays for card processing and keeps Declutter running. The seller gets the full item price.",
  serviceFeeSellerDelivery: "$0.70 plus 5% of the items and the seller's delivery, once per checkout. It pays for card processing and keeps Declutter running. The seller gets the full item price.",
  serviceFeeShip: "$0.70 plus 5% of the items and the shipping, once per checkout. It pays for card processing and keeps Declutter running. The seller gets the full item price.",
  pickup: "Picking it up yourself is always free.",
  delivery: "A local Helpr picks it up and brings it to you. The price is set by road miles and size. If no Helpr takes it within 48 hours, what you paid for delivery comes back.",
  sellerDelivery: "The seller brings it to you at the time you picked.",
  ship: "The postage for the carrier you picked.",
  setupFee: "Charged once per account, on your first purchase.",
  tax: "No sales tax is charged on Declutter items.",
  gift: "Your gift card pays first. Anything left on it stays yours.",
} as const;

/** A small (i) that opens one sentence about a line. A 44 px tap, drawn small. */
function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="iconCompact" aria-label={`About ${label}`} data-summary-tip={label}
          className="-my-3 -ml-1.5 text-muted-foreground [&_svg]:size-3.5">
          <Info aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={`About ${label}`} className="w-72 text-ds-13 leading-relaxed text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function Line({ label, tip, value, data }: { label: string; tip: string; value: ReactNode; data: string }) {
  return (
    <div className="flex items-center justify-between gap-3" data-summary-line={data}>
      <dt className="flex min-w-0 items-center gap-0.5">
        <span>{label}</span>
        <InfoTip label={label}>{tip}</InfoTip>
      </dt>
      <dd className="shrink-0 font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

const PICKUP_WAYS: Handover[] = ["porch", "pickup_home", "meetup"];

export function CheckoutPriceSummary({
  itemCount, itemsCents, discountCents, way, wayCents, serviceFeeCents, setupFeeCents, setupFeeKnown, taxCents, payCents, gift = null,
}: {
  itemCount: number;
  itemsCents: number;
  discountCents: number;
  /** The way chosen; undefined when none is open (no line then). */
  way: Handover | undefined;
  /** What that way costs: 0 for a pickup or a free seller delivery, null while a delivery or postage is not priced yet. */
  wayCents: number | null;
  serviceFeeCents: number;
  setupFeeCents: number;
  setupFeeKnown: boolean;
  taxCents: number;
  payCents: number;
  /**
   * The lead's money review (11-07): a picked gift card (giftSplit, only once the total is whole): a "Gift card" line
   * takes its part off, and "Pay by card" ends the summary with what goes on the card (the Pay button's figure).
   */
  gift?: { fromGiftCents: number; onCardCents: number } | null;
}) {
  const pickup = way !== undefined && PICKUP_WAYS.includes(way);
  const wayTip = !way ? "" : pickup ? SUMMARY_TIPS.pickup : way === "delivery" ? SUMMARY_TIPS.delivery : way === "ship" ? SUMMARY_TIPS.ship : SUMMARY_TIPS.sellerDelivery;
  const unpriced = way !== undefined && !pickup && wayCents === null;
  return (
    <dl className="space-y-2.5" data-checkout-price-summary="">
      <Line data="items" label={itemCount > 1 ? `${itemCount} items` : "Item"} tip={SUMMARY_TIPS.items} value={exact(itemsCents)} />
      {discountCents > 0 && <Line data="discount" label="Bundle discount" tip={SUMMARY_TIPS.discount} value={`−${exact(discountCents)}`} />}
      <Line data="service-fee" label="Service fee" value={exact(serviceFeeCents)}
        tip={way === "seller_delivery" ? SUMMARY_TIPS.serviceFeeSellerDelivery : way === "ship" ? SUMMARY_TIPS.serviceFeeShip : SUMMARY_TIPS.serviceFee} />
      {/* A delivery or postage not priced yet has no line: the Total says "+ delivery" until it is. */}
      {way && !unpriced && (
        <Line data="way" label={pickup ? "Pickup" : way === "delivery" ? "Helpr delivery" : way === "ship" ? "Shipping" : "Seller delivery"} tip={wayTip}
          value={wayCents === 0 || pickup ? <span className="font-bold text-primary" data-summary-free="">Free</span> : exact(wayCents as number)} />
      )}
      {setupFeeCents > 0 && <Line data="setup-fee" label="One-time setup fee" tip={SUMMARY_TIPS.setupFee} value={exact(setupFeeCents)} />}
      <Line data="tax" label="Sales tax" tip={SUMMARY_TIPS.tax} value={exact(taxCents)} />
      <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5" data-summary-line="total">
        <dt className="text-ds-16 font-bold text-foreground">Total</dt>
        <dd className="text-right text-ds-24 font-bold tabular-nums text-foreground">
          {formatPrice(payCents)}
          {/* Delivery chosen but not priced yet: the total is not complete, so say so (money review #4). */}
          {unpriced && <span className="ml-1 text-ds-14 font-semibold text-muted-foreground">{way === "ship" ? "+ shipping" : "+ delivery"}</span>}
          {!setupFeeKnown && <span className="ml-1 text-ds-14 font-semibold text-muted-foreground" data-setup-fee-pending="">+ any setup fee</span>}
        </dd>
      </div>
      {gift && gift.fromGiftCents > 0 && (
        <>
          <Line data="gift" label="Gift card" tip={SUMMARY_TIPS.gift} value={`−${exact(gift.fromGiftCents)}`} />
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5" data-summary-line="pay-by-card">
            <dt className="text-ds-16 font-bold text-foreground">Pay by card</dt>
            <dd className="text-right text-ds-24 font-bold tabular-nums text-foreground">{exact(gift.onCardCents)}</dd>
          </div>
        </>
      )}
    </dl>
  );
}
