/**
 * The gift guides' big batch 1120 extras (owner approved 11-19 ~9:10 PM, FOLLOWUP-OWNER-1119.md item 83):
 *   (a) the GIFT FINDER: three taps (who, budget, vibe) give the six best picks from the guides, with a share link
 *       (the answers ride in the URL) and no sign-in;
 *   (b) SHIPPING DEADLINES: a store's Christmas order-by day from its own published holiday shipping page, a small chip
 *       on its cards until that day passes (hidden after, by the day in Louisiana);
 *   (c) the 25 Days banner and (d) the Declutter tie-in, each behind a manual flag that is OFF here: the lead turns one
 *       on (a one-line change below) on the owner's word, (c) only after her Sunday Nov 22 Facebook post.
 * Guard: src/test/giftGuideExtras1120.test.tsx.
 */
import type { CatalogPick } from "@/content/giftGuideCatalog";

// ---------------------------------------------------------------------------------------------------------------
// (a) Gift finder

export type FinderWho = "her" | "him" | "mom" | "dad" | "kids" | "teen" | "friend" | "coworker" | "grandparent";
export type FinderVibe = "cozy" | "practical" | "trendy" | "louisiana" | "outdoorsy";
export type FinderBudget = 25 | 50 | 100 | 0;

/** Who the gift is for: the label and the guide (and, for a merged guide, its sections) the picks come from. */
export const FINDER_WHO: { id: FinderWho; label: string; guides: { slug: string; sections?: string[] }[] }[] = [
  { id: "her", label: "Her", guides: [{ slug: "her" }] },
  { id: "him", label: "Him", guides: [{ slug: "him" }] },
  { id: "mom", label: "Mom", guides: [{ slug: "mom" }] },
  { id: "dad", label: "Dad", guides: [{ slug: "dad" }] },
  { id: "kids", label: "Kids", guides: [{ slug: "gender-neutral", sections: ["gender-neutral-little-kids", "gender-neutral-big-kids"] }, { slug: "girls", sections: ["girls-little-kids", "girls-big-kids"] }, { slug: "boys", sections: ["boys-little-kids", "boys-big-kids"] }] },
  { id: "teen", label: "Teen", guides: [{ slug: "girls", sections: ["girls-teens"] }, { slug: "boys", sections: ["boys-teens"] }, { slug: "gender-neutral", sections: ["gender-neutral-teens"] }] },
  { id: "friend", label: "Friend", guides: [{ slug: "friends" }] },
  { id: "coworker", label: "Coworker", guides: [{ slug: "work-gifts" }] },
  { id: "grandparent", label: "Grandparent", guides: [{ slug: "grandparents" }] },
];
export const FINDER_BUDGETS: { id: FinderBudget; label: string }[] = [
  { id: 25, label: "Under $25" }, { id: 50, label: "Under $50" }, { id: 100, label: "Under $100" }, { id: 0, label: "Any budget" },
];
/** The vibe: its label and the words (name, brand, gift type) that mark a pick as that vibe. */
export const FINDER_VIBES: { id: FinderVibe; label: string; words: RegExp }[] = [
  { id: "cozy", label: "Cozy", words: /\b(cozy|cosy|sherpa|fleece|blanket|throw|slippers?|robe|pajamas?|pj|socks?|candle|sweatshirt|hoodie|barefoot dreams|ugg|weighted|heated)\b/i },
  { id: "practical", label: "Practical", words: /\b(tumbler|bottle|organizer|charger|charging|wallet|tool|kit|bag|backpack|tote|case|pouch|lunch|cooler|knife|multi-?tool|flashlight|headlamp|scanner|planner)\b/i },
  { id: "trendy", label: "Trendy", words: /\b(stanley|owala|lululemon|jellycat|sol de janeiro|laneige|rare beauty|stoney clover|baublebar|summer fridays|dyson|crocs|squishmallow|needoh|kendra scott)\b/i },
  { id: "louisiana", label: "Louisiana", words: /\b(louisiana|lsu|saints|new orleans|nola|cajun|creole|acadiana|crawfish|beignet|mardi gras|fleur de lis|bayou|geaux)\b/i },
  { id: "outdoorsy", label: "Outdoorsy", words: /\b(yeti|cooler|fishing|fish|hunting|hunt|camp|camping|hiking|costa|huk|simms|aftco|columbia|boots?|rain|kayak|boat|grill|solo stove|duck|deer|outdoor)\b/i },
];
/** How many picks the finder shows. */
export const FINDER_COUNT = 6;

/** A pick is the vibe: its badges (TikTok/trending, Louisiana) or its words. */
const isVibe = (p: CatalogPick, vibe: FinderVibe) => {
  const v = FINDER_VIBES.find((x) => x.id === vibe)!;
  if (vibe === "trendy" && p.badges?.some((b) => b === "tiktok" || b === "trending")) return true;
  if (vibe === "louisiana" && p.badges?.some((b) => b === "louisiana-made" || b === "shop-louisiana" || b === "sponsor")) return true;
  return v.words.test(`${p.name} ${p.brand ?? ""}`);
};

/** The picks one "who" draws from, in each guide's own order (commission, high to low). */
export const finderPool = (who: FinderWho, picksOf: (slug: string) => CatalogPick[]): CatalogPick[] => {
  const w = FINDER_WHO.find((x) => x.id === who);
  if (!w) return [];
  const lists = w.guides.map((g) => picksOf(g.slug).filter((p) => !g.sections || (p.sectionId !== undefined && g.sections.includes(p.sectionId))));
  // Interleave the guides (Girls, Boys, Gender-neutral take turns) so one never fills all six places.
  const out: CatalogPick[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
};

/**
 * The finder's six: the vibe's picks within the budget first, then the rest within the budget (so a narrow vibe still
 * gives six), each link once. A budget keeps only picks with a known band at most the budget (Amazon picks carry no
 * band: Amazon allows no price outside its own site, so they show only with "Any budget").
 */
export const giftFinder = (pool: CatalogPick[], budget: FinderBudget, vibe: FinderVibe): CatalogPick[] => {
  const fits = (p: CatalogPick) => budget === 0 || (p.band !== undefined && p.band <= budget);
  const seen = new Set<string>();
  const out: CatalogPick[] = [];
  for (const p of [...pool.filter((x) => fits(x) && isVibe(x, vibe)), ...pool.filter(fits)]) {
    if (out.length >= FINDER_COUNT) break;
    if (seen.has(p.href)) continue;
    seen.add(p.href);
    out.push(p);
  }
  return out;
};

/** The answers in a share link's query ("?who=her&budget=50&vibe=cozy"), each checked against its options. */
export const readFinder = (params: URLSearchParams): { who?: FinderWho; budget?: FinderBudget; vibe?: FinderVibe } => {
  const who = FINDER_WHO.find((x) => x.id === params.get("who"))?.id;
  const b = params.get("budget");
  const budget = FINDER_BUDGETS.find((x) => String(x.id) === b)?.id;
  const vibe = FINDER_VIBES.find((x) => x.id === params.get("vibe"))?.id;
  return { ...(who ? { who } : {}), ...(budget !== undefined ? { budget } : {}), ...(vibe ? { vibe } : {}) };
};

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

export const EXTRAS_WORDS = {
  finderTitle: "Find a gift in 3 taps",
  finderWho: "Who's it for?",
  finderBudget: "Your budget",
  finderVibe: "Their vibe",
  finderResults: "Our picks for you",
  finderShare: "Copy link to these picks",
  finderCopied: "Link copied",
  finderAgain: "Start over",
  finderNone: "Nothing fits all three yet. Try another budget or vibe.",
  finderAmazonNote: "Amazon picks show with Any budget (Amazon doesn't let us list prices).",
  giveawayBanner: "25 Days of Louisiana Giveaways: a new Louisiana prize every day, Dec 1 to 25. See how to enter",
  declutterTieIn: "Sell what you don't use to pay for gifts, on Declutter",
};
