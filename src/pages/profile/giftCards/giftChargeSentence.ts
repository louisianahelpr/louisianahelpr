import { formatPriceExact } from "@/lib/format";

/**
 * The one sentence that tells a gift-card donor what their card will be
 * charged. `totalCents` is face value + the card-cost fee, the same
 * `unit_amount` `create-gift-card-checkout` sends to Stripe.
 *
 * Dollars AND cents (A3-B2, audit 2026-10-29): this used `formatPrice`, which
 * rounds to whole dollars for display, so a $25 gift read "You'll be charged
 * $26 in total" and Stripe Checkout then charged $26.06. Copy that names what
 * the card is charged must match it to the cent. Only the total is stated,
 * never a fee breakdown (owner rule: members see no fee numbers except the $2
 * setup fee).
 */
export function giftChargeSentence(totalCents: number | null): string {
  if (totalCents == null) return "Your total is shown before you pay.";
  return `You'll be charged $${formatPriceExact(totalCents / 100)} in total.`;
}
