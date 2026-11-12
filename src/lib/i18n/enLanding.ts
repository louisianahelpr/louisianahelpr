/**
 * The landing's words under the hero, in English (F260q, owner 11-11 "Spanish everything"): the section cards, the
 * money band and the join block (SectionsShowcase.tsx). The landing draws its own English and reads only the Spanish,
 * through useGuestSpanish.ts, so its first paint imports no i18n module; src/test/landingInSpanish.test.tsx holds the
 * two equal. Spanish: esLanding.ts. {hours} and {names} are filled by the landing.
 */
import { addEnglish } from "./enRegistry";

export const enLanding = {
  "landing.sectionsHeading": "Hire, work, buy and sell. One account.",
  "landing.idOnce": "Verify your ID once and it counts everywhere on Helpr.",
  "landing.sectionsLabel": "Sections",
  "landing.name.jobs": "Jobs",
  "landing.name.shops": "Shops",
  "landing.name.homes": "Homes",
  "landing.blurb.jobs": "Hire local help, or find work nearby. Your payment is held until the work is done.",
  "landing.blurb.declutter": "Sell to neighbors or find a deal. Offers and checkout are built in.",
  "landing.comingSoon": "Coming soon",
  "landing.browseJobs": "Browse jobs",
  "landing.shopDeclutter": "Shop Declutter",
  "landing.onTheWayOne": "{names} is on the way.",
  "landing.onTheWayMany": "{names} are on the way.",
  "landing.and": "and",
  "landing.moneyHeadline": "Nobody gets paid until it’s really done, or really handed over.",
  "landing.step1Title": "Paid through Helpr",
  "landing.step1Body": "The full price is shown before anyone pays, and Helpr holds the money.",
  "landing.step2Title": "Held until it’s done",
  "landing.step2Body": "Nobody is paid out until the work is done, or the buyer says they got the item.",
  "landing.step3Title": "Approved, then released",
  "landing.step3Body": "The person hiring approves the work or asks for a change. If they haven’t answered in {hours} hours, a real person on our team steps in.",
  "landing.trustLabel": "Why it’s safe",
  "landing.trust.id": "ID-verified people",
  "landing.trust.email": "Every email confirmed",
  "landing.trust.cash": "No cash changes hands",
  "landing.trust.person": "A real person answers",
  "landing.trust.made": "Made in Louisiana",
  "landing.joinLead": "Join your neighbors on",
  "landing.joinSub": "One free account for jobs and Declutter.",
  "landing.createAccount": "Create your free account",
  "landing.startHere": "Start here",
  "landing.postJob": "Post a job",
  "landing.sell": "Sell something",
  "landing.memberLogin": "Already a member? Log in",
} as const;

addEnglish(enLanding);
