/**
 * The shared section bar's words ("Search <noun>", Clear search), in English (F260q). Their own file, not enDeclutter.ts:
 * the search bar sits on screens that show no Declutter words (Profile, Jobs), and importing enDeclutter put its 9 KB on
 * them (Q178, Builder 2 11-11). Importing this file registers them with t() (enRegistry.ts). Spanish: esDeclutter.ts.
 */
import { addEnglish } from "./enRegistry";

export const enSections = {
  "section.search": "Search",
  "section.noun.jobs": "jobs",
  "section.noun.jobsAndItems": "jobs and items",
  "section.noun.postedJobs": "posted jobs",
  "section.noun.jobsWorking": "jobs you're working",
  "section.noun.homes": "homes",
  "section.noun.shops": "shops",
  "section.noun.declutter": "Declutter",
  "section.clearSearch": "Clear search",
} as const;

addEnglish(enSections);
