/**
 * The words of You › Settings' account screens that were still English in Spanish (design audit area 09 H1, 11-18):
 * Blocked people, Warnings and strikes, Color and text, the Log out dialog, the search-engine switch, the profile
 * link panel, the Privacy group and the consent step's one 18+ box. Not on the boot path: each screen imports this
 * file (side effect), which registers the English with t() (enRegistry.ts).
 */
import { addEnglish } from "./enRegistry";

export const enAccount = {
  // Log out (You, the desktop menu)
  "acct.logoutTitle": "Log out?",
  "acct.logoutBody": "You can log back in anytime. Your account stays as it is.",
  "acct.logout": "Log out",
  "acct.loggingOut": "Logging out…",
  "acct.cancel": "Cancel",
  "acct.profile": "Profile",
  // Blocked people
  "acct.blockedTitle": "Blocked people",
  "acct.blockedLoadFailed": "We couldn't load the people you blocked.",
  "acct.blockedSome": "They can't message you or apply to your jobs, and you won't see their messages, applications or profile.",
  "acct.blockedNone": "You haven't blocked anyone. You can block someone from the menu on their profile.",
  "acct.unblock": "Unblock",
  "acct.unblocking": "Unblocking…",
  "acct.unblockName": "Unblock {name}",
  "acct.goneName": "A deleted account",
  // Color and text (was "Accessibility")
  "acct.colorTextTitle": "Color and text",
  "acct.colorMode": "Color mode",
  "acct.light": "Light",
  "acct.matchPhone": "Match phone",
  "acct.dark": "Dark",
  // Warnings and strikes
  "acct.warningsTitle": "Warnings and strikes",
  "acct.banned": "Account banned",
  "acct.bannedBody": "Permanently banned due to policy violations.",
  "acct.suspended": "Suspended",
  "acct.strikeN": "Strike {n} of 3",
  "acct.good": "Good standing",
  "acct.goodBody": "No warnings or violations on record.",
  "acct.strikesOf3": "{n} of 3 strikes",
  "acct.strikesOf3Label": "{n} of 3 strikes on the 3-strike system",
  // Search engines
  "acct.searchTitle": "Show my profile in search engines",
  "acct.searchBody": "Off: only people you send the link to find your page. On: Google and others can list it.",
  "acct.saveFailed": "Couldn't save that. Try again.",
  // Account and security: change email, log out everywhere (design audit area 09 L5 + L6)
  "acct.emailTitle": "Change email address",
  "acct.newEmail": "New email",
  "acct.emailHelp": "We'll email a link to the new address. Your email changes when you tap it.",
  "acct.emailConfirm": "Confirm change",
  "acct.sending": "Sending…",
  "acct.everywhereTitle": "Log out everywhere?",
  "acct.everywhereBody": "This logs out every device, including this one. You'll need to log back in here.",
  "acct.everywhere": "Log out everywhere",
  "acct.everywhereFailed": "Logged out on this device. We couldn't confirm your other devices. Log in and use Log out everywhere again.",
  // Profile link panel
  "acct.gettingLink": "Getting your link…",
  "acct.tryAgain": "Try again",
  "acct.linkWho": "Anyone with the link sees your listings, open jobs, Helpr work and Wanted posts. Never your address or contact info.",
  "acct.shareProfile": "Share profile",
  "acct.changeLink": "Change link (you can do this once)",
  "acct.newLink": "New link",
  "acct.linkHint": "3 to 30 letters, numbers or single hyphens. You can change it once.",
  "acct.saving": "Saving…",
  "acct.saveLink": "Save link",
  // Settings › Privacy
  "acct.savedAddress": "Saved address",
  "acct.savedAddressNone": "None yet. The address of the next job you post shows here.",
} as const;

addEnglish(enAccount);
