/**
 * The words the first screen of EVERY page reads (language switch, nav, the
 * Jobs header, a few shared helpers). Bundled on boot. Every other screen's
 * words live in enScreens.ts, its own chunk, loaded by the screens that use
 * them (Log in, Sign up, Finish your profile, Delete account). en.ts joins
 * the two and stays THE SOURCE for es.ts and MsgKey (bundle budget, 1030d).
 */
export const enCore = {
  // Language switch
  "lang.label": "Language",
  "lang.english": "English",
  "lang.spanish": "Español",
  "lang.switchTo": "Switch language to {lang}",
  "lang.legalInEnglish": "The legal terms are in English.",

  // Main nav (desktop rail + phone dock)
  "nav.home": "Home",
  "nav.posts": "Posts",
  "nav.jobs": "Jobs",
  "nav.messages": "Messages",
  "nav.profile": "Profile",
  "nav.you": "You",
  "nav.explore": "Explore",
  "nav.declutter": "Declutter",
  "nav.shops": "Shops",
  "nav.homes": "Homes",
  "nav.create": "Create",
  "nav.primary": "Primary",
  "nav.bottom": "Bottom navigation",
  "nav.comingSoon": "{label}, coming soon",
  "nav.isComingSoon": "{label} is coming soon",

  "common.timedOut": "{label} timed out. Please check your connection and try again.",
  "signup.notifySubtitle": "Sign up to get notified when paid work lands.",
  "signup.itemSubtitle": "Sign up and we'll take you straight back to this item.",
  "zip.unknown": "We don't recognise that as a Louisiana ZIP code. Jobs are matched by parish, so double-check it — otherwise nearby work won't reach you.",
  // Jobs browse (the section tabs)
  "tabs.browse": "Browse",
  "tabs.less": "Earlier tabs",
  "tabs.more": "More tabs",
  "tabs.moreToDo": "More tabs, {n} to do",
  "tabs.lessToDo": "Earlier tabs, {n} to do",
  "jobs.tabPosted": "Posted",
  "jobs.tabWorking": "Working",
  "jobs.tabsLabel": "Jobs & Posts",

  // Jobs browse header (Explore chips, Soon, settings gear)
  "jobs.settings": "Jobs settings",
  "nav.sections": "Sections",
  "soon.short": "Soon",
  "soon.full": "Coming soon",
} as const;
