/**
 * The app's words, English. THE SOURCE: every key here must exist in es.ts
 * (typed Record<MsgKey, string>, so a missing key fails typecheck; the
 * dictionary test checks the reverse, empties and {vars}).
 *
 * Keys are "<screen>.<thing>". {name} is filled by t(key, { name }).
 * Money and legal meaning must match exactly across languages.
 */
export const en = {
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

  // Landing hero (LOCKED English copy, CLAUDE.md "The landing hero is LOCKED").
  // The Spanish lines are their faithful translation (lead, 2026-10-29).
  "hero.titleLead": "Louisiana’s local",
  "hero.titleAccent": "partner.",
  "hero.subhead": "Hire help or find work. One account, real neighbors.",

  // Log in
  "login.title": "Log in",
  "login.welcome": "Welcome back, neighbor.",
  "login.email": "Email",
  "login.password": "Password",
  "login.forgot": "Forgot password?",
  "login.emailInvalid": "Enter a valid email address",
  "login.emailMissing": "Add your email address",
  "login.passwordMissing": "Add your password",
  "login.showPassword": "Show password",
  "login.hidePassword": "Hide password",
  "login.submit": "Log in",
  "login.submitting": "Logging in…",
  "login.newHere": "New to Helpr?",
  "login.createAccount": "Create an account",
  "login.mfaTitle": "Two-step verification",
  "login.mfaBody": "Enter the 6-digit code from your authenticator app to finish signing in.",
  "login.mfaCode": "Authentication code",
  "login.verify": "Verify",
  "login.verifying": "Verifying…",
  "login.differentAccount": "Use a different account",
  "login.confirmEmailFirst": "Check your inbox first — you'll need to confirm your email before signing in.",
  "login.mfaCheckFailed": "Couldn't verify your security settings — try again?",
  "login.tooManyAttempts": "Too many attempts \u2014 try again in {minutes} min.",
  "login.mfaWrongCode": "That code didn't match. Check your app and try again.",
} as const;

export type MsgKey = keyof typeof en;
