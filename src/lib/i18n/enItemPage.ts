/**
 * Declutter item page and card words that were English for a Spanish reader (design audit r2 #35): "incl. fee",
 * "Listed 1 week ago", "About 1 mi away", the "Protected:" line, "Joined ...", and the seller badges. The drawing
 * files read them through wordInLang (src/lib/i18n/inLang.ts), so the landing strip and Browse pay for no hook.
 * Spanish: esItemPage.ts.
 */
import { addEnglish } from "./enRegistry";

export const enItemPage = {
  "ip.inclFee": "incl. fee",
  "ip.protected": "Protected: pay in the app, 24 hours to report a problem.",
  "ip.protectedPorch": "Protected: pay in the app, pick up from the porch, 24 hours to report a problem.",
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
  "ip.joined": "Joined {date}",
} as const;

addEnglish(enItemPage);
