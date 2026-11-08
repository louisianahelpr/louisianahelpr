/**
 * Declutter trades (owner 10-31; posting row owner 11-08): a NEW priced listing is "Open to trades" when the seller
 * left the posting screen's "Open to trades?" row on. That row starts from the seller's saved default
 * (declutter_seller_defaults.accepts_trades, Settings > Listing defaults; OFF unless turned on). A new item takes no
 * trades (declutter_items.accepts_trades DEFAULT false), so only ON is sent, once the listing is up.
 * Guard: src/test/declutterTradesClient.test.tsx.
 */
import { setTradeRules } from "@/lib/declutter/trades";

/** Turns trades on for `itemId` when the seller chose it. Throws when that could not be saved. */
export async function tradesOnIfChosen(itemId: string, wanted: boolean, set: typeof setTradeRules = setTradeRules): Promise<"on" | "off"> {
  if (!wanted) return "off";
  await set(itemId, true);
  return "on";
}
