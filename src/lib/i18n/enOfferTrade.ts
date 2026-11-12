/**
 * The words of the item page's trade offer panel, in English (F260q). Their own file, not enDeclPanels.ts: the item page's first load and Selling
 * show none of them (Q178, Builder 2 11-11). Importing this file registers them with t() (enRegistry.ts).
 * Spanish: esDeclPanels.ts.
 */
import { addEnglish } from "./enRegistry";

export const enOfferTrade = {

  "dp.tradeSent": "Trade offer sent. The seller has 48 hours to answer.",
  "dp.youOffered": "You offered your {title} in trade",
  "dp.yourListing": "listing",
  "dp.waitingSeller": "Waiting on the seller.",
  "dp.seeInBuying": "See it in Buying",
  "dp.offerTrade": "Offer a trade",
  "dp.tradeWhat": "Swap one of your listings for this. No money changes hands, and each of you picks up the other's item.",
  "dp.tradePick": "Pick one of your listings to trade for \"{title}\". No money changes hands. The seller has 48 hours to answer.",
  "dp.loadingListings": "Loading your listings…",
  "dp.noListings": "You have no listings up to trade.",
  "dp.listAnItem": "List an item",
  "dp.first": "first.",
  "dp.tradeListLabel": "Your listing to trade",
  "dp.cancel": "Cancel",
  "dp.sending": "Sending…",
  "dp.sendTrade": "Send trade offer",
} as const;

addEnglish(enOfferTrade);
