/**
 * Declutter top 5 (owner 11-19, "Do all 5"), in English (dt5.*): the offer to savers, the Selling home, the "in demand"
 * lines, the shop-wide sale, bulk actions and away mode. Importing this file registers them with t() (enRegistry.ts).
 * Spanish: esDeclTop5.ts.
 */
import { addEnglish } from "./enRegistry";

export const enDeclTop5 = {
  // #1 Offer to savers (20261120010630).
  "dt5.so.saved1": "1 person saved this.",
  "dt5.so.savedN": "{n} people saved this.",
  "dt5.so.send": "Send them an offer",
  "dt5.so.sent1": "Offer sent to 1 person. You can send another tomorrow.",
  "dt5.so.sentN": "Offer sent to {n} people. You can send another tomorrow.",
  "dt5.so.title": "Send an offer to everyone who saved \"{title}\"",
  "dt5.so.body": "Each person gets a private offer in their Offers, with 48 hours to accept. Nothing changes on your listing.",
  "dt5.so.theySee": "They see {price} (was {was}).",
  "dt5.so.pctOff": "{pct}% off",
  "dt5.so.confirm": "Send offer",
  "dt5.so.toast1": "Offer sent to 1 person.",
  "dt5.so.toastN": "Offer sent to {n} people.",
  "dt5.so.cardTag": "The seller's offer",
  "dt5.so.cardWhy": "You saved this, so the seller sent you a lower price.",
  // #2 Selling home (20261120012050).
  "dt5.home.title": "Your week",
  "dt5.home.todo": "To do",
  "dt5.home.offers1": "Answer 1 offer",
  "dt5.home.offersN": "Answer {n} offers",
  "dt5.home.handover1": "Hand over 1 sale",
  "dt5.home.handoverN": "Hand over {n} sales",
  "dt5.home.relist1": "1 paused listing to put back up",
  "dt5.home.relistN": "{n} paused listings to put back up",
  "dt5.home.drops1": "1 listing hasn't sold in 2 weeks: try a lower price",
  "dt5.home.dropsN": "{n} listings haven't sold in 2 weeks: try a lower price",
  "dt5.home.savers1": "1 saved listing: send its savers an offer",
  "dt5.home.saversN": "{n} saved listings: send their savers an offer",
  "dt5.home.allDone": "Nothing waiting on you.",
  "dt5.home.sales": "Sales",
  "dt5.home.earnings": "Earned",
  "dt5.home.views": "Views",
  "dt5.home.saves": "Saves",
  "dt5.home.up": "Up {pct}% on last week",
  "dt5.home.down": "Down {pct}% on last week",
  "dt5.home.same": "Same as last week",
  "dt5.home.new": "None last week",
  "dt5.home.window": "Last 7 days, next to the 7 before.",
  "dt5.home.worth1": "1 item for sale, worth {amount} if it sells.",
  "dt5.home.worthN": "{n} items for sale, worth {amount} if they all sell.",
  // #4 Shop-wide sale (20261120014036).
  "dt5.sale.title": "Shop sale",
  "dt5.sale.none": "Take a percent off everything you have for sale, for a few days. Prices go back by themselves.",
  "dt5.sale.start": "Start a sale",
  "dt5.sale.on": "{pct}% off everything until {when}.",
  "dt5.sale.scheduled": "{pct}% off everything from {from} until {when}.",
  "dt5.sale.end": "End sale",
  "dt5.sale.cancel": "Cancel sale",
  "dt5.sale.sheetTitle": "Put everything on sale",
  "dt5.sale.sheetBody": "Every listing for sale gets this much off, never below your lowest price. Buyers see the old price crossed out. When the sale ends, prices go back.",
  "dt5.sale.pctOff": "{pct}% off",
  "dt5.sale.starts": "Starts",
  "dt5.sale.today": "Now",
  "dt5.sale.tomorrow": "Tomorrow",
  "dt5.sale.through": "Runs through",
  "dt5.sale.days": "{n} days",
  "dt5.sale.confirm": "Start sale",
  "dt5.sale.started": "Your sale is on.",
  "dt5.sale.set": "Your sale is set.",
  "dt5.sale.ended": "Sale ended. Prices are back.",
  "dt5.sale.cancelled": "Sale cancelled.",
} as const;

addEnglish(enDeclTop5);
