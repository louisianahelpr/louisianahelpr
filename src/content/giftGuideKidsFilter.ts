import { pickPriceShown, shownDollars } from "@/lib/pickPriceShown.mjs";

/**
 * The For Kids guide's filters (owner pop-up, Mon 2026-11-23 ~10:55 AM: "Age + price + girls/boys"): multi-select chips
 * in the guide's Filter panel, three groups. Within a group the chips add up (3-5 OR 6-8); across groups they narrow
 * (an age AND a price AND who it's for).
 *   - Age: Baby (0-2), 3-5, 6-8, 9-12, Teens, from the maker's or the listing's own recommended age
 *     (src/content/giftGuideKidsTags.json, every age with its source). A gift can sit in more than one band. A gift
 *     with no stated age is never guessed: it stays out of every age chip.
 *   - Price: under $10, $10-$25, $25-$50, $50 and up, by the dollars the card SHOWS (rounded, src/lib/pickPriceShown.mjs),
 *     so a "~$10" gift is in $10-$25 as the eye reads it. A gift showing no price stays out of every price chip.
 *   - Girls / Boys / Everyone: a gift for anyone is "Everyone" and shows under Girls AND under Boys. Girls or Boys only
 *     where the listing itself names one (the tag file's genderSource); anything untagged counts as Everyone.
 * The themed kids guides (Monster Jam, Bluey ...) have the same Filter (owner 2026-11-24 ~7 PM: "add a filter like the
 * main 3 guides"); their tags come from their own picks (src/content/giftGuideThemeTags.ts, loaded on their page only).
 * Guard: src/test/giftGuideKidsFilters1123.test.ts, src/test/giftGuideThemeLayout1124.test.tsx.
 */
export const KIDS_FILTER_GUIDE = "kids";

export type KidAge = "baby" | "3-5" | "6-8" | "9-12" | "teens";
export type KidPrice = "under-10" | "10-25" | "25-50" | "50-up";
export type KidGender = "girls" | "boys" | "everyone";

/** The age bands, in whole years: `lo` inclusive, `hi` exclusive (Baby is 0 up to 3). */
export const KID_AGES: { id: KidAge; label: string; lo: number; hi: number }[] = [
  { id: "baby", label: "Baby (0–2)", lo: 0, hi: 3 },
  { id: "3-5", label: "3–5", lo: 3, hi: 6 },
  { id: "6-8", label: "6–8", lo: 6, hi: 9 },
  { id: "9-12", label: "9–12", lo: 9, hi: 13 },
  { id: "teens", label: "Teens", lo: 13, hi: 18 },
];

/** The price bands, by shown dollars: `lo` inclusive, `hi` exclusive. */
export const KID_PRICES: { id: KidPrice; label: string; lo: number; hi: number }[] = [
  { id: "under-10", label: "Under $10", lo: 0, hi: 10 },
  { id: "10-25", label: "$10–$25", lo: 10, hi: 25 },
  { id: "25-50", label: "$25–$50", lo: 25, hi: 50 },
  { id: "50-up", label: "$50+", lo: 50, hi: Infinity },
];

export const KID_GENDERS: { id: KidGender; label: string }[] = [
  { id: "girls", label: "Girls" },
  { id: "boys", label: "Boys" },
  { id: "everyone", label: "Everyone" },
];

/** One pick's tags (src/content/giftGuideKidsTags.json). Ages in years; no ageMin = the maker states none. */
export interface KidTag {
  name: string;
  gender: KidGender;
  genderSource?: string;
  ageMin?: number;
  ageMax?: number;
  ageSource?: string;
}
export type KidTags = Record<string, KidTag>;

/**
 * A pick's stable key in the tag file: "amazon:<ASIN>" for an Amazon product (any tag or path), else the link's host
 * (no www.) and path, without query or hash. So the tags written today match a pick the other guide branch adds later
 * with its own ?tag= or a /dp/ path variant.
 */
export const tagKey = (href: string): string => {
  const asin = /amazon\.com\/(?:[^/?#]+\/)?dp\/([A-Z0-9]{10})/.exec(href);
  if (asin) return `amazon:${asin[1]}`;
  const bare = href.split(/[?#]/)[0].replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const slash = bare.indexOf("/");
  const host = (slash < 0 ? bare : bare.slice(0, slash)).toLowerCase().replace(/^www\./, "");
  return `${host}/${slash < 0 ? "" : bare.slice(slash + 1)}`;
};

/**
 * The age bands a maker's age covers. A stated range ("5 - 12 years") covers every band it touches. An open "N and up"
 * covers N's own band and the next one (a 3+ toy reads as 3-5 and 6-8, not as a teen gift), since an open age states
 * the youngest it suits, not that a teen wants it.
 */
export const ageBands = (tag: Pick<KidTag, "ageMin" | "ageMax"> | undefined): KidAge[] => {
  if (!tag || typeof tag.ageMin !== "number") return [];
  const min = tag.ageMin;
  if (typeof tag.ageMax === "number") {
    const max = tag.ageMax;
    return KID_AGES.filter((b) => b.lo <= max && min < b.hi).map((b) => b.id);
  }
  const first = KID_AGES.findIndex((b) => min < b.hi);
  return first < 0 ? [] : KID_AGES.slice(first, first + 2).map((b) => b.id);
};

/** The price band of the price a card shows on `today`, or null when it shows none. */
export const priceBand = (pick: { price?: number; priceAt?: string }, today: string): KidPrice | null => {
  if (!pickPriceShown(pick.price, pick.priceAt, today)) return null;
  const d = shownDollars(pick.price);
  return KID_PRICES.find((b) => d >= b.lo && d < b.hi)?.id ?? null;
};

export interface KidsSelection { ages: KidAge[]; prices: KidPrice[]; genders: KidGender[] }
export const NO_KIDS_SELECTION: KidsSelection = { ages: [], prices: [], genders: [] };
export const kidsSelectionCount = (s: KidsSelection) => s.ages.length + s.prices.length + s.genders.length;

/** The gender a pick counts as: its tag's, else Everyone (never a guess toward one). */
const genderOf = (tag: KidTag | undefined): KidGender => tag?.gender ?? "everyone";

/** True when a pick passes every group that has a chip on. */
export function matchesKids(pick: { href: string; price?: number; priceAt?: string }, sel: KidsSelection, tags: KidTags, today: string): boolean {
  const tag = tags[tagKey(pick.href)];
  if (sel.ages.length) {
    const bands = ageBands(tag);
    if (!bands.some((b) => sel.ages.includes(b))) return false;
  }
  if (sel.prices.length) {
    const band = priceBand(pick, today);
    if (!band || !sel.prices.includes(band)) return false;
  }
  if (sel.genders.length) {
    const g = genderOf(tag);
    // Everyone shows under Girls and under Boys.
    const ok = sel.genders.includes(g) || (g === "everyone" && (sel.genders.includes("girls") || sel.genders.includes("boys")));
    if (!ok) return false;
  }
  return true;
}

/** The picks a selection keeps, in their order. */
export const filterKids = <P extends { href: string; price?: number; priceAt?: string }>(picks: P[], sel: KidsSelection, tags: KidTags, today: string): P[] =>
  kidsSelectionCount(sel) === 0 ? picks : picks.filter((p) => matchesKids(p, sel, tags, today));

/**
 * Flow audit 11-23 (B5): the tag file has Girls-only picks but no Boys-only ones, so Girls hid nothing ("140 of 140")
 * and read as broken. Each For chip now names how many gifts it would show with the other groups' chips as they are,
 * so "Girls (140)" says up front that every gift here suits girls. Never a guessed tag to make the numbers move.
 */
export const kidsGenderCounts = <P extends { href: string; price?: number; priceAt?: string }>(picks: P[], sel: KidsSelection, tags: KidTags, today: string): Record<KidGender, number> => {
  const out = { girls: 0, boys: 0, everyone: 0 } as Record<KidGender, number>;
  for (const g of KID_GENDERS) out[g.id] = filterKids(picks, { ...sel, genders: [g.id] }, tags, today).length;
  return out;
};

/** Toggle one chip in a group. */
export const toggleIn = <T extends string>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** The tag file, loaded on the Kids page only (it is not in the shared guides chunk). */
let tagsPromise: Promise<KidTags> | null = null;
export const loadKidTags = (): Promise<KidTags> =>
  (tagsPromise ??= import("@/content/giftGuideKidsTags.json").then(
    (m) => (m.default as unknown as { tags: KidTags }).tags,
    (e: unknown) => {
      // A failed chunk (offline, a stale deploy): forget it so the next visit asks again.
      tagsPromise = null;
      throw e;
    },
  ));
