/**
 * "Your page" (the member's own profile link card) in English (F260q): YourPageLink.tsx, shown on Home, You and
 * Selling. One panel's words, imported by that panel only, so they are inlined into its chunk (Q178), whichever of
 * the three screens loads it. Spanish: esYourPage.ts.
 */
import { addEnglish } from "./enRegistry";

export const enYourPage = {
  "yp.hidden": "Your public profile is hidden right now",
  "yp.hiddenEmail": "Neighbors can't open it until your email is confirmed. Tap the link in the email we sent you.",
  "yp.hiddenEmailAction": "Account and security",
  "yp.hiddenOther": "Neighbors can't open it while your account is under review. A test account never has a public page.",
  "yp.askWhy": "Ask us why",
  "yp.copied": "Link copied",
  "yp.copyFailed": "Couldn't copy the link. Press and hold it to copy.",
  "yp.page": "Your public profile",
  "yp.pageAt": "Your public profile: {link}",
  "yp.copyLabel": "Copy your public profile link",
  "yp.shareLabel": "Share profile",
  "yp.copy": "Copy",
  "yp.share": "Share",
  "yp.shareListings": "Share your listings",
  "yp.forSale1": "1 item for sale",
  "yp.forSaleN": "{n} items for sale",
  "yp.everything": "Everything you sell is on",
  "yp.copyLink": "Copy link",
  "yp.pageLead": "Your public profile:",
} as const;

addEnglish(enYourPage);
