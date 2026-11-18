/**
 * Owner 2026-11-16 ("i think we should add this to our landing pages on louisiana helpr so people can see our gift
 * guides"; pop-up "New gift guide page"): a public /gift-guides page with picks and affiliate links. Rebuilt 2026-11-18
 * (~9:05 AM: "open to the sections first ... shop by store, you can choose the store, or the budget, or the person")
 * to work like the owner's Amazon gift-guide artifact: /gift-guides shows three rows of guide tiles, a tile opens
 * /gift-guides/<slug>, and each guide is a numbered list with a small photo (or letter tile) per item.
 *
 * THE CLASS: an affiliate page that hides its disclosure, leaks a link without rel="sponsored", carries an Amazon link
 * without the site's Associates ID, or loses a way in (rows, guide pages, old #slug pins). Checked from the content
 * inventory (src/content/giftGuides.ts, src/content/giftGuidesAmazon.ts, src/content/giftGuideCatalog.ts) and the
 * rendered page:
 *   1. the landing shows the three rows (person, budget & theme, store) and every guide has a tile to /gift-guides/<slug>;
 *   2. /gift-guides/<slug> renders that guide's every pick as a numbered row with a lazy, sized thumbnail or letter tile,
 *      and an "All guides" link back; an old /gift-guides#<slug> pin redirects to /gift-guides/<slug>;
 *   3. EVERY Amazon link carries tag=louisianahelpr-20 (owner 2026-11-17), and no other tag;
 *   4. the FTC disclosure (16 CFR Part 255) and Amazon's required statement render once each, word for word, as plain
 *      lines at the BOTTOM, after the guides (owner decision 2026-11-18);
 *   5. EVERY outbound anchor is sponsored + noopener and opens a new tab; content links are https on an allowed host;
 *      every pick's `store` is read from its link host; picks carry no price.
 * Still noindex and out of the sitemap, not linked from the landing or the footers (owner 2026-11-17); public, no gate.
 *
 * @mutate src/pages/info/giftGuides/GiftOut.tsx | rel="sponsored noopener" | rel="noopener"
 * @mutate src/pages/info/giftGuides/GiftOut.tsx | target="_blank" rel= | rel=
 * @mutate src/pages/info/GiftGuides.tsx | <p data-gift-disclosure="">{G.disclosure}</p> | <p data-gift-disclosure="">{null}</p>
 * @mutate src/pages/info/GiftGuides.tsx |           <p data-gift-amazon-statement="">{G.amazonStatement}</p>\n | \n
 * @mutate src/content/giftGuides.ts | amazonStatement: "As an Amazon Associate, Louisiana Helpr earns from qualifying purchases.", | amazonStatement: "As an Amazon Associate I earn from qualifying purchases.",
 * @mutate src/pages/info/GiftGuides.tsx | {guide ? <GiftGuideView guide={guide} /> : myList ? <GiftGuideMyList /> : <GiftGuideLanding group={group} />}{footer} | {footer}{guide ? <GiftGuideView guide={guide} /> : myList ? <GiftGuideMyList /> : <GiftGuideLanding group={group} />}
 * @mutate src/content/giftGuideCatalog.ts |   return { row: rowId(group), label: group, tint }; |   return { row: rowId(group), label: group, tint: "oat" as GuideTint };
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx | <Link to={`/gift-guides/${g.slug}`} | <Link to={`/gift-guides#${g.slug}`}
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <details key={row} open={row === active?.row} | <details key={row} open
 * @mutate src/content/giftGuideCatalog.ts |     ...(children?.length ? { children } : {}), | 
 * @mutate src/content/giftGuideCatalog.ts | (g.parent ? g.parent === KIDS_HUB : g.slug !== KIDS_HUB) | !g.parent
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx | <Link to={`/gift-guides?group=${row}`} | <Link to="/gift-guides"
 * @mutate src/content/giftGuideCatalog.ts | 8978491: "mom", | 8978491: "nowhere", 
 * @mutate src/content/giftGuideCatalog.ts | 9000047: "gardener", | 9000047: "no-guide", 
 * @mutate src/content/giftGuideCatalog.ts | "for-him": "him", | "for-him": "him-x",

 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx | className="gg-cover" loading="lazy" decoding="async" | className="gg-cover" decoding="async"
 * @mutate src/pages/info/GiftGuides.tsx |   const { slug } = useParams<{ slug?: string }>(); |   const slug = undefined as string \| undefined; useParams();
 * @mutate src/pages/info/GiftGuides.tsx |   if (!slug && fromHash) return | if (!slug && fromHash && false) return
 * @mutate src/pages/info/GiftGuides.tsx |   if (moved) return | if (moved && false) return
 * @mutate src/pages/info/GiftGuides.tsx | {guide ? <Link to="/gift-guides" className="gg-link" | {guide ? <Link to="/gift-guides/" className="gg-link"
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | className="gg-thumb" loading="lazy" decoding="async" | className="gg-thumb" decoding="async"
 * @mutate src/content/giftGuidesAmazon.ts | ["8Bitdo Retro Mechanical Keyboard", "https://www.amazon.com/dp/B0DKXH5WCD?tag=louisianahelpr-20"], | ["8Bitdo Retro Mechanical Keyboard", "https://www.amazon.com/dp/B0DKXH5WCD?tag=hggguidepage-20"],
 * @mutate src/content/giftGuideCatalog.ts |   return hit; |   return "amazon" as GiftStore;
 * @mutate src/content/giftGuides.ts | const shopmy = (id: number) => `https://shopmy.us/collections/${id}`; | const shopmy = (id: number) => `http://shopmy.us/collections/${id}`;
 * @mutate src/App.tsx |       <Route path="/gift-guides/:slug" element={<RouteErrorBoundary> |       <Route path="/gift-guides/:slug" element={<ProtectedRoute><RouteErrorBoundary>
 * @mutate src/pages/info/GiftGuides.tsx | "gg w-full" | "gg page-column"
 * @mutate src/content/giftGuides.ts |   for (const c of [...codes].sort((a, b) => a.rank - b.rank)) stores.set(c.store, [...(stores.get(c.store) ?? []), c]); |   for (const c of codes) stores.set(`${c.store} ${c.code}`, [c]);
 * @mutate src/content/giftGuideCatalog.ts |   const to = MERGED_GUIDES[s]?.[0] ?? s; |   const to = s;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | padding:8px 0;order:2} | padding:8px 0}
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx | !group && !more ? "gg-rows gg-rows-folded" : "gg-rows" | "gg-rows"
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | /iPhone\|iPad\|iPod/.test(userAgent) ? "&" : "?" | "?"
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx | {!group && topPicks().length > 0 && ( | {false && (
 * @mutate src/content/giftGuideCatalog.ts | GUIDES.filter((g) => !g.empty && !g.thin && g.row === row | GUIDES.filter((g) => !g.empty && g.row === row
 * @mutate src/content/giftGuideCatalog.ts | GUIDES.filter((g) => !g.empty && !g.thin && g.row === row | GUIDES.filter((g) => !g.thin && g.row === row
 * @mutate src/content/giftGuideCatalog.ts |     if (g.empty) return false; |     if (false) return false;
 * @mutate src/content/giftGuideCatalog.ts | picks: HAS_CHUNK.has(t) ? d.picks : uniqueByHref([...d.picks, ...src.picks]) | picks: HAS_CHUNK.has(t) ? d.picks : [...d.picks, ...src.picks, ...src.picks]
 * @mutate src/content/giftGuides.ts | codes.filter((c) => (!c.expires \|\| c.expires >= today) && | codes.filter((c) => (today === today) &&
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |   if (codes.length === 0) return null; |   if (codes.length === 0) return <details data-gift-codes="" />;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | {!guide.children && guide.picks.length === 0 && guide.links.length === 0 && ( | {false && (
 * @mutate src/content/giftGuideCatalog.ts | export const REMOVED_GUIDES = ["last-minute-gifts", | export const REMOVED_GUIDES = ["nothing",
 * @mutate src/pages/info/GiftGuides.tsx | : guide.lead} title={guide.title} titleId="gift-guide-title" | : guide.lead} title={guide.slug} titleId="gift-guide-title"
 * @mutate src/pages/info/Index.tsx |       <SectionsShowcase />\n |       <SectionsShowcase />\n      <GiftGuidesBand />\n
 * @mutate src/components/Footer.tsx |               <Link to="/safety" className={FOOTER_LINK}> |               <Link to="/gift-guides" className={FOOTER_LINK}>
 * @mutate src/components/sponsor/Sections.tsx |         <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>\n |         <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>\n        <Link to={C.links.giftGuides}>{C.footer.giftGuidesLink}</Link>\n
 * @mutate src/content/giftGuideIndex.ts |   { group: "By store", tint: "green", slug: "store-amazon", title: "Amazon", lead: "shop" }, |   { group: "By store", tint: "green", slug: "store-shopmy", title: "ShopMy", lead: "shop" },\n  { group: "By store", tint: "green", slug: "store-amazon", title: "Amazon", lead: "shop" },
 * @mutate src/content/giftGuideIndex.ts | { group: "By career", tint: "oat", slug: "stay-at-home-parents" | { group: "Life moments", tint: "oat", slug: "stay-at-home-parents"
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx |         {g.age && <span className="gg-count">{g.age}</span>} |         <span className="gg-count">{g.age ?? ""}{g.picks.length} picks</span>
 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx |       <h2 id={titleId}>{title}</h2>\n |       <h2 id={titleId}>{title}</h2>\n      <p className="gg-line">25 picks</p>\n
 * @mutate src/content/giftGuides.ts |   { rank: 1, store: "Muck Boot", code: "TAKE25", | { rank: 8, store: "Muck Boot US", code: "TAKE25",
 */
import { readFileSync, existsSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { GiftGuidesBand, GIFT_GUIDES_PATH } from "@/components/landing/GiftGuidesBand";
import { giftGuides, AFFILIATE_HOSTS, BRAND_SITES, LOUISIANA_SHOPS, SPONSOR_SITES, SHOPMY_COLLECTIONS, activeCodes, codesByStore, discountCodes } from "@/content/giftGuides";
import { DiscountCodes, SalesList, liveSales } from "@/pages/info/giftGuides/GiftGuidesSidebar";
import { GIFT_WRAP_JOB_PATH } from "@/pages/info/giftGuides/GiftGuideHelpr";
import { AMAZON_GUIDES } from "@/content/giftGuidesAmazon";
import { GUIDE_INDEX } from "@/content/giftGuideIndex";
import { DEAL_CODES, SALES, type PickChunk } from "@/content/giftGuidePicks";
import { GUIDES, ROWS, STORES, AMAZON_TAG, KIDS_HUB, MERGED_GUIDES, OLD_SLUGS, REMOVED_GUIDES, guidesIn, childrenOf, guideBySlug, loadAllGuidePicks, searchGuides, storeOf, unplacedGuides, STORE_ROW_MIN_PICKS, type CatalogGuide } from "@/content/giftGuideCatalog";
import { GiftGuideView, PICKS_PAGE, storeLabel } from "@/pages/info/giftGuides/GiftGuideView";
import { smsHref } from "@/pages/info/giftGuides/GiftGuideShare";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { PUBLIC_PAGE_META, NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { giftGuidePageMeta, publicOrGiftGuidePageMetaFor } from "@/lib/giftGuidePageMeta.mjs";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { sponsorPage } from "@/content/sponsorPage";
import { BLOCKED_BRANDS, blockedBrand } from "../../scripts/giftGuideBlocklist.mjs";

afterEach(cleanup);

/** Each guide's researched chunk, as generated (PERF split 11-18: one lazy file per guide), and every chunk loaded. */
const RESEARCHED_PICKS: Record<string, PickChunk["picks"]> = Object.fromEntries(
  Object.entries(import.meta.glob<PickChunk>("../content/giftGuidePicks/*.json", { eager: true, import: "default" }))
    .map(([f, c]) => [f.replace(/^.*\/|\.json$/g, ""), c.picks] as const)
    .filter(([, l]) => l.length > 0),
);
await loadAllGuidePicks();

const src = (p: string) => blankComments(readFileSync(p, "utf8"));

/** Opens every "Show more" under a long list (50 rows at first as of 2026-11-18, design audit #3), so a check sees every row. */
const expandAll = (root: HTMLElement) => {
  for (let b = root.querySelector<HTMLButtonElement>("[data-gift-more-picks]"); b; b = root.querySelector<HTMLButtonElement>("[data-gift-more-picks]")) fireEvent.click(b);
  return root;
};
const DISCLOSURE = "Some links are affiliate links. We may earn a small share of the sale at no extra cost to you.";
const AMAZON_STATEMENT = "As an Amazon Associate, Louisiana Helpr earns from qualifying purchases.";
const ROW_LABELS = ["By person", "For kids", "By budget", "Louisiana", "Experiences", "Hobbies", "By career", "Life moments", "Pets", "Colors", "By store"];
// @two-way src/test/giftGuidesPage.test.tsx:stale allowed host
const ALLOWED_HOSTS = ["shopmy.us", "www.pinterest.com", "www.amazon.com", "amazon.com", "amzn.to", ...AFFILIATE_HOSTS, ...BRAND_SITES, ...LOUISIANA_SHOPS, ...SPONSOR_SITES];
const isAmazon = (href: string) => ["www.amazon.com", "amazon.com", "amzn.to"].includes(new URL(href).hostname);

const picks = GUIDES.flatMap((g) => g.picks);
const contentLinks = [
  ...giftGuides.allLinks.map((l) => l.href),
  ...giftGuides.sections.flatMap((s) => [s.shop.href, ...s.more.map((m) => m.href), ...s.picks.map((p) => p.href)]),
  ...AMAZON_GUIDES.flatMap((g) => g.items.map(([, href]) => href)),
  ...Object.values(RESEARCHED_PICKS).flat().map((p) => p.href),
];

/** Renders the page at a URL, with a probe that shows where a redirect landed. */
function renderAt(url: string) {
  const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<><GiftGuides /><Where /></>} />
        <Route path="/gift-guides/:slug" element={<><GiftGuides /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("gift guides: the content inventory", () => {
  it("every link is https on an allowed host; every pick's store is its link host; no prices", () => {
    expect(contentLinks.length).toBeGreaterThan(600);
    expect(picks.length).toBeGreaterThan(600);
    for (const href of contentLinks) {
      const u = new URL(href);
      expect(u.protocol, href).toBe("https:");
      expect(ALLOWED_HOSTS, href).toContain(u.hostname);
    }
    for (const p of picks) {
      expect(STORES[p.store].hosts, p.href).toContain(new URL(p.href).hostname);
      if (p.image) expect(new URL(p.image).protocol, p.name).toBe("https:");
      expect(`${p.name} ${p.line ?? ""}`, p.name).not.toMatch(/\$\s?\d/);
    }
    expect(storeOf("https://amzn.to/abc")).toBe("amazon");
    expect(storeOf("https://shopmy.us/collections/1")).toBe("shopmy");
    expect(() => storeOf("https://example.com/")).toThrow();
  });

  it("every allowed host is still used by some link (two-way)", () => {
    const used = new Set(contentLinks.map((h) => new URL(h).hostname));
    // amazon.com and amzn.to are allowed for Amazon links the owner adds later (short links, bare host).
    const stale = ALLOWED_HOSTS.filter((h) => !used.has(h) && !["amazon.com", "amzn.to"].includes(h));
    expect(stale, `stale allowed host — remove it (lower the baseline): ${stale.join(", ")}`).toEqual([]);
    expect(used.size).toBeGreaterThan(3);
  });

  it("every Amazon link carries tag=louisianahelpr-20 and no other tag", () => {
    const amazon = [...contentLinks, ...picks.map((p) => p.href)].filter(isAmazon);
    expect(amazon.length).toBeGreaterThan(600);
    expect(AMAZON_TAG).toBe("louisianahelpr-20");
    for (const href of amazon) expect(new URL(href).searchParams.getAll("tag"), href).toEqual(["louisianahelpr-20"]);
    expect(src("src/content/giftGuidesAmazon.ts")).not.toMatch(/tag=(?!louisianahelpr-20")/);
  });

  it("the artifact's 46 Amazon guides are all here, each with items; budget guides carry no computed price", () => {
    expect(AMAZON_GUIDES.length).toBe(46);
    expect(AMAZON_GUIDES.reduce((n, g) => n + g.items.length, 0)).toBe(629);
    for (const g of AMAZON_GUIDES) expect(g.items.length, g.slug).toBeGreaterThan(0);
    expect(AMAZON_GUIDES.filter((g) => g.row === "theme").map((g) => g.slug)).toEqual([
      "under-25", "under-50", "stocking-stuffers", "nurses", "louisiana-pantry", "home-finds", "under-10", "pet-lovers", "last-minute",
    ]);
  });

  it("slugs are unique and URL-safe; every cover file exists; every row has guides", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const covers = GUIDES.filter((g) => g.cover);
    expect(covers.length).toBeGreaterThan(20);
    for (const g of covers) expect(existsSync(`public${g.cover}`), g.cover).toBe(true);
    expect(ROWS.map((r) => r.label)).toEqual(ROW_LABELS);
    for (const r of ROWS) expect(GUIDES.filter((g) => g.row === r.row).length, r.row).toBeGreaterThan(1);
    // The old section slugs (pins link to them) all still name a guide.
    // The old section slugs (pins link to them) still name a guide, unless the owner's list dropped it (its picks stay in ShopMy).
    for (const s of giftGuides.sections) if (!REMOVED_GUIDES.includes(s.id)) expect(slugs, s.id).toContain(OLD_SLUGS[s.id] ?? s.id);
  });

  it("each store guide with picks holds every pick on its store, and only those", () => {
    const byStore: [string, keyof typeof STORES][] = [["store-amazon", "amazon"], ["store-zchocolat", "zchocolat"], ["store-diecast-models", "diecast"]];
    for (const [slug, store] of byStore) {
      const g = guideBySlug(slug)!;
      expect(g?.row, slug).toBe("by-store");
      expect(g.picks.length, slug).toBeGreaterThan(0);
      for (const p of g.picks) expect(p.store).toBe(store);
      const names = new Set(g.picks.map((p) => p.name));
      const hrefs = new Set(g.picks.map((p) => p.href));
      for (const p of picks.filter((x) => x.store === store)) expect(names.has(p.name) || hrefs.has(p.href), p.name).toBe(true);
    }
    expect(guidesIn("by-store")[0].slug).toBe("store-amazon");
    expect(guidesIn("by-store")[1].slug).toBe("store-walmart");
    // The fixed stores, then every researched store page (store-<x>).
    expect(Object.keys(STORES).filter((k) => !k.startsWith("store-")).sort()).toEqual(["amazon", "diecast", "louisiana", "shopmy", "sponsor", "zchocolat"]);
  });

  it("syncs the owner's 2026-11-18 list: Experiences after Louisiana, Stay-at-Home Parents, Gift Wrap after Stocking Stuffers, no ShopMy store tile", () => {
    const rows = ROWS.map((r) => r.label);
    expect(rows.indexOf("Experiences")).toBe(rows.indexOf("Louisiana") + 1);
    // A guide that holds nothing yet is not listed (lead 2026-11-18); the rest keep the list's order.
    const holding = (slugs: string[]) => slugs.filter((x) => guideBySlug(x) && !guideBySlug(x)!.empty && !guideBySlug(x)!.thin);
    expect(guidesIn("experiences").map((g) => g.slug)).toEqual(holding([
      "gift-cards", "louisiana-restaurants", "swamp-and-bayou-tours", "spa-days", "date-night", "concerts-and-events", "classes-and-workshops", "subscriptions", "family-fun-days",
    ]));
    expect(guidesIn("experiences").length).toBeGreaterThan(1);
    expect(guideBySlug("stay-at-home-parents")?.row).toBe("by-career");
    const budget = guidesIn("by-budget").map((g) => g.slug);
    expect(budget.indexOf("gift-wrap-and-cards")).toBe(budget.indexOf("stocking-stuffers") + 1);
    // The By store row is the list's store entries, in its order (Louisiana popularity).
    const listed = GUIDE_INDEX.filter((g) => g.group === "By store").map((g) => g.slug);
    expect(listed.length).toBeGreaterThan(200);
    // ... then every other researched store page, in name order (follow-up batch 11-18).
    const stores = guidesIn("by-store").map((g) => g.slug);
    expect(stores.slice(0, holding(listed).length)).toEqual(holding(listed));
    const extra = guidesIn("by-store").slice(holding(listed).length);
    expect(extra.map((g) => g.title)).toEqual([...extra.map((g) => g.title)].sort((a, b) => a.localeCompare(b)));
    for (const g of extra) expect(g.slug, g.title).toMatch(/^store-/);
    // No "ShopMy" tile: each brand from her ShopMy links is its own store (Target, Tractor Supply, Dillard's ...).
    const tiles = guidesIn("by-store");
    expect(tiles.some((g) => g.slug === "store-shopmy" || /^shopmy$/i.test(g.title))).toBe(false);
    expect(guideBySlug("store-shopmy")).toBeUndefined();
    const viaShopMy = GUIDE_INDEX.filter((g) => g.via === "shopmy").map((g) => g.slug);
    expect(viaShopMy.length).toBeGreaterThan(50);
    for (const s of ["store-target", "store-tractor-supply", "store-dillards"]) expect(viaShopMy, s).toContain(s);
    for (const s of viaShopMy) expect(guideBySlug(s)?.row, s).toBe("by-store");
  });

  it("Kids is a hub of Boys / Girls / Gender-Neutral, each a hub of its five age guides; removed guides are gone", () => {
    const kids = guideBySlug(KIDS_HUB)!;
    expect(kids.picks).toEqual([]);
    const genders = childrenOf(kids).map((c) => c.slug);
    expect([...genders].sort()).toEqual(["boys", "gender-neutral", "girls"]);
    for (const who of genders) {
      const ages = GUIDE_INDEX.filter((x) => x.parent === who).map((x) => x.slug);
      expect(ages.length, who).toBe(5);
      // Only the age guides that hold something are tiles (lead 2026-11-18).
      expect(childrenOf(guideBySlug(who)!).map((c) => c.slug)).toEqual(ages.filter((x) => !guideBySlug(x)?.empty));
      expect(childrenOf(guideBySlug(who)!).length, who).toBeGreaterThan(0);
    }
    for (const empty of REMOVED_GUIDES) expect(guideBySlug(empty), empty).toBeUndefined();
    expect(unplacedGuides()).toEqual([]);
    expect(guideBySlug("girls-toddlers")!.age).toBe("ages 1–3");
    // The old For Kids section's picks (Toddlers collection) lead the gender-neutral Toddlers guide, so nothing was lost.
    // ... unless Toddlers now has its own researched list (then it lists exactly that one, and the Toddlers collection
    // the old picks came from stays its full-guide link).
    const toddlers = guideBySlug("gender-neutral-toddlers")!;
    if (!RESEARCHED_PICKS["gender-neutral-toddlers"]) {
      for (const p of giftGuides.sections.find((x) => x.id === "for-kids")!.picks) expect(toddlers.picks.map((x) => x.name)).toContain(p.name);
    } else expect(toddlers.links.map((l) => l.label)).toContain("Gifts for Toddlers on ShopMy");
  });

  it("the owner's guide list drives the order and the palettes; every listed guide with content is shown", () => {
    expect(ROWS.map((r) => r.label)).toEqual(ROW_LABELS);
    expect(ROWS.map((r) => r.tint)).toEqual(["green", "red", "oat", "green", "oat", "red", "oat", "green", "red", "oat", "green"]);
    const shown = GUIDES.filter((g) => GUIDE_INDEX.some((x) => x.slug === g.slug)).map((g) => g.slug);
    expect(shown).toEqual(GUIDE_INDEX.filter((x) => shown.includes(x.slug)).map((x) => x.slug));
    expect(shown).toEqual(GUIDE_INDEX.filter((x) => !REMOVED_GUIDES.includes(x.slug)).map((x) => x.slug));
    expect(shown.length).toBeGreaterThan(200);
    for (const g of GUIDES) expect(ROWS.find((r) => r.row === g.row), g.slug).toBeTruthy();
    for (const x of GUIDE_INDEX.filter((i) => shown.includes(i.slug))) expect(guideBySlug(x.slug)!.tint).toBe(x.tint);
  });

  it("the disclosures say plainly what the links are, Amazon's in its required words", () => {
    expect(giftGuides.disclosure).toBe(DISCLOSURE);
    expect(giftGuides.amazonStatement).toBe(AMAZON_STATEMENT);
  });
});

describe("gift guides: the landing opens to the guides", () => {
  it("shows one tile row per group, in order, each with See all; every top-level guide's tile links to /gift-guides/<slug>", () => {
    const top = ROWS.flatMap((r) => GUIDES.filter((g) => !g.empty && !g.thin && g.row === r.row && (g.parent ? g.parent === KIDS_HUB : g.slug !== KIDS_HUB)));
    const { container } = renderAt("/gift-guides");
    const rows = [...container.querySelectorAll("[data-gift-row]")];
    expect(rows.map((r) => r.querySelector("h2")?.textContent)).toEqual(ROW_LABELS);
    expect([...container.querySelectorAll("a[data-gift-see-all]")].map((a) => a.getAttribute("href"))).toEqual(ROWS.map((r) => `/gift-guides?group=${r.row}`));
    const tiles = [...container.querySelectorAll("[data-gift-rows] a[data-gift-tile]")];
    expect(tiles.length).toBeGreaterThan(30);
    // "Start here" (owner 2026-11-18): Mom, Dad, Her, Him, Kids, Under $25, Louisiana-Made first; on a phone the rows
    // fold behind "More guides" (a CSS class; the button is hidden on wider screens).
    const start = [...container.querySelectorAll("[data-gift-start] a[data-gift-tile]")].map((a) => a.getAttribute("data-gift-tile"));
    expect(start).toEqual(["mom", "dad", "her", "him", "kids", "under-25", "louisiana-made"].filter((x) => guideBySlug(x) && !guideBySlug(x)!.empty));
    expect(start.length).toBeGreaterThan(4);
    const folded = container.querySelector("[data-gift-rows]")!;
    expect(folded.className).toContain("gg-rows-folded");
    const more = container.querySelector("button[data-gift-more]")!;
    expect(more.textContent).toBe("More guides");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(container.querySelector("[data-gift-rows]")!.className).not.toContain("gg-rows-folded");
    expect(container.querySelector("button[data-gift-more]")!.getAttribute("aria-expanded")).toBe("true");
    expect(GIFT_GUIDES_CSS).toMatch(/@media \(max-width:767px\)\{\.gg-more-btn\{display:flex[^}]*\}\.gg-rows-folded\{display:none\}\}/);
    expect(GIFT_GUIDES_CSS).toContain(".gg-more-btn{display:none}");
    // Design audit 11-18 (High): on a phone the menu sat 2,000–3,100 px above the picks; it now follows the page.
    const phone = GIFT_GUIDES_CSS.slice(GIFT_GUIDES_CSS.lastIndexOf("@media (max-width:767px){"));
    expect(phone).toMatch(/\.gg-side\{[^}]*order:2/);
    expect(phone).toMatch(/\.gg-main\{[^}]*order:1/);
    expect(tiles.map((a) => a.getAttribute("href"))).toEqual(top.map((g) => `/gift-guides/${g.slug}`));
    // No guide's list on the landing; only the "Top 10 most-loved" row (owner 2026-11-18), first, ten picks at most.
    const topRow = container.querySelector("[data-gift-top]")!;
    expect(topRow.compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(topRow.querySelector("h2")?.textContent).toBe("Top 10 most-loved");
    const topRows = topRow.querySelectorAll("[data-gift-pick]");
    expect(topRows.length).toBeGreaterThan(0);
    expect(topRows.length).toBeLessThanOrEqual(10);
    expect(container.querySelectorAll("[data-gift-pick]").length).toBe(topRows.length);
    for (const img of container.querySelectorAll("img.gg-cover")) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(Number(img.getAttribute("width"))).toBe(480);
      expect(Number(img.getAttribute("height"))).toBe(480);
    }
    expect(container.querySelectorAll("[data-gift-rows] img.gg-cover").length).toBe(top.filter((g) => g.cover).length);
    // A guide with no cover gets a plain gingham tile with its name only (owner 2026-11-18: no footer text).
    const text = [...container.querySelectorAll("[data-gift-rows] [data-gift-textcover]")];
    expect(text.length).toBe(top.filter((g) => !g.cover).length);
    for (const t of text) expect(t.textContent).not.toMatch(/LOUISIANA HELPR/i);
  });

  it("every header is compact: italic lead, title and a small Share pill; no subtitle, no pick count anywhere", () => {
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector(".gg-band")).toBeNull();
    const words = container.querySelector("[data-gift-words]");
    expect([...(words?.children ?? [])].map((c) => c.textContent)).toEqual(["top-rated finds", "Holiday Gift Guides", "ShareText this guide"]);
    // Owner 2026-11-18: no "25 picks" count and no subtitle under any title; a tile is its cover and its name (a kids
    // age guide keeps its age band).
    const tiles = [...container.querySelectorAll("a[data-gift-tile]")];
    expect(tiles.length).toBeGreaterThan(100);
    for (const t of tiles) {
      const g = guideBySlug(t.getAttribute("data-gift-tile")!)!;
      // The text cover (no cover file) repeats the name as a decorative, aria-hidden picture; the tile's words are the name.
      const words = [...t.childNodes].filter((n) => !(n instanceof Element && n.getAttribute("aria-hidden") === "true")).map((n) => n.textContent).join("");
      expect(words, g.slug).toBe(`${g.title}${g.age ?? ""}`);
    }
    expect(container.textContent).not.toMatch(/\d+ picks?\b|\d+ guides\b|Coming soon|On ShopMy/);
    cleanup();
    const wordsOf = (path: string) => [...(renderAt(path).container.querySelector("[data-gift-words]")?.children ?? [])].map((c) => c.textContent);
    expect(wordsOf("/gift-guides/mom")).toEqual(["gifts for", "Mom", "ShareText this guide"]);
    cleanup();
    // "Text this guide" (owner 2026-11-18): an sms: link carrying the guide's URL; iOS's form, else Android's.
    const text = renderAt("/gift-guides/mom").container.querySelector("a[data-gift-text]")!;
    expect(text.getAttribute("href")).toMatch(/^sms:[?&]body=.*https%3A%2F%2Fwww\.louisianahelpr\.com%2Fgift-guides%2Fmom$/);
    expect(smsHref("https://x.test/g", "Mom", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe("sms:&body=Mom%20https%3A%2F%2Fx.test%2Fg");
    expect(smsHref("https://x.test/g", "Mom", "Mozilla/5.0 (Linux; Android 15)")).toBe("sms:?body=Mom%20https%3A%2F%2Fx.test%2Fg");
    cleanup();
    cleanup();
    const mom = renderAt("/gift-guides/mom").container;
    expect(mom.querySelector(".gg-band")).toBeNull();
    expect(mom.querySelector("[data-gift-words] h2")?.textContent).toBe("Mom");
  });

  it("a guide that holds nothing is in no row, search or menu; its own link opens Picks coming soon and related guides", () => {
    // Lead 2026-11-18 (live: 384 of 469 guides opened "Picks coming soon"). Proven red: drop the `!g.empty` filter in
    // guidesIn or searchGuides and the empty guide is listed again.
    const empty = GUIDES.filter((g) => g.empty);
    const holding = GUIDES.filter((g) => !g.empty);
    expect(holding.length).toBeGreaterThan(100);
    for (const g of empty) expect(g.picks.length + g.links.length + (g.children?.length ?? 0), g.slug).toBe(0);
    for (const g of holding) expect(g.picks.length + g.links.length + (g.children?.length ?? 0) + (g.deals?.length ?? 0), g.slug).toBeGreaterThan(0);
    for (const r of ROWS) for (const g of guidesIn(r.row)) expect(g.empty, g.slug).toBeUndefined();
    const landing = renderAt("/gift-guides").container;
    const listed = new Set([...landing.querySelectorAll("a[data-gift-tile], [data-gift-sidebar] a")].map((a) => a.getAttribute("href")));
    for (const g of empty) {
      expect(listed.has(`/gift-guides/${g.slug}`), g.slug).toBe(false);
      expect(searchGuides(g.title).map((x) => x.slug), g.slug).not.toContain(g.slug);
    }
    cleanup();
    // A fixture empty guide (so the page stays proven once every real guide holds picks).
    const probe: CatalogGuide = { ...guideBySlug("mom")!, slug: "probe-empty", picks: [], links: [], deals: undefined, empty: true };
    const { container } = render(<MemoryRouter><GiftGuideView guide={probe} /></MemoryRouter>);
    expect(container.querySelector("[data-gift-coming-soon]")?.textContent).toContain("Picks coming soon");
    expect(container.querySelector("[data-gift-list]")).toBeNull();
    const related = [...container.querySelectorAll("[data-gift-related] a[data-gift-tile]")].map((a) => a.getAttribute("data-gift-tile")!);
    expect(related.length).toBeGreaterThan(0);
    for (const r of related) expect(guideBySlug(r)?.empty, r).toBeUndefined();
    cleanup();
    expect(renderAt("/gift-guides/mom").container.querySelector("[data-gift-coming-soon]")).toBeNull();
  });

  it("See all shows one group's guides as a wrapped grid, with a way back", () => {
    const { container } = renderAt("/gift-guides?group=by-budget");
    expect([...container.querySelectorAll("[data-gift-row]")].map((r) => r.getAttribute("data-gift-row"))).toEqual(["by-budget"]);
    expect(container.querySelector("[data-gift-row] ul")?.className).toBe("gg-wrap");
    expect(container.querySelector("a[data-gift-back]")?.getAttribute("href")).toBe("/gift-guides");
  });

  it("the sidebar lists every group collapsed on the landing; on a guide only its group is open, the guide marked current", () => {
    const { container } = renderAt("/gift-guides");
    const groups = [...container.querySelectorAll("details[data-gift-group]")] as HTMLDetailsElement[];
    expect(groups.map((d) => d.querySelector("summary")?.textContent)).toEqual(ROW_LABELS);
    expect(groups.filter((d) => d.open)).toEqual([]);
    expect(container.querySelector('[data-gift-sidebar] a[aria-current="page"]')?.getAttribute("href")).toBe("/gift-guides");
    cleanup();
    const view = renderAt("/gift-guides/under-25").container;
    const open = ([...view.querySelectorAll("details[data-gift-group]")] as HTMLDetailsElement[]).filter((d) => d.open);
    expect(open.map((d) => d.getAttribute("data-gift-group"))).toEqual(["by-budget"]);
    expect([...view.querySelectorAll('[data-gift-sidebar] a[aria-current="page"]')].map((a) => a.getAttribute("href"))).toEqual(["/gift-guides/under-25"]);
  });

  it("kids in two taps: the row and menu show Girls / Boys / Gender-Neutral; each opens its five age covers", () => {
    const { container } = renderAt("/gift-guides");
    const kidsRow = container.querySelector('[data-gift-row="for-kids"]')!;
    expect([...kidsRow.querySelectorAll("a[data-gift-tile]")].map((a) => a.getAttribute("data-gift-tile")).sort()).toEqual(["boys", "gender-neutral", "girls"]);
    const menu = container.querySelector('details[data-gift-group="for-kids"]')!;
    expect([...menu.querySelectorAll("a")].map((a) => a.getAttribute("href")).sort()).toEqual(["/gift-guides/boys", "/gift-guides/gender-neutral", "/gift-guides/girls"]);
    cleanup();
    const girls = renderAt("/gift-guides/girls").container;
    expect([...girls.querySelectorAll("[data-gift-guide] a[data-gift-tile]")].map((a) => a.getAttribute("href"))).toEqual(
      GUIDE_INDEX.filter((x) => x.parent === "girls").map((x) => `/gift-guides/${x.slug}`),
    );
    cleanup();
    const side = renderAt("/gift-guides/girls").container;
    const open = ([...side.querySelectorAll("details[data-gift-group]")] as HTMLDetailsElement[]).filter((d) => d.open);
    expect(open.map((d) => d.getAttribute("data-gift-group"))).toEqual(["for-kids"]);
    expect(open[0].querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/gift-guides/girls");
  });

  it("career hubs open their roles; Teachers sits in Educators", () => {
    const filledSlug = (x: string) => Boolean(guideBySlug(x));
    for (const hub of ["healthcare", "oilfield-and-trades", "service-industry", "educators", "first-responders", "military"]) {
      const g = guideBySlug(hub)!;
      expect(g?.row, hub).toBe("by-career");
      // Its roles from the owner's list (more than four), each shown once it holds something (lead 2026-11-18).
      const roles = GUIDE_INDEX.filter((x) => x.parent === hub).map((x) => x.slug);
      expect(roles.length, hub).toBeGreaterThan(4);
      expect(childrenOf(g).map((c) => c.slug), hub).toEqual(roles.filter((x) => filledSlug(x) && !guideBySlug(x)?.empty));
      expect(childrenOf(g).length, hub).toBeGreaterThan(0);
      for (const c of childrenOf(g)) expect(c.parent).toBe(hub);
    }
    expect(guideBySlug("teachers")!.parent).toBe("educators");
    const row = renderAt("/gift-guides").container.querySelector('[data-gift-row="by-career"]')!;
    const tiles = [...row.querySelectorAll("a[data-gift-tile]")].map((a) => a.getAttribute("data-gift-tile"));
    expect(tiles).toContain("healthcare");
    expect(tiles).not.toContain("female-nurses");
  });

  it("Discount codes sit at the top of the menu, hide when expired or empty, and each has a copy button", () => {
    expect(discountCodes.length).toBeGreaterThan(5);
    expect(discountCodes.map((c) => c.store)).not.toContain("Instant Funding");
    // A code past its last day hides itself; the section disappears when none is left.
    // ... and one before its first day stays hidden too (affiliate sweep 11-18: Muck Boot CYBER showed on Nov 18).
    // @mutate src/content/giftGuides.ts | && (!c.starts \|\| c.starts <= today) | && true
    expect(activeCodes(discountCodes, "2026-11-19").map((c) => c.code)).not.toContain("TAKE25");
    expect(activeCodes(discountCodes, "2026-11-20").map((c) => c.code)).toContain("TAKE25");
    expect(activeCodes(discountCodes, "2026-11-28").map((c) => c.code)).not.toContain("CYBER");
    expect(activeCodes(discountCodes, "2026-11-29").map((c) => c.code)).toContain("CYBER");
    // Sweep #10: Bonheur (a pick on Spa Days) has its live codes; its Black Friday code is embargoed to Nov 26.
    expect(activeCodes(discountCodes, "2026-11-18").filter((c) => c.store === "Bonheur Jewelry").map((c) => c.code)).toEqual(["SHOPMY25", "BONHEUR15"]);
    expect(activeCodes(discountCodes, "2026-11-25").map((c) => c.code)).not.toContain("BLKFRIDAY35");
    expect(activeCodes(discountCodes, "2026-11-26").map((c) => c.code)).toContain("BLKFRIDAY35");
    // Software and supplement codes are out (Parallels, HerbsPro: skip list).
    expect(discountCodes.map((c) => c.store)).not.toEqual(expect.arrayContaining(["Parallels Desktop"]));
    expect(discountCodes.map((c) => c.store)).not.toContain("HerbsPro");
    expect(activeCodes(discountCodes, "2026-12-07").map((c) => c.code)).not.toContain("CYBER");
    expect(discountCodes.find((c) => c.code === "CYBER")?.dates).toBe("Nov 29 – Dec 6");
    expect(render(<MemoryRouter><DiscountCodes codes={[]} /></MemoryRouter>).container.querySelector("[data-gift-codes]")).toBeNull();
    cleanup();
    // At the top of the menu, under the search box (owner 2026-11-18).
    const side = renderAt("/gift-guides").container.querySelector("[data-gift-sidebar]")!;
    expect(side.firstElementChild?.querySelector("[data-gift-search]")).not.toBeNull();
    const codes = side.querySelector(":scope > [data-gift-codes]")!;
    expect(codes).not.toBeNull();
    expect(codes.compareDocumentPosition(side.querySelector("details[data-gift-group]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One box per store, several codes inside: Muck Boot holds CYBER and TAKE25 (Nov 20–28), in the owner's order.
    const boxes = [...side.querySelectorAll("[data-gift-code-store]")];
    const d = new Date();
    const todayIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(boxes.map((b) => b.getAttribute("data-gift-code-store"))).toEqual(codesByStore(activeCodes([...discountCodes, ...DEAL_CODES], todayIso)).map((x) => x.store));
    // Follow-up 2026-11-18: the rest of her list, then the codes the researched deals name (WINTERBREW, GRATITUDE ...).
    const shown = [...side.querySelectorAll("[data-gift-code]")].map((c) => c.getAttribute("data-gift-code"));
    for (const c of ["ONBRAND-LEXI", "LEXIL-20", "LEXILOMBAS7"]) expect(shown, c).toContain(c);
    const all = [...discountCodes, ...DEAL_CODES];
    expect(all.map((c) => c.code)).toEqual(expect.arrayContaining(["WINTERBREW", "GRATITUDE"]));
    expect(activeCodes(all, "2026-11-24").map((c) => c.code)).toContain("GRATITUDE");
    expect(activeCodes(all, "2026-11-25").map((c) => c.code)).not.toContain("GRATITUDE");
    for (const c of DEAL_CODES) expect(c.offer, c.code).not.toMatch(/\$\s?\d/);
    expect(all.map((c) => c.code)).not.toContain("IFDEAL30");
    expect(activeCodes(discountCodes, "2026-11-29").map((c) => c.code)).not.toContain("TAKE25");
    expect(activeCodes(discountCodes, "2026-11-28").map((c) => c.code)).toContain("TAKE25");
    cleanup();
    const write = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: write } });
    // Ranked by Louisiana popularity; a store with two codes is one box with both.
    expect(codesByStore(discountCodes).map((x) => x.store).slice(0, 5)).toEqual(["Muck Boot", "Durango Boots", "Magnifique", "Free Country", "Bruno Marc"]);
    const both = render(<MemoryRouter><DiscountCodes codes={discountCodes} /></MemoryRouter>).container;
    expect(both.querySelectorAll('[data-gift-code-store="Muck Boot"]').length).toBe(1);
    expect([...both.querySelectorAll('[data-gift-code-store="Muck Boot"] [data-gift-code]')].map((x) => x.getAttribute("data-gift-code"))).toEqual(["CYBER", "TAKE25"]);
    cleanup();
    const { container } = render(<MemoryRouter><DiscountCodes codes={[{ rank: 1, store: "Example Shop", code: "TEST10", offer: "10% off" }]} /></MemoryRouter>);
    expect(container.querySelector('[data-gift-code-store="Example Shop"]')?.textContent).toContain("TEST10");
    fireEvent.click(screen.getByRole("button", { name: "Copy TEST10" }));
    expect(write).toHaveBeenCalledWith("TEST10");
  });

  it("a store page with fewer than 4 picks is no By store tile or menu entry, but search and its link still open it", () => {
    // Proven red: drop `!g.thin` in guidesIn and the thin store pages are tiles again.
    expect(STORE_ROW_MIN_PICKS).toBe(4);
    const thin = GUIDES.filter((g) => g.thin);
    for (const g of thin) {
      expect(g.row, g.slug).toBe("by-store");
      expect(g.picks.length, g.slug).toBeLessThan(4);
    }
    for (const g of guidesIn("by-store")) expect(g.picks.length + (g.deals?.length ?? 0) > 0 && (g.picks.length >= 4 || !g.thin), g.slug).toBe(true);
    for (const g of guidesIn("by-store")) expect(g.thin, g.slug).toBeUndefined();
    if (thin[0]) {
      expect(searchGuides(thin[0].title).map((x) => x.slug)).toContain(thin[0].slug);
      const { container } = renderAt(`/gift-guides/${thin[0].slug}`);
      expect(container.querySelector("[data-gift-words] h2")?.textContent).toBe(thin[0].title);
      expect(container.querySelector('[data-gift-row="by-store"]')).toBeNull();
      cleanup();
    }
    const landing = renderAt("/gift-guides").container;
    for (const g of thin) expect(landing.querySelector(`a[data-gift-tile="${g.slug}"]`), g.slug).toBeNull();
  });

  it("the landing carries the 25 Days card, linking to the Facebook page in a new tab", () => {
    const card = renderAt("/gift-guides").container.querySelector("[data-gift-giveaways]")!;
    expect(card.textContent).toContain("25 Days of Louisiana Giveaways");
    const a = card.querySelector("a[data-gift-social]")!;
    expect(a.getAttribute("href")).toBe("https://www.facebook.com/louisianahelpr");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("Sales sit under Discount codes, collapsed, soonest end first; a sale past its end day hides", () => {
    expect(SALES.length).toBeGreaterThan(20);
    for (let i = 1; i < SALES.length; i++) expect(SALES[i - 1].ends <= SALES[i].ends, SALES[i].offer).toBe(true);
    const last = SALES[SALES.length - 1].ends;
    expect(liveSales(SALES, last).length).toBeGreaterThan(0);
    const next = new Date(`${last}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    expect(liveSales(SALES, next.toISOString().slice(0, 10))).toEqual([]);
    expect(render(<MemoryRouter><SalesList sales={[]} /></MemoryRouter>).container.querySelector("[data-gift-sales]")).toBeNull();
    cleanup();
    const side = renderAt("/gift-guides").container.querySelector("[data-gift-sidebar]")!;
    const sales = side.querySelector(":scope > details[data-gift-sales]") as HTMLDetailsElement | null;
    expect(sales).not.toBeNull();
    expect(sales!.open).toBe(false);
    const codes = side.querySelector(":scope > [data-gift-codes]")!;
    expect(codes.compareDocumentPosition(sales!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const a of sales!.querySelectorAll("a[data-gift-out]")) expect(ALLOWED_HOSTS, a.getAttribute("href")!).toContain(new URL(a.getAttribute("href")!).hostname);
    expect(sales!.textContent).not.toMatch(/\$\s?\d/);
  });

  it("Female and Male Nurses fold into RNs, LPNs and CNAs (each pick once), and their old links open RNs", () => {
    for (const gone of Object.keys(MERGED_GUIDES)) expect(guideBySlug(gone), gone).toBeUndefined();
    for (const t of ["rns", "lpns", "cnas"]) {
      const g = guideBySlug(t)!;
      expect(g.picks.length, t).toBeGreaterThan(10);
      // Once each: by link, and by name for a ShopMy collection link that several products share.
      expect(new Set(g.picks.map((p) => `${p.href} ${p.name}`)).size, t).toBe(g.picks.length);
      expect(g.links.map((l) => l.label), t).toEqual(expect.arrayContaining(["Gifts for Female Nurses on ShopMy", "Gifts for Male Nurses on ShopMy"]));
    }
    renderAt("/gift-guides/female-nurses");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/rns");
    cleanup();
    renderAt("/gift-guides#male-nurses");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/rns");
    cleanup();
    renderAt("/gift-guides#for-fnurse");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/rns");
  });

  it("an old /gift-guides#<slug> pin opens that guide's page; an unknown slug falls back to the landing", () => {
    renderAt("/gift-guides#for-him");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/him");
    expect(screen.getByRole("heading", { level: 2, name: "Him" })).toBeTruthy();
    cleanup();
    renderAt("/gift-guides/for-mom");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/mom");
    cleanup();
    renderAt("/gift-guides#louisiana-made");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/louisiana-made");
    cleanup();
    renderAt("/gift-guides/no-such-guide");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides");
  });
});

describe("gift guides: one guide at /gift-guides/<slug>", () => {
  it("renders every list guide's picks as numbered rows with a thumbnail or letter tile, under its words-only header, with All guides", () => {
    // Every list guide's body (GiftGuideView alone: rendering ~600 whole pages, sidebar and all, ran the worker out of
    // memory on 2026-11-18 once the store pages arrived); the page frame (header, All guides) on a sample below.
    let checked = 0;
    for (const g of GUIDES.filter((x) => !x.children && x.picks.length > 0)) {
      const { container } = render(<MemoryRouter><GiftGuideView guide={g} /></MemoryRouter>);
      expandAll(container);
      const rows = [...container.querySelectorAll("ol[data-gift-list] > li[data-gift-pick]")];
      expect(rows.length, g.slug).toBe(g.picks.length);
      rows.forEach((li, i) => {
        const a = li.querySelector("a")!;
        expect(a.getAttribute("href")).toBe(g.picks[i].href);
        expect(a.textContent).toContain(g.picks[i].name);
        const img = a.querySelector("img.gg-thumb");
        if (g.picks[i].image) {
          expect(img?.getAttribute("loading")).toBe("lazy");
          expect(Number(img?.getAttribute("width"))).toBeGreaterThan(0);
          expect(Number(img?.getAttribute("height"))).toBeGreaterThan(0);
        } else {
          expect(img).toBeNull();
          expect(a.querySelector("[data-gift-letter]")?.textContent).toBe(storeLabel(g.picks[i]));
        }
      });
      checked += 1;
      cleanup();
    }
    expect(checked).toBeGreaterThan(50);
    for (const slug of ["mom", "store-amazon", "store-walmart", "under-25", "25-days-sponsors"]) {
      const g = guideBySlug(slug)!;
      const { container } = renderAt(`/gift-guides/${slug}`);
      expect(container.querySelector("[data-gift-words] h2")?.textContent, slug).toBe(g.title);
      // Design audit 2026-11-18 #3: a long list draws 50 rows, then "Show more" adds 50 at a time (store-amazon drew 827).
      // @mutate src/pages/info/giftGuides/GiftGuideView.tsx | {sectionsOf(guide.picks.slice(0, shown)).map( | {sectionsOf(guide.picks).map(
      expect(container.querySelectorAll("ol[data-gift-list] > li[data-gift-pick]").length, slug).toBe(Math.min(g.picks.length, PICKS_PAGE));
      expandAll(container);
      expect(container.querySelectorAll("ol[data-gift-list] > li[data-gift-pick]").length, slug).toBe(g.picks.length);
      const back = container.querySelector("a[data-gift-back]");
      expect(back?.getAttribute("href")).toBe("/gift-guides");
      expect(back?.textContent).toContain("All guides");
      expect(back!.compareDocumentPosition(container.querySelector("[data-gift-words]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      cleanup();
    }
  }, 90_000);

  it("every guide's palette is one of the three cover palettes; covers are the owner's files, two-way", () => {
    for (const g of GUIDES) expect(["green", "oat", "red"], g.slug).toContain(g.tint);
    expect(guideBySlug("mom")!.tint).toBe("green");
    expect(guideBySlug("girls-toddlers")!.tint).toBe("red");
    expect(guideBySlug("mom")!.cover).toBe("/gift-guides/covers/mom.webp");
    for (const g of GUIDES.filter((x) => x.cover)) expect(existsSync(`public${g.cover}`), g.cover).toBe(true);
    // Two-way: every cover file shipped is some guide's cover.
    const used = new Set(GUIDES.map((g) => g.cover));
    const files = readdirSync("public/gift-guides/covers");
    expect(files.length).toBeGreaterThan(40);
    for (const f of files) expect(used.has(`/gift-guides/covers/${f}`), f).toBe(true);
  });

  it("every ShopMy collection is a guide's full-guide link or a guide of its own", () => {
    const linked = new Set(GUIDES.flatMap((g) => g.links.map((l) => l.href)));
    expect(SHOPMY_COLLECTIONS.length).toBeGreaterThan(40);
    // Workaholic (8988297) left the owner's list with the non-healthcare careers (REMOVED_GUIDES).
    const kept = SHOPMY_COLLECTIONS.filter((c) => c.id !== 8988297);
    for (const c of kept) expect(linked.has(`https://shopmy.us/collections/${c.id}`), c.label).toBe(true);
    // Each collection is its own guide's "full guide" link (not only reachable through another guide's links).
    const labelled = new Set(GUIDES.flatMap((g) => g.links.filter((l) => l.label === `${SHOPMY_COLLECTIONS.find((c) => l.href.endsWith(`/${c.id}`))?.label} on ShopMy`).map((l) => l.href)));
    for (const c of kept) expect(labelled.has(`https://shopmy.us/collections/${c.id}`), c.label).toBe(true);
  });
});

describe("gift guides: links and disclosures on every view", () => {
  it("the disclosure and Amazon's statement show once each, at the bottom after the guides, as plain lines", () => {
    for (const url of ["/gift-guides", "/gift-guides/under-25", "/gift-guides/for-her"]) {
      const { container } = renderAt(url);
      expect(screen.getAllByText(DISCLOSURE).length, url).toBe(1);
      expect(screen.getAllByText(AMAZON_STATEMENT).length, url).toBe(1);
      const last = container.querySelector("[data-gift-row]:last-of-type, [data-gift-guide]")!;
      expect(last, url).toBeTruthy();
      for (const line of [screen.getByText(DISCLOSURE), screen.getByText(AMAZON_STATEMENT)]) {
        expect(last.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING, url).toBeTruthy();
        const classes = (line.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
        expect(classes.filter((c) => /^(?:[a-z0-9]+:)*(?:border|rounded|bg-|shadow|ring|p[xytblr]?-|outline)/.test(c))).toEqual([]);
      }
      cleanup();
    }
  });

  it("every outbound anchor is rel sponsored + noopener and opens a new tab; every internal link stays in the app", () => {
    let outbound = 0;
    // Whole pages for the landing and a sample (the sidebar's and header's links), then every guide's body alone (its
    // picks, deals and full-guide links): ~600 whole pages ran the worker out of memory on 2026-11-18.
    const SAMPLE = ["mom", "store-amazon", "store-walmart", "gift-wrap-and-cards", "kids", "healthcare"];
    const views: [string, () => HTMLElement][] = [
      ...["/gift-guides", "/gift-guides?list=mine", ...SAMPLE.map((s) => `/gift-guides/${s}`)].map((url) => [url, () => renderAt(url).container] as [string, () => HTMLElement]),
      ...GUIDES.map((g) => [g.slug, () => render(<MemoryRouter><GiftGuideView guide={g} /></MemoryRouter>).container] as [string, () => HTMLElement]),
    ];
    for (const [url, draw] of views) {
      const container = expandAll(draw());
      for (const a of container.querySelectorAll("a")) {
        const href = a.getAttribute("href") ?? "";
        // "Text this guide" opens the visitor's own messages app (an sms: link, not a shop).
        if (href.startsWith("sms:") && a.hasAttribute("data-gift-text")) continue;
        // The 25 Days card's Facebook page (a social follow, not a shop: no affiliate rel).
        if (a.hasAttribute("data-gift-social")) {
          expect(href, url).toBe(sponsorPage.links.facebookPage);
          continue;
        }
        if (href.startsWith("/")) {
          // The one link out of the guides: the Hire-a-Helpr box's pre-filled Post a job (owner 2026-11-18).
          if (href === GIFT_WRAP_JOB_PATH) continue;
          expect(href, url).toMatch(/^\/gift-guides(?:\/[a-z0-9-]+|\?group=[a-z-]+|\?list=mine)?$/);
          continue;
        }
        outbound += 1;
        expect(a.hasAttribute("data-gift-out"), href).toBe(true);
        const rel = (a.getAttribute("rel") ?? "").split(/\s+/);
        expect(rel, href).toContain("sponsored");
        expect(rel, href).toContain("noopener");
        expect(a.getAttribute("target"), href).toBe("_blank");
        expect(ALLOWED_HOSTS, href).toContain(new URL(href).hostname);
      }
      cleanup();
    }
    expect(outbound).toBeGreaterThan(picks.length);
    // Renders all ~470 guide pages (2026-11-18) one by one (~12 s alone, more under a parallel run): a per-test timeout, not a budget.
  }, 90_000);

  it("fills the public container: no page column or narrower measure", () => {
    const { container } = renderAt("/gift-guides");
    const root = container.querySelector("[data-gift-guides]");
    expect(root).toBeTruthy();
    const capped: string[] = [];
    for (let el: Element | null = root; el && el !== container; el = el.parentElement) {
      for (const c of (el.getAttribute("class") ?? "").split(/\s+/)) {
        if (c === "page-column" || c === "page-measure" || (/^(?:[a-z0-9]+:)*max-w-/.test(c) && c !== "max-w-[78rem]")) capped.push(c);
      }
    }
    expect(capped).toEqual([]);
    expect(src("src/pages/info/GiftGuides.tsx")).not.toMatch(/<PublicHeaderPage[^>]*\bwidth=|PAGE_COLUMN|page-column|page-measure/);
  });
});

describe("gift guides: public but not yet indexed or linked (owner 2026-11-17, public 2026-11-18)", () => {
  it("App.tsx: /gift-guides and /gift-guides/<slug> render the page for everyone, with no ?preview=1 gate", () => {
    const app = src("src/App.tsx");
    for (const path of ["/gift-guides", "/gift-guides/:slug"]) {
      expect(app).toContain(`<Route path="${path}" element={<RouteErrorBoundary>{routeEl(<PageTransition><GiftGuides /></PageTransition>)}</RouteErrorBoundary>} />`);
    }
    expect(app).not.toMatch(/GiftGuidesPreviewGate|params\.get\("preview"\)/);
    expect(app.split("\n").filter((l) => l.includes("<GiftGuides />")).length).toBe(2);
  });

  it("is indexed (follow-up 2026-11-18, SEO): the landing and every guide holding picks are in the sitemap, two-way; each guide sets its own head", () => {
    const sitemap = readFileSync("public/sitemap.xml", "utf8");
    const listed = [...sitemap.matchAll(/<loc>https:\/\/www\.louisianahelpr\.com(\/gift-guides[^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(listed).toContain("/gift-guides");
    const guides = listed.filter((x) => x !== "/gift-guides").map((x) => x.replace("/gift-guides/", ""));
    expect(guides.length).toBeGreaterThan(200);
    // Every listed guide opens, holds picks, and is no thin store page.
    for (const s of guides) {
      const g = guideBySlug(s);
      expect(g, s).toBeTruthy();
      expect(g!.picks.length, s).toBeGreaterThan(0);
      expect(g!.empty, s).toBeUndefined();
      expect(g!.thin, s).toBeUndefined();
    }
    // Every guide with researched picks that is listed in a row is in the sitemap.
    for (const g of GUIDES.filter((x) => RESEARCHED_PICKS[x.slug] && !x.empty && !x.thin)) expect(guides, g.slug).toContain(g.slug);
    expect(PUBLIC_PAGE_META["/gift-guides"].canonical).toBe("https://www.louisianahelpr.com/gift-guides");
    expect(Object.keys(NOINDEX_PAGE_META)).not.toContain("/gift-guides");
    expect(src("src/pages/info/GiftGuides.tsx")).toContain('usePageMeta(guide ? giftGuidePageMeta(guide.slug, guide.title) : PUBLIC_PAGE_META["/gift-guides"]);');
    const mom = giftGuidePageMeta("mom");
    expect(mom.title).toBe("Gifts for Mom — Helpr");
    expect(mom.canonical).toBe("https://www.louisianahelpr.com/gift-guides/mom");
    expect(mom.robots).toBeUndefined();
    expect(giftGuidePageMeta("store-walmart").title).toBe("Walmart gift guide — Helpr");
    // A guide not in the sitemap (empty, a hub, a thin store page) is noindex under its own title.
    const unlisted = GUIDES.find((g) => !GIFT_GUIDE_SEO[g.slug])!;
    expect(unlisted).toBeTruthy();
    expect(giftGuidePageMeta(unlisted.slug, unlisted.title)).toMatchObject({ title: `${unlisted.title} gift guide — Helpr`, robots: expect.stringMatching(/noindex/) });
    expect(Object.keys(GIFT_GUIDE_SEO).sort()).toEqual(guides.sort());
    for (const name of Object.values(GIFT_GUIDE_SEO)) expect(name).not.toMatch(/undefined/);
    // Q178 (CI 11-18: /declutter/item/:id 418 -> 423 KB gz): the guides' name table stays out of publicPageMeta.mjs,
    // which Login, Signup, Index and the Declutter item page load cold; only GiftGuides.tsx and api/share.ts read it.
    // @mutate src/lib/publicPageMeta.mjs | import { townPageMetaFor } from "./townPages.mjs"; | import { townPageMetaFor } from "./townPages.mjs";\nimport { GIFT_GUIDE_SEO } from "../content/giftGuideSeo.mjs";
    expect(src("src/lib/publicPageMeta.mjs")).not.toMatch(/giftGuideSeo|giftGuidePageMeta/);
    expect(src("api/share.ts")).toContain('import { publicOrGiftGuidePageMetaFor as publicPageMetaFor } from "../src/lib/giftGuidePageMeta.mjs";');
    expect(publicOrGiftGuidePageMetaFor("/gift-guides/mom", null)?.title).toBe("Gifts for Mom — Helpr");
    expect(publicOrGiftGuidePageMetaFor("/gift-guides/mom/", null)?.title).toBe("Gifts for Mom — Helpr");
    expect(publicOrGiftGuidePageMetaFor("/browse", null)).toBe(PUBLIC_PAGE_META["/browse"]);
    const rewrites = (JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] }).rewrites;
    expect(rewrites.filter((x) => x.source.startsWith("/gift-guides"))).toEqual([
      { source: "/gift-guides", destination: "/api/share?_og=page&_id=gift-guides" },
      { source: "/gift-guides/:slug", destination: "/api/share?_og=page&_id=gift-guides/:slug" },
      { source: "/gift-guides", destination: "/index.html" },
      { source: "/gift-guides/:slug", destination: "/index.html" },
    ]);
  });

  it("no way in: not on the landing, not in the public footer, not in the /25days footer", () => {
    expect(src("src/pages/info/Index.tsx")).not.toMatch(/GiftGuidesBand/);
    expect(src("src/components/Footer.tsx")).not.toMatch(/gift-guides|giftGuides/);
    expect(src("src/components/sponsor/Sections.tsx")).not.toMatch(/giftGuides/);
    render(<MemoryRouter><GiftGuidesBand /></MemoryRouter>);
    expect(GIFT_GUIDES_PATH).toBe("/gift-guides");
    expect(screen.getByTestId("landing-gift-guides-link").getAttribute("href")).toBe("/gift-guides");
    expect(sponsorPage.links.giftGuides).toBe("/gift-guides");
  });
});

describe("gift guides: blocked brands and the CJ input (lead 2026-11-18)", () => {
  it("SheVibe, King Palm, AnyListingSEO, Loren and Restoro never reach a guide, store page or deal; _cj.json is read", () => {
    expect([...BLOCKED_BRANDS]).toEqual(["SheVibe", "King Palm", "AnyListingSEO", "Loren", "Restoro", "Yeloly", "Serika", "Parallels", "HerbsPro", "ZazzMode"]);
    // ... and no code for one (the codes table and the codes the researched deals name).
    // @mutate scripts/gift-guide-picks.mjs | if (blockedBrand({ ...d, store })) continue; | void d;
    expect(src("scripts/gift-guide-picks.mjs")).toContain("if (blockedBrand({ ...d, store })) continue;");
    for (const c of [...discountCodes, ...DEAL_CODES]) expect(blockedBrand({ store: c.store }), `${c.store} ${c.code}`).toBe(false);
    for (const p of [{ brand: "SheVibe" }, { store: "King Palm" }, { name: "KingPalm rolling kit" }, { href: "https://www.restoro.com/x" }, { brand: "AnyListing SEO" }, { retailer: "Loren" }, { title: "Loren Hope sale" }])
      expect(blockedBrand(p), JSON.stringify(p)).toBe(true);
    for (const p of [{ brand: "Lorena" }, { name: "Florence tote" }, { brand: "SilverRushStyle", affiliate_href: "https://www.anrdoezrs.net/click-101930553-11260336" }])
      expect(blockedBrand(p), JSON.stringify(p)).toBe(false);
    // The import drops a blocked pick before any guide or store page sees it, and a blocked deal section too.
    // @mutate scripts/gift-guide-picks.mjs | if (blockedBrand(p)) return hidden.push | if (false) return hidden.push
    const script = src("scripts/gift-guide-picks.mjs");
    expect(script).toMatch(/function toPick\(p, where\) \{\n\s*if \(blockedBrand\(p\)\) return hidden\.push/);
    expect(script).toMatch(/const addDeal = \(slug, d\) => \{\n\s*if \(blockedBrand\(d\)/);
    // _cj.json (SilverRushStyle's CJ links) lands in the guides it fits and on its store page, like _awin.json.
    expect(script).toContain('for (const f of ["_awin.json", "_cj.json", "_impact.json", "_shopify-collabs.json", "_later.json", "_later-mylinks.json", "_later-brands.json"]) {');
    for (const f of ["_awin.json", "_cj.json", "_impact.json", "_shopify-collabs.json", "_later-mylinks.json", "_later-brands.json"]) expect(script, f).toContain(`["${f}", []]`);
    // Deals and bounties: _later-promos.json (deal sections) and _amazon-bounties.json (Prime, Audible, registries).
    expect(script).toContain('for (const f of ["_later-deals.json", "_later-promos.json"]) {');
    expect(script).toContain('readList("_amazon-bounties.json")');
    // One store page per store however a feed spells it (stanley, stanley-1913 and stanley1913 were three pages).
    // @mutate scripts/gift-guide-picks.mjs | const alias = STORE_ALIASES[ | const alias = undefined && STORE_ALIASES[
    expect(script).toContain('const alias = STORE_ALIASES[compact(domainLike ? domainCore(raw) : cleanName(raw))];');
    expect(script).toContain('const name = alias ?? (isDomain ? domainCore(raw) : cleanName(raw));');
    for (const pair of ['stanley1913: "Stanley"', 'ankerinnovations: "Anker"', 'ulta: "Ulta Beauty"', 'giftcards: "GiftCards.com"', 'yotoplay: "Yoto"']) expect(script, pair).toContain(pair);
    // What ships today: no shown guide, store page or pick carries a blocked brand.
    for (const g of GUIDES) expect(blockedBrand({ store: g.title }) || blockedBrand({ name: g.title }), g.slug).toBe(false);
    let picks = 0;
    for (const [slug, list] of Object.entries(RESEARCHED_PICKS)) for (const p of list) {
      picks += 1;
      expect(blockedBrand(p as unknown as Record<string, unknown>), `${slug}: ${p.name}`).toBe(false);
    }
    expect(picks).toBeGreaterThan(500);
  });
});

describe("gift guides: Her and Him never call another guide's collection their full guide (design audit 11-18 #16)", () => {
  it("Her lists Mom, Sister, Aunt and Friends under More on ShopMy; a guide's own collection keeps Shop the full guide", () => {
    // @mutate src/content/giftGuideCatalog.ts | links: [s.shop, ...s.more].map((l) => ({ ...l, related: true })) | links: [s.shop, ...s.more]
    for (const slug of ["her", "him"]) {
      const g = guideBySlug(slug)!;
      expect(g, slug).toBeTruthy();
      expect(g.links.length, slug).toBeGreaterThan(1);
      expect(g.links.every((l) => l.related), slug).toBe(true);
      const { container, unmount } = render(<MemoryRouter><GiftGuideView guide={g} /></MemoryRouter>);
      expect(container.textContent, slug).not.toContain("Shop the full guide");
      const related = container.querySelector("[data-gift-related]")!;
      expect(related.textContent, slug).toMatch(/^More on ShopMy:/);
      unmount();
    }
    const her = render(<MemoryRouter><GiftGuideView guide={guideBySlug("her")!} /></MemoryRouter>).container;
    expect([...her.querySelectorAll("[data-gift-related] a")].map((a) => a.textContent)).toEqual(["Gifts for Mom", "Gifts for Sister", "Gifts for Aunt", "Gifts for Friends"]);
    cleanup();
    // Dad's own ShopMy collection is still his full guide.
    const dad = guideBySlug("dad")!;
    expect(dad.links.some((l) => !l.related && l.label === "Gifts for Dad on ShopMy")).toBe(true);
    expect(render(<MemoryRouter><GiftGuideView guide={dad} /></MemoryRouter>).container.textContent).toContain("Shop the full guide: Gifts for Dad on ShopMy");
  });
});

describe("gift guides: rows read in order (design audit 11-18 #8, #9)", () => {
  it("By budget runs Under $5 up to $100 & Up, then Stocking Stuffers and Gift Wrap; each kids hub runs Babies to Teens", () => {
    // @mutate src/content/giftGuideIndex.ts | slug: "under-5", | slug: "under-5x",
    const budget = GUIDE_INDEX.filter((g) => g.group === "By budget").map((g) => g.slug);
    expect(budget).toEqual(["under-5", "under-10", "under-15", "under-20", "under-25", "under-30", "under-40", "under-50", "under-75", "under-100", "100-and-up", "stocking-stuffers", "gift-wrap-and-cards"]);
    for (const hub of ["boys", "girls", "gender-neutral"]) {
      expect(GUIDE_INDEX.filter((g) => g.parent === hub).map((g) => g.slug.slice(hub.length + 1)), hub).toEqual(["babies", "toddlers", "little-kids", "big-kids", "teens"]);
      expect(GUIDE_INDEX.filter((g) => g.parent === hub).every((g) => /^ages \d+(–\d+|\+)$/.test(g.age ?? "")), hub).toBe(true);
    }
  });
});

describe("gift guides: Amazon CDN photos held behind one switch; photo-less picks swapped in mixed guides (lead 2026-11-18)", () => {
  it("ships no m.media-amazon.com photo while AMAZON_CDN_PHOTOS is off, and the import swaps no-photo picks from the link library", () => {
    // @mutate scripts/gift-guide-picks.mjs | (!amazonHosted \|\| (AMAZON_CDN_PHOTOS && | (true \|\| (AMAZON_CDN_PHOTOS &&
    const script = src("scripts/gift-guide-picks.mjs");
    expect(script).toContain('export const AMAZON_CDN_PHOTOS = process.env.GIFT_AMAZON_PHOTOS === "on" || false;');
    expect(script).toContain('(!amazonHosted || (AMAZON_CDN_PHOTOS && p.image_source === "amazon-sitestripe"))');
    expect(script).toContain('JSON.parse(readFileSync(join(LIB, "unused-by-guide.json"), "utf8"))');
    expect(script).toContain("const everyPick = [...sortedGuides.flatMap(([, l]) => l), ...swappedOut];");
    let photos = 0;
    for (const [slug, list] of Object.entries(RESEARCHED_PICKS)) for (const p of list) {
      if (!p.image) continue;
      photos += 1;
      expect(new URL(p.image).hostname, `${slug}: ${p.name}`).not.toMatch(/(^|\.)(media-amazon|images-amazon|ssl-images-amazon|amazon)\.com$/);
    }
    expect(photos).toBeGreaterThan(5000);
    // Affiliate sweep 11-18 PM: no TIFF photo (blank in every browser), and a ShopMy collection link (a mixed
    // collection, not the retailer) is on no store page.
    // @mutate scripts/gift-guide-picks.mjs | const store = collection ? null | const store = false ? null
    // @mutate scripts/gift-guide-picks.mjs |   const image = !tiff && !deadHost && |   const image = !tiff && 
    for (const [slug, list] of Object.entries(RESEARCHED_PICKS)) for (const p of list) {
      expect(p.image ?? "", `${slug}: ${p.name}`).not.toMatch(/\.tiff?(\?|#|$)/i);
      // ShopMy's S3 photos are all 403 (11-18 PM): none ships.
      expect(p.image ?? "", `${slug}: ${p.name}`).not.toMatch(/production-shopmyshelf-/);
      if (p.href.startsWith("https://shopmy.us/collections/")) expect(p.store, `${slug}: ${p.name}`).toBeUndefined();
    }
    // Affiliate sweep 11-18 PM #6, #11, #14: no raw non-ASCII ("®") in a link (encoded by the import), no line naming
    // a different size than its pick (Stanley 40 oz said "The 30 oz"), and the Anker Zolo Later link spelled as Later's
    // own My Links export has it (5HUUxI9Na8b; the hand list had a lower-case L).
    // @mutate scripts/gift-guide-picks.mjs |   if (/[^\x00-\x7f]/.test(href)) href = url.href; | 
    let sized = 0;
    let anker = 0;
    for (const [slug, list] of Object.entries(RESEARCHED_PICKS)) for (const p of list) {
      expect(p.href, `${slug}: ${p.name}`).toMatch(/^[\x21-\x7e]+$/);
      const oz = (t: string) => [...t.matchAll(/(\d+)\s?oz\b/gi)].map((m) => m[1]);
      if (oz(p.name).length && oz(p.line).length) {
        sized += 1;
        expect(oz(p.line).every((n) => oz(p.name).includes(n)), `${slug}: ${p.name} | ${p.line}`).toBe(true);
      }
      if (p.href.includes("mavely.app.link/5HUUx")) {
        anker += 1;
        expect(p.href, `${slug}: ${p.name}`).toBe("https://mavely.app.link/5HUUxI9Na8b");
      }
    }
    expect(sized).toBeGreaterThan(5);
    expect(anker).toBeGreaterThan(3);
    // XTRATUF in the Louisiana guides the lead named (11-18).
    // @mutate scripts/gift-guide-picks.mjs | for (const p of readList("_xtratuf.json")) if (names.includes(p.name)) add(slug, p, "_xtratuf.json"); | void names;
    for (const slug of ["crawfish-boil-host", "commercial-fishermen-and-shrimpers"]) expect(RESEARCHED_PICKS[slug].filter((p) => p.store === "store-xtratuf").length, slug).toBeGreaterThan(1);
  });
});

describe("gift guides: the Amazon page in sections (design audit 11-18 #3)", () => {
  it("opens on Louisiana Helpr Picks, then By person, For kids and the rest, in order, each once", () => {
    // @mutate scripts/gift-guide-picks.mjs | pageList["store-amazon"] = [...byHref.values()].map((p) => ({ ...p, section: sectionOf(p) })) | pageList["store-amazon"] = [...byHref.values()].map((p) => ({ ...p }))
    const order = ["Louisiana Helpr Picks", "By person", "For kids", "By budget", "Louisiana", "Hobbies", "By career", "Life moments", "Experiences", "Colors", "Pets", "More finds"];
    const amazon = RESEARCHED_PICKS["store-amazon"];
    expect(amazon.every((p) => p.section && order.includes(p.section))).toBe(true);
    const runs = amazon.map((p) => p.section).filter((x, i, all) => x !== all[i - 1]);
    expect(runs[0]).toBe("Louisiana Helpr Picks");
    expect(new Set(runs).size).toBe(runs.length);
    expect([...runs].sort((a, b) => order.indexOf(a!) - order.indexOf(b!))).toEqual(runs);
    expect(runs.length).toBeGreaterThan(5);
    const g = guideBySlug("store-amazon")!;
    const { container } = render(<MemoryRouter><GiftGuideView guide={g} /></MemoryRouter>);
    expandAll(container);
    const titles = [...container.querySelectorAll("[data-gift-section] > h3")].map((h) => h.textContent);
    expect(titles).toEqual(runs);
    expect(container.querySelectorAll("ol[data-gift-list] > li[data-gift-pick]").length).toBe(g.picks.length);
    // The numbers run on across sections (each later list starts its counter where the last one stopped).
    const lists = [...container.querySelectorAll<HTMLOListElement>("ol[data-gift-list]")];
    expect(lists[1].style.counterReset).toBe(`gg ${lists[0].children.length}`);
  });
});
