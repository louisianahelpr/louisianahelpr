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
  "firstRun.title": "What brings you to Helpr?",
  "firstRun.lede": "Pick any. You can do all of it with one account.",
  "firstRun.hire.title": "Get help with a job",
  "firstRun.hire.sub": "Yard, cleaning, moving, assembly and more",
  "firstRun.earn.title": "Earn by helping neighbors",
  "firstRun.earn.sub": "Pick up jobs near you",
  "firstRun.sell.title": "Sell things I don't need",
  "firstRun.sell.sub": "List an item for neighbors to buy",
  "firstRun.deal.title": "Find a good deal",
  "firstRun.deal.sub": "Local items from your neighbors",
  "firstRun.note": "This only sets what you see first on Home. Nothing is locked.",
  "firstRun.continue": "Continue",
} as const;

addEnglish(enNewMember);
