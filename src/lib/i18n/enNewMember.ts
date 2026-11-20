/**
 * A new member's Home in English (owner 11-14): the Get started guide (GetStartedGuide.tsx) and the new-member block
 * (NewMemberHome.tsx, WelcomeCard.tsx, ForSaleNearYou.tsx). Its own dictionary, loaded with those blocks' own chunks, so these words
 * never weigh on Home's first load for every other member (/home's critical-path budget, measured 2026-11-14).
 * Importing this file registers the words with t() (enRegistry.ts). Spanish: esNewMember.ts.
 */
import { addEnglish } from "./enRegistry";

export const enNewMember = {
  "home.wc.title": "What brings you here?",
  "home.wc.post": "Post a job",
  "home.wc.postMeta": "Get help from a neighbor",
  "home.wc.find": "Find work",
  "home.wc.findMeta": "See the jobs posted near you",
  "home.wc.sell": "Sell something",
  "home.wc.sellMeta": "List an item on Declutter",
  "home.gs.title": "Get started",
  "home.gs.apply": "Apply to your first job",
  "home.gs.post": "Post your first job",
  "home.gs.list": "List your first item",
  "home.gs.save": "Save an item you like",
  "home.gs.photo": "Add a profile photo",
  "home.gs.alerts": "Turn on job alerts",
  "home.gs.hide": "Hide",
  "home.gs.hideAria": "Hide Get started",
  "home.gs.done": "done",
  "home.ns.forSale": "For sale near you",
  "home.ns.free": "Free",
  "home.ns.seeAll": "See all",
  // Area 11b M1: the first-run picker (FirstRun.tsx), so a Spanish member's first screen is Spanish too.
  "firstRun.skip": "Skip",
  "firstRun.title": "What brings you here?",
  "firstRun.lede": "Tap one to start. One account does it all.",
  "firstRun.hire.title": "Hire help",
  "firstRun.hire.sub": "Post a job in three short steps",
  "firstRun.earn.title": "Find work",
  "firstRun.earn.sub": "Jobs near you, paid through Helpr",
  "firstRun.sell.title": "Sell stuff",
  "firstRun.sell.sub": "Snap a photo, set a price, post",
  "firstRun.note": "You can do the others any time. Nothing is locked.",
} as const;

addEnglish(enNewMember);
