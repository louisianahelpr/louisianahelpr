/**
 * "Your page" (the member's own profile link card) in English (F260q): YourPageLink.tsx, shown on Home, You and
 * Selling. One panel's words, imported by that panel only, so they are inlined into its chunk (Q178), whichever of
 * the three screens loads it. Spanish: esYourPage.ts.
 */
import { addEnglish } from "./enRegistry";

export const enYourPage = {
  "yp.hidden": "Your page is hidden right now, so others can't open it.",
  "yp.askWhy": "Ask us why",
  "yp.copied": "Link copied",
  "yp.copyFailed": "Couldn't copy the link. Press and hold it to copy.",
  "yp.page": "Your page",
  "yp.pageAt": "Your page: {link}",
  "yp.copyLabel": "Copy your page link",
  "yp.shareLabel": "Share your page",
  "yp.copy": "Copy",
  "yp.share": "Share",
  "yp.shareListings": "Share your listings",
  "yp.forSale1": "1 item for sale",
  "yp.forSaleN": "{n} items for sale",
  "yp.everything": "Everything you sell is on",
  "yp.copyLink": "Copy link",
  "yp.pageLead": "Your page:",
} as const;

addEnglish(enYourPage);
