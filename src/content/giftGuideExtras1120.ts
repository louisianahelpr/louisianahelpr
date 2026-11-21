/**
 * The gift guides' big batch 1120 extras (owner approved 11-19 ~9:10 PM, FOLLOWUP-OWNER-1119.md item 83):
 *   (a) the GIFT FINDER: three taps (who, budget, vibe) give the best picks (exact, then close matches) from the guides, with a share link
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
  // Follow-up 1120: Kids is one guide by age; Friends and Coworkers are sections of Friends & Coworkers.
  { id: "kids", label: "Kids", guides: [{ slug: "kids", sections: ["little-kids"] }, { slug: "kids", sections: ["big-kids"] }] },
  // Owner 11-20 evening: Teens is its own guide.
  { id: "teen", label: "Teen", guides: [{ slug: "teens" }] },
  { id: "friend", label: "Friend", guides: [{ slug: "friends-and-coworkers", sections: ["for-your-best-friend"] }] },
  { id: "coworker", label: "Coworker", guides: [{ slug: "friends-and-coworkers", sections: ["for-the-office-coworkers-and-the-boss"] }] },
  { id: "grandparent", label: "Grandparent", guides: [{ slug: "grandparents" }] },
];
export const FINDER_BUDGETS: { id: FinderBudget; label: string }[] = [
  { id: 25, label: "Under $25" }, { id: 50, label: "Under $50" }, { id: 100, label: "Under $100" }, { id: 0, label: "Any budget" },
];
/** The vibe: its label and the words (name, brand, gift type) that mark a pick as that vibe. */
export const FINDER_VIBES: { id: FinderVibe; label: string; words: RegExp }[] = [
  { id: "cozy", label: "Cozy", words: /\b(cozy|cosy|sherpa|fleece|blanket|throw|slippers?|robe|pajamas?|pj|socks?|candle|sweatshirt|hoodie|barefoot dreams|ugg|weighted|heated)\b/i },
  { id: "practical", label: "Practical", words: /\b(tumbler|bottle|organizer|charger|charging|wallet|tool|kit|bag|backpack|tote|case|pouch|lunch|cooler|knife|multi-?tool|flashlight|headlamp|scanner|planner)\b/i },
  { id: "trendy", label: "Trendy", words: /\b(stanley|owala|lululemon|jellycat|sol de janeiro|laneige|rare beauty|stoney clover|baublebar|summer fridays|dyson|crocs|squishmallow|needoh)\b/i },
  { id: "louisiana", label: "Louisiana", words: /\b(louisiana|lsu|saints|new orleans|nola|cajun|creole|acadiana|crawfish|beignet|mardi gras|fleur de lis|bayou|geaux)\b/i },
  { id: "outdoorsy", label: "Outdoorsy", words: /\b(yeti|cooler|fishing|fish|hunting|hunt|camp|camping|hiking|costa|huk|simms|aftco|columbia|boots?|rain|kayak|boat|grill|solo stove|duck|deer|outdoor)\b/i },
];
/** How many picks the finder shows (owner 11-20: always a list, 6 to 12): the exact matches, then close ones up to this. */
export const FINDER_COUNT = 9;

/**
 * Gift types (the import's `type`) that are a vibe whatever the name says (holiday audit A #67: Her + Outdoorsy listed
 * five beauty items, Kids + Outdoorsy a Barbie and puffy pens).
 */
const VIBE_TYPES: Partial<Record<FinderVibe, RegExp>> = {
  cozy: /^(pajamas|robe|slippers|throw-blanket|blanket|candle|socks|sweatshirt|baby-clothes)$/,
  practical: /^(wallet|bag|tools?|tech-accessory|drinkware|luggage|kitchen-tool|cookware|accessory|cooler)$/,
  outdoorsy: /^(cooler|boots|outdoor|grill|fishing|hunting|camping|ride-on)$/,
};
/** Gift types that are never "outdoorsy", whatever a word in the name says (a "rain" hair oil, a "Columbia" lip). */
const NOT_OUTDOORSY = /^(skincare|makeup|lip|fragrance|hair-care|hair-tool|hair-accessory|beauty-device|body-care|nails|jewelry|doll|art-supplies|stationery|plush)$/;
/** A pick is the vibe: its badges (TikTok/trending, Louisiana), its gift type or its words. */
const isVibe = (p: CatalogPick, vibe: FinderVibe) => {
  const v = FINDER_VIBES.find((x) => x.id === vibe)!;
  if (vibe === "trendy" && p.badges?.some((b) => b === "tiktok" || b === "trending")) return true;
  // Only "Louisiana-made": the national 25 Days sponsors (K18, SRI) carry the sponsor and shop badges too (holiday audit
  // A #64); the Louisiana guides' own picks join through giftFinder's `local` list.
  if (vibe === "louisiana" && p.badges?.some((b) => b === "louisiana-made")) return true;
  if (vibe === "outdoorsy" && NOT_OUTDOORSY.test(p.type ?? "")) return false;
  if (VIBE_TYPES[vibe]?.test(p.type ?? "")) return true;
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

/** A budget guide section's ceiling: its anchor ("under-25", "100-and-up") or its heading ("Under $25", "$100 & Up"). */
const SECTION_BANDS: Record<string, 25 | 50 | 100 | 500> = { "under-25": 25, "under-50": 50, "under-100": 100, "100-and-up": 500 };
const sectionBand = (p: CatalogPick): 25 | 50 | 100 | 500 | undefined => {
  if (p.sectionId && SECTION_BANDS[p.sectionId]) return SECTION_BANDS[p.sectionId];
  const m = /^under \$(\d+)$/i.exec(p.section?.trim() ?? "");
  if (m) return Number(m[1]) <= 25 ? 25 : Number(m[1]) <= 50 ? 50 : Number(m[1]) <= 100 ? 100 : 500;
  return /^\$100 (&|and) up$/i.test(p.section?.trim() ?? "") ? 500 : undefined;
};
/**
 * What a pick costs, as a band ($25, $50, $100; 500 = over $100): its own band, else its checked price, else the
 * budget section it sits in ("Under $25"). Amazon picks carry no band or price (Amazon allows no price outside its
 * own site), so a budget section is the only way one joins a budget; the band is only used to sort, never shown.
 */
export const pickBand = (p: CatalogPick): 25 | 50 | 100 | 500 | undefined => {
  if (p.band !== undefined) return p.band;
  if (p.price !== undefined && p.store !== "amazon") return p.price <= 25 ? 25 : p.price <= 50 ? 50 : p.price <= 100 ? 100 : 500;
  return sectionBand(p);
};

/** The guides whose sections are budgets ("Under $25", "Under $100"): the finder borrows from them when a person's own guide runs short. */
export const FINDER_BUDGET_GUIDES = ["gifts-by-budget", "splurge"];
/**
 * The Louisiana guides: the "Louisiana" vibe draws from them for every person (holiday audit A #64: Dad, Friend, Kids
 * and Mom + Louisiana listed no Louisiana item at all, since Louisiana things live only in these guides).
 */
export const FINDER_LOUISIANA_GUIDES = ["shop-small-louisiana", "louisiana-by-region", "louisiana-celebrations", "louisiana-food-gifts"];
/** Fewer picks than this and the finder points to the person's own guide too (holiday audit A #65). */
export const FINDER_FEW = 3;

/** Toys and kids' things: a grown-up's finder never borrows them; a kid's borrows only them. */
const KID_THING = /\b(play-?doh|rainbow loom|loomi|melissa (&|and) doug|squish\w*|lincoln logs|barbie|dolls?|plush|play ?sets?|toys?|paint sticks|dive buddies|ms\.? rachel|lego|stacker|kids?'?)\b/i;
/** The guides' men's/women's rules (scripts/giftGuideRules.mjs mensItem, WORK_BOOT_OFF), for picks borrowed from a budget guide. */
const MENS = /\b(men'?s|mens|for men|boys'?)\b|^huk$/i;
const WOMENS = /\b(women'?s|womens|ladies|girls'?|lip|gloss|balm|makeup|mascara|blush|nail|mani|earrings|huggies|hoops?|bobby pins|hair|scrunchies?|bows?|eye patches|eye mask|perfume|parfum|tote|racerback|bandana|welly|emi jay|kitsch|summer fridays|tower 28|olive (&|and) june|sol de janeiro|laneige|bareminerals|benefit|kate spade|spartina|gorjana|baublebar|bath (&|and) body works)\b/i;
const WORK_BOOT = /\b(work boots?|chore (boots?|classic)|steel toe|muckster|wetland boot)\b|^muck boot$/i;
/**
 * Gift types (the import's `type`) that are women's gifts unless the name says men's: beauty, bath and body, hair and
 * jewelry. Live check 11-20: Dad + Under $25 + Outdoorsy filled with a shower oil (type "bath") and pimple patches
 * ("skincare") whose names no word list caught.
 */
const WOMENS_TYPE = /^(skincare|makeup|lip|nails?|bath|body-care|body care|body wash|body cream|hair-?care|hair-tool|hair-accessory|fragrance|fragrance mist|perfume|jewelry|earrings|lash|lashes|beauty|beauty-device|sleep-mask|cosmetic case)$/i;
/** Beauty and body care by name, for a pick whose type is missing or wrong (Bondi Boost shampoo came in typed "shoes"). */
const BEAUTY_NAME = /\b(shampoo|conditioner|volumi[sz]ing|serum|moisturi[sz]er|body (wash|cream|lotion|butter|oil|mist)|shower oil|pimple|mighty patch|eye patch(es)?|face mask|sheet mask)\b/i;
/** Gift types that are men's gifts unless the name says women's (the reverse rule, for Her and Mom). */
const MENS_TYPE = /^(cologne|aftershave|beard|shaving|razor|hunting)$/i;
/** Whether a pick suits this person: men's things never go to Her/Mom, women's things never to Him/Dad, toys only to Kids. */
const finderFits = (who: FinderWho, p: CatalogPick) => {
  const text = `${p.name} ${p.brand ?? ""}`;
  if (who === "kids") return KID_THING.test(text);
  if (KID_THING.test(text)) return false;
  if (who === "her" || who === "mom") return !MENS.test(p.name) && !MENS.test(p.brand ?? "") && !WORK_BOOT.test(p.name) && !(MENS_TYPE.test(p.type ?? "") && !WOMENS.test(p.name));
  if (who === "him" || who === "dad") return !WOMENS.test(text) && !((WOMENS_TYPE.test(p.type ?? "") || BEAUTY_NAME.test(p.name)) && !MENS.test(p.name));
  return true;
};
/**
 * One card per near-duplicate: the same brand's same gift type ("Stanley" + "can-cooler": the 10 oz Everyday Can Cooler
 * and the Everyday Slim Can Cooler both showed for Mom + Under $25 + Trendy), else the same name once sizes, counts and
 * the colour after a comma are dropped.
 */
export const nearDupKey = (p: CatalogPick) => {
  const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const brand = fold(p.brand ?? "");
  if (brand && p.type && p.type !== "other") return `${brand}|${fold(p.type)}`;
  return fold(p.name.split(",")[0].replace(/\b\d+(\.\d+)?\s*(oz|ml|l|in|inch|ct|count|pack|pk|piece|pc)\b|["”]/gi, ""));
};

/** The finder's answer: the picks that fit all three, then the closest ones (shown under "Close matches"). */
interface FinderResult { exact: CatalogPick[]; close: CatalogPick[] }
/** Gift types any number of which may show (no type to repeat). */
const ANY_TYPE = new Set(["other", ""]);

/**
 * The finder's picks (owner 11-20: "always show a list from those 3 picks"), each link once, at most one per brand and
 * (in the close matches) one per gift type, so one can cooler, one pair of socks (holiday audit A #66, #69):
 *   1. exact: this person's picks within the budget and the vibe; for "Louisiana", the Louisiana guides' picks that
 *      suit this person within the budget too (A #64);
 *   then, as close matches, until FINDER_COUNT, ALWAYS for this person and within the budget (A #65: Dad + Under $25
 *   listed shampoo, pimple patches and a $50 tumbler); only the vibe relaxes:
 *   2. this person's picks within the budget, any vibe;
 *   3. the budget guides' picks within the budget that suit this person (men's/women's, kids), vibe first;
 *   4. for "Louisiana", the Louisiana guides' picks that suit this person within the budget.
 * A pick with no known price fits only "Any budget" (Amazon shows none). Fewer than FINDER_FEW in all and the page links
 * the person's own guide. Each tier keeps the guide's own order (commission, high to low).
 */
export const giftFinder = (pool: CatalogPick[], budget: FinderBudget, vibe: FinderVibe, borrow: CatalogPick[] = [], who?: FinderWho, local: CatalogPick[] = []): FinderResult => {
  const fits = (p: CatalogPick) => { const b = pickBand(p); return budget === 0 || (b !== undefined && b <= budget); };
  const vibed = (p: CatalogPick) => isVibe(p, vibe);
  const suits = (p: CatalogPick) => !who || finderFits(who, p);
  const lent = budget === 0 || !who ? [] : borrow.filter((p) => fits(p) && suits(p));
  // The person's own list is theirs, but never hands Dad a women's item, nor Mom a men's one (gg-live-1120).
  const own = who ? pool.filter((p) => suits(p) || who === "kids") : pool;
  const louisiana = vibe === "louisiana" ? local.filter((p) => fits(p) && (who === "kids" ? KID_THING.test(`${p.name} ${p.brand ?? ""}`) || /\b(baby|toddler|youth|kids?)\b/i.test(p.name) : suits(p))) : [];
  const seen = new Set<string>();
  const near = new Set<string>();
  const brands = new Set<string>();
  const types = new Map<string, number>();
  const typeOf = (p: CatalogPick) => (ANY_TYPE.has(p.type ?? "") ? "" : (p.type as string));
  const take = (list: CatalogPick[], into: CatalogPick[], cap: number, typeMax: number) => {
    for (const p of list) {
      if (into.length >= cap) return;
      const key = nearDupKey(p);
      const brand = (p.brand ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const t = typeOf(p);
      if (seen.has(p.href) || near.has(key) || (brand && brands.has(brand)) || (t && (types.get(t) ?? 0) >= typeMax)) continue;
      seen.add(p.href);
      near.add(key);
      if (brand) brands.add(brand);
      if (t) types.set(t, (types.get(t) ?? 0) + 1);
      into.push(p);
    }
  };
  const exact: CatalogPick[] = [];
  take([...own.filter((p) => fits(p) && vibed(p)), ...louisiana], exact, FINDER_COUNT, 2);
  const close: CatalogPick[] = [];
  const room = FINDER_COUNT - exact.length;
  for (const tier of [own.filter(fits), lent.filter(vibed), lent, louisiana]) take(tier, close, room, 1);
  return { exact, close };
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
  // Owner 11-20 12:30 PM landing plan: the big call to action's one line under its title.
  finderLead: "Pick who it's for, your budget and their vibe. We'll show up to 9 gifts.",
  finderWho: "Who's it for?",
  finderBudget: "Your budget",
  finderVibe: "Their vibe",
  finderResults: "Our picks for you",
  finderShare: "Copy link to these picks",
  finderCopied: "Link copied",
  finderAgain: "Start over",
  finderClose: "Close matches",
  finderNone: "No picks for them yet. Try someone else.",
  finderFew: (guide: string) => `Only a few fit. See every gift in the ${guide} guide`,
  giveawayBanner: "25 Days of Louisiana Giveaways: a new Louisiana prize every day, Dec 1 to 25. See how to enter",
  declutterTieIn: "Sell what you don't use to pay for gifts, on Declutter",
};
