import type { CartLine } from "@/lib/declutter/api";

/**
 * Owner 11-11 (F363, option b): a Declutter to-do on the Home list is the BUYER's when it opens the Buying tab; every
 * other one (a sale, a free item to pick) is the seller's or giver's. ONE rule for the badges (NeedsYouBridge) and the
 * Buying tab's Needs you group (useBuyingTracker, via declutterBuyingTodos), so the chip, its cards and the badge
 * agree. Its own leaf module: NeedsYouBridge runs on every signed-in page and must not pull needsYouTodos' derivation
 * code with it (B51, src/test/homeDeriveLoadsBesideData.test.ts).
 */
export function isDeclutterBuyingTodo(t: { section: string; to: string }): boolean {
  return t.section === "declutter" && t.to.includes("tab=buying");
}

/**
 * F363 side effect (b) (owner 11-11): the purchases whose open problems are read for the Needs you rows, sorted, so Home
 * (useNeedsYouTodos) and the Buying tab (BuyingOrders) ask the same ids under the same key and one read serves both.
 * A purchase that ended (cancelled, refunded) is not asked about.
 */
export function buyerProblemOrderIds(cart: readonly Pick<CartLine, "my_side" | "order_id" | "order_status">[]): string[] {
  const ids = new Set<string>();
  for (const l of cart) {
    if (l.my_side === "buyer" && l.order_id && (l.order_status === "paid" || l.order_status === "handed_over")) ids.add(l.order_id);
  }
  return [...ids].sort();
}
