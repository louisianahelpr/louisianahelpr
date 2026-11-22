/**
 * The gift guides' big batch 1120 extras (owner approved 11-19 ~9:10 PM, FOLLOWUP-OWNER-1119.md item 83):
 *   (a) the GIFT FINDER's people (FINDER_WHO, still read by the swipe game); the finder itself is now the quiz,
 *       src/content/giftQuiz.ts (owner 2026-11-21 ~6:15 PM);
 *   (b) SHIPPING DEADLINES: a store's Christmas order-by day from its own published holiday shipping page, a small chip
 *       on its cards until that day passes (hidden after, by the day in Louisiana);
 *   (c) the 25 Days banner and (d) the Declutter tie-in, each behind a manual flag that is OFF here: the lead turns one
 *       on (a one-line change below) on the owner's word, (c) only after her Sunday Nov 22 Facebook post.
 * Guard: src/test/giftGuideExtras1120.test.tsx.
 */

// ---------------------------------------------------------------------------------------------------------------
// (a) Gift finder

export type FinderWho = "her" | "him" | "mom" | "dad" | "kids" | "teen" | "friend" | "coworker" | "grandparent";

/** Who the gift is for: the label and the guide (and, for a merged guide, its sections) the picks come from. */
export const FINDER_WHO: { id: FinderWho; label: string; guides: { slug: string; sections?: string[] }[] }[] = [
  { id: "her", label: "Her", guides: [{ slug: "her" }] },
  { id: "him", label: "Him", guides: [{ slug: "him" }] },
  { id: "mom", label: "Mom", guides: [{ slug: "mom" }] },
  { id: "dad", label: "Dad", guides: [{ slug: "dad" }] },
  // Holiday audit 1121 (High): Kids is the owner's one flat list (no sections since 11-21), so the finder takes the
  // whole guide; the old "little-kids" / "big-kids" sections matched none of its 56 picks and Kids came up empty.
  // Friends and Coworkers are sections of Friends & Coworkers.
  { id: "kids", label: "Kids", guides: [{ slug: "kids" }] },
  // Owner 11-20 evening: Teens is its own guide.
  { id: "teen", label: "Teen", guides: [{ slug: "teens" }] },
  // Owner's standard plan 11-20 evening: "For your best friend" holds 11 picks, 8 once the finder keeps one per brand and
  // gift type; the Secret Santa picks take turns with them so a friend still gets a full list.
  { id: "friend", label: "Friend", guides: [{ slug: "friends-and-coworkers", sections: ["for-your-best-friend"] }, { slug: "friends-and-coworkers", sections: ["secret-santa-and-white-elephant"] }] },
  { id: "coworker", label: "Coworker", guides: [{ slug: "friends-and-coworkers", sections: ["for-the-office-coworkers-and-the-boss"] }] },
  { id: "grandparent", label: "Grandparent", guides: [{ slug: "grandparents" }] },
];

// ---------------------------------------------------------------------------------------------------------------
// (b) Shipping deadlines

/**
 * Each store's Christmas order-by day, read from that store's own published holiday shipping page (owner: "per-store
 * order-by dates from each store's published holiday shipping page"). A row is added only with its source page and
 * the day it was read; never a guess and never last year's date. On 2026-11-20 Amazon, Walmart and Target had not
 * published their 2026 dates (dealhack.com/Deadlines, checked 2026-11-03), so the table starts empty and each store's
 * row joins when its page is up. Keys are the catalog's store keys ("amazon", "store-target").
 */
export const SHIP_DEADLINES: Record<string, { orderBy: string; method: string; source: string; readOn: string }> = {};

/** Today in Louisiana, "YYYY-MM-DD". */
export const louisianaToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** A store's chip on `today`: "Order by Dec 18" through that day, then null (the cutoff passed). */
export const deadlineChip = (store: string, today: string, table = SHIP_DEADLINES): string | null => {
  const d = table[store];
  if (!d || today > d.orderBy) return null;
  const day = new Date(`${d.orderBy}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Order by ${day}`;
};

// ---------------------------------------------------------------------------------------------------------------
// (c) and (d): the gated banners (manual flags, OFF)

/**
 * The lead flips each `on` on the owner's word (a one-line change, landed like any other): the 25 Days banner only
 * after her Sunday Nov 22 Facebook post (and never before `from`), the Declutter link once she announces the app.
 */
export const GIFT_GUIDE_FLAGS = {
  giveawayBanner: { on: false, from: "2026-11-22" },
  declutterTieIn: { on: false },
} as const;

/** Whether the 25 Days banner shows on `today` (its flag on, and not before its first day). */
export const giveawayBannerOn = (today: string, flags: { on: boolean; from: string } = GIFT_GUIDE_FLAGS.giveawayBanner) => flags.on && today >= flags.from;
/** Whether the Declutter link shows. */
export const declutterTieInOn = (flags: { on: boolean } = GIFT_GUIDE_FLAGS.declutterTieIn) => flags.on;

/** The finder's anchor on the landing (/gift-guides#gift-finder opens it; the sidebar links it). */
export const FINDER_ANCHOR = "gift-finder";

/** The gift quiz's words (owner 2026-11-21 ~6:15 PM: a real quiz that narrows the list; src/content/giftQuiz.ts). */
export const EXTRAS_WORDS = {
  finderTitle: "Find a gift in 3 taps",
  finderLead: "A few quick questions, then a short list of gifts that fit.",
  finderWho: "Who's it for?",
  quizAge: "How old?",
  finderBudget: "Your budget",
  quizInto: "What are they into?",
  quizStepOf: (n: number, of: number) => `Step ${n} of ${of}`,
  quizBack: "Back",
  quizLoading: "Finding gifts…",
  quizResults: (forWords: string) => `Our picks for ${forWords}`,
  quizWidened: "Only a few fit that budget, so we added some just outside it.",
  quizMore: "Show me more",
  quizWholeGuide: (guide: string) => `See the whole ${guide} guide`,
  finderShare: "Copy link to these picks",
  finderCopied: "Link copied",
  finderAgain: "Start over",
};
