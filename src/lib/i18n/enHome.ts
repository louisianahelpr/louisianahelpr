/**
 * Home (the Dashboard) in English (F260q, owner 11-11 "Spanish everything"): the screen's own words in
 * HomeDashboard.tsx (greeting, Needs you card, loading and empty lines, Live now, Coming up, Your sections).
 * The to-do and Coming up lines themselves are built from data (useNeedsYouTodos.ts) and stay English for now.
 * Importing this file registers the words with t() (enRegistry.ts). Spanish: esHome.ts.
 */
import { addEnglish } from "./enRegistry";

export const enHome = {
  "home.morning": "Good morning",
  "home.afternoon": "Good afternoon",
  "home.evening": "Good evening",
  "home.h1": "Dashboard",
  "home.searchNoun": "jobs and items",
  "home.loadingAria": "Loading your Dashboard",
  "home.loadingSr": "Loading your Home",
  "home.needsYou": "Needs you",
  "home.needsYouOf": "Needs you · {at} of {n}",
  "home.seeJob": "See job",
  "home.orderTotal": "{amount} order total",
  "home.yourTodos": "Your to-dos",
  "home.todoDot": "To-do {at} of {n}",
  "home.hide": "Hide",
  "home.seeAll": "See all ({n})",
  "home.checking": "Checking your to-dos",
  "home.oneMoment": "One moment",
  "home.payoutTitle": "Add your payout account to get {amount}",
  "home.payoutBody": "Your pay is kept until you add where to send it.",
  "home.setUp": "Set up",
  "home.caughtUp": "You're all caught up",
  "home.caughtUpBody": "Things that need you show up here.",
  "home.todo": "To do",
  "home.liveNow": "Live now",
  "home.started": "Started {time}",
  "home.openJob": "Open job",
  "home.comingUpFailed": "We couldn't load what's coming up.",
  "home.comingUpFailedBody": "Check your connection and try again.",
  "home.comingUp": "Coming up",
  "home.nothingElse": "Nothing else booked.",
  "home.nothingYet": "Nothing booked yet.",
  "home.yourSections": "Your sections",
  "home.customize": "Customize",
  "home.role.posted": "You hired",
  "home.role.working": "You're working",
  "home.role.buying": "You're buying",
  "home.role.selling": "You're selling",
  "home.role.ordered": "You ordered",
  "home.role.shop": "Your shop",
  "home.soonOne": "{names} is opening soon",
  "home.soonMany": "{names} are opening soon",
  "home.and": "and",
} as const;

addEnglish(enHome);
