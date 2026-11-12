/**
 * Declutter's offer box in English (F260q, owner 11-11 "Spanish everything"): the amount chips, the bill, the help
 * line, the add-a-card step (DeclutterOfferPanel.tsx). Money meaning must match esOffer.ts exactly. Importing this file
 * registers the words with t() (enRegistry.ts).
 */
import { addEnglish } from "./enRegistry";

export const enOffer = {
  "offer.cardNotSaved": "No card was saved, so nothing happened yet.",
  "offer.addCard": "Add a card",
  "offer.cardStepTitle": "To send your offer, add a card first.",
  "offer.cardStepBody": "We save your card now; you're only charged if the seller says yes and you check out. Then you send your offer.",
  "offer.opening": "Opening…",
  "offer.notNow": "Not now",
  "offer.enterAmount": "Enter an amount, like 25 or 25.50.",
  "offer.lessThanPrice": "Offer less than the price. To pay the price, tap Buy now.",
  "offer.atLeast": "Offers must be at least {min} (half the price).",
  "offer.cardSaved": "Card saved. Now send your offer.",
  "offer.quickAmounts": "Quick offer amounts",
  "offer.chipAria": "{pct}% off, an offer of {amount} ({total})",
  "offer.pctOff": "{pct}% off",
  "offer.custom": "Custom",
  "offer.customPlaceholder": "Custom amount, at least {min}",
  "offer.youPayIfYes": "You pay if the seller says yes",
  "offer.inclFee": "incl. fee",
  "offer.help": "The seller has 48 hours to accept, say no or answer with another price. If they accept, you have 24 hours to check out. Nothing is charged until you pay.",
  "offer.send": "Send offer",
  "offer.cardCheckFailed": "We couldn't check your saved card.",
  "offer.checkingCard": "Checking for your card…",
  "offer.atMost": "At most, {phrase}. A price drop or more items from this seller makes it less.",
  "osw.title": "Offer sent",
  "osw.lead": "Your card isn't charged unless the seller accepts and you check out.",
  "osw.youOffered": "You offered",
  "osw.48h": "The seller has 48 hours to answer",
  "osw.answer": "The seller accepts, counters or says no",
  "osw.letKnow": "We'll let you know",
  "osw.ifAccepts": "If the seller accepts",
  "osw.checkout": "You have 24 hours to check out:",
  "osw.meet": "Meet at the safe spot",
  "osw.delivered": "Get it delivered",
  "osw.pickup": "Pick it up",
  "osw.thenPaid": "Then the seller is paid",
  "osw.gotIt": "Got it",
  "osw.keepBrowsing": "Keep browsing",
} as const;

addEnglish(enOffer);
