/**
 * Declutter item page and card words that were English for a Spanish reader (design audit r2 #35): "incl. fee",
 * "Listed 1 week ago", "About 1 mi away", the "Protected:" line, "Member since ...", and the seller badges. The drawing
 * files read them through wordInLang (src/lib/i18n/inLang.ts), so the landing strip and Browse pay for no hook.
 * Spanish: esItemPage.ts.
 */
import { addEnglish } from "./enRegistry";

export const enItemPage = {
  "ip.protected": "Protected: pay in the app, 24 hours to report a problem.",
  "ip.protectedPorch": "Protected: pay in the app, pick up from the porch, 24 hours to report a problem.",
  // Declutter top 5 #3 (owner 11-19, 20261120012729): "in demand" lines, real counts past a threshold only.
  "ip.demand.offers": "{n} offers this week",
  "ip.demand.saves": "{n} people saved this",
  "ip.demand.views": "{n} views today",
  "ip.demand.label": "In demand",
  // Declutter top 5 #4 (20261120014036): the seller's shop-wide sale, on a listing at its sale price.
  "ip.sale": "Shop sale: {pct}% off until {when}",
  "ip.away.about": "About {n} mi away",
  "ip.away.under1": "Less than 1 mi away",
  "ip.away.n": "{n} mi away",
  "ip.listed": "Listed {when}",
  "ip.ago.now": "just now",
  "ip.ago.min": "{n} min ago",
  "ip.ago.h": "{n} h ago",
  "ip.ago.yesterday": "yesterday",
  "ip.ago.days": "{n} days ago",
  "ip.ago.week": "1 week ago",
  "ip.ago.weeks": "{n} weeks ago",
  "ip.badge.listsOften": "Lists often",
  "ip.badge.onTime": "On-time handovers",
  "ip.badge.active": "Active today",
  // Owner 11-20 (item page polish #6): "Member since Mar 2025" on the seller card (member and guest).
  "ip.memberSince": "Member since {date}",
  // Owner 11-20 (item page polish #5): the one meta row under the condition chip.
  "ip.buyerProtection": "Buyer protection",
  "ip.porchPickup": "Porch pickup",
  "ip.breadcrumb": "Where this item is in Declutter",
} as const;

addEnglish(enItemPage);
