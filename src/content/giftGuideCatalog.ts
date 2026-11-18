/**
 * /gift-guides (owner 2026-11-18 ~9:05 AM: "open to the sections first ... shop by store, you can choose the store, or
 * the budget, or the person"): every guide the page shows, as one list in three rows. Built from the two content files
 * and nothing else, so no pick, price or link is made up here:
 *   - src/content/giftGuides.ts: the ShopMy sections, their picks, the brand-site picks and the Pinterest links;
 *   - src/content/giftGuidesAmazon.ts: the owner's Amazon guides, copied from her artifact.
 * Every pick carries a `store`, read from its link's host (storeOf), and each "Shop by store" guide is every pick on
 * that store. Guard: src/test/giftGuidesPage.test.tsx.
 */
import { giftGuides, LOUISIANA_MADE_BRANDS, LOUISIANA_SHOPS, SHOPMY_COLLECTIONS, SPONSOR_BRANDS, SPONSOR_SITES, shopmyCollection, type GiftLink, type GiftSection } from "@/content/giftGuides";
import { AMAZON_GUIDES } from "@/content/giftGuidesAmazon";
import { GUIDE_INDEX as OWNER_INDEX } from "@/content/giftGuideIndex";
import { CHUNK_PICK_COUNTS, CHUNK_SLUGS, PICK_CHUNKS, RESEARCHED_STORES, type ResearchedPick, type StoreDeal } from "@/content/giftGuidePicks";

/**
 * The owner's list plus every store page the researched picks name (follow-up batch 2026-11-18: every store or brand
 * we hold a link for gets its own "By store" page), appended to the By store row in name order.
 */
const GUIDE_INDEX: typeof OWNER_INDEX = [
  ...OWNER_INDEX,
  ...Object.entries(RESEARCHED_STORES)
    .filter(([slug]) => !OWNER_INDEX.some((g) => g.slug === slug))
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([slug, st]) => ({ group: "By store", tint: "green" as const, slug, title: st.name, lead: "shop" })),
];

/** A fixed store, or a researched store page's slug ("store-walmart"). */
export type GiftStore = "amazon" | "shopmy" | "zchocolat" | "diecast" | "louisiana" | "sponsor" | (string & {});
type FixedStore = "amazon" | "shopmy" | "zchocolat" | "diecast" | "louisiana" | "sponsor";

/** Each store, the name the page shows and the link hosts that belong to it. */
const FIXED_STORES: Record<FixedStore, { name: string; hosts: readonly string[] }> = {
  amazon: { name: "Amazon", hosts: ["www.amazon.com", "amazon.com", "amzn.to"] },
  shopmy: { name: "ShopMy", hosts: ["shopmy.us"] },
  zchocolat: { name: "zChocolat", hosts: ["www.zchocolat.com"] },
  diecast: { name: "DiecastModelsWholesale", hosts: ["www.diecastmodelswholesale.com"] },
  // The Louisiana shops' own sites (each pick names its brand, so "On <brand>" is shown, not this name).
  louisiana: { name: "a Louisiana shop", hosts: LOUISIANA_SHOPS },
  // The 25 Days sponsors' own sites (each pick names its brand, shown as "On <brand>").
  sponsor: { name: "a 25 Days sponsor", hosts: SPONSOR_SITES },
};

/** Every store: the fixed ones, then each researched store page (its name and the hosts its picks' links use). */
export const STORES: Record<GiftStore, { name: string; hosts: readonly string[] }> = { ...FIXED_STORES, ...RESEARCHED_STORES };

/** The fixed store a pick's link goes to, read from its host. A host on no fixed store is a content error, so it throws. */
export function storeOf(href: string): GiftStore {
  const host = new URL(href).hostname;
  const hit = (Object.keys(FIXED_STORES) as FixedStore[]).find((s) => FIXED_STORES[s].hosts.includes(host));
  if (!hit) throw new Error(`gift guides: ${href} is on no store in STORES`);
  return hit;
}

/** The Amazon Associates ID every Amazon link must carry (owner 2026-11-17). */
export const AMAZON_TAG = "louisianahelpr-20";

/** The three Christmas-neutral gingham palettes of the owner's covers (green, oat, red), one per group, taking turns (GUIDE_INDEX). */
export type GuideTint = (typeof GUIDE_INDEX)[number]["tint"];

export interface CatalogPick {
  name: string;
  href: string;
  store: GiftStore;
  /** A short line, when the content file has one (the ShopMy picks). Amazon items have none: none is invented. */
  line?: string;
  /** The product photo, when the content file has one. Amazon items have none (Amazon allows its product images only
   *  through SiteStripe or its API), so the page draws a letter tile instead. */
  image?: string;
  /** The maker, when the content names one (the researched picks): shown as "On <brand>" for a Louisiana shop. */
  brand?: string;
  /** Badges (owner 2026-11-18), decided from the brand, never from a free-text flag. No price is ever a badge. */
  badges?: PickBadge[];
}

/** The badges a pick can carry (owner 2026-11-18). Optional; a pick with none shows none. */
export type PickBadge = "trending" | "louisiana-made" | "sponsor" | "ships-fast" | "local-pickup";

/**
 * A pick's badges, in this order: Trending (its optional `trending` flag), "Louisiana-made" only when the pick is
 * marked louisianaFit AND its brand is Louisiana-based, "25 Days sponsor" for a sponsor's pick or any pick on the
 * sponsors guide (lead 2026-11-18), Ships fast and Local pickup (optional flags). Never a price.
 */
export const badgesFor = (brand: string | undefined, flags: { louisianaFit?: true; trending?: true; shipsFast?: true; localPickup?: true; sponsor?: true } = {}): PickBadge[] => [
  ...(flags.trending ? (["trending"] as const) : []),
  ...(flags.louisianaFit && brand && LOUISIANA_MADE_BRANDS.includes(brand) ? (["louisiana-made"] as const) : []),
  ...(flags.sponsor || (brand && SPONSOR_BRANDS.includes(brand)) ? (["sponsor"] as const) : []),
  ...(flags.shipsFast ? (["ships-fast"] as const) : []),
  ...(flags.localPickup ? (["local-pickup"] as const) : []),
];

/** A group's id: its label in GUIDE_INDEX, slugged ("By person" -> "by-person"). */
export type GuideRow = string;

export interface CatalogGuide {
  slug: string;
  row: GuideRow;
  /** The small script line above the title. */
  lead: string;
  title: string;
  line: string;
  /** /gift-guides/covers/<slug>.webp (the owner's square cover) when there is one; else a plain gingham tile. */
  cover?: string;
  /** The gingham palette: the guide's cover's (GUIDE_INDEX), shared by its page's band. */
  tint: GuideTint;
  picks: CatalogPick[];
  /** The guide's full collections and boards (ShopMy, Pinterest). */
  links: GiftLink[];
  /**
   * A HUB (owner 2026-11-18: "For Kids is a sub-hub, not a list"): its page shows its children's cover tiles in
   * labelled groups instead of a list. Only children that hold something are listed (never a dead tile).
   */
  children?: { label: string; slugs: string[] }[];
  /** The hub a child guide sits under. */
  parent?: string;
  /** The age band a kids guide is for ("ages 0–1"), from the owner's list; shown with its count. */
  age?: string;
  /** A store page's live deal sections, after its picks (each hidden after its end date on the page). */
  deals?: StoreDeal[];
  /** Holds nothing yet: left out of the rows, the search and the menu (its own link still opens). */
  empty?: true;
  /** A store page with fewer than STORE_ROW_MIN_PICKS picks: not a By store tile or menu entry (search and its link still find it). */
  thin?: true;
}

const rowId = (label: string) => label.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The groups, in the owner's order (GUIDE_INDEX), each with its one palette: sidebar headings and landing rows. */
export const ROWS: { row: GuideRow; label: string; tint: GuideTint }[] = [...new Set(GUIDE_INDEX.map((g) => g.group))].map((group) => {
  // A group's colour is the one most of its covers wear (a guide moved between groups keeps its old cover colour).
  const tints = GUIDE_INDEX.filter((g) => g.group === group).map((g) => g.tint);
  const tint = [...new Set(tints)].sort((x, y) => tints.filter((t) => t === y).length - tints.filter((t) => t === x).length)[0];
  return { row: rowId(group), label: group, tint };
});

const section = (id: string): GiftSection => {
  const s = giftGuides.sections.find((x) => x.id === id);
  if (!s) throw new Error(`gift guides: no section ${id}`);
  return s;
};

const fromSection = (s: GiftSection): CatalogPick[] =>
  s.picks.map((p) => ({ name: p.name, href: p.href, store: storeOf(p.href), line: p.line, image: p.image }));

type Draft = { slug: string; lead: string; title: string; line: string; picks: CatalogPick[]; links: GiftLink[] };

/**
 * Guide slugs before the owner's guide list (the 11-16 page's section ids and the Amazon artifact's guide ids) -> the
 * list's slug. An old /gift-guides#for-her pin, or /gift-guides/for-her, lands on /gift-guides/her.
 */
export const OLD_SLUGS: Record<string, string> = {
  "for-her": "her", "for-him": "him", "for-kids": "kids", "for-mom": "mom", "for-dad": "dad", "for-bf": "boyfriend-or-husband",
  "for-sister": "sister", "for-brother": "brother", "for-friends": "friends", "for-grandparents": "grandparents", "for-aunt": "aunt",
  "for-cousins": "cousins", "for-teens": "gender-neutral-teens", "for-girls": "girls", "for-boys": "boys", "for-toddler": "gender-neutral-toddlers",
  "for-teachers": "teachers", "for-coworker": "coworkers", "for-fnurse": "female-nurses", "for-mnurse": "male-nurses",
  "for-hcw": "healthcare-workers", "for-newmom": "new-mom", "for-newdad": "new-dad", "for-newlyweds": "newlyweds",
  "for-engaged": "newly-engaged", "for-homeowner": "new-homeowner", "for-homebody": "homebody", "for-coffee": "coffee-lover",
  "for-cook": "home-cook", "for-book": "book-lover", "for-golf": "golfer", "for-gamer": "gamer", "for-traveler": "traveler",
  "for-beach": "beach-lover", "for-mountain": "mountain-lover", "for-hunters": "hunters", "for-fishermen": "fishermen",
  "for-workaholic": "workaholic", "for-pink": "pink-lover", "for-blue": "blue-lover", "last-minute": "last-minute-gifts",
  "amazon": "store-amazon", "amazon-finds": "store-amazon", "brand-shops": "store-zchocolat",
};
const slugOf = (old: string) => OLD_SLUGS[old] ?? old;

const sectionGuide = (id: string): Draft => {
  const s = section(id);
  return { slug: slugOf(s.id), lead: "the gift guide", title: s.title, line: s.line, picks: fromSection(s), links: [s.shop, ...s.more] };
};

/**
 * Each ShopMy collection (SHOPMY_COLLECTIONS) -> the guide whose "full guide" link it is. A collection with no Amazon
 * or section guide still makes its guide show (its link, no picks listed: the picks live on ShopMy).
 */
const SHOPMY_GUIDE: Record<number, string> = {
  8978491: "mom", 8987388: "dad", 8987440: "sister", 8987483: "friends", 8987524: "aunt", 8987579: "grandparents",
  8987631: "cousins", 8987711: "female-nurses", 8987757: "teachers", 8987879: "louisiana-kitchen", 8987928: "hunters",
  8987957: "fishermen", 8987968: "boys", 8987983: "girls", 8987998: "gender-neutral-teens", 8988029: "homebody", 8988040: "beach-lover",
  8988060: "traveler", 8988084: "healthcare-workers", 8988105: "male-nurses", 8988114: "new-mom", 8988131: "new-dad",
  8988150: "newlyweds", 8988183: "newly-engaged", 8988205: "new-homeowner", 8988243: "mountain-lover", 8988262: "cat-person",
  8988283: "dog-lover", 8988297: "workaholic", 8988306: "pink-lover", 8988317: "blue-lover", 8999988: "coffee-lover",
  9000033: "boyfriend-or-husband", 9000034: "brother", 9000035: "gender-neutral-toddlers", 9000036: "coworkers", 9000041: "home-cook",
  9000042: "book-lover", 9000044: "golfer", 9000046: "gamer", 9000047: "gardener", 9000334: "louisiana-pantry", 9013686: "big-sisters",
};
const shopmyLinkFor = (slug: string): GiftLink[] =>
  SHOPMY_COLLECTIONS.filter((c) => SHOPMY_GUIDE[c.id] === slug).map((c) => ({ label: `${c.label} on ShopMy`, href: shopmyCollection(c.id) }));

const amazonGuides: Draft[] = AMAZON_GUIDES.map((g) => ({
  slug: slugOf(g.slug),
  lead: g.lead,
  title: g.title,
  line: g.blurb,
  // The old For Kids section's two picks come from the ShopMy Gifts for Toddlers collection, so they lead Toddlers
  // (the artifact's Toddlers and Teens lists are not boy- or girl-specific, so they sit under Gender-Neutral).
  picks: [...(g.slug === "for-toddler" ? fromSection(section("for-kids")) : []), ...g.items.map(([name, href]) => ({ name, href, store: storeOf(href) }))],
  // The Stocking Stuffers guide keeps the Pinterest boards the old section linked to.
  links: [...shopmyLinkFor(slugOf(g.slug)), ...(g.slug === "stocking-stuffers" ? [section("stocking-stuffers").shop, ...section("stocking-stuffers").more] : [])],
}));

/**
 * A researched pick's store: Amazon, a Louisiana shop, a sponsor or a brand site by its host; otherwise (an affiliate
 * link, or a ShopMy pick with a retailer) the store page the loader named.
 */
const researchedStore = (p: ResearchedPick): GiftStore => {
  const host = new URL(p.href).hostname;
  const fixed = (Object.keys(FIXED_STORES) as FixedStore[]).find((s) => FIXED_STORES[s].hosts.includes(host));
  // A ShopMy link to an Amazon product stays "On ShopMy" (the Amazon page lists Amazon links only).
  if (fixed && !(fixed === "shopmy" && p.store && p.store !== "store-amazon")) return fixed;
  if (p.store && STORES[p.store]) return p.store;
  throw new Error(`gift guides: ${p.href} is on no store in STORES`);
};
const toPick = (p: ResearchedPick): CatalogPick => {
  const badges = badgesFor(p.brand, p);
  return { name: p.name, href: p.href, store: researchedStore(p), line: p.line, brand: p.brand, ...(p.image ? { image: p.image } : {}), ...(badges.length ? { badges } : {}) };
};
/** The static picks (content files). The researched picks arrive per guide, from its chunk (loadGuidePicks). */
const allPicks = (): CatalogPick[] => [...giftGuides.sections.flatMap(fromSection), ...amazonGuides.flatMap((g) => g.picks)];

/**
 * PERF (follow-up 2026-11-18): the researched picks are one lazy chunk per guide (src/content/giftGuidePicks/<slug>.json,
 * generated, each page's FINAL list), so /gift-guides loads no picks and /gift-guides/<slug> loads only its own.
 * A guide in CHUNK_SLUGS shows "loading" until its chunk is in; a fixed store page (zChocolat, Diecast) adds its
 * chunk's picks to its static ones (APPEND_CHUNK).
 */
const HAS_CHUNK = new Set(CHUNK_SLUGS);
const APPEND_CHUNK = new Set(["store-amazon", "store-zchocolat", "store-diecast-models"]);
const loaded = new Map<string, { picks: CatalogPick[]; deals?: StoreDeal[] }>();
const listeners = new Set<() => void>();
let version = 0;
/** Whether a guide's picks are in hand (a guide with no chunk always is). */
export const picksReady = (slug: string) => !HAS_CHUNK.has(slug) || loaded.has(slug);
/** Fetch one guide's chunk (once); every guide object's `picks` and `deals` read it from then on. */
export const loadGuidePicks = async (slug: string): Promise<void> => {
  if (picksReady(slug)) return;
  const load = PICK_CHUNKS[`./giftGuidePicks/${slug}.json`];
  if (!load) throw new Error(`gift guides: no picks chunk for ${slug}`);
  const chunk = await load();
  loaded.set(slug, { picks: chunk.picks.map(toPick), ...(chunk.deals ? { deals: chunk.deals } : {}) });
  version += 1;
  listeners.forEach((l) => l());
};
/** Every chunk (tests, and nothing on the page). */
export const loadAllGuidePicks = () => Promise.all(CHUNK_SLUGS.map(loadGuidePicks));
export const subscribeGuidePicks = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
export const guidePicksVersion = () => version;

/** One pick per link (several guides share an item), first occurrence wins. */
const uniqueByHref = (picks: CatalogPick[]) => [...new Map(picks.map((p) => [p.href, p] as const)).values()];
/** One pick per product name: a ShopMy pick's link is its whole collection, so several picks share one link. */
const uniqueByName = (picks: CatalogPick[]) => [...new Map(picks.map((p) => [p.name, p] as const)).values()];

/** Every pick on the given stores: a "By store" guide. */
const storeGuide = (stores: GiftStore[], slug: string, title: string, line: string, links: GiftLink[] = []): Draft => {
  const picks = allPicks().filter((p) => stores.includes(p.store));
  return { slug, lead: "shop by store", title, line, picks: stores.includes("amazon") ? uniqueByHref(picks) : uniqueByName(picks), links };
};


/** Every guide's content, by slug. A GUIDE_INDEX slug with no draft (or an empty one) is hidden until it has some. */
const DRAFTS: Draft[] = [
  ...["for-her", "for-him", "for-the-home", "louisiana-made"].map(sectionGuide),
  // Kids is a hub; its section's two picks are Toddlers picks (amazonGuides), so the hub keeps only its collection links.
  { ...sectionGuide("for-kids"), picks: [] },
  ...amazonGuides,
  ...GUIDE_INDEX.filter((g) => !amazonGuides.some((a) => a.slug === g.slug) && shopmyLinkFor(g.slug).length > 0)
    .map((g) => ({ slug: g.slug, lead: g.lead, title: g.title, line: `The ${g.title} collection on ShopMy.`, picks: [], links: shopmyLinkFor(g.slug) })),
  storeGuide(["amazon"], "store-amazon", STORES.amazon.name, "Every Amazon find from every guide."),
  storeGuide(["zchocolat"], "store-zchocolat", STORES.zchocolat.name, "French chocolate gift boxes."),
  storeGuide(["diecast"], "store-diecast-models", STORES.diecast.name, "Diecast model cars, for collectors."),
];

/**
 * Each researched store page (two taps, like Walmart): its list ("Louisiana Helpr Picks": its own store-<x> file, then
 * every pick on that store from every guide, once each, photos first) and its deal sections come from its chunk.
 */
for (const slug of Object.keys(RESEARCHED_STORES)) {
  // The fixed store pages (Amazon, zChocolat, Diecast) keep their own draft: static picks, then their chunk's.
  if (APPEND_CHUNK.has(slug)) continue;
  const g = GUIDE_INDEX.find((x) => x.slug === slug)!;
  DRAFTS.push({ slug, lead: g.lead, title: g.title, line: "", picks: [], links: [] });
}


/**
 * The hubs, from the owner's list (GUIDE_INDEX `parent`, 2026-11-18): Kids opens Boys, Girls and Gender-Neutral, each
 * of those opens its five age guides; the career hubs (Healthcare Pros, Educators, First Responders, Military,
 * Industrial Workers) open their roles. A hub page shows its children's tiles, then any
 * picks of its own (the artifact's Boys and Girls lists stay on the Boys and Girls hubs).
 */
const HUBS: Record<string, { label: string; slugs: string[] }[]> = {};
for (const g of GUIDE_INDEX) {
  if (!g.parent) continue;
  const label = g.parent === "kids" ? "Shop for" : g.age ? "By age" : "Guides";
  (HUBS[g.parent] ??= [{ label, slugs: [] }])[0].slugs.push(g.slug);
}

/**
 * Guides with content that the owner's list (GUIDE_INDEX) no longer carries (2026-11-18). Their Amazon and ShopMy
 * items stay in the Amazon and ShopMy store guides, so no pick is lost; the guide itself is not shown, and an old
 * link to it lands on the main page.
 */
export const REMOVED_GUIDES = ["last-minute-gifts", "splurge-gifts", "workaholic", "home-finds", "nurses", "pet-lovers", "for-the-home"];

/**
 * Guides the owner folded into others (2026-11-18: Female Nurses and Male Nurses go into RNs, LPNs and CNAs). Each
 * target gets the folded guides' picks and collection links, once each; an old link to a folded guide opens the
 * first target.
 */
export const MERGED_GUIDES: Record<string, string[]> = { "female-nurses": ["rns", "lpns", "cnas"], "male-nurses": ["rns", "lpns", "cnas"] };

const draftOf = new Map(DRAFTS.map((d) => [d.slug, d] as const));
/** A guide with a researched chunk lists exactly the chunk's picks, in their order (APPEND_CHUNK: static, then chunk). */
for (const slug of CHUNK_SLUGS) {
  const g = GUIDE_INDEX.find((x) => x.slug === slug);
  if (!g || draftOf.has(slug)) continue;
  draftOf.set(slug, { slug, lead: g.lead, title: g.title, line: "", picks: [], links: [] });
}
/** Every guide on the owner's list shows, filled or not (owner 2026-11-18: an empty one opens "Picks coming soon"). */
for (const g of GUIDE_INDEX) {
  if (!draftOf.has(g.slug)) draftOf.set(g.slug, { slug: g.slug, lead: g.lead, title: g.title, line: "", picks: [], links: [] });
}
for (const [from, targets] of Object.entries(MERGED_GUIDES)) {
  const src = draftOf.get(from);
  if (!src) continue;
  for (const t of targets) {
    const d = draftOf.get(t)!;
    // A guide with researched picks keeps exactly those (the folded guides' items stay in their store guides); it
    // still gets the folded guides' collection links.
    draftOf.set(t, { ...d, picks: HAS_CHUNK.has(t) ? d.picks : uniqueByHref([...d.picks, ...src.picks]), links: [...new Map([...d.links, ...src.links].map((l) => [l.href, l] as const)).values()] });
  }
}
const filled = (slug: string) => draftOf.has(slug) && !REMOVED_GUIDES.includes(slug) && !MERGED_GUIDES[slug];

/** Where an old or folded guide's link now goes (null: no such guide). */
export const newSlugFor = (slug: string): string | null => {
  const s = OLD_SLUGS[slug] ?? slug;
  const to = MERGED_GUIDES[s]?.[0] ?? s;
  return GUIDES.some((g) => g.slug === to) ? to : null;
};
const parentOf = new Map(Object.entries(HUBS).flatMap(([hub, groups]) => groups.flatMap((x) => x.slugs.map((c) => [c, hub] as const))));

/** The cover files shipped in public/gift-guides/covers (one per GUIDE_INDEX slug that has a guide). */
/** Every guide with content that no group shows (a test keeps this empty: nothing is dropped silently). */
export const unplacedGuides = () =>
  DRAFTS.filter((d) => filled(d.slug) && (d.picks.length > 0 || d.links.length > 0 || HAS_CHUNK.has(d.slug)) && !GUIDES.some((g) => g.slug === d.slug)).map((d) => d.slug);
const hasCover = new Set(OWNER_INDEX.map((g) => g.slug));
/** The folder in public/ the covers are served from (static files, not an app route). */
const COVER_DIR = `${"/gift-guides"}/covers`;

/**
 * Whether a guide holds anything (lead 2026-11-18, live: 384 of 469 guides opened "Picks coming soon"): its picks
 * (static, or a researched chunk), its collection links, or a child guide that holds something. A guide that holds
 * nothing is left out of every row, the search and the menu; its own link still opens, pointing to related guides.
 */
const holdsMemo = new Map<string, boolean>();
const holds = (slug: string): boolean => {
  if (holdsMemo.has(slug)) return holdsMemo.get(slug)!;
  const d = draftOf.get(slug);
  const own = Boolean(d && (HAS_CHUNK.has(slug) || d.picks.length > 0 || d.links.length > 0));
  const v = own || (HUBS[slug] ?? []).some((x) => x.slugs.some((c) => filled(c) && holds(c)));
  holdsMemo.set(slug, v);
  return v;
};

/** The fewest picks a store page needs to be a tile in the By store row and menu (lead 2026-11-18); its link still opens. */
export const STORE_ROW_MIN_PICKS = 4;
/** A guide's pick count without loading its chunk (static picks, plus its chunk's count). */
const pickCount = (slug: string) => {
  const d = draftOf.get(slug)!;
  return HAS_CHUNK.has(slug) ? (APPEND_CHUNK.has(slug) ? d.picks.length : 0) + (CHUNK_PICK_COUNTS[slug] ?? 0) : d.picks.length;
};

const build = (slug: string, group: string, tint: GuideTint, listed?: { title: string; lead: string; age?: string }): CatalogGuide => {
  const d = draftOf.get(slug)!;
  const children = HUBS[slug]?.map((x) => ({ label: x.label, slugs: x.slugs.filter((c) => filled(c) && holds(c)) })).filter((x) => x.slugs.length > 0);
  const g: CatalogGuide = {
    ...d,
    title: listed?.title ?? d.title,
    lead: listed?.lead ?? d.lead,
    ...(listed?.age ? { age: listed.age } : {}),
    row: rowId(group),
    tint,
    cover: hasCover.has(slug) ? `${COVER_DIR}/${slug}.webp` : undefined,
    parent: parentOf.get(slug),
    ...(children?.length ? { children } : {}),
    ...(holds(slug) ? {} : { empty: true as const }),
    ...(group === "By store" && holds(slug) && pickCount(slug) < STORE_ROW_MIN_PICKS ? { thin: true as const } : {}),
  };
  if (HAS_CHUNK.has(slug)) {
    // Read from the guide's chunk once it is in (loadGuidePicks); until then the static picks (APPEND_CHUNK) or none.
    const base = APPEND_CHUNK.has(slug) ? d.picks : [];
    Object.defineProperty(g, "picks", { enumerable: true, get: () => {
      const c = loaded.get(slug);
      if (!c) return base;
      return !APPEND_CHUNK.has(slug) ? c.picks : slug === "store-amazon" ? uniqueByHref([...base, ...c.picks]) : uniqueByName([...base, ...c.picks]);
    } });
    Object.defineProperty(g, "deals", { enumerable: true, get: () => loaded.get(slug)?.deals });
  }
  return g;
};

export const GUIDES: CatalogGuide[] = ROWS.flatMap((r) => [
  ...GUIDE_INDEX.filter((g) => g.group === r.label && filled(g.slug)).map((g) => build(g.slug, g.group, g.tint, g)),
]);

/**
 * The guides a group's row and menu list, in order (owner 2026-11-18, "covers in two taps"): top-level guides, with
 * the Kids hub replaced by its own children (Girls, Boys, Gender-Neutral); each of those opens its five age guides.
 * A guide that holds nothing is not listed.
 */
export const guidesIn = (row: GuideRow) => GUIDES.filter((g) => !g.empty && !g.thin && g.row === row && (g.parent ? g.parent === KIDS_HUB : g.slug !== KIDS_HUB));


/**
 * The guides an empty guide's page points to (lead 2026-11-18): its siblings under the same hub, else its row, that
 * hold something, up to six.
 */
export const relatedGuides = (g: CatalogGuide): CatalogGuide[] => {
  const ok = (x: CatalogGuide) => !x.empty && x.slug !== g.slug && !x.children;
  const siblings = g.parent ? GUIDES.filter((x) => ok(x) && x.parent === g.parent) : [];
  return (siblings.length ? siblings : GUIDES.filter((x) => ok(x) && x.row === g.row)).slice(0, 6);
};

/** The Kids hub: its page shows Girls, Boys and Gender-Neutral; the rows and menu show those three in its place. */
export const KIDS_HUB = "kids";


/** A hub's child guides, flat, in order. */
export const childrenOf = (g: CatalogGuide) => (g.children ?? []).flatMap((x) => x.slugs).map((c) => guideBySlug(c)!).filter(Boolean);

export const guideBySlug = (slug: string | undefined) => GUIDES.find((g) => g.slug === slug);

/**
 * The sidebar search (owner 2026-11-18): every guide whose title or group matches the words typed, case- and
 * accent-blind, in the page's order. Empty words match nothing (the sidebar then shows its groups).
 */
export const searchGuides = (query: string): CatalogGuide[] => {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const label = new Map(ROWS.map((r) => [r.row, r.label] as const));
  return GUIDES.filter((g) => {
    if (g.empty) return false;
    const hay = fold(`${g.title} ${g.lead} ${label.get(g.row) ?? ""}`);
    return words.every((w) => hay.includes(w));
  });
};
