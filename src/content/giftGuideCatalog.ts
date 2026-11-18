/**
 * /gift-guides (owner 2026-11-18 ~9:05 AM: "open to the sections first ... shop by store, you can choose the store, or
 * the budget, or the person"): every guide the page shows, as one list in three rows. Built from the two content files
 * and nothing else, so no pick, price or link is made up here:
 *   - src/content/giftGuides.ts: the ShopMy sections, their picks, the brand-site picks and the Pinterest links;
 *   - src/content/giftGuidesAmazon.ts: the owner's Amazon guides, copied from her artifact.
 * Every pick carries a `store`, read from its link's host (storeOf), and each "Shop by store" guide is every pick on
 * that store. Guard: src/test/giftGuidesPage.test.tsx.
 */
import { giftGuides, LOUISIANA_MADE_BRANDS, LOUISIANA_SHOPS, SHOPMY_COLLECTIONS, SPONSOR_BRANDS, shopmyCollection, type GiftLink, type GiftSection } from "@/content/giftGuides";
import { AMAZON_GUIDES } from "@/content/giftGuidesAmazon";
import { GUIDE_INDEX } from "@/content/giftGuideIndex";
import { RESEARCHED_PICKS, type ResearchedPick } from "@/content/giftGuidePicks";

export type GiftStore = "amazon" | "shopmy" | "zchocolat" | "diecast" | "louisiana";

/** Each store, the name the page shows and the link hosts that belong to it. */
export const STORES: Record<GiftStore, { name: string; hosts: readonly string[] }> = {
  amazon: { name: "Amazon", hosts: ["www.amazon.com", "amazon.com", "amzn.to"] },
  shopmy: { name: "ShopMy", hosts: ["shopmy.us"] },
  zchocolat: { name: "zChocolat", hosts: ["www.zchocolat.com"] },
  diecast: { name: "DiecastModelsWholesale", hosts: ["www.diecastmodelswholesale.com"] },
  // The Louisiana shops' own sites (each pick names its brand, so "On <brand>" is shown, not this name).
  louisiana: { name: "a Louisiana shop", hosts: LOUISIANA_SHOPS },
};

/** The store a pick's link goes to, read from its host. A host on no store is a content error, so it throws. */
export function storeOf(href: string): GiftStore {
  const host = new URL(href).hostname;
  const hit = (Object.keys(STORES) as GiftStore[]).find((s) => STORES[s].hosts.includes(host));
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

/** "Louisiana-made" only for a Louisiana brand; "25 Days sponsor" for a sponsor's pick (lead 2026-11-18). */
export const badgesFor = (brand: string | undefined): PickBadge[] => [
  ...(brand && LOUISIANA_MADE_BRANDS.includes(brand) ? (["louisiana-made"] as const) : []),
  ...(brand && SPONSOR_BRANDS.includes(brand) ? (["sponsor"] as const) : []),
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

const toPick = (p: ResearchedPick): CatalogPick => {
  const badges = badgesFor(p.brand);
  return { name: p.name, href: p.href, store: storeOf(p.href), line: p.line, brand: p.brand, ...(badges.length ? { badges } : {}) };
};
const researched = (): CatalogPick[] => Object.values(RESEARCHED_PICKS).flat().map(toPick);
const allPicks = (): CatalogPick[] => [...giftGuides.sections.flatMap(fromSection), ...amazonGuides.flatMap((g) => g.picks), ...researched()];

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
/** The researched picks (src/content/giftGuidePicks.ts, generated) are each listed guide's list, in their order. */
for (const [slug, list] of Object.entries(RESEARCHED_PICKS)) {
  const g = GUIDE_INDEX.find((x) => x.slug === slug);
  if (!g) continue;
  const d = draftOf.get(slug) ?? { slug, lead: g.lead, title: g.title, line: "", picks: [], links: [] };
  draftOf.set(slug, { ...d, picks: list.map(toPick) });
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
    draftOf.set(t, { ...d, picks: RESEARCHED_PICKS[t] ? d.picks : uniqueByHref([...d.picks, ...src.picks]), links: [...new Map([...d.links, ...src.links].map((l) => [l.href, l] as const)).values()] });
  }
}
/**
 * Guides held on "Picks coming soon" (lead 2026-11-18): the budget guides wait for the price-verified list, so none of
 * their picks show (their Amazon items stay in the Amazon store guide). scripts/gift-guide-picks.mjs skips the same.
 */
export const HELD_PICK_GUIDES = ["under-20", "under-25", "under-50"];
for (const slug of HELD_PICK_GUIDES) {
  const d = draftOf.get(slug);
  if (d) draftOf.set(slug, { ...d, picks: [], links: [] });
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
  DRAFTS.filter((d) => filled(d.slug) && (d.picks.length > 0 || d.links.length > 0) && !GUIDES.some((g) => g.slug === d.slug)).map((d) => d.slug);
const hasCover = new Set(GUIDE_INDEX.map((g) => g.slug));
/** The folder in public/ the covers are served from (static files, not an app route). */
const COVER_DIR = `${"/gift-guides"}/covers`;

const build = (slug: string, group: string, tint: GuideTint, listed?: { title: string; lead: string; age?: string }): CatalogGuide => {
  const d = draftOf.get(slug)!;
  const children = HUBS[slug]?.map((x) => ({ label: x.label, slugs: x.slugs.filter(filled) })).filter((x) => x.slugs.length > 0);
  return {
    ...d,
    title: listed?.title ?? d.title,
    lead: listed?.lead ?? d.lead,
    ...(listed?.age ? { age: listed.age } : {}),
    row: rowId(group),
    tint,
    cover: hasCover.has(slug) ? `${COVER_DIR}/${slug}.webp` : undefined,
    parent: parentOf.get(slug),
    ...(children ? { children } : {}),
  };
};

export const GUIDES: CatalogGuide[] = ROWS.flatMap((r) => [
  ...GUIDE_INDEX.filter((g) => g.group === r.label && filled(g.slug)).map((g) => build(g.slug, g.group, g.tint, g)),
]);

/**
 * The guides a group's row and menu list, in order (owner 2026-11-18, "covers in two taps"): top-level guides, with
 * the Kids hub replaced by its own children (Girls, Boys, Gender-Neutral); each of those opens its five age guides.
 */
export const guidesIn = (row: GuideRow) => GUIDES.filter((g) => g.row === row && (g.parent ? g.parent === KIDS_HUB : g.slug !== KIDS_HUB));

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
    const hay = fold(`${g.title} ${g.lead} ${label.get(g.row) ?? ""}`);
    return words.every((w) => hay.includes(w));
  });
};
