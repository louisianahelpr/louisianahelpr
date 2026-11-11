/**
 * The signed-out public pages' words in English (F260q, owner 11-11 "Spanish everything"): the footer, /fees and
 * /safety. The footer reads them without importing this file (landing/useGuestSpanish.ts keeps guest first paint
 * flat) and draws its own English; src/test/publicPagesInSpanish.test.tsx holds the two equal. /fees and /safety
 * import it (side effect: registers these words with t(), enRegistry.ts). Spanish: esPublic.ts.
 */
import { addEnglish } from "./enRegistry";

export const enPublic = {
  "footer.taglineLead": "Jobs and Declutter",
  "footer.taglineTail": "for Louisiana.",
  "footer.explore": "Explore",
  "footer.jobs": "Jobs",
  "footer.findHelpr": "Find a Helpr",
  "footer.help": "Help center",
  "footer.fees": "Fees",
  "footer.safety": "Safety",
  "footer.contact": "Contact us",
  "footer.legal": "Legal",
  "footer.terms": "Terms",
  "footer.rules": "Rules",
  "footer.privacy": "Privacy",
  "footer.follow": "Follow",
  "footer.appStore": "Download Helpr on the App Store (opens in a new tab)",
  "footer.appStoreTitle": "Download on the App Store",
  "footer.facebook": "Follow us on Facebook (opens in a new tab)",
  "footer.facebookTitle": "Follow us on Facebook",
  "footer.instagram": "Follow us on Instagram (opens in a new tab)",
  "footer.instagramTitle": "Follow us on Instagram",
  "footer.madeWith": "Made with",
  "footer.love": "love",
  "footer.forCommunities": "for Louisiana communities",

  "fees.title": "Fees",
  "fees.postFree": "Posting a job is free.",
  "fees.setupFee": "A small one-time setup fee applies to your first paid job.",
  "fees.shownFirst": "Any service fee is shown before you pay.",
  "fees.helprsSeePay": "Helprs see their pay before they apply.",

  "safety.title": "Safety",
  "safety.idChecked": "Every member is ID checked: a photo ID, once per account, before they first post, get hired, list or buy.",
  "safety.moneyHeld": "Your money is held safely until you approve the work.",
  "safety.report": "You can report a problem from any job.",
} as const;

addEnglish(enPublic);
