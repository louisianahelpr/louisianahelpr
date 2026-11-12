/**
 * The "Ask for it" sheet's words in English (F260q): FreeAskSheet.tsx, loaded only when the button is pressed, so its
 * words ride in its own chunk, never on the item page's first load (Q178). Importing this file registers them with t()
 * (enRegistry.ts). Spanish: esFreeAsk.ts.
 */
import { addEnglish } from "./enRegistry";

export const enFreeAsk = {
  "fask.today": "Today",
  "fask.todayAt": "Today {time}",
  "fask.tomorrowAt": "Tomorrow {time}",
  "fask.changed": "Time changed. The giver sees your new time.",
  "fask.asked": "Asked. {name} picks who gets it, and we'll tell you.",
  "fask.changeTitle": "Change your pickup time",
  "fask.title": "Ask for it",
  "fask.free": "Free",
  "fask.when": "When can you pick it up?",
  "fask.fromGiver": "From the giver's pickup times · {where}",
  "fask.fromName": "From {name}'s pickup times · {where}",
  "fask.or": " or ",
  "fask.loadFailed": "We couldn't load the pickup times.",
  "fask.loading": "Loading the pickup times…",
  "fask.noTimes": "{name} has no pickup times open in the next week, so this item can't be asked for right now.",
  "fask.dayAria": "Pickup day",
  "fask.timeAria": "Pickup time on {day}",
  "fask.noteFirst": "Asking is free. {name} picks who gets it. If it's you, {steps}.",
  "fask.noteLead": "Free, nothing is charged. {name} picks who gets it. If it's you, ",
  "fask.theTimeYouPick": "the time you pick",
  "fask.noteTail": " is already set, and you'll get the address.",
  "fask.changeTo": "Change to {time}",
  "fask.askAt": "Ask for it · {time}",
  "fask.pickNew": "Pick a new time",
  "fask.pickToAsk": "Pick a time to ask",
  "fask.upTo3": "You can ask for up to 3 free items at a time.",
} as const;

addEnglish(enFreeAsk);
