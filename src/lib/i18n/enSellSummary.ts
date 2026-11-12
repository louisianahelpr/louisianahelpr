/**
 * The words of the Sell form's summary card (sell.*), in English (F260q). Their own file, not enDeclPanels.ts: the item page's first load and Selling
 * show none of them (Q178, Builder 2 11-11). Importing this file registers them with t() (enRegistry.ts).
 * Spanish: esDeclPanels.ts.
 */
import { addEnglish } from "./enRegistry";

export const enSellSummary = {
  "sell.yourListing": "Your listing",
  "sell.writing": "We're writing it from your photos.",
  "sell.wrote": "We wrote this from your photos. Change anything.",
  "sell.addPhotos": "Add photos and we'll write it for you, or fill it in yourself.",
  "sell.filling": "We're filling this in…",
  "sell.done": "Done",
  "sell.add": "Add",
  "sell.edit": "Edit",
  "sell.title": "Title",
  "sell.titlePlaceholder": "e.g. Oak rocking chair",
  "sell.limit": " · That's the limit.",
  "sell.price": "Price",
  "sell.free": "Free",
  "sell.chargeForIt": "Charge for it",
  "sell.category": "Category",
  "sell.condition": "Condition",
  "sell.size": "Size",
  "sell.details": "Details",
  "sell.anythingElse": "Anything else?",
  "sell.optional": "(optional)",
  "sell.detailsPlaceholder": "e.g. Works great. Small scuff on the base.",
} as const;

addEnglish(enSellSummary);
