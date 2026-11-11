/**
 * The words of You › Settings (F410c, audit 11-10 High: switching to Español there translated only "Idioma", so a
 * Spanish speaker met a nearly English screen right where they chose Spanish). Not on the boot path: SettingsTab
 * imports this file (side effect), which registers the English with t() (enRegistry.ts).
 *
 * Each English value is EXACTLY the words SettingsTab (or the shared label it shows) already draws, so the screen
 * translates by looking its English words up here (settingsWord); a row whose words are not listed stays English
 * rather than going blank. Shared labels (TAB_TITLES, BIGGER_TEXT_LABEL, SHARE_JOB_PHOTOS_LABEL) keep their one
 * English source; only their Spanish lives here.
 */
import { addEnglish } from "./enRegistry";

export const enSettings = {
  "settings.title": "Settings",
  // Group headings
  "settings.look": "Look",
  "settings.yourSections": "Your sections",
  "settings.updates": "Updates",
  "settings.yourAccount": "Your account",
  "settings.more": "More",
  // Look
  "settings.colorMode": "Color mode",
  "settings.light": "Light",
  "settings.dark": "Dark",
  "settings.matchPhone": "Match my phone",
  "settings.biggerText": "Bigger text and buttons",
  "settings.biggerTextSub": "Larger text and bigger tap targets",
  // Your sections
  "settings.jobs": "Jobs",
  "settings.declutter": "Declutter",
  "settings.shops": "Shops",
  "settings.homes": "Homes",
  "settings.jobsBlurb": "Hire help or find work",
  "settings.declutterBlurb": "Sell or find a deal",
  "settings.shopsBlurb": "Shop local or open a shop",
  "settings.homesBlurb": "Find a place or list one",
  "settings.comingSoon": "Coming soon",
  // Updates
  "settings.notifications": "Notifications",
  "settings.notificationsSub": "What we tell you, and how",
  "settings.savedSearches": "Saved searches",
  "settings.savedSearchesSub": "Get told when something new matches",
  // Your account
  "settings.editProfile": "Edit profile",
  "settings.editProfileSub": "Photo, about you, what you help with",
  "settings.security": "Account and security",
  "settings.securitySub": "Email, password, sign-in",
  "settings.id": "ID",
  "settings.idStart": "Not verified yet",
  "settings.idContinue": "Not finished",
  "settings.idChecking": "Stripe is checking",
  "settings.idWithTeam": "With our team",
  "settings.idFailed": "Couldn't verify",
  "settings.idVerified": "Verified",
  "settings.download": "Download my data",
  "settings.downloadSub": "A copy of what Helpr holds about you",
  "settings.downloadBusy": "Preparing your file…",
  "settings.sharePhotos": "Let Helpr share my job photos",
  "settings.sharePhotosSub": "Before and after photos may show what Helprs do. Faces and addresses are hidden.",
  "settings.blocked": "Blocked people",
  "settings.blockedSub": "People you blocked, and unblock",
  "settings.warnings": "Warnings and strikes",
  "settings.warningsSub": "Your account standing",
  "settings.delete": "Delete account",
  "settings.deleteSub": "Permanent",
  // More
  "settings.membership": "Membership",
  "settings.referrals": "Referrals",
  "settings.referralsSub": "Invite friends & earn credits",
  "settings.giftCard": "Gift card",
  "settings.giftCardSub": "Send a Helpr gift card by email",
  "settings.reportBug": "Report a bug",
  "settings.reportBugSub": "Tell us what isn't working",
  "settings.legal": "Legal & policies",
  "settings.legalSub": "Terms, rules & privacy",
  "settings.admin": "Admin",
  "settings.adminSub": "Moderation, payouts & platform health",
  "settings.logout": "Log out",
} as const;

addEnglish(enSettings);
