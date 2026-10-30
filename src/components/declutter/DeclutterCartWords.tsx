/**
 * DA-4 (Declutter audit 2026-10-30): a free claim is not a purchase. The claimer's Buying tab read "Your cart · 1 to
 * check out" over a "Checkout" card for a free item nobody pays for. These are the words CartView uses: give-away
 * words when the lines are all free, the cart words otherwise. A line is free when its price is 0 (a CHECK keeps a
 * free listing's price and current price at 0 together; the cart line copies it).
 */
import type { CartLine } from "@/lib/declutter/api";

/** The cart section's title and its count words: "Claimed · 1 to choose a pickup" when every waiting line is free. */
export function cartSectionWords(waiting: CartLine[]): { title: string; todoWords: string } {
  const claimsOnly = waiting.length > 0 && waiting.every((l) => l.price_cents === 0);
  return claimsOnly ? { title: "Claimed", todoWords: "to choose a pickup" } : { title: "Your cart", todoWords: "to check out" };
}

/** One seller's card: its heading, and (2+ items) what the items share. */
function checkoutCardWords(allFree: boolean, count: number): { heading: string; shared: string } {
  if (allFree) {
    return { heading: count > 1 ? `Choose how you'll get these ${count}` : "Choose how you'll get it", shared: "From the same giver: one pickup." };
  }
  return { heading: count > 1 ? `One checkout for ${count} items` : "Checkout", shared: "From the same seller: one pickup, one payment." };
}

/** The heading of one seller's card in the cart, and (2+ items) the line saying what they share. */
export function CheckoutCardHead({ allFree, count }: { allFree: boolean; count: number }) {
  const w = checkoutCardWords(allFree, count);
  return (
    <>
      <h3 className="text-base font-semibold">{w.heading}</h3>
      {count > 1 && <p className="text-ds-13 text-muted-foreground">{w.shared}</p>}
    </>
  );
}
