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
  // Trades audit 11-08 #2: a trade is not a claim. All trades: "Trades"; trades and claims together: "To pick up".
  const trades = waiting.filter((l) => l.source === "swap").length;
  if (claimsOnly && trades > 0) return { title: trades === waiting.length ? "Trades" : "To pick up", todoWords: "to choose a pickup" };
  return claimsOnly ? { title: "Claimed", todoWords: "to choose a pickup" } : { title: "Your cart", todoWords: "to check out" };
}

/** Trades audit 11-08 #2: a trade line's price reads "Trade", never "Free". */
export const isTradeLine = (l: Pick<CartLine, "source">): boolean => l.source === "swap";

/** One seller's card: its heading, and (2+ items) what the items share. */
function checkoutCardWords(allFree: boolean, count: number, trade: boolean): { heading: string; shared: string } {
  if (trade) {
    return { heading: count > 1 ? `Your trade: choose how you'll get these ${count}` : "Your trade: choose how you'll get it", shared: "From the person you traded with: one pickup. No money changes hands." };
  }
  if (allFree) {
    return { heading: count > 1 ? `Choose how you'll get these ${count}` : "Choose how you'll get it", shared: "From the same giver: one pickup." };
  }
  return { heading: count > 1 ? `One checkout for ${count} items` : "Checkout", shared: "From the same seller: one pickup, one payment." };
}

/** The heading of one seller's card in the cart, and (2+ items) the line saying what they share. */
export function CheckoutCardHead({ allFree, count, trade = false }: { allFree: boolean; count: number; trade?: boolean }) {
  const w = checkoutCardWords(allFree, count, trade);
  return (
    <>
      <h3 className="text-base font-semibold">{w.heading}</h3>
      {(count > 1 || trade) && <p className="text-ds-13 text-muted-foreground">{w.shared}</p>}
    </>
  );
}
