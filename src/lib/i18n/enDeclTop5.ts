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
} as const;

addEnglish(enDeclTop5);
