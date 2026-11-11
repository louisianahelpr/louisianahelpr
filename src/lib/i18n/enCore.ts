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
  "lang.saved": "Language saved: English",
  "lang.switchTo": "Switch language to {lang}",
  "lang.legalInEnglish": "The legal terms are in English. A Spanish summary is on the Terms page.",

  // Main nav (desktop rail + phone dock)
  "nav.home": "Dashboard",
  // F146 (owner UI audit 11-09): the phone dock reads "Home · Jobs · Declutter · Messages · You".
  "nav.dockHome": "Home",
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
  "signup.jobSubtitle": "Sign up to apply, and we'll take you straight back to this job.",
  "signup.saveItemSubtitle": "Sign up to save items. We'll take you straight back to where you were.",
  "zip.unknown": "We don't recognise that as a Louisiana ZIP code. Jobs are matched by parish, so double-check it — otherwise nearby work won't reach you.",
  // Jobs browse (the section tabs)
  "tabs.browse": "Browse",
  "tabs.less": "Earlier tabs",
  "tabs.lessToDo": "Earlier tabs, {n} to do",
  "tabs.nMore": "{n} more",
  "tabs.nMoreTabs": "{n} more tabs",
  "tabs.nMoreToDo": "{n} more tabs, {m} to do",
  "tabs.nToDo": "{n} to do",
  "jobs.tabPosted": "Posted",
  "jobs.tabWorking": "Working",
  "jobs.tabsLabel": "Jobs & Posts",
  // The Vinted header (owner 11-08): the photo's menu and the floating create pill.
  "jobs.myJobs": "My Jobs",
  "jobs.postAJob": "Post a job",

  // Jobs browse header (Explore chips, Soon, settings gear)
  "jobs.settings": "Jobs settings",
  "nav.sections": "Sections",
  "soon.short": "Soon",
  "soon.full": "Coming soon",
} as const;
