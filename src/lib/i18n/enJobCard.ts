/**
 * The Browse job card's chips in English (UX-8 phase 1; Auditor 3 A3-3 part 3, 11-01): Just in, Recommended, Boosted,
 * Urgent, Today. Kept apart from the job page's words (enJobs.ts) because the card is on the guest /browse first
 * screen: importing this file (side effect) registers only these few words with t() (enRegistry.ts).
 */
import { addEnglish } from "./enRegistry";

export const enJobCard = {
  "jobCard.justIn": "Just in",
  "jobCard.justPosted": "Just posted",
  "jobCard.recommended": "Recommended",
  "jobCard.boosted": "Boosted",
  "jobCard.urgent": "Urgent",
  "jobCard.today": "Today",
} as const;

addEnglish(enJobCard);
