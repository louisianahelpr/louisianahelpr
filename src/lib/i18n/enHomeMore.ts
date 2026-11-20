/**
 * Home's more rows in English (owner polish 11-20): "Recent messages" and "Your active listings and jobs"
 * (HomeMoreRows.tsx). Imported by that lazy chunk only, so these words never ride Home's first load (/home's
 * critical-path budget). Spanish: esHomeMore.ts.
 */
import { addEnglish } from "./enRegistry";

export const enHomeMore = {
  "home.more.messages": "Recent messages",
  "home.more.unread": "Unread",
  "home.more.active": "Your active listings and jobs",
  "home.more.jobOpen": "Open · waiting for applicants",
  "home.more.applicant1": "Open · 1 applicant",
  "home.more.applicantsN": "Open · {n} applicants",
  "home.more.listed": "Listed",
} as const;

addEnglish(enHomeMore);
