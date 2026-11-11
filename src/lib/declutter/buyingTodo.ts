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
