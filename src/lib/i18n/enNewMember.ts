/**
 * A new member's Home in English (owner 11-14): the Get started guide (GetStartedGuide.tsx) and the new-member block
 * (NewMemberHome.tsx, ForSaleNearYou.tsx). Its own dictionary, loaded with those blocks' own chunks, so these words
 * never weigh on Home's first load for every other member (/home's critical-path budget, measured 2026-11-14).
 * Importing this file registers the words with t() (enRegistry.ts). Spanish: esNewMember.ts.
 */
import { addEnglish } from "./enRegistry";

export const enNewMember = {
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
} as const;

addEnglish(enNewMember);
