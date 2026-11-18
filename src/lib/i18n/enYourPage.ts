/**
 * "Your page" (the member's own profile link card) in English (F260q): YourPageLink.tsx, shown on Home, You and
 * Selling. One panel's words, imported by that panel only, so they are inlined into its chunk (Q178), whichever of
 * the three screens loads it. Spanish: esYourPage.ts.
 */
import { addEnglish } from "./enRegistry";

export const enYourPage = {
  "yp.hidden": "Your page is hidden right now",
  "yp.hiddenEmail": "Neighbors can't open it until your email is confirmed. Tap the link in the email we sent you.",
  "yp.hiddenEmailAction": "Account and security",
  "yp.hiddenOther": "Neighbors can't open it while your account is under review. A test account never has a public page.",
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
  // The You page (design audit r2 #31)
  "yp.you.publicProfile": "View my public profile",
  "yp.you.yourProfile": "Your profile",
  "yp.you.editLabel": "Edit profile",
  "yp.you.edit": "Edit",
  "yp.you.activity": "Your activity",
  "yp.you.menu": "You",
  "yp.you.row.earnings": "Money",
  "yp.you.row.notifications": "Notifications",
  "yp.you.row.settings": "Settings",
  "yp.you.row.support": "Talk to a real person",
  "yp.you.row.admin": "Admin",
  "yp.you.cap.notifications": "Alerts and email",
  "yp.you.cap.settings": "Account, look, sections",
  "yp.you.cap.support": "Help",
  "yp.you.coming": "{amount} coming",
  "yp.you.held": "{amount} held",
  "yp.you.logOut": "Log out",
  "yp.you.delete": "Delete account",
  "yp.you.tile.posted": "Posted",
  "yp.you.tile.working": "Working",
  "yp.you.tile.buying": "Buying",
  "yp.you.tile.selling": "Selling",
  "yp.you.tile.orders": "Orders",
  "yp.you.tile.myShop": "My shop",
  "yp.you.tile.renting": "Renting",
  "yp.you.tile.owning": "Owning",
  "yp.you.count.posted": "{n} live",
  "yp.you.count.working": "{n} booked",
  "yp.you.count.selling": "{n} live",
  "yp.you.count.shopOrders": "{n} open",
  "yp.you.count.buying": "{n} in progress",
} as const;

addEnglish(enYourPage);
