/**
 * Declutter's free-item ask panel in English (F260q, owner 11-11): FreeClaimPanel in DeclutterFreeClaim.tsx (asking,
 * your ask, take it back). The long rules sentence (freeAskLine) and the giver's side are not converted yet.
 * Importing this file registers the words with t() (enRegistry.ts). Spanish: esFree.ts.
 */
import { addEnglish } from "./enRegistry";

export const enFree = {
  "free.taken": "Your ask is taken back.",
  "free.pickedSomeone": "The giver picked someone for this item.",
  "free.pickedSomeoneBody": "If they don't choose a pickup in time, it's free again.",
  "free.underAge": "You must be 18 or older to use Declutter.",
  "free.youAskedAria": "You asked for this item",
  "free.youAsked": "You asked for this.",
  "free.pickup": "Pickup {time}",
  "free.changeTime": "Change time",
  "free.waitingOnGiver": "Waiting on the giver to pick who gets it. We'll tell you either way.",
  "free.waitingOn": "Waiting on {name} to pick who gets it. We'll tell you either way.",
  "free.takeBack": "Take back my ask",
  "free.takeBackTitle": "Take back your ask?",
  "free.takeItBack": "Take it back",
  "free.keepAsk": "Keep my ask",
  "free.takeBackBody": "\"{title}\": your ask ends. Nothing is charged.",
  "free.askAria": "Ask for this item",
  "free.askForIt": "Ask for it",
  "free.askingFree": "Asking is free.",
  "free.freeNothing": "Free, nothing is charged.",
  "free.pickWhenAsk": "You pick a pickup time when you ask.",
  "free.howItWorks": "How it works",
  "free.howTitle": "How free items work",
} as const;

addEnglish(enFree);
