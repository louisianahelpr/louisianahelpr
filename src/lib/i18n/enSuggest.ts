/**
 * "Suggest a category" (SuggestCategory.tsx, on Post a job step 1 and the Sell form) in English. Design audit r2 #37:
 * it was English in Spanish. Imported by that component only, so it rides in its chunk. Spanish: esSuggest.ts.
 */
import { addEnglish } from "./enRegistry";

export const enSuggest = {
  "sug.link": "Don't see yours? Suggest a category",
  "sug.title": "Suggest a category",
  "sug.body": "Tell us what's missing and we'll look at adding it for everyone. You can pick “Other” and post right now.",
  "sug.name": "Category name",
  "sug.placeholder": "e.g. Tutoring",
  "sug.max": "Up to {n} characters.",
  "sug.cancel": "Cancel",
  "sug.send": "Send suggestion",
} as const;

addEnglish(enSuggest);
