/**
 * The listing-setting parts shared by the Sell page's saved-draft step form, Manage listing and Declutter settings, in
 * English (F260q, owner 11-11 "Spanish everything"): "Keep it up until it sells" (KeepUpRow), "make it free after __
 * days" (AutoFreeRow / autoFree.ts), how long a listing stays up (LISTING_LIFETIME), the price-drops switch name and
 * the "If it doesn't sell" strip (DropSchedule). Its own small chunk (vite.config.ts I18N_SCREEN_DICTS), so Manage
 * listing and Settings do not pull the whole Sell dictionary. The exported English constants read from here, so the
 * English stays one string. Spanish: esListingParts.ts.
 */
import { addEnglish } from "./enRegistry";

export const enListingParts = {
  "lp.keepUpTitle": "Keep it up until it sells",
  "lp.keepUpExplainer": "It renews every 30 days until someone buys it. You can turn this off anytime.",
  "lp.keepUpOn": "On. It renews every 30 days until someone buys it, with no reminders.",
  "lp.keepUpOff": "Off. It's up for 30 days at a time, up to 4 times (about 4 months). We'll remind you before each round ends.",
  "lp.keepUpToastOn": "It renews every 30 days until it sells.",
  "lp.keepUpToastOff": "It's up for 30 days at a time again, up to 4 times.",
  "lp.loadFail": "We couldn't load this setting.",
  "lp.afLabel": "If it doesn't sell, make it free after",
  "lp.afNeverOption": "Never make it free",
  "lp.afDays": "{n} days",
  "lp.afNever": "It won't become free on its own.",
  "lp.afExplainer": "If it hasn't sold by day {n}, it becomes free and anyone nearby can claim it. Already past day {n}? It becomes free tonight.",
  "lp.afSaved": "If it hasn't sold by day {n}, it becomes free.",
  "lp.afWins": "This wins over a stopped price: on day {n} it's free.",
  "lp.life": "30 days. If it hasn't sold, it goes back up by itself up to 3 more times (about 4 months). We'll remind you before each round ends.",
  "lp.lifeKeepUp": "Until it sells. It renews every 30 days by itself, with no reminders.",
  "lp.dropsSwitch": "Lower the price over time",
  "lp.dsHead": "If it doesn't sell",
  "lp.dsEach": "{pct}% less each evening, {time}",
  "lp.dsAria": "The lowest it could be each evening",
  "lp.dsFoot": "The first drop comes after it has been up 12 hours. It never goes below {floor}, and may stop sooner.",
} as const;

addEnglish(enListingParts);
