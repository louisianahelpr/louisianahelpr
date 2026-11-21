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

  // The guest's way in on the public header and Declutter's guest cards (design audit r2 #37). Boot words, so the
  // public header pays for no extra chunk.
  "g.logIn": "Log in",
  "g.signUp": "Sign up",
  "g.joinFree": "Join free",

  // Main nav (desktop rail + phone dock)
  "nav.home": "Home",
  "nav.goHome": "Go to Home",
  // F146 (owner UI audit 11-09): the phone dock reads "Home · Jobs · Declutter · Messages · You".
  "nav.dockHome": "Home",
  "nav.posts": "Posts",
  "nav.jobs": "Jobs",
  "nav.messages": "Messages",
  // The Inbox (owner 11-15: "Merge messages and notifications into one, like Vinted does"): one top-bar icon, two tabs.
  "inbox.title": "Inbox",
  "inbox.tabs": "Inbox sections",
  "inbox.messages": "Messages",
  "inbox.notifications": "Notifications",
  "inbox.unread": "{name}, {n} unread",
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
  // Owner 11-20 (ease batch): a guest who started a job post (src/lib/guestPostDraft.ts).
  "signup.postSubtitle": "Your job post is saved on this device. Sign up and verify your email, and we'll bring you right back to post it.",
  "signup.saveItemSubtitle": "Sign up to save items. We'll take you straight back to where you were.",
  "zip.unknown": "We don't recognise that as a Louisiana ZIP code. Jobs are matched by parish, so double-check it — otherwise nearby work won't reach you.",
  // Jobs browse (the section tabs)
  "tabs.browse": "Browse",
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
  // The shared next-step line (nextStepWords): every screen with a NextStep shows it.
  "next.lead": "Next: {step}",
  // The shared confirm sheet's default way out (DeclutterConfirmSheet), on every Declutter screen.
  "core.notNow": "Not now",
  // Home's route skeleton when the page never arrives (design audit area 02 #1): drawn before Home's chunk, so boot words.
  "home.stuckTitle": "We couldn't load your Home.",
  "home.stuckBody": "Tap Try again. If it sticks, our end is having a hiccup, not yours.",
  "core.tryAgain": "Try again",
} as const;
