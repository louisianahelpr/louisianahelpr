/**
 * Declutter item-page panels in English (F260q, owner 11-11 "Spanish everything"): deadlines ("19 hours left"), the
 * price-drop banner, the fair-price hint, Helpr delivery's price list and the trade offer. Importing this file
 * registers them with t() (enRegistry.ts). Spanish: esDeclPanels.ts. "Declutter" and "Helpr" stay as they are.
 */
import { addEnglish } from "./enRegistry";

export const enDeclPanels = {
  "dp.timeUp": "time is up",
  "dp.daysLeft": "{n} days left",
  "dp.hourLeft": "1 hour left",
  "dp.hoursLeft": "{n} hours left",
  "dp.minuteLeft": "1 minute left",
  "dp.minutesLeft": "{n} minutes left",
  "dp.byTime": "by {time}",

  "dp.dropThisEvening": "this evening at {time}",
  "dp.dropTomorrow": "tomorrow at {time}",
  "dp.dropDay": "{day} at {time}",
  "dp.nextDrop": "Next possible drop: {price}, {when}",
  "dp.dropRuleMine": "Each evening it can drop {pct}%, rounded down to a whole dollar. It never goes below your lowest price, and may stop sooner.",
  "dp.dropRule": "Each evening it can drop {pct}%, rounded down to a whole dollar, until it reaches a price the seller chose.",

  "dp.hintAria": "Recent sale prices",
  "dp.hintNearYou": "Most items like this sold for {range} near you",
  "dp.hintInArea": "Most items like this sold for {range} in this area",
  "dp.hintBasis": "Based on {n}+ Declutter sales of items in the same category and condition, within about 25 miles, in the last year.",

  "dp.sizeSmall": "Small or medium",
  "dp.sizeLarge": "Large",
  "dp.sizeXl": "Extra large",
  "dp.perMile": "{base} + {mile} a mile",
  "dp.aboutMile": "About 1 mile · {price}",
  "dp.aboutMiles": "About {n} miles · {price}",

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

addEnglish(enDeclPanels);
