/**
 * The money tiles' words in English (F260q): HomeMoneyTiles.tsx (Home's strip and the head of You › Money). One panel's
 * words, imported by that panel only, so they are inlined into its chunk (Q178). Money meaning must match es exactly.
 * Importing this file registers them with t() (enRegistry.ts). Spanish: esMoneyTiles.ts.
 */
import { addEnglish } from "./enRegistry";

export const enMoneyTiles = {
  "mt.kept": "Kept for you",
  "mt.addPayout": "Add your payout account to get it",
  "mt.notSent": "Approved, not sent yet",
  "mt.reaches": "Reaches your wallet {day}",
  "mt.firstReaches": "First reaches your wallet {day}",
  "mt.sentAfter": "Sent {days} days after the job is approved",
  "mt.heldFor": "Held for {title}",
  "mt.paidToAfter": "Paid to {name} after you confirm it's done",
  "mt.yourHelpr": "your Helpr",
  "mt.heldForJobs": "Held for {n} jobs",
  "mt.heldForOneJob": "Held for 1 job",
  "mt.paidEach": "Paid to each Helpr after you confirm their job is done",
  "mt.onItsWay": "On its way",
  "mt.comingToYou": "Coming to you",
  "mt.nothingYet": "Nothing on its way yet",
  "mt.waiting": "Waiting for approval",
  "mt.dispute": "Held in a dispute",
} as const;

addEnglish(enMoneyTiles);
