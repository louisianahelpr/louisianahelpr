/**
 * OWNER, 11-20 NIGHT ("there are too many random sections", "gifts needs to be more affordable", "you're not spending
 * 100 dollars on a gift for a friend"). The last pass of the import, on the finished pages:
 *   1. her removals by tap (scripts/gift-guide-owner-removals-1120.json: per guide, the slug of each item's name, and
 *      `everywhere`: the 10:20 PM list that leaves every guide and store page), so a regenerate never brings one back;
 *   2. her notes: Southern Tide off every men's guide, one cast iron pan on Him, sponsor items off Her where a better
 *      known brand holds the same kind of gift (Her keeps one bag: the YETI Camino, after her taps);
 *   3. the price rule: Friends & Coworkers holds nothing over $50, every other guide nothing over $100, except her own
 *      picks and keeps, and the guides whose point is a price (gifts by budget, splurge) or a prize (the sponsors page);
 *   4. one flat list per guide (the page draws no section headings): cheaper first, by price tier, like items together;
 *   5. Fabletics photos on the standard-size model (the feed's `model=p` is the plus-size model photo).
 * A pick with no checked price (Amazon never shows one) cannot be judged by price and stays.
 * Guard: src/test/giftGuideFlatAffordable1120.test.ts.
 */
import { SPONSORS_GUIDE_1120E, brandCapCuts1120e, sponsorBrands1120e, sponsorOff1120e } from "./giftGuideRules.mjs";

export const ownerKey = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** The price caps. */
export const FRIENDS_GUIDE = "friends-and-coworkers";
export const FRIENDS_MAX = 50;
export const GUIDE_MAX = 100;
/** Guides the price rule leaves alone: the price tiers themselves, and the sponsors' prize page. */
export const PRICE_RULE_EXEMPT = new Set(["gifts-by-budget", "splurge", "25-days-sponsors"]);
/** Her keeps over the cap, by name (owner 11-20), besides every `ownerPick`. */
export const OWNER_KEPT = /\bYETI Camino\b|\bKitsch\b.*\bAdvent\b|\blululemon Define\b|\bDrowsy\b.*\bSleep Mask\b|\bTurboBlade\b|\bBedJet\b|\bEvelina Clog\b|\bXTRATUF\b|\bToddler\b.*\bAdvent\b|\bAdvent\b.*\bToddler\b/i;

/** The men's guides Southern Tide leaves (owner: "remove southern tide", on Him). */
export const MEN_GUIDES_1120E = new Set(["him", "dad", "husband", "boyfriend", "brother", "father-in-law", "grandpa", "son", "uncle", "nephew", "brother-in-law", "new-dad", "boys-teens"]);
const CAST_IRON_PAN = /\bcast iron\b.*\b(skillet|pan)\b/i;
/** Sponsor items off Her: a better known brand on the page holds the same kind of gift (Sol de Janeiro, Glossier, Saie). */
export const HER_SPONSOR_OFF = /^(IDRA Wellness Body Lotion|Timeless Skin Care The Holiday Survival Bundle)$/i;

/** Guides whose sections are the point of the order (a color): sections stay together, cheaper first inside each. */
const SECTION_FIRST = new Set(["gifts-by-color"]);
const tier = (p) => {
  const v = typeof p.price === "number" ? p.price : typeof p.band === "number" ? p.band : null;
  return v === null ? 1 : v <= 25 ? 0 : v <= 50 ? 1 : v <= 100 ? 2 : 3;
};
/** One flat order: price tier (cheapest first), then the pick's old section, then its type, then its price. */
export const flatOrder = (slug, list) => {
  const first = (key) => { const at = new Map(); list.forEach((p, i) => { const k = key(p); if (!at.has(k)) at.set(k, i); }); return (p) => at.get(key(p)); };
  const sec = first((p) => p.sectionId ?? p.section ?? "");
  const type = first((p) => p.type ?? "other");
  const price = (p) => (typeof p.price === "number" ? p.price : Infinity);
  const rows = list.map((p, i) => ({ p, i }));
  const by = SECTION_FIRST.has(slug)
    ? (a, b) => sec(a.p) - sec(b.p) || tier(a.p) - tier(b.p) || type(a.p) - type(b.p) || price(a.p) - price(b.p) || a.i - b.i
    : (a, b) => tier(a.p) - tier(b.p) || sec(a.p) - sec(b.p) || type(a.p) - type(b.p) || price(a.p) - price(b.p) || a.i - b.i;
  return rows.sort(by).map((r) => r.p);
};

/** A Fabletics photo on the standard-size model. */
export const fableticsPhoto = (url) => (/^https:\/\/cdn\.fabletics\.com\//.test(String(url ?? "")) ? String(url).replace(/([?&])model=p&/, "$1").replace(/[?&]model=p$/, "") : url);

/** Store pages are a store's own shelf (a HOKA page with no shoes helps no one), so the gift price cap skips them. */
export const priceCapOf = (slug) => (PRICE_RULE_EXEMPT.has(slug) || slug.startsWith("store-") ? Infinity : slug === FRIENDS_GUIDE ? FRIENDS_MAX : GUIDE_MAX);
/** True when the price rule removes this pick from this guide. Friends & Coworkers keeps nothing over its cap, her picks included. */
export const overPrice = (slug, p) => {
  if (typeof p.price !== "number" || p.price <= priceCapOf(slug)) return false;
  if (slug === FRIENDS_GUIDE) return true;
  return !(p.ownerPick || OWNER_KEPT.test(String(p.name ?? "")));
};

/**
 * Applies the pass in place. `log` collects what left: { tapped: [guide, name][], notes: [...], price: [guide, name, price][] }.
 * Safe to run twice (the import runs it before the Top 10 is drawn and again after the last renames).
 */
/** Owner 11-20 9:50 and 9:53 PM: "remove the color guides", "remove the pet guides". Their lists are dropped whole, never re-homed. */
export const REMOVED_GUIDES_1120E = ["gifts-by-color", "red-lover", "pink-lover", "purple-lover", "blue-lover", "green-lover", "yellow-lover", "black-lover", "neutral-lover", "pets", "dog-lover", "cat-person", "new-puppy", "new-kitten", "horse-lover", "fish-lover", "bird-lover"];

/**
 * OWNER RESET 11-20 10:25 PM ("yes lets do that"): only Her, Him, Kids, Teens, Grandparents, Friends & Coworkers, the Louisiana guides and
 * the 25 Days sponsors page stay on the site. These are unpublished, not deleted: their source lists stay in the import, their pages are not
 * written, and their links open the gift guides page (REMOVED_GUIDES, giftGuideCatalog.ts). Delete a slug in both places to bring it back.
 */
export const UNPUBLISHED_GUIDES_1120E = ["car-lover", "coffee-lover", "creative-and-entertainment", "family", "fitness", "gift-wrap-and-cards", "gifts-by-budget", "healthcare", "heroes", "home-and-kitchen", "life-moments", "outdoors-and-travel", "splurge", "work-life"];

export function applyOwner1120e(pageList, spec, log = { tapped: [], notes: [], price: [], brand: [] }) {
  log.brand ??= [];
  for (const gone of [...REMOVED_GUIDES_1120E, ...UNPUBLISHED_GUIDES_1120E]) delete pageList[gone];
  const seen = new Set([...log.tapped, ...log.notes, ...log.price, ...(log.brand ?? []), ...(log.sponsor ?? [])].map((r) => `${r[0]}|${r[1]}`));
  const note = (bucket, slug, p, extra) => { const k = `${slug}|${p.name}`; if (!seen.has(k)) { seen.add(k); log[bucket].push(extra === undefined ? [slug, p.name] : [slug, p.name, extra]); } };
  const sponsorBrands = sponsorBrands1120e(pageList[SPONSORS_GUIDE_1120E], spec.sponsorNames ?? []);
  const louisiana = new Set(spec.louisianaGuides ?? []);
  const everywhere = new Set(spec.everywhere ?? []);
  log.sponsor ??= [];
  for (const slug of Object.keys(pageList)) {
    const tapped = new Set((spec.removals?.[slug] ?? []).map((r) => r.key));
    // "ok remove the ones i selected" (10:20 PM): `everywhere` keys leave every guide and store page, sponsors and Louisiana included.
    let list = pageList[slug].filter((p) => (tapped.has(ownerKey(p.name)) || everywhere.has(ownerKey(p.name)) ? (note("tapped", slug, p), false) : true));
    if (MEN_GUIDES_1120E.has(slug)) list = list.filter((p) => (/southern tide/i.test(`${p.brand ?? ""} ${p.name}`) ? (note("notes", slug, p, "Southern Tide off men's guides"), false) : true));
    if (slug === "him") {
      const pans = list.filter((p) => CAST_IRON_PAN.test(p.name));
      const keep = pans.find((p) => /skillet/i.test(p.name)) ?? pans[0];
      list = list.filter((p) => (CAST_IRON_PAN.test(p.name) && p !== keep ? (note("notes", slug, p, "one cast iron pan"), false) : true));
    }
    if (slug === "her") list = list.filter((p) => (HER_SPONSOR_OFF.test(p.name) ? (note("notes", slug, p, "sponsor item, a better known brand holds the spot"), false) : true));
    list = list.filter((p) => (overPrice(slug, p) ? (note("price", slug, p, p.price), false) : true));
    // 25 Days sponsor items stay on the sponsors page and the Louisiana guides only.
    list = list.filter((p) => (sponsorOff1120e(slug, p, sponsorBrands, louisiana) ? (note("sponsor", slug, p, p.brand ?? ""), false) : true));
    // One Crew Dog on the whole site, and two of any other brand a guide (scripts/giftGuideRules.mjs).
    const brandCuts = brandCapCuts1120e(slug, list, (p) => Boolean(p.ownerPick) || OWNER_KEPT.test(String(p.name ?? "")));
    list = list.filter((p) => (brandCuts.has(p) ? (note("brand", slug, p, p.brand ?? ""), false) : true));
    list = list.map((p) => (p.image && fableticsPhoto(p.image) !== p.image ? { ...p, image: fableticsPhoto(p.image) } : p));
    pageList[slug] = flatOrder(slug, list);
  }
  return log;
}
