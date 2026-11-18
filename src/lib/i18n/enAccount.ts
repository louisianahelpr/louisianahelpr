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
  // Consent step (one 18+ statement: the box below says it)
  "acct.agreeLead": "I agree to the",
  "acct.notForYou": "Not for you?",
} as const;

addEnglish(enAccount);
