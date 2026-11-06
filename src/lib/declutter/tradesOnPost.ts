/**
 * Declutter trades (owner 10-31): a NEW listing is "Open to trades" only when the seller's saved default says so
 * (declutter_seller_defaults.accepts_trades, Settings > Listing defaults; OFF unless turned on). A new item takes no
 * trades (declutter_items.accepts_trades DEFAULT false), so only ON is sent, once the listing is up.
 * Guard: src/test/declutterTradesClient.test.ts.
 */
import { fetchSellerDefaults } from "@/lib/declutter/sellerDefaults";
import { setTradeRules } from "@/lib/declutter/trades";

/** Turns trades on for `itemId` when the seller's default is on. Throws when that could not be saved. */
export async function tradesOnFromDefault(
  userId: string,
  itemId: string,
  deps: { defaults: typeof fetchSellerDefaults; set: typeof setTradeRules } = { defaults: fetchSellerDefaults, set: setTradeRules },
): Promise<"on" | "off"> {
  const saved = await deps.defaults(userId);
  if (saved?.acceptsTrades !== true) return "off";
  await deps.set(itemId, true);
  return "on";
}
