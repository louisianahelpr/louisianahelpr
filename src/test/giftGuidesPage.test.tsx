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
 * @mutate src/pages/info/giftGuides/GiftDisclosure.tsx | <p data-gift-disclosure="">{G.disclosure}</p> | <p data-gift-disclosure="">{null}</p>
 * @mutate src/pages/info/giftGuides/GiftDisclosure.tsx |       <p data-gift-amazon-statement="">{G.amazonStatement}</p>\n | \n
 * @mutate src/content/giftGuides.ts | amazonStatement: "As an Amazon Associate, Louisiana Helpr earns from qualifying purchases.", | amazonStatement: "As an Amazon Associate I earn from qualifying purchases.",
 * @mutate src/pages/info/GiftGuides.tsx | {smallBiz ? <GiftGuideSmallBiz /> : deals ? <GiftGuideDeals /> : guide ? <GiftGuideView guide={guide} /> : shared ? <GiftGuideSharedList code={code} /> : myList ? <GiftGuideMyList /> : <GiftGuideLanding group={group} />}{footer} | {footer}{smallBiz ? <GiftGuideSmallBiz /> : deals ? <GiftGuideDeals /> : guide ? <GiftGuideView guide={guide} /> : shared ? <GiftGuideSharedList code={code} /> : myList ? <GiftGuideMyList /> : <GiftGuideLanding group={group} />}
 * @mutate src/content/giftGuideCatalog.ts |   return { row: rowId(group), label: group, tint }; |   return { row: rowId(group), label: group, tint: "oat" as GuideTint };
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx | <Link to={`/gift-guides/${g.slug}`} | <Link to={`/gift-guides#${g.slug}`}
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <details key={row} open={row === active?.row} | <details key={row} open
 * @mutate src/content/giftGuideCatalog.ts |     ...(children?.length ? { children } : {}), | 
 * @mutate src/content/giftGuideCatalog.ts | g.row === row && !g.parent); | g.row === row && !g.parent && g.slug !== KIDS_HUB);
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx | <Link to={`/gift-guides?group=${row}`} | <Link to="/gift-guides"
 * @mutate src/content/giftGuideCatalog.ts | 8978491: "mom", | 8978491: "nowhere", 
 * @mutate src/content/giftGuideCatalog.ts | 9000047: "gardener", | 9000047: "no-guide", 
 * @mutate src/content/giftGuideCatalog.ts | "for-him": "him", | "for-him": "him-x",

 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx | className="gg-cover" loading="lazy" decoding="async" | className="gg-cover" decoding="async"
 * @mutate src/pages/info/GiftGuides.tsx |   const slug = myListPage ? undefined : rawSlug; |   const slug = undefined as string \| undefined; void rawSlug;
 * @mutate src/pages/info/GiftGuides.tsx |   if (!slug && !shared && !myListPage && fromHash) return | if (!slug && !shared && !myListPage && fromHash && false) return
 * @mutate src/pages/info/GiftGuides.tsx |   if (moved) return | if (moved && false) return
 * @mutate src/pages/info/GiftGuides.tsx | backTo={guide \|\| deals \|\| myList \|\| shared \|\| group ? "/gift-guides" : "/"} | backTo={guide \|\| deals \|\| myList \|\| shared \|\| group ? "/gift-guides/" : "/"}
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | className="gg-thumb" loading="lazy" decoding="async" | className="gg-thumb" decoding="async"
 * @mutate src/content/giftGuidesAmazon.ts | ["8Bitdo Retro Mechanical Keyboard", "https://www.amazon.com/dp/B0DKXH5WCD?tag=louisianahelpr-20"], | ["8Bitdo Retro Mechanical Keyboard", "https://www.amazon.com/dp/B0DKXH5WCD?tag=hggguidepage-20"],
 * @mutate src/content/giftGuideCatalog.ts |   return hit; |   return "amazon" as GiftStore;
 * @mutate src/content/giftGuides.ts | const shopmy = (id: number) => `https://shopmy.us/collections/${id}`; | const shopmy = (id: number) => `http://shopmy.us/collections/${id}`;
 * @mutate src/App.tsx |       <Route path="/gift-guides/:slug" element={<RouteErrorBoundary> |       <Route path="/gift-guides/:slug" element={<ProtectedRoute><RouteErrorBoundary>
 * @mutate src/pages/info/GiftGuides.tsx | "gg w-full" | "gg page-column"
 * @mutate src/content/giftGuides.ts |   for (const c of [...codes].sort((a, b) => a.rank - b.rank)) stores.set(c.store, [...(stores.get(c.store) ?? []), c]); |   for (const c of codes) stores.set(`${c.store} ${c.code}`, [c]);
 * @mutate src/content/giftGuideCatalog.ts |   const to = MERGED_GUIDES[s]?.[0] ?? s; |   const to = s;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-side{display:none} | .gg-side{display:block}
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | /iPhone\|iPad\|iPod/.test(userAgent) ? "&" : "?" | "?"
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       {!group && <TopStrip />} |       {false && <TopStrip />}
 * @mutate src/content/giftGuideCatalog.ts | GUIDES.filter((g) => !g.empty && !g.thin && g.row === row | GUIDES.filter((g) => !g.empty && g.row === row
 * @mutate src/content/giftGuideCatalog.ts | GUIDES.filter((g) => !g.empty && !g.thin && g.row === row | GUIDES.filter((g) => !g.thin && g.row === row
 * @mutate src/content/giftGuideCatalog.ts |     if (g.empty \|\| g.thin) return false; |     if (false) return false;
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
 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx |       <p className="gg-lead">{lead}</p>\n      <h1 id={titleId}>{title}</h1>\n |       <p className="gg-lead">{lead}</p>\n      <h1 id={titleId}>{title}</h1>\n      <p className="gg-line">25 picks</p>\n
 * @mutate src/content/giftGuides.ts |   { rank: 1, store: "Muck Boot", code: "TAKE25", | { rank: 8, store: "Muck Boot US", code: "TAKE25",
 */
import { readFileSync, existsSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  // The header's own row (back target, title, title actions) as PageHeader draws it, so a test can see what rides it.
  PublicHeaderPage: ({ title, titleTag = "h1", backTo, titleActions, children }: { title: string; titleTag?: "h1" | "p"; backTo?: string; titleActions?: React.ReactNode; children: React.ReactNode }) => (
    <main><div data-test-header-row="" data-back-to={backTo}>{titleTag === "p" ? <p data-test-title="">{title}</p> : <h1 data-test-title="">{title}</h1>}{titleActions}</div>{children}</main>
  ),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { GiftGuidesBand, GIFT_GUIDES_PATH } from "@/components/landing/GiftGuidesBand";
import { giftGuides, AFFILIATE_HOSTS, BRAND_SITES, LOUISIANA_SHOPS, SPONSOR_SITES, NATIONAL_SPONSOR_SITES, SHOPMY_COLLECTIONS, activeCodes, codesByStore, discountCodes } from "@/content/giftGuides";
import { DiscountCodes, SalesList, liveSales } from "@/pages/info/giftGuides/GiftGuidesSidebar";
import { GIFT_WRAP_JOB_PATH } from "@/pages/info/giftGuides/GiftGuideHelpr";
import { AMAZON_GUIDES } from "@/content/giftGuidesAmazon";
import { GUIDE_INDEX } from "@/content/giftGuideIndex";
import { DEAL_CODES, SALES, type PickChunk } from "@/content/giftGuidePicks";
import { GUIDES, ROWS, STORES, AMAZON_TAG, KIDS_HUB, MERGED_GUIDES, REMOVED_GUIDES, guidesIn, childrenOf, guideBySlug, loadAllGuidePicks, searchGuides, storeOf, unplacedGuides, STORE_ROW_MIN_PICKS, type CatalogGuide } from "@/content/giftGuideCatalog";
import { GiftGuideView, DEALS_AFTER_PICKS, PICKS_PAGE, STORE_DEALS_FIRST, storeDealRows, storeLabel } from "@/pages/info/giftGuides/GiftGuideView";
import { smsHref } from "@/pages/info/giftGuides/GiftGuideShare";
import { isLouisianaItem } from "../../scripts/giftGuideRules.mjs";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { TEEN_TILES } from "@/pages/info/giftGuides/GiftGuideLanding";
import { GUIDE_MERGES, MERGED_INTO, isFoldedStore } from "@/content/giftGuideMerges.mjs";
import { newSlugFor } from "@/content/giftGuideCatalog";
import { SECTION_ANCHORS } from "@/content/giftGuidePicks";
import { DEALS_SLUG } from "@/content/giftGuideDeals.mjs";
import { SMALL_BIZ_SLUG } from "@/content/giftGuideSmallBiz.mjs";
// The fun pages (owner 2026-11-20: swipe, planner, the Secret Santa drawer) are own pages too: in the sitemap, no guide.
const OWN_PAGES = [DEALS_SLUG, SMALL_BIZ_SLUG, "swipe", "planner", "draw-names", "printables"];
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
const ROW_LABELS = ["By person", "For kids", "By budget", "Louisiana", "Hobbies", "By career", "Life moments", "Pets", "Colors", "By store"];
// @two-way src/test/giftGuidesPage.test.tsx:stale allowed host
const LA_HOSTS = new Set([...LOUISIANA_SHOPS, ...SPONSOR_SITES]);
const ALLOWED_HOSTS = ["shopmy.us", "www.pinterest.com", "www.amazon.com", "amazon.com", "amzn.to", ...AFFILIATE_HOSTS, ...BRAND_SITES, ...LOUISIANA_SHOPS, ...SPONSOR_SITES, ...NATIONAL_SPONSOR_SITES];
const isAmazon = (href: string) => ["www.amazon.com", "amazon.com", "amzn.to"].includes(new URL(href).hostname);

const picks = GUIDES.flatMap((g) => g.picks);
const contentLinks = [
  ...giftGuides.sections.flatMap((s) => [s.shop.href, ...s.more.map((m) => m.href), ...s.picks.map((p) => p.href)]),
  ...AMAZON_GUIDES.flatMap((g) => g.items.map(([, href]) => href)),
  ...Object.values(RESEARCHED_PICKS).flat().map((p) => p.href),
  // A store page's deal sections link out too (1119e: the CJ and Awin hosts are now used only by deals after the sort's cuts).
  ...Object.values(import.meta.glob<PickChunk>("../content/giftGuidePicks/*.json", { eager: true, import: "default" })).flatMap((c) => (c.deals ?? []).flatMap((d) => [d.href, ...(d.items ?? []).map((i) => i.href)])),
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

describe("gift guides: the shipping pill rides the page header's row (owner 11-18 PM)", () => {
  // Owner: "the order by should be on the same line as gift guides but on the right, move the rest up". The pill is the
  // header's title action (same row as "← Gift guides"), never a row of its own above the hero.
  // @mutate src/pages/info/GiftGuides.tsx |       titleActions={shipPill}> |       >{shipPill}
  it("on the landing and on a guide, the pill sits in the header row beside the title, outside the page body", () => {
    let checked = 0;
    for (const url of ["/gift-guides", "/gift-guides/mom"]) {
      const { container } = renderAt(url);
      const pill = container.querySelector("[data-gift-ship]");
      expect(pill, url).not.toBeNull();
      expect(pill!.closest("[data-gift-guides]"), url).toBeNull();
      const row = pill!.closest("[data-test-header-row]");
      expect(row, url).not.toBeNull();
      // Live audit r3 #7: the header's "Gift guides" stays as drawn but is a plain line; the banner title is the h1.
      // @mutate src/pages/info/GiftGuides.tsx | title={G.pageTitle} titleTag="p" | title={G.pageTitle}
      expect(row!.querySelector("[data-test-title]")?.textContent, url).toBe(giftGuides.pageTitle);
      expect(row!.querySelector("[data-test-title]")?.tagName, url).toBe("P");
      checked += 1;
      cleanup();
    }
    expect(checked).toBeGreaterThan(1);
    // The landing has no row of its own above the hero any more.
    expect(renderAt("/gift-guides").container.querySelector("[data-gift-guides] > .gg-top")).toBeNull();
    cleanup();
    expect(renderAt("/gift-guides/store-walmart").container.querySelector("[data-gift-guides] > .gg-top")).toBeNull();
  });
});

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
    // Follow-up 1120 (owner 2026-11-20 ~12:00 AM, "Remove Kendra Scott"): the artifact's 5 Kendra Scott rows are gone (629 -> 624).
    expect(AMAZON_GUIDES.reduce((n, g) => n + g.items.length, 0)).toBe(624);
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
    // Big batch 1120: Colors is one merged guide (Gifts by Color) now, so a row holds at least one guide.
    for (const r of ROWS) expect(GUIDES.filter((g) => g.row === r.row).length, r.row).toBeGreaterThan(0);
    // The old section slugs (pins link to them) still open a guide (a merged one at its section), unless the owner's list
    // dropped it (its picks stay in ShopMy).
    for (const s of giftGuides.sections) if (!REMOVED_GUIDES.includes(s.id)) expect(slugs, s.id).toContain((newSlugFor(s.id) ?? "").split("#")[0]);
  });

  it("each store guide with picks holds every pick on its store, and only those", () => {
    // zChocolat and the diecast store are gone (lead 11-19, 1530 train); Amazon keeps its 15 best (owner: 10-15 per store page).
    const byStore: [string, keyof typeof STORES][] = [["store-amazon", "amazon"]];
    for (const [slug, store] of byStore) {
      const g = guideBySlug(slug)!;
      expect(g?.row, slug).toBe("by-store");
      expect(g.picks.length, slug).toBeGreaterThan(0);
      for (const p of g.picks) expect(p.store).toBe(store);
      const names = new Set(g.picks.map((p) => p.name));
      const hrefs = new Set(g.picks.map((p) => p.href));
      // A size or color variant of a listed product counts as listed (owner 11-18 PM: no repeats on a page).
      const variant = (n: string) => n.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\d+(\.\d+)?/g, " ").replace(/\b(fl|oz|qt|ct|count|pc|pack|pk|cup|mm|in)\b\.?/g, " ").replace(/\b(black|white|red|blue|green|pink|purple|gold|silver|grey|gray|navy|brown)\b(?! line\b)/g, " ").replace(/[^a-z]+/g, " ").trim();
      const variants = new Set(g.picks.map((p) => variant(p.name)));
      // A Louisiana item leaves national store pages (owner rule 11-18 PM: Louisiana items only in the Louisiana section).
      expect(g.picks.length, slug).toBeLessThanOrEqual(15);
      if (g.picks.length < 15) for (const p of picks.filter((x) => x.store === store && !isLouisianaItem(x, LA_HOSTS))) expect(names.has(p.name) || hrefs.has(p.href) || [...variants].some((v) => v.includes(variant(p.name)) || variant(p.name).includes(v)), p.name).toBe(true);
    }
    expect(guidesIn("by-store")[0].slug).toBe("store-amazon");
    expect(guidesIn("by-store")[1].slug).toBe("store-walmart");
    // The fixed stores, then every researched store page (store-<x>).
    expect(Object.keys(STORES).filter((k) => !k.startsWith("store-")).sort()).toEqual(["amazon", "diecast", "louisiana", "shopmy", "sponsor", "zchocolat"]);
  });

  it("syncs the owner's 2026-11-18 list: no Experiences row, Stay-at-Home Parents, Gift Wrap after Stocking Stuffers, no ShopMy store tile", () => {
    const rows = ROWS.map((r) => r.label);
    // Owner 11-18 PM ("No just get rid of the expernices"): the Experiences row and its seven guides are gone, not
    // hidden; Gift Cards and Subscriptions stay as their own guides, in By budget after Gift Wrap & Cards.
    expect(rows).not.toContain("Experiences");
    // A guide that holds nothing yet is not listed (lead 2026-11-18); the rest keep the list's order.
    const holding = (slugs: string[]) => slugs.filter((x) => guideBySlug(x) && !guideBySlug(x)!.empty && !guideBySlug(x)!.thin);
    expect(guidesIn("experiences")).toEqual([]);
    const gone = ["louisiana-restaurants", "swamp-and-bayou-tours", "spa-days", "date-night", "concerts-and-events", "classes-and-workshops", "family-fun-days"];
    for (const slug of gone) {
      expect(GUIDE_INDEX.some((g) => g.slug === slug), slug).toBe(false);
      expect(guideBySlug(slug), slug).toBeUndefined();
      expect(REMOVED_GUIDES, slug).toContain(slug);
      expect(searchGuides(slug.replace(/-/g, " ")).map((g) => g.slug), slug).not.toContain(slug);
    }
    expect(GUIDE_INDEX.some((g) => g.group === "Experiences")).toBe(false);
    // Follow-up 1120: Easy & Last-Minute (its gift cards out, owner 11-20 ~12:20 AM) is a section of Gifts by Budget.
    expect(guideBySlug("gifts-by-budget")?.row).toBe("by-budget");
    expect(newSlugFor("gift-cards")).toBe(`gifts-by-budget#${SECTION_ANCHORS["gift-cards"]}`);
    expect(newSlugFor("subscriptions")).toBe(`gifts-by-budget#${SECTION_ANCHORS.subscriptions}`);
    // Lead 11-18 PM (analytics: visits to store-hide-me-vpn, store-wondershare, store-rvshare): no VPN, software,
    // PC-cleaner, game, airline/travel-booking, car/RV-rental or ticket-resale store page, and the brands are blocked.
    // @mutate scripts/giftGuideBlocklist.mjs | "Wondershare", "Roxio", | "Roxio",
    const junkStores: Record<string, string> = { "store-hide-me-vpn": "hide.me VPN", "store-wondershare": "Wondershare", "store-rvshare": "RVshare", "store-nordvpn": "NordVPN", "store-restoro": "Restoro", "store-air-india": "Air India", "store-carla-car-rental": "Carla Car Rental", "store-undercover-tourist": "Undercover Tourist" };
    for (const [slug, name] of Object.entries(junkStores)) {
      expect(GUIDE_INDEX.some((g) => g.slug === slug), slug).toBe(false);
      expect(guideBySlug(slug), slug).toBeUndefined();
      expect(REMOVED_GUIDES, slug).toContain(slug);
      expect(blockedBrand({ store: name }), name).toBe(true);
    }
    // Follow-up 1120: Stay-at-Home Parents is a section of Family; By budget is Gifts by Budget, Splurge, then Gift Wrap.
    expect(newSlugFor("stay-at-home-parents")?.startsWith("family")).toBe(true);
    const budget = guidesIn("by-budget").map((g) => g.slug);
    expect(budget).toEqual(["gifts-by-budget", "splurge", "gift-wrap-and-cards"]);
    // The By store row is the list's store entries, in its order (Louisiana popularity).
    const listed = GUIDE_INDEX.filter((g) => g.group === "By store").map((g) => g.slug);
    // 174 after the lead's 11-18 PM cut of 40 VPN / software / travel / rental store entries.
    expect(listed.length).toBeGreaterThan(150);
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
    // A merged duplicate slug (MERGED_GUIDES, lead 11-19) redirects to its canonical page instead.
    // 1120: a store page not among the 30 kept (isFoldedStore) has no page; its old link opens the landing.
    for (const s of viaShopMy.filter((x) => !MERGED_GUIDES[x] && !REMOVED_GUIDES.includes(x) && !isFoldedStore(x))) expect(guideBySlug(s)?.row, s).toBe("by-store");
    for (const s of viaShopMy.filter((x) => isFoldedStore(x))) expect(guideBySlug(s), s).toBeUndefined();
  });

  it("Kids is ONE guide by age (Babies to Teens), each age mixing girls, boys and any; removed guides are gone", () => {
    // Follow-up 1120 (owner pop-up 11-20 ~1:10 AM, "FINAL MERGES"): Girls, Boys and Gender-Neutral, with their five ages
    // each, are one Kids guide whose sections are the ages; every old slug opens its age section (a hub's own picks lead).
    const kids = guideBySlug(KIDS_HUB)!;
    expect(kids.children ?? []).toEqual([]);
    const sections = [...new Set(kids.picks.map((p) => p.sectionId).filter(Boolean))];
    expect(sections.filter((x) => x !== "top-picks")).toEqual(["babies", "toddlers", "little-kids", "big-kids", "teens"].filter((x) => sections.includes(x)));
    expect(sections.length).toBeGreaterThan(3);
    for (const who of ["girls", "boys", "gender-neutral"]) {
      expect(guideBySlug(who), who).toBeUndefined();
      for (const age of GUIDE_INDEX.filter((x) => x.parent === who).map((x) => x.slug)) {
        expect(guideBySlug(age), age).toBeUndefined();
        expect(newSlugFor(age), age).toBe(`${KIDS_HUB}#${SECTION_ANCHORS[age]}`);
        expect(age.endsWith(SECTION_ANCHORS[age]), age).toBe(true);
      }
    }
    for (const empty of REMOVED_GUIDES) expect(guideBySlug(empty), empty).toBeUndefined();
    expect(unplacedGuides()).toEqual([]);
    expect(kids.picks.find((p) => p.sectionId === "toddlers")?.section).toBe("Toddlers (ages 1–3)");
  });

  it("the owner's guide list drives the order and the palettes; every listed guide with content is shown", () => {
    expect(ROWS.map((r) => r.label)).toEqual(ROW_LABELS);
    expect(ROWS.map((r) => r.tint)).toEqual(["green", "red", "oat", "green", "red", "oat", "green", "red", "oat", "green"]);
    const shown = GUIDES.filter((g) => GUIDE_INDEX.some((x) => x.slug === g.slug)).map((g) => g.slug);
    expect(shown).toEqual(GUIDE_INDEX.filter((x) => shown.includes(x.slug)).map((x) => x.slug));
    expect(shown).toEqual(GUIDE_INDEX.filter((x) => !REMOVED_GUIDES.includes(x.slug) && !MERGED_GUIDES[x.slug] && !MERGED_INTO[x.slug] && !isFoldedStore(x.slug)).map((x) => x.slug));
    // Follow-up 1120: ~30 guides (with sections) and 26 store pages; 41+ shown on the owner's list, measured 2026-11-20.
    expect(shown.length).toBeGreaterThan(35);
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
    const top = ROWS.flatMap((r) => [
      ...GUIDES.filter((g) => !g.empty && !g.thin && g.row === r.row && !g.parent),
      ...(r.row === "for-kids" ? TEEN_TILES.map((t) => guideBySlug(t.slug)!).filter((g) => g && !g.empty) : []),
    ]);
    const { container } = renderAt("/gift-guides");
    const rows = [...container.querySelectorAll("[data-gift-row]")];
    // The heading is the group's name, then its guide count (owner 11-18 PM; checked in the row-count test).
    expect(rows.map((r) => r.querySelector("h2")?.textContent?.replace(/\u00a0\(\d+\)$/, ""))).toEqual(ROW_LABELS);
    expect([...container.querySelectorAll("a[data-gift-see-all]")].map((a) => a.getAttribute("href"))).toEqual(ROWS.map((r) => `/gift-guides?group=${r.row}`));
    const tiles = [...container.querySelectorAll("[data-gift-rows] a[data-gift-tile]")];
    expect(tiles.length).toBeGreaterThan(30);
    // Owner redesign 11-18 PM ("the page the guide opens to on the phone view I don't like it"): the landing opens
    // straight to the rows of guide covers, By person first, on every width: no "Start here" row, nothing folded behind
    // "More guides", and nothing (no Top 10) above the first row.
    expect(container.querySelector("[data-gift-start], button[data-gift-more], .gg-rows-folded")).toBeNull();
    expect(GIFT_GUIDES_CSS).not.toMatch(/gg-rows-folded|gg-more-btn/);
    // Owner 11-20 12:30 PM landing plan: above the first row, in order, the big "Find a gift in 3 taps" finder, the
    // countdown + Gift of the Day as one slim line, and the one quick-filter chip row; no how-to box, no tip boxes.
    const mainKids = [...container.querySelector(".gg-main")!.children];
    expect(mainKids[0].matches("[data-gift-finder]")).toBe(true);
    expect(mainKids[1].matches("[data-gift-countdown]")).toBe(true);
    expect(mainKids[2].matches("[data-gift-quick-picks]")).toBe(true);
    expect(mainKids[3].matches("[data-gift-rows]")).toBe(true);
    expect(container.querySelector("[data-gift-hint]")).toBeNull();
    mainKids.splice(0, 3);
    expect(mainKids[0].querySelector("[data-gift-row]")?.getAttribute("data-gift-row")).toBe(ROWS[0].row);
    // Design audit 11-18 (High): on a phone the menu sat 2,000–3,100 px above the picks; holistic review 11-18 M9: it
    // then sat at the bottom of the phone page, a second copy of the rows. Phones have no sidebar (the rows, the chips
    // and search reach every guide).
    const phone = GIFT_GUIDES_CSS.slice(GIFT_GUIDES_CSS.lastIndexOf("@media (max-width:767px){"));
    expect(phone).toMatch(/\.gg-side\{display:none\}/);
    expect(phone).toMatch(/\.gg-main\{[^}]*order:1/);
    expect(tiles.map((a) => a.getAttribute("href"))).toEqual(top.map((g) => `/gift-guides/${g.slug}`));
    // No guide's list on the landing; "Our Top 10" is a short sideways strip of photo cards right AFTER the first row
    // (By person; holistic review 11-18 M9: it sat 5th), ten picks at most.
    // @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx | const ROWS_BEFORE_TOP = 1; | const ROWS_BEFORE_TOP = 4;
    const topRow = container.querySelector("[data-gift-top]")!;
    expect(rows[0].compareDocumentPosition(topRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(topRow.compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(topRow.querySelector("ul.gg-row")).not.toBeNull();
    expect(topRow.querySelector("ol")).toBeNull();
    for (const card of topRow.querySelectorAll("[data-gift-top-card]")) {
      expect(card.querySelector("a[data-gift-out] .gg-thumb")).not.toBeNull();
      expect(card.querySelector(".gg-topcard-name")?.textContent).toBeTruthy();
    }
    // Design audit r2 #17: "most-loved" claimed a ranking we don't have.
    expect(topRow.querySelector("h2")?.textContent).toBe("Top 10 This Week");
    const topRows = topRow.querySelectorAll("[data-gift-pick]");
    expect(topRows.length).toBeGreaterThan(0);
    expect(topRows.length).toBeLessThanOrEqual(10);
    expect(container.querySelectorAll("[data-gift-pick]").length).toBe(topRows.length);
    // Holistic review 11-18 M10: the first row's first four covers load at once; every other cover stays lazy.
    const eager = [...container.querySelectorAll("img.gg-cover[data-gift-cover-priority]")];
    expect(eager.length).toBe(4);
    for (const img of eager) {
      expect(img.closest("[data-gift-row]")?.getAttribute("data-gift-row")).toBe(ROWS[0].row);
      expect([img.getAttribute("loading"), img.getAttribute("fetchpriority")]).toEqual(["eager", "high"]);
    }
    for (const img of container.querySelectorAll("img.gg-cover:not([data-gift-cover-priority])")) {
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

  it("every header is compact: italic lead, title (the page's h1) and the slim tool row; no subtitle, no pick count anywhere", () => {
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector(".gg-band")).toBeNull();
    const words = container.querySelector("[data-gift-words]");
    expect([...(words?.children ?? [])].map((c) => c.tagName + (c.matches("[data-gift-quick]") ? "[tools]" : c.textContent))).toEqual(["Ptop-rated finds", "H1Holiday Gift Guides", "DIV[tools]"]);
    // Owner 2026-11-18: no "25 picks" count and no subtitle under any title; a tile is its cover and its name (a kids
    // age guide keeps its age band).
    const tiles = [...container.querySelectorAll("a[data-gift-tile]")];
    // Follow-up 1120: ~30 guides and 26 store pages (50+ tiles measured 2026-11-20).
    expect(tiles.length).toBeGreaterThan(40);
    for (const t of tiles) {
      const g = guideBySlug(t.getAttribute("data-gift-tile")!)!;
      // The text cover (no cover file) repeats the name as a decorative, aria-hidden picture; the tile's words are the name.
      const words = [...t.childNodes].filter((n) => !(n instanceof Element && n.getAttribute("aria-hidden") === "true")).map((n) => n.textContent).join("");
      // The For kids row's Teens tiles are named apart ("Teen girls"; live audit r3 #4).
      expect(words, g.slug).toBe(`${TEEN_TILES.find((x) => x.slug === g.slug)?.label ?? g.title}${g.age ?? ""}`);
    }
    expect(container.textContent).not.toMatch(/\d+ picks?\b|\d+ guides\b|Coming soon|On ShopMy/);
    cleanup();
    const wordsOf = (path: string) => [...(renderAt(path).container.querySelector("[data-gift-words]")?.children ?? [])].map((c) => c.textContent);
    // A guide's header is its cover's look as a short banner (owner 11-18 PM): gingham in the guide's palette, a cream
    // arch holding the lead, the title and the LOUISIANA HELPR line (real text, no image), the tool row right under it.
    // @mutate src/pages/info/GiftGuides.tsx | titleId="gift-guide-title" tint={guide.tint} | titleId="gift-guide-title"
    // The tool row carries no text: an empty My list shows no "0" badge (pre-launch audit 11-18 PM).
    // @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       {n > 0 && <span className="gg-icon-count" |       {true && <span className="gg-icon-count"
    expect(wordsOf("/gift-guides/mom")).toEqual(["gifts forMomLouisiana Helpr", ""]);
    cleanup();
    let banners = 0;
    for (const slug of ["mom", "kids", "store-walmart", "gifts-by-budget"]) {
      const g = guideBySlug(slug)!;
      const c = renderAt(`/gift-guides/${slug}`).container;
      const head = c.querySelector("[data-gift-words]")!;
      expect(head.getAttribute("data-gift-banner"), slug).toBe(g.tint);
      expect(head.querySelector(".gg-banner")?.className, slug).toBe(`gg-banner gg-check gg-${g.tint}`);
      const arch = head.querySelector("[data-gift-arch]")!;
      expect([...arch.children].map((x) => x.textContent), slug).toEqual([g.age ? `${g.lead}, ${g.age}` : g.lead, g.title, "Louisiana Helpr"]);
      // Live audit r3 #7: the guide's name is the page's ONE h1; the header's "Gift guides" is a plain line.
      expect(arch.querySelector("h1")?.id, slug).toBe("gift-guide-title");
      expect(c.querySelectorAll("h1").length, slug).toBe(1);
      expect(head.querySelector("img"), slug).toBeNull();
      banners += 1;
      cleanup();
    }
    expect(banners).toBeGreaterThan(3);
    // The landing keeps its plain header.
    expect(renderAt("/gift-guides").container.querySelector("[data-gift-banner]")).toBeNull();
    cleanup();
    // "Text this guide" (owner 2026-11-18; in Share's menu since the 11-18 PM redesign): an sms: link carrying the
    // guide's URL; iOS's form, else Android's.
    expect(smsHref("https://x.test/g", "Mom", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe("sms:&body=Mom%20https%3A%2F%2Fx.test%2Fg");
    expect(smsHref("https://x.test/g", "Mom", "Mozilla/5.0 (Linux; Android 15)")).toBe("sms:?body=Mom%20https%3A%2F%2Fx.test%2Fg");
    cleanup();
    cleanup();
    const mom = renderAt("/gift-guides/mom").container;
    expect(mom.querySelector(".gg-band")).toBeNull();
    expect(mom.querySelector("[data-gift-words] h1")?.textContent).toBe("Mom");
  });

  it("a guide that holds nothing is in no row, search or menu; its own link opens Picks coming soon and related guides", () => {
    // Lead 2026-11-18 (live: 384 of 469 guides opened "Picks coming soon"). Proven red: drop the `!g.empty` filter in
    // guidesIn or searchGuides and the empty guide is listed again.
    const empty = GUIDES.filter((g) => g.empty);
    const holding = GUIDES.filter((g) => !g.empty);
    // Follow-up 1120: ~30 guides and 26 store pages (50+ holding picks, measured 2026-11-20).
    expect(holding.length).toBeGreaterThan(40);
    // A hidden guide holds fewer than GUIDE_MIN_PICKS picks (lead 11-19, one guide per product).
    for (const g of empty) expect(g.picks.length, g.slug).toBeLessThan(6);
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
    // (A budget guide that holds 6+ picks after one guide per product, owner 11-19.)
    // Follow-up 1120: Under $25, Under $50 and Stocking Stuffers are sections of Gifts by Budget.
    const budget = ["gifts-by-budget", "splurge"].find((s) => guideBySlug(s) && !guideBySlug(s)!.empty)!;
    const view = renderAt(`/gift-guides/${budget}`).container;
    const open = ([...view.querySelectorAll("details[data-gift-group]")] as HTMLDetailsElement[]).filter((d) => d.open);
    expect(open.map((d) => d.getAttribute("data-gift-group"))).toEqual(["by-budget"]);
    expect([...view.querySelectorAll('[data-gift-sidebar] a[aria-current="page"]')].map((a) => a.getAttribute("href"))).toEqual([`/gift-guides/${budget}`]);
  });

  // Follow-up 1120 (owner 11-20 ~1:10 AM): ONE Kids guide by age; the row shows Kids and Kids by age links each age
  // section, teens included.
  // @mutate src/pages/info/giftGuides/GiftGuideAges.tsx |   const bands = KID_AGE_BANDS.flatMap((b) => { |   const bands = KID_AGE_BANDS.filter((b) => b.tail !== "teens").flatMap((b) => {
  it("kids in two taps: the row shows Kids; Kids by age opens each age section, teens too; the menu Kids", () => {
    const { container } = renderAt("/gift-guides");
    const kidsRow = container.querySelector('[data-gift-row="for-kids"]')!;
    expect(TEEN_TILES).toEqual([]);
    expect([...kidsRow.querySelectorAll("a[data-gift-tile]")].map((a) => a.getAttribute("data-gift-tile"))).toEqual(["kids"]);
    expect(kidsRow.querySelector("[data-gift-row-count]")?.textContent).toBe("\u00a0(1)");
    const ageLinks = [...kidsRow.querySelectorAll("a[data-gift-age-link]")].map((a) => a.getAttribute("href"));
    expect(ageLinks.length).toBeGreaterThan(3);
    for (const h of ageLinks) expect(h).toMatch(/^\/gift-guides\/kids#(babies|toddlers|little-kids|big-kids|teens)$/);
    expect(ageLinks.some((h) => h!.endsWith("#teens"))).toBe(true);
    const menu = container.querySelector('details[data-gift-group="for-kids"]')!;
    expect([...menu.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/gift-guides/kids"]);
    cleanup();
    const side = renderAt("/gift-guides/kids").container;
    const open = ([...side.querySelectorAll("details[data-gift-group]")] as HTMLDetailsElement[]).filter((d) => d.open);
    expect(open.map((d) => d.getAttribute("data-gift-group"))).toEqual(["for-kids"]);
    expect(open[0].querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/gift-guides/kids");
  });

  it("career guides hold their roles as sections (1120); Teachers is a section of Work Life (follow-up 1120)", () => {
    for (const hub of ["healthcare", "heroes", "work-life"]) {
      const g = guideBySlug(hub)!;
      expect(g?.row, hub).toBe("by-career");
      const roles = GUIDE_MERGES.find((m) => m.parent === hub)!.sections;
      expect(roles.length, hub).toBeGreaterThan(4);
      // No role tiles any more: the roles are the guide's sections, in the merge table's order.
      expect(childrenOf(g), hub).toEqual([]);
      // 1120 section groups (owner: "by role, not job title"): every section is one its roles point to.
      const ids = [...new Set(g.picks.map((p) => p.sectionId).filter((x) => x && x !== "top-picks"))];
      for (const id of ids) expect(roles.map((r) => SECTION_ANCHORS[r]), `${hub}#${id}`).toContain(id);
      expect(ids.length, hub).toBeGreaterThan(2);
    }
    expect(newSlugFor("teachers")).toBe(`work-life#${SECTION_ANCHORS.teachers}`);
    const row = renderAt("/gift-guides").container.querySelector('[data-gift-row="by-career"]')!;
    const tiles = [...row.querySelectorAll("a[data-gift-tile]")].map((a) => a.getAttribute("data-gift-tile"));
    expect(tiles).toContain("healthcare");
    expect(tiles).not.toContain("female-nurses");
    expect(tiles).not.toContain("rns");
  });

  it("Discount codes sit in the collapsed Deals & codes section, hide when expired or empty, and each has a copy button", () => {
    expect(discountCodes.length).toBeGreaterThan(5);
    expect(discountCodes.map((c) => c.store)).not.toContain("Instant Funding");
    // A code past its last day hides itself; the section disappears when none is left.
    // ... and one before its first day stays hidden too (affiliate sweep 11-18: Muck Boot CYBER showed on Nov 18).
    // @mutate src/content/giftGuides.ts | && (!c.starts \|\| c.starts <= today) | && true
    expect(activeCodes(discountCodes, "2026-11-19").map((c) => c.code)).not.toContain("TAKE25");
    expect(activeCodes(discountCodes, "2026-11-20").map((c) => c.code)).toContain("TAKE25");
    expect(activeCodes(discountCodes, "2026-11-28").map((c) => c.code)).not.toContain("CYBER");
    expect(activeCodes(discountCodes, "2026-11-29").map((c) => c.code)).toContain("CYBER");
    // Tushbaby LAHELPR25 (confirmed 11-18 PM): Dec 1 through Dec 25 only.
    // @mutate src/content/giftGuides.ts | code: "LAHELPR25", offer: "25% off sitewide", dates: "Dec 1 – 25", starts: "2026-12-01", | code: "LAHELPR25", offer: "25% off sitewide", dates: "Dec 1 – 25", starts: "2026-11-01",
    const tush = (d: string) => activeCodes(discountCodes, d).filter((c) => c.store === "Tushbaby").map((c) => c.code);
    expect([tush("2026-11-30"), tush("2026-12-01"), tush("2026-12-25"), tush("2026-12-26")]).toEqual([[], ["LAHELPR25"], ["LAHELPR25"], []]);
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
    // Owner redesign 11-18 PM ("Codes should be a section with the other discount stuff right?"): one "Deals & codes"
    // section on the page (after the landing's guide rows), never in the menu and never a button.
    const page = renderAt("/gift-guides").container;
    expect(page.querySelector("[data-gift-sidebar] [data-gift-codes]")).toBeNull();
    const side = page.querySelector("details[data-gift-deals-codes]") as HTMLDetailsElement;
    expect(side).not.toBeNull();
    expect(side.querySelector(":scope > summary .gg-deals-title")?.textContent).toBe("Deals & codes");
    expect(side.querySelector("[data-gift-deals-count]")?.textContent).toMatch(/^\d+ deals? · \d+ codes?$|^\d+ (deals?|codes?)$/);
    // Opened, at most DEALS_ROWS rows show, codes first (design spec 2026-11-18 H5); each list keeps its See all.
    // @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | const DEALS_ROWS = 8; | const DEALS_ROWS = 80;
    expect(side.querySelectorAll("[data-gift-code-store], [data-gift-sale]").length).toBe(8);
    const codes = side.querySelector(":scope > [data-gift-codes]")!;
    expect(codes).not.toBeNull();
    // Owner 11-18 PM ("discount code shouldn't open expanded"): it starts collapsed; opening shows every code.
    // @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <details id="gift-codes" className="gg-deals" data-gift-deals-codes=""> | <details open id="gift-codes" className="gg-deals" data-gift-deals-codes="">
    expect(side.open).toBe(false);
    const rowsOnPage = page.querySelectorAll("[data-gift-row]");
    expect(rowsOnPage.length).toBe(ROW_LABELS.length);
    expect(rowsOnPage[rowsOnPage.length - 1].compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One box per store, several codes inside: Muck Boot holds CYBER and TAKE25 (Nov 20–28), in the owner's order.
    const moreCodes = side.querySelector("button[data-gift-all-codes]");
    if (moreCodes) fireEvent.click(moreCodes);
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
    expect(codesByStore(discountCodes).map((x) => x.store).slice(0, 5)).toEqual(["Muck Boot", "XTRATUF", "Durango Boots", "Magnifique", "Bruno Marc"]);
    // XTRATUF XT25 (train 1120c) runs Nov 20 through Nov 29.
    expect(activeCodes(discountCodes, "2026-11-29").map((c) => c.code)).toContain("XT25");
    expect(activeCodes(discountCodes, "2026-11-30").map((c) => c.code)).not.toContain("XT25");
    const both = render(<MemoryRouter><DiscountCodes codes={discountCodes} /></MemoryRouter>).container;
    expect(both.querySelectorAll('[data-gift-code-store="Muck Boot"]').length).toBe(1);
    expect([...both.querySelectorAll('[data-gift-code-store="Muck Boot"] [data-gift-code]')].map((x) => x.getAttribute("data-gift-code"))).toEqual(["CYBER", "TAKE25"]);
    cleanup();
    const { container } = render(<MemoryRouter><DiscountCodes codes={[{ rank: 1, store: "Example Shop", code: "TEST10", offer: "10% off" }]} /></MemoryRouter>);
    expect(container.querySelector('[data-gift-code-store="Example Shop"]')?.textContent).toContain("TEST10");
    fireEvent.click(screen.getByRole("button", { name: "Copy TEST10" }));
    expect(write).toHaveBeenCalledWith("TEST10");
  });

  it("a store page with fewer than 6 picks is no By store tile, menu entry or search result, but its link still opens it", () => {
    // Proven red: drop `!g.thin` in guidesIn and the thin store pages are tiles again.
    // Lead 2026-11-19 (1530 train): under six picks a store page is not linked anywhere (row, menu, search, sitemap) until filled.
    expect(STORE_ROW_MIN_PICKS).toBe(6);
    const thin = GUIDES.filter((g) => g.thin);
    for (const g of thin) {
      expect(g.row, g.slug).toBe("by-store");
      expect(g.picks.length, g.slug).toBeLessThan(6);
    }
    for (const g of guidesIn("by-store")) expect(g.picks.length + (g.deals?.length ?? 0) > 0 && (g.picks.length >= 6 || !g.thin), g.slug).toBe(true);
    for (const g of guidesIn("by-store")) expect(g.thin, g.slug).toBeUndefined();
    if (thin[0]) {
      expect(searchGuides(thin[0].title).map((x) => x.slug)).not.toContain(thin[0].slug);
      const { container } = renderAt(`/gift-guides/${thin[0].slug}`);
      expect(container.querySelector("[data-gift-words] h1")?.textContent).toBe(thin[0].title);
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

  it("Sales sit under Discount codes in the collapsed Deals & codes section, soonest end first; a sale past its end day hides", () => {
    expect(SALES.length).toBeGreaterThan(20);
    for (let i = 1; i < SALES.length; i++) expect(SALES[i - 1].ends <= SALES[i].ends, SALES[i].offer).toBe(true);
    const last = SALES[SALES.length - 1].ends;
    expect(liveSales(SALES, last).length).toBeGreaterThan(0);
    const next = new Date(`${last}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    expect(liveSales(SALES, next.toISOString().slice(0, 10))).toEqual([]);
    expect(render(<MemoryRouter><SalesList sales={[]} /></MemoryRouter>).container.querySelector("[data-gift-sales]")).toBeNull();
    cleanup();
    const side = renderAt("/gift-guides").container.querySelector("details[data-gift-deals-codes]") as HTMLDetailsElement;
    const sales = side.querySelector(":scope > [data-gift-sales]");
    expect(sales).not.toBeNull();
    expect(side.open).toBe(false);
    const codes = side.querySelector(":scope > [data-gift-codes]")!;
    expect(codes.compareDocumentPosition(sales!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const a of sales!.querySelectorAll("a[data-gift-out]")) expect(ALLOWED_HOSTS, a.getAttribute("href")!).toContain(new URL(a.getAttribute("href")!).hostname);
    expect(sales!.textContent).not.toMatch(/\$\s?\d/);
  });

  it("Female and Male Nurses fold into RNs, which is a section of Healthcare Workers (1120): their old links open it", () => {
    for (const gone of Object.keys(MERGED_GUIDES)) expect(guideBySlug(gone), gone).toBeUndefined();
    const g = guideBySlug("healthcare")!;
    const rns = g.picks.filter((p) => p.sectionId === SECTION_ANCHORS.rns);
    expect(rns.length).toBeGreaterThan(3);
    // Once each on the whole page: by link, and by name for a ShopMy collection link that several products share.
    expect(new Set(g.picks.map((p) => `${p.href} ${p.name}`)).size).toBe(g.picks.length);
    renderAt("/gift-guides/female-nurses");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/healthcare");
    cleanup();
    renderAt("/gift-guides#male-nurses");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/healthcare");
    cleanup();
    renderAt("/gift-guides/rns");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/healthcare");
  });

  it("an old /gift-guides#<slug> pin opens that guide's page; an unknown slug falls back to the landing", () => {
    renderAt("/gift-guides#for-him");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/him");
    expect(screen.getByRole("heading", { level: 1, name: "Him" })).toBeTruthy();
    cleanup();
    renderAt("/gift-guides/for-mom");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/mom");
    cleanup();
    // 1120: Louisiana-Made is a section of Shop Small Louisiana.
    renderAt("/gift-guides#louisiana-made");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/shop-small-louisiana");
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
    // Follow-up 1120: ~30 guides and 26 store pages (measured 2026-11-20: 49+ list guides).
    expect(checked).toBeGreaterThan(40);
    for (const slug of ["mom", "store-amazon", "store-walmart", "gifts-by-budget", "25-days-sponsors"]) {
      const g = guideBySlug(slug)!;
      const { container } = renderAt(`/gift-guides/${slug}`);
      expect(container.querySelector("[data-gift-words] h1")?.textContent, slug).toBe(g.title);
      // Design audit 2026-11-18 #3: a long list draws 50 rows, then "Show more" adds 50 at a time (store-amazon drew 827).
      // ... and with six or fewer left it draws them all (design audit r2 #16: "Show more (1 more)").
      // @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const upTo = picks.length - shown <= SHOW_ALL_UNDER ? picks.length : shown; |   const upTo = picks.length;
      expect(container.querySelectorAll("ol[data-gift-list] > li[data-gift-pick]").length, slug).toBe(g.picks.length - PICKS_PAGE <= 6 ? g.picks.length : PICKS_PAGE);
      expandAll(container);
      expect(container.querySelectorAll("ol[data-gift-list] > li[data-gift-pick]").length, slug).toBe(g.picks.length);
      // Owner 11-18 PM ("double back button?? does the same thing"): one way back, the header's arrow, to All guides.
      expect(container.querySelector("a[data-gift-back]"), slug).toBeNull();
      expect(container.querySelector("[data-test-header-row]")?.getAttribute("data-back-to"), slug).toBe("/gift-guides");
      cleanup();
    }
  }, 90_000);

  it("every guide's palette is one of the three cover palettes; covers are the owner's files, two-way", () => {
    for (const g of GUIDES) expect(["green", "oat", "red"], g.slug).toContain(g.tint);
    expect(guideBySlug("mom")!.tint).toBe("green");
    expect(guideBySlug("kids")!.tint).toBe("red");
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
          // 1120: a merged guide's section link carries its anchor ("/gift-guides/girls#girls-babies").
          expect(href, url).toMatch(/^\/gift-guides(?:\/[a-z0-9-]+(?:#[a-z0-9-]+)?|\?group=[a-z-]+(?:#[a-z-]+)?|\?list=mine|#[a-z0-9-]+)?$/);
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
    for (const path of ["/gift-guides", "/gift-guides/:slug", "/gift-guides/list/:code"]) {
      expect(app).toContain(`<Route path="${path}" element={<RouteErrorBoundary>{routeEl(<PageTransition><GiftGuides /></PageTransition>)}</RouteErrorBoundary>} />`);
    }
    expect(app).not.toMatch(/GiftGuidesPreviewGate|params\.get\("preview"\)/);
    // + the shared wish list (owner 2026-11-20).
    expect(app.split("\n").filter((l) => l.includes("<GiftGuides />")).length).toBe(3);
  });

  it("is indexed (follow-up 2026-11-18, SEO): the landing and every guide holding picks are in the sitemap, two-way; each guide sets its own head", () => {
    const sitemap = readFileSync("public/sitemap.xml", "utf8");
    const listed = [...sitemap.matchAll(/<loc>https:\/\/www\.louisianahelpr\.com(\/gift-guides[^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(listed).toContain("/gift-guides");
    // The two own pages (the deals guide, Small Business Saturday) are in the sitemap too, but are no catalog guide.
    const guides = listed.filter((x) => x !== "/gift-guides").map((x) => x.replace("/gift-guides/", "")).filter((s) => !OWN_PAGES.includes(s));
    expect(listed).toEqual(expect.arrayContaining(OWN_PAGES.map((s) => `/gift-guides/${s}`)));
    expect(guides.length).toBeGreaterThan(40); // follow-up 1120: ~30 merged guides + 26 store pages (measured 2026-11-20)
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
    // The deals guide (owner 2026-11-19) has its own head (src/test/giftGuideDeals1119.test.tsx).
    // ... and so does the Small Business Saturday page (1120).
    // My Wish List and a shared list (owner 2026-11-20) are noindex (src/test/giftWishList1120.test.tsx).
    expect(src("src/pages/info/GiftGuides.tsx")).toContain(': deals ? giftGuidePageMeta(smallBiz ? SMALL_BIZ_SLUG : DEALS_SLUG) : guide ? guideHead(guide) : PUBLIC_PAGE_META["/gift-guides"],');
    expect(src("src/pages/info/GiftGuides.tsx")).toContain("return giftGuidePageMeta(guide.slug, guide.title, picks.slice(0, 3).map((p) => p.name), picks.length);");
    const mom = giftGuidePageMeta("mom");
    expect(mom.title).toBe("Gifts for Mom — Helpr");
    expect(mom.canonical).toBe("https://www.louisianahelpr.com/gift-guides/mom");
    expect(mom.robots).toBeUndefined();
    expect(giftGuidePageMeta("store-walmart").title).toBe("Walmart gift guide — Helpr");
    // A guide not in the sitemap (empty, a hub, a thin store page) is noindex under its own title.
    // (Follow-up 1120: every shown guide is in the sitemap now; a probe stands in when none is left out.)
    const unlisted = GUIDES.find((g) => !GIFT_GUIDE_SEO[g.slug]) ?? { slug: "probe-unlisted", title: "Probe" };
    expect(unlisted).toBeTruthy();
    expect(giftGuidePageMeta(unlisted.slug, unlisted.title)).toMatchObject({ title: `${unlisted.title} gift guide — Helpr`, robots: expect.stringMatching(/noindex/) });
    expect(Object.keys(GIFT_GUIDE_SEO).sort()).toEqual(guides.sort());
    for (const name of Object.values(GIFT_GUIDE_SEO)) expect(name).not.toMatch(/undefined/);
    // A "gifts for the" / "gifts for a" guide reads as one phrase (batch 11-19: og:title was "Gifts for the: Coffee
    // Lover: holiday gift guide 2026"). No name puts a colon after a dangling article.
    // @mutate scripts/gift-guide-picks.mjs | : /^gifts for (the\|a)$/i.test(e.lead) ? `${cap(e.lead)} ${e.title}` | : /^gifts for (the\|a)$/i.test(e.lead) ? `${cap(e.lead)}: ${e.title}`
    const forThe = ["coffee-lover", "traveler", "home-cook", "dog-lover", "gamer"].find((s) => GIFT_GUIDE_SEO[s])!;
    const title = GUIDE_INDEX.find((g) => g.slug === forThe)!.title;
    expect(GIFT_GUIDE_SEO[forThe]).toBe(`Gifts for the ${title}`);
    expect(giftGuidePageMeta(forThe).ogTitle).toBe(`Gifts for the ${title}: holiday gift guide 2026`);
    const forA = ["hospital-stay", "new-job"].find((s) => GIFT_GUIDE_SEO[s]);
    if (forA) expect(GIFT_GUIDE_SEO[forA]).toBe(`Gifts for a ${GUIDE_INDEX.find((g) => g.slug === forA)!.title}`);
    const theGuides = Object.values(GIFT_GUIDE_SEO).filter((n) => /^Gifts for (the|a) /.test(n));
    expect(theGuides.length).toBeGreaterThan(2); // follow-up 1120: ~30 guides + 26 store pages, measured 2026-11-20: Gifts for the Family, the Coffee Lover, the Car Lover
    for (const name of Object.values(GIFT_GUIDE_SEO)) expect(name).not.toMatch(/\b(the|a|an):/i);
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
      // A shared wish list (owner 2026-11-20): its own noindex link card (api/share metaForWishList), before the not-found catch-all.
      { source: "/gift-guides/list/:code", destination: "/api/share?_og=wishlist&_id=:code" },
      // ... and the app's own rewrite for it (unknownUrlsAnswer404: every App.tsx route has one).
      { source: "/gift-guides/list/:code", destination: "/index.html" },
      // The fun pages (owner 2026-11-20): api/share.ts serves them first (their own info body); these are the SPA
      // entries the not-found guard needs; a Secret Santa reveal link goes straight to the SPA (noindex header).
      { source: "/gift-guides/draw-names", destination: "/index.html" },
      { source: "/gift-guides/swipe", destination: "/index.html" },
      { source: "/gift-guides/planner", destination: "/index.html" },
      { source: "/gift-guides/printables", destination: "/index.html" },
      { source: "/gift-guides/secret-santa/:code/:token", destination: "/index.html" },
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
    expect([...BLOCKED_BRANDS]).toEqual(["SheVibe", "King Palm", "AnyListingSEO", "Loren", "Restoro", "Yeloly", "Serika", "Parallels", "HerbsPro", "ZazzMode", "NordVPN", "Surfshark", "Keeper Security", "NordPass", "hide.me", "Intego", "Corel", "Clip Studio Paint", "Daz 3D", "Wondershare", "Roxio", "Pinnacle Studio", "Lalal.ai", "Ashampoo", "AOMEI", "PandaOffice", "Jalbum", "O&O Software", "Abelssoft", "Paragon Software", "GearUP", "YUPLAY", "Whokeys", "DirectDeals", "Hero Wars", "Skytours", "Oojo", "Cheapvuelos", "Ovago", "HopeGoo", "Air India", "Ocean Hotels", "Rent Cars", "VIP Cars", "Carla Car Rental", "RVshare", "Undercover Tourist", "PARISCityVISION", "Ying Mart", "YingMart", "Brooklyn Delhi", "eCreamery", "AimHave", "Minteefy", "Mosaic Weighted Blankets", "Dragontree", "Dragontree Apothecary", "Deme by Gabriella", "Deme", "CHORD", "Life is Good", "The Jacket Maker", "Diamond Art Club", "Lubiwood", "nixplay", "onn.", "Mainstays", "Hyper Tough", "Holiday Time", "Better Homes & Gardens", "Better Homes and Gardens", "Great Value", "Time and Tru", "DiecastModelsWholesale", "Diecast Models Wholesale", "Kaiya Baby", "Magic Story", "TechPals", "ZonliHome", "Zonli", "Kitty Kick Stix", "Makerfire", "Bonne et Filou", "The Fort Kit", "Cocinare", "Maker Wine", "Magic Makers", "The Fidget Company", "Gisada", "Imarku", "TOUCHBeauty", "Baleaf", "SILK THE RICH", "True Beauty Lashes", "Cashmere Boutique", "MelodySusie", "Lofree", "AndaSeat", "Xplora", "Byrokko", "Frost Buddy", "Forte Chocolate", "TempSpike", "TempPro", "Hairmax", "AmScope", "Adagio Teas", "Free Country", "BADESOFA", "Literie", "Ozark Trail",
      "Kendra Scott", "Labubu", "Smiski", "Sonny Angel", "Lovesac", "Fishwife"]);
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
    expect(script).toContain('for (const f of ["_awin.json", "_cj.json", "_impact.json", "_shopify-collabs.json", "_later.json", "_later-mylinks.json", "_later-brands.json", "_walmart-under5-1118.json"]) {');
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

describe("gift guides: each row heading carries its guide count (owner 11-18 PM)", () => {
  // Owner: "add the number in parentheses on the right of By Person". Computed: the tiles the row shows, the same
  // number its See all page shows.
  // @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx | &nbsp;({list.length}) | &nbsp;(24)
  it("every row's (n) equals its tiles, on the landing and on its See all page", () => {
    const { container } = renderAt("/gift-guides");
    const rows = [...container.querySelectorAll("section[data-gift-row]")];
    expect(rows.length).toBeGreaterThan(5);
    const counts = new Map<string, number>();
    for (const r of rows) {
      const n = r.querySelectorAll(":scope > ul > li a[data-gift-tile], :scope > ul a[data-gift-tile]").length;
      const shown = r.querySelector("h2 [data-gift-row-count]")?.textContent?.replace(/\u00a0/g, " ").trim();
      expect(shown, r.getAttribute("data-gift-row")!).toBe(`(${n})`);
      counts.set(r.getAttribute("data-gift-row")!, n);
    }
    expect(new Set(counts.values()).size).toBeGreaterThan(2);
    cleanup();
    for (const row of ["by-person", "by-store"]) {
      const c = renderAt(`/gift-guides?group=${row}`).container;
      expect(c.querySelector(`section[data-gift-row="${row}"] h2 [data-gift-row-count]`)?.textContent?.trim(), row).toBe(`(${counts.get(row)})`);
      cleanup();
    }
  });
});

describe("gift guides: design audit round 2 UI fixes", () => {
  // @mutate src/content/giftGuideCatalog.ts |   }).map((g, i) => [g, i] as const).sort(([a, i], [b, j]) => rank(a) - rank(b) \|\| i - j).map(([g]) => g); |   });
  // @mutate src/content/giftGuideCatalog.ts |   "store-tractor-supply": "boots", hunters: "boots", farmers: "boots", |   "store-tractor-supply": "",
  it("#11 search: Louisiana words find their guides; a title match ranks first", () => {
    // Follow-up 1120: Game Day is a section of Louisiana Celebrations, Hunters of Outdoors & Travel.
    expect(searchGuides("lsu").map((g) => g.slug)).toEqual(expect.arrayContaining(["louisiana-celebrations"]));
    expect(searchGuides("saints").map((g) => g.slug)).toContain("louisiana-celebrations");
    expect(searchGuides("boots").map((g) => g.slug)).toEqual(expect.arrayContaining(["store-tractor-supply", "outdoors-and-travel"]));
    const mom = searchGuides("mom").map((g) => g.slug);
    expect(mom[0]).toBe("mom");
    const firstOther = mom.findIndex((x) => !guideBySlug(x)!.title.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith("mom")));
    expect(firstOther === -1 ? mom.length : firstOther).toBeGreaterThan(0);
    // Follow-up 1120: Mom-to-Be and New Mom are sections of Life Moments; their titles still find it.
    expect(mom).toContain("life-moments");
  });

  // @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   : pick.store === "shopmy" ? pick.brand ?? "" |   : pick.store === "shopmy" ? "ShopMy"
  it("#9 no pick says \"On ShopMy\"", () => {
    let checked = 0;
    for (const slug of ["mom", "cousins", "camper"]) {
      const { container } = renderAt(`/gift-guides/${slug}`);
      expandAll(container);
      for (const li of container.querySelectorAll("li[data-gift-pick]")) expect(li.textContent, slug).not.toMatch(/On ShopMy/);
      checked += container.querySelectorAll("li[data-gift-pick]").length;
      cleanup();
    }
    expect(checked).toBeGreaterThan(20);
  });

  // Live audit r3 #1 (High): Walmart's deals were ~3,500 px of photo-less rows and bare bold links before most picks.
  // @mutate src/pages/info/giftGuides/GiftGuideView.tsx |     if (seen.has(href) \|\| seen.has(norm(title))) return; |     if (false) return;
  // @mutate src/pages/info/giftGuides/GiftGuideView.tsx | (all ? rows : rows.slice(0, STORE_DEALS_FIRST)) | rows
  it("#12 / r3 #1 a store's deals come after ALL its picks: one compact Sales-style list, 6 rows, then See all deals (n), no duplicate links", () => {
    const g = guideBySlug("store-walmart")!;
    // Follow-up 1120 (owner: 10-15 per store page): 11 Walmart picks after the audits' store-page cuts, measured 2026-11-20.
    expect(g.picks.length).toBeGreaterThan(9);
    const { container } = renderAt("/gift-guides/store-walmart");
    expandAll(container);
    const deals = container.querySelector("[data-gift-deals]")!;
    expect(deals).not.toBeNull();
    const picksAll = [...container.querySelectorAll("li[data-gift-pick]")];
    expect(picksAll.length).toBe(g.picks.length);
    for (const li of picksAll) expect(li.compareDocumentPosition(deals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No photo-less pick rows inside the deals: each deal is one line, the offer link and its end date.
    expect(deals.querySelectorAll("li[data-gift-pick], .gg-thumb").length).toBe(0);
    const rows = [...deals.querySelectorAll("li[data-gift-deal]")];
    expect(rows.length).toBe(STORE_DEALS_FIRST);
    for (const li of rows) expect(li.querySelector("a.gg-link[data-gift-out]"), li.textContent!).not.toBeNull();
    const all = storeDealRows(g);
    expect(all.length).toBeGreaterThan(STORE_DEALS_FIRST);
    const more = deals.querySelector("button[data-gift-all-deals]")!;
    expect(more.textContent).toBe(`See all deals (${all.length})`);
    fireEvent.click(more);
    expect(deals.querySelectorAll("li[data-gift-deal]").length).toBe(all.length);
    // No link twice on the page (live audit r3 #1/#6: Xbox, AirPods, the mixer repeated in the deals).
    const hrefs = [...container.querySelectorAll("[data-gift-guide] a[data-gift-out]")].map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(g.picks.length);
    const pickHrefs = new Set(g.picks.map((p) => `https://${p.href.replace(/^https:\/\//, "")}`));
    for (const a of deals.querySelectorAll("a[data-gift-out]")) expect(pickHrefs.has(a.getAttribute("href")!), a.getAttribute("href")!).toBe(false);
    expect(new Set(all.map((r) => r.href)).size).toBe(all.length);
    cleanup();
    const amazon = renderAt("/gift-guides/store-amazon").container;
    const titles = [...amazon.querySelectorAll("[data-gift-section] > h3")].map((h) => h.textContent);
    expect(new Set(titles).size).toBe(titles.length);
  });

  // @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |   return sales.filter((x) => x.ends >= today && !seen.has(x.href) && Boolean(seen.add(x.href))); |   return sales.filter((x) => x.ends >= today);
  it("#10 Sales: one line per link, the first 12, then See all sales", () => {
    const dup = { slug: "store-walmart", store: "Walmart", offer: "x", href: "https://walmrt.us/x", ends: "2099-01-01" };
    expect(liveSales([dup, { ...dup }], "2026-11-18")).toHaveLength(1);
    const many = Array.from({ length: 20 }, (_, i) => ({ ...dup, href: `https://walmrt.us/${i}` }));
    const c = render(<MemoryRouter><SalesList sales={many} /></MemoryRouter>).container;
    expect(c.querySelectorAll("[data-gift-sale]").length).toBe(12);
    fireEvent.click(c.querySelector("[data-gift-all-sales]")!);
    expect(c.querySelectorAll("[data-gift-sale]").length).toBe(20);
  });

  // Owner redesign 11-18 PM ("share text search list codes is too much buttons right here"): ONE slim row under every
  // title, at every width: the search field, My list (an icon with its count) and Share (an icon). No pill buttons.
  // @mutate src/pages/info/giftGuides/GiftGuideCover.tsx |       <h1 id={titleId}>{title}</h1>\n      {tools} |       <h1 id={titleId}>{title}</h1>
  // @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       <MyListIcon current={myList} />\n |       <a href="#codes">Codes</a>\n      <MyListIcon current={myList} />\n
  it("#15 / redesign: the tool row under the title is search, My list and Share, nothing else", () => {
    for (const url of ["/gift-guides", "/gift-guides/mom", "/gift-guides/store-walmart"]) {
      const { container } = renderAt(url);
      const head = container.querySelector("[data-gift-words]")!;
      const quick = head.querySelector("[data-gift-quick]")!;
      expect(quick, url).not.toBeNull();
      expect(quick.getAttribute("aria-label"), url).toBe("Gift guide tools");
      expect(quick.querySelector("input[type=search][aria-label='Search gift guides']"), url).not.toBeNull();
      const controls = [...quick.querySelectorAll("a, button")].filter((el) => !el.closest("[data-gift-search-results]"));
      expect(controls.map((el) => el.getAttribute("aria-label")), url).toEqual(["My Wish List, 0 saved", "Share"]);
      // Icons only: 44px tap targets (RoundIconButton w-11 h-11; .gg-icon 44px), and no visible words.
      expect(controls[1].className, url).toMatch(/\bw-11\b.*\bh-11\b/);
      expect(GIFT_GUIDES_CSS).toMatch(/\.gg-icon\{[^}]*width:44px;height:44px/);
      expect(controls[1].textContent, url).toBe("");
      // The old pills are gone: no Text link, Codes button or Share pill outside the menu.
      expect(container.textContent, url).not.toMatch(/Text th(is|ese) guides?|\bCodes\b/);
      expect(container.querySelector("[data-gift-text]"), url).toBeNull();
      // Under the title, above the guides.
      expect(quick.compareDocumentPosition(container.querySelector(".gg-layout")!) & Node.DOCUMENT_POSITION_FOLLOWING, url).toBeTruthy();
      cleanup();
    }
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-quick\b|\.gg-share\{/);
  });

  // @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |           {native && <InlineTextButton | {false && <InlineTextButton
  it("Share opens a small menu: Copy link, Text this guide (sms:), and the phone's own share sheet where there is one", async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: write } });
    const { container } = renderAt("/gift-guides/mom");
    const share = screen.getByRole("button", { name: "Share" });
    expect(share.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-gift-share-menu]")).toBeNull();
    fireEvent.click(share);
    const menu = container.querySelector("[data-gift-share-menu]")!;
    expect(share.getAttribute("aria-expanded")).toBe("true");
    // jsdom has no navigator.share: no third item.
    expect([...menu.querySelectorAll("[role=menuitem]")].map((x) => x.textContent)).toEqual(["Copy link", "Text this guide", "Facebook", "Pinterest"]);
    const text = menu.querySelector("a[data-gift-text]")!;
    expect(text.getAttribute("href")).toMatch(/^sms:[?&]body=.*https%3A%2F%2Fwww\.louisianahelpr\.com%2Fgift-guides%2Fmom$/);
    fireEvent.click(menu.querySelector("[data-gift-copy-link]")!);
    expect(write).toHaveBeenCalledWith("https://www.louisianahelpr.com/gift-guides/mom");
    await screen.findByText("Link copied");
    // Escape closes it.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("[data-gift-share-menu]")).toBeNull();
    cleanup();
    // With the phone's share sheet, a third item opens it with the guide's link.
    const native = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { share: native });
    try {
      const land = renderAt("/gift-guides").container;
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
      const items = [...land.querySelectorAll("[data-gift-share-menu] [role=menuitem]")];
      expect(items.map((x) => x.textContent)).toEqual(["Copy link", "Text these guides", "More ways to share", "Facebook", "Pinterest"]);
      fireEvent.click(items[2]);
      expect(native).toHaveBeenCalledWith({ title: "Holiday Gift Guides", url: "https://www.louisianahelpr.com/gift-guides" });
    } finally {
      delete (navigator as { share?: unknown }).share;
    }
  });
});

describe("gift guides: Discount codes stay closed while moving between guides (owner 11-18 PM)", () => {
  // Owner: "if I click something like gift for her the discount codes open and expand again ... they should only open
  // if clicked". Closed on the landing, still closed after opening Her from the menu; a click opens it.
  it("landing -> Gifts for Her -> Mom keeps the codes collapsed, every code inside", () => {
    const { container } = renderAt("/gift-guides");
    // Owner redesign 11-18 PM: the codes are inside the page's one "Deals & codes" section.
    const codesNow = () => container.querySelector("details[data-gift-deals-codes]") as HTMLDetailsElement;
    expect(codesNow().open).toBe(false);
    // A tap opens it; the next page's section starts closed again.
    fireEvent.click(codesNow().querySelector("summary")!);
    codesNow().open = true;
    const her = [...container.querySelectorAll("[data-gift-sidebar] a")].find((a) => a.getAttribute("href") === "/gift-guides/her")!;
    expect(her).toBeTruthy();
    fireEvent.click(her);
    expect(container.querySelector('[data-testid="where"]')?.textContent).toBe("/gift-guides/her");
    // A guide shows only its own deals and codes (owner 11-19), so its box may be absent; when present it starts closed.
    expect(codesNow()?.open ?? false).toBe(false);
    // Opened on Her, it is closed again on Mom (a new section per guide, nothing remembered).
    // @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       <DealsAndCodes key={guide.slug} guide={guide} /> |       <DealsAndCodes guide={guide} />
    if (codesNow()) codesNow().open = true;
    // On a guide it comes right after pick 10 (design spec 11-18 H5), never above pick #1.
    // @mutate src/pages/info/giftGuides/GiftGuideView.tsx | export const DEALS_AFTER_PICKS = 10; | export const DEALS_AFTER_PICKS = 0;
    const herPicks = [...container.querySelectorAll("li[data-gift-pick]")];
    if (codesNow() && herPicks.length > DEALS_AFTER_PICKS) expect(herPicks.filter((li) => li.compareDocumentPosition(codesNow()) & Node.DOCUMENT_POSITION_FOLLOWING).length).toBe(DEALS_AFTER_PICKS);
    const mom = [...container.querySelectorAll("[data-gift-sidebar] a")].find((a) => a.getAttribute("href") === "/gift-guides/mom")!;
    fireEvent.click(mom);
    expect(codesNow()?.open ?? false).toBe(false);
  });
});

describe("gift guides: no ShopMy collection lines on a guide page, no ShopMy/Pinterest links in the footer (owner 11-18 PM)", () => {
  // Owner: "you can remove this because my full guides are already here with the links" (Shop the full guide / More
  // on ShopMy), and "same for this" (Every collection on ShopMy / Every gift guide on Pinterest). The disclosures stay.
  // @mutate src/pages/info/giftGuides/GiftDisclosure.tsx |       <p data-gift-amazon-statement="">{G.amazonStatement}</p>\n |       <p data-gift-amazon-statement="">{G.amazonStatement}</p>\n      <p className="gg-more"><a href="https://shopmy.us/shop/lexilombas">Every collection on ShopMy</a></p>\n
  it("Her, Him, Dad and a store page show neither line; the footer keeps both disclosures and no other link", () => {
    let pages = 0;
    for (const slug of ["her", "him", "dad", "store-walmart"]) {
      const { container } = renderAt(`/gift-guides/${slug}`);
      expect(container.textContent, slug).not.toMatch(/Shop the full guide|More on ShopMy|Every collection on ShopMy|Every gift guide on Pinterest/);
      const foot = container.querySelector("footer.gg-disc")!;
      expect(foot.querySelector("[data-gift-disclosure]")?.textContent, slug).toBe(giftGuides.disclosure);
      expect(foot.querySelector("[data-gift-amazon-statement]")?.textContent, slug).toBe(AMAZON_STATEMENT);
      expect(foot.querySelectorAll("a").length, slug).toBe(0);
      pages += 1;
      cleanup();
    }
    expect(pages).toBeGreaterThan(3);
  });
});

describe("gift guides: rows read in order (design audit 11-18 #8, #9)", () => {
  it("By budget runs Under $5 up to $100 & Up, then Stocking Stuffers and Gift Wrap; each kids hub runs Babies to Teens", () => {
    // @mutate src/content/giftGuideIndex.ts | slug: "under-5", | slug: "under-5x",
    const budget = GUIDE_INDEX.filter((g) => g.group === "By budget").map((g) => g.slug);
    // Big batch 1120: Splurge Gifts and Easy & Last-Minute Gifts (merged guides) sit where their first sections sat.
    // Follow-up 1120: Gifts by Budget (Stocking Stuffers, Under $25, Under $50, memberships) leads the row.
    expect(budget).toEqual(["gifts-by-budget", "under-5", "under-10", "under-15", "under-20", "under-25", "under-30", "under-40", "under-50", "splurge", "under-75", "under-100", "100-and-up", "stocking-stuffers", "gift-wrap-and-cards", "gift-tags", "advent-calendars", "easy-and-last-minute", "gift-cards", "subscriptions"]);
    // The landing's By budget row: the guides that stay, in that order.
    expect(guidesIn("by-budget").map((g) => g.slug)).toEqual(["gifts-by-budget", "splurge", "gift-wrap-and-cards"]);
    for (const hub of ["boys", "girls", "gender-neutral"]) {
      expect(GUIDE_INDEX.filter((g) => g.parent === hub).map((g) => g.slug.slice(hub.length + 1)), hub).toEqual(["babies", "toddlers", "little-kids", "big-kids", "teens"]);
      expect(GUIDE_INDEX.filter((g) => g.parent === hub).every((g) => /^ages \d+(–\d+|\+)$/.test(g.age ?? "")), hub).toBe(true);
    }
  });
});

describe("gift guides: Amazon CDN photos held behind one switch; photo-less picks swapped in mixed guides (lead 2026-11-18)", () => {
  it("ships no m.media-amazon.com photo while AMAZON_CDN_PHOTOS is off, and the import swaps no-photo picks from the link library", () => {
    // @mutate scripts/gift-guide-picks.mjs | (!amazonHosted \|\| (AMAZON_CDN_PHOTOS && | (true \|\| (AMAZON_CDN_PHOTOS &&
    // @mutate scripts/gift-guide-picks.mjs | ssl-images-amazon\|amazon\|amazon-adsystem)\.com$/; | ssl-images-amazon\|amazon)\.com$/;
    const script = src("scripts/gift-guide-picks.mjs");
    // Owner 11-18 PM: the switch is ON until 3 sales unlock PA-API (then OFF, or PA-API images); Amazon CDN photos ship
    // only through it, only from m.media-amazon.com, only tagged "amazon-sitestripe".
    expect(script).toContain('export const AMAZON_CDN_PHOTOS = process.env.GIFT_AMAZON_PHOTOS !== "off";');
    expect(script).toContain('(!amazonHosted || (AMAZON_CDN_PHOTOS && p.image_source === "amazon-sitestripe" && new URL(p.image).hostname === "m.media-amazon.com"))');
    // Every Amazon image host counts as Amazon-hosted, the ad-system widget host too (lead 11-18 PM).
    expect(script).toContain("export const AMAZON_IMAGE_HOST = /(^|\\.)(media-amazon|images-amazon|ssl-images-amazon|amazon|amazon-adsystem)\\.com$/;");
    expect(script).toContain("AMAZON_IMAGE_HOST.test(new URL(p.image).hostname)");
    expect(script).toContain('JSON.parse(readFileSync(join(LIB, "unused-by-guide.json"), "utf8"))');
    expect(script).toContain("const everyPick = [...sortedGuides.flatMap(([, l]) => l), ...swappedOut.filter(hasPhoto)];");
    let photos = 0;
    let amazonCdn = 0;
    for (const [slug, list] of Object.entries(RESEARCHED_PICKS)) for (const p of list) {
      if (!p.image) continue;
      photos += 1;
      const host = new URL(p.image).hostname;
      // The only Amazon image host that may ship is the CDN, on an Amazon-link pick (never images-amazon,
      // ssl-images-amazon, ws-na.amazon-adsystem.com or amazon.com itself).
      if (/(^|\.)(media-amazon|images-amazon|ssl-images-amazon|amazon|amazon-adsystem)\.com$/.test(host)) {
        expect(host, `${slug}: ${p.name}`).toBe("m.media-amazon.com");
        expect(p.href, `${slug}: ${p.name}`).toMatch(/^https:\/\/(www\.)?amazon\.com\//);
        amazonCdn += 1;
      }
    }
    // Owner 11-18 PM: photo-less Amazon picks show their CDN photo (measured below the floor = the switch is off).
    // Follow-up 1120: ~30 guides and 26 store pages hold ~390 Amazon CDN photos (measured 2026-11-20; 500+ on 65 guides).
    expect(amazonCdn).toBeGreaterThan(300);
    // Brand-site photos (lead 11-18 PM): a photo-less Amazon pick takes the brand's own photo of the same product from
    // amazon-brand-images.json, its Amazon link kept (179 rows from 45 ASINs, measured 2026-11-18).
    // @mutate scripts/gift-guide-picks.mjs | if (!hasOwn && brand?.source === "brand-site" | if (false && brand?.source === "brand-site"
    let brandSite = 0;
    for (const list of Object.values(RESEARCHED_PICKS)) for (const p of list) if (/^https:\/\/www\.amazon\.com\//.test(p.href) && p.image && !p.image.startsWith("https://m.media-amazon.com/")) brandSite += 1;
    expect(brandSite).toBeGreaterThan(10); // one guide per product (owner 11-19); 22 after the Amazon page kept its 15 best (1530 train); 12 after the train 1120b re-audit cuts
    // Floor re-measured 2026-11-18 after design audit r2 dropped page titles, store names and promos (4,397 photos).
    expect(photos).toBeGreaterThan(1500); // follow-up 1120: ~30 guides + 26 store pages, measured 2026-11-20 (~1,850)
    // Affiliate sweep 11-18 PM: no TIFF photo (blank in every browser), and a ShopMy collection link (a mixed
    // collection, not the retailer) is on no store page.
    // @mutate scripts/gift-guide-picks.mjs | const store = collection ? null | const store = false ? null
    // @mutate scripts/gift-guide-picks.mjs |   const ownImage = !tiff && !deadHost && |   const ownImage = !tiff && 
    for (const [slug, list] of Object.entries(RESEARCHED_PICKS)) for (const p of list) {
      // A server-converted TIFF (KitchenAid ".tif?fmt=png", served as PNG) is fine.
      // ShopMy's static.shopmy.us mirror serves JPEG bytes under a ".tif" name (checked 11-18 PM).
      if (!(p.image ?? "").startsWith("https://static.shopmy.us/")) expect((p.image ?? "").replace(/\.tiff?\?(.*&)?fmt=(png|jpe?g|webp)\b.*/i, ""), `${slug}: ${p.name}`).not.toMatch(/\.tiff?(\?|#|$)/i);
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
    expect(sized).toBeGreaterThan(0); // one guide per product (owner 11-19)
    expect(anker).toBeGreaterThan(0); // one guide per product (owner 11-19)
    // XTRATUF in the Louisiana guides the lead named (11-18).
    // @mutate scripts/gift-guide-picks.mjs | for (const p of readList("_xtratuf.json")) if (names.includes(p.name)) add(slug, p, "_xtratuf.json"); | void names;
    // (One guide per product, owner 11-19: each XTRATUF boot shows on one guide now; the named guides still hold some.)
    expect(Object.entries(RESEARCHED_PICKS).filter(([s]) => !s.startsWith("store-")).flatMap(([, l]) => l.filter((p) => p.store === "store-xtratuf")).length).toBeGreaterThan(0);
  });
});

describe("gift guides: the Amazon page in sections (design audit 11-18 #3)", () => {
  it("opens on Louisiana Helpr Picks, then By person, For kids and the rest, in order, each once", () => {
    // @mutate scripts/gift-guide-picks.mjs | pageList["store-amazon"] = [...byHref.values()].map((p) => ({ ...p, section: sectionOf(p) })) | pageList["store-amazon"] = [...byHref.values()].map((p) => ({ ...p }))
    const order = ["Louisiana Helpr Picks", "By person", "For kids", "By budget", "Louisiana", "Hobbies", "By career", "Life moments", "Colors", "Pets", "More finds"];
    const amazon = RESEARCHED_PICKS["store-amazon"];
    expect(amazon.every((p) => p.section && order.includes(p.section))).toBe(true);
    const runs = amazon.map((p) => p.section).filter((x, i, all) => x !== all[i - 1]);
    expect(runs[0]).toBe("Louisiana Helpr Picks");
    expect(new Set(runs).size).toBe(runs.length);
    expect([...runs].sort((a, b) => order.indexOf(a!) - order.indexOf(b!))).toEqual(runs);
    // Amazon keeps its 15 best (lead 11-19, 1530 train): one or more sections, in order.
    expect(runs.length).toBeGreaterThan(0);
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
