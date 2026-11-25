/**
 * The Sam's Club Black Friday deals guide (owner 2026-11-25 ~4:55 PM: "Can you make a gift guide with the Sam's Club
 * Black Friday deals"). Its items are a store deals guide's rows (scripts/gift-guide-themes/sams-club-black-friday.json,
 * imported by scripts/theme-guide-import.mjs; giftGuideLive.mjs DEAL_THEME_TITLES_1125). This file holds the words and
 * the one link the page adds on top of the items:
 *  - the "Join Sam's Club" card first, because the deals are for members only. Its link is our Later (Mavely) link to
 *    samsclub.com/join (made in the owner's Later account 2026-11-25; Later pays $10.50 per Club and $21 per Plus
 *    membership, 14-day cookie, tracker commissions.js "Sam's Club (Rakuten)"). The prices are the ones samsclub.com/join
 *    showed on 2026-11-25 (Club $60/year, Plus $120/year "now includes Walmart+"); no new-member discount was shown.
 *  - the card on the Black Friday page that opens this guide.
 * Guard: src/test/samsClubBlackFriday1125.test.tsx.
 */
export const SAMS_BF_SLUG = "sams-club-black-friday";

export const SAMS_MEMBERSHIP = {
  /** Later (Mavely) link to https://www.samsclub.com/join, made 2026-11-25 in the owner's Later account. */
  href: "https://mavely.app.link/2ayTFz3Fm8b",
  /** Read on samsclub.com/join, 2026-11-25. */
  clubPerYear: 60,
  plusPerYear: 120,
  checked: "2026-11-25",
} as const;

export const SAMS_BF_WORDS = {
  joinKicker: "Members only",
  joinTitle: "Join Sam's Club first",
  joinLine: `These Black Friday prices are for Sam's Club members. Club membership is $${SAMS_MEMBERSHIP.clubPerYear} a year; Plus is $${SAMS_MEMBERSHIP.plusPerYear} a year and now includes Walmart+.`,
  joinCta: "Join Sam's Club",
  // The cards show no why-line (owner 11-21), so the dates live here: Sam's Club's ad runs Nov 26-29; some prices on
  // this page are Instant Savings that started earlier or run a few days longer (each row's line in the rows file says).
  dates: "Black Friday sale: online from Thu, Nov 26 and in clubs from Fri, Nov 27, through Sun, Nov 29. A few of these prices started early or run a few days longer. While supplies last.",
  featureTitle: "Sam's Club Black Friday Deals",
  featureLine: "The best Sam's Club Black Friday gifts, each with its sale price.",
  featureCta: "See the deals",
} as const;
