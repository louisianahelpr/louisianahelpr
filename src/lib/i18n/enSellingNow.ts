/**
 * "Selling now" on a member's profile in English (F260q): SellingNowRow.tsx. One panel's words, imported by that panel
 * only, so they are inlined into its chunk (Q178): the profile page loads no other dictionary. Spanish: esSellingNow.ts.
 */
import { addEnglish } from "./enRegistry";

export const enSellingNow = {
  "sn.title": "Selling now · {n}",
  "sn.fewer": "Show fewer",
  "sn.all": "See all",
} as const;

addEnglish(enSellingNow);
