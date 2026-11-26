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
 * Owner 11-21 ("launch the 3 guides remove the rest that are live"): only Her, Him and Kids (and the 25 Days
 * sponsors page) are live (src/content/giftGuideLive.mjs). The tests of retired guides, store pages, the finder, the
 * Top 10, Deals & codes and Kids by age are gone; the inventory floors follow the live list;
 * src/test/giftGuideOnlyThree1121.test.tsx guards the retirement.
 *
 * @mutate src/pages/info/giftGuides/GiftOut.tsx | rel="sponsored noopener" | rel="noopener"
 * @mutate src/pages/info/giftGuides/GiftOut.tsx | target="_blank" rel= | rel=
 * @mutate src/pages/info/giftGuides/GuidesDisclosure.tsx | <p data-gift-disclosure="">{G.disclosureLead} <span | <p data-gift-disclosure="">{null} <span
 * @mutate src/pages/info/giftGuides/GuidesDisclosure.tsx | <span data-gift-amazon-statement="">{G.amazonStatement}</span></p>\n | </p>\n
 * @mutate src/content/giftGuides.ts |   disclosureLead: "Affiliate links:", |   disclosureLead: "Links:",
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | padding-top:14px;font-size:12px;color:var(--gg-muted); | padding-top:14px;font-size:10px;color:var(--gg-muted);
 * @mutate src/content/giftGuides.ts | amazonStatement: "As an Amazon Associate, Louisiana Helpr earns from qualifying purchases.", | amazonStatement: "As an Amazon Associate I earn from qualifying purchases.",
 * @mutate src/pages/info/GiftGuides.tsx | {deals ? <LazyDeals key={deals.id} day={deals} /> : guide ? | {footer}{deals ? <LazyDeals key={deals.id} day={deals} /> : guide ?
 * @mutate src/content/giftGuideCatalog.ts |   return { row: rowId(group), label: group, tint }; |   return { row: rowId(group), label: group, tint: "oat" as GuideTint };
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx | <Link to={`/gift-guides/${g.slug}`} | <Link to={`/gift-guides#${g.slug}`}
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |   { slug: "him", dot: "green" }, |   { slug: "him", dot: "red" },
 * @mutate src/content/giftGuideCatalog.ts |     ...(children?.length ? { children } : {}), | 
 * @mutate src/content/giftGuideCatalog.ts | g.row === row && !g.parent && !g.view); | g.row === row && !g.parent && !g.view && g.slug !== KIDS_HUB);
 * @mutate src/content/giftGuideCatalog.ts | 8978491: "mom", | 8978491: "nowhere", 
 * @mutate src/content/giftGuideCatalog.ts | 9000047: "gardener", | 9000047: "no-guide", 
 * @mutate src/content/giftGuideCatalog.ts | "for-him": "him", | "for-him": "him-x",

 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx | className="gg-cover" loading="lazy" decoding="async" | className="gg-cover" decoding="async"
 * @mutate src/pages/info/GiftGuides.tsx |   const slug = myListPage ? undefined : rawSlug; |   const slug = undefined as string \| undefined; void rawSlug;
 * @mutate src/pages/info/GiftGuides.tsx |   if (!slug && !shared && !myListPage && fromHash) return | if (!slug && !shared && !myListPage && fromHash && false) return
 * @mutate src/pages/info/GiftGuides.tsx |   if (moved) return | if (moved && false) return
 * @mutate src/pages/info/GiftGuides.tsx | const backTo = guide \|\| deals \|\| myList \|\| shared \|\| sidePage === "finder" ? "/gift-guides" : "/"; | const backTo = guide \|\| deals \|\| myList \|\| shared \|\| sidePage === "finder" ? "/gift-guides/" : "/";
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | className="gg-thumb" loading={eager ? "eager" : "lazy"} decoding="async" | className="gg-thumb" decoding="async"
 * @mutate src/content/giftGuidesAmazon.ts | ["8Bitdo Retro Mechanical Keyboard", "https://www.amazon.com/dp/B0DKXH5WCD?tag=louisianahelpr-20"], | ["8Bitdo Retro Mechanical Keyboard", "https://www.amazon.com/dp/B0DKXH5WCD?tag=hggguidepage-20"],
 * @mutate src/content/giftGuideCatalog.ts |   return hit; |   return "amazon" as GiftStore;
 * @mutate src/content/giftGuides.ts | const shopmy = (id: number) => `https://shopmy.us/collections/${id}`; | const shopmy = (id: number) => `http://shopmy.us/collections/${id}`;
 * @mutate src/App.tsx |       <Route path="/gift-guides/:slug" element={<RouteErrorBoundary> |       <Route path="/gift-guides/:slug" element={<ProtectedRoute><RouteErrorBoundary>
 * @mutate src/pages/info/GiftGuides.tsx | "gg w-full" | "gg page-column"
 * @mutate src/content/giftGuides.ts |   for (const c of [...codes].sort((a, b) => a.rank - b.rank)) stores.set(c.store, [...(stores.get(c.store) ?? []), c]); |   for (const c of codes) stores.set(`${c.store} ${c.code}`, [c]);
 * @mutate src/content/giftGuideCatalog.ts |   const to = MERGED_GUIDES[s]?.[0] ?? s; |   const to = s;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-side{display:none} | .gg-side{order:2;position:static}
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | /iPhone\|iPad\|iPod/.test(userAgent) ? "&" : "?" | "?"
 * @mutate src/content/giftGuideCatalog.ts | GUIDES.filter((g) => !g.empty && !g.thin && g.row === row | GUIDES.filter((g) => !g.empty && g.row === row
 * @mutate src/content/giftGuideCatalog.ts | GUIDES.filter((g) => !g.empty && !g.thin && g.row === row | GUIDES.filter((g) => !g.thin && g.row === row
 * @mutate src/content/giftGuideCatalog.ts |     if (g.empty \|\| g.thin) return false; |     if (false) return false;
 * @mutate src/content/giftGuideCatalog.ts | picks: HAS_CHUNK.has(t) ? d.picks : uniqueByHref([...d.picks, ...src.picks]) | picks: HAS_CHUNK.has(t) ? d.picks : [...d.picks, ...src.picks, ...src.picks]
 * @mutate src/content/giftGuides.ts | codes.filter((c) => (!c.expires \|\| c.expires >= today) && | codes.filter((c) => (today === today) &&
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | {!guide.children && guide.picks.length === 0 && ( | {false && (
 * @mutate src/content/giftGuideCatalog.ts | export const REMOVED_GUIDES = ["last-minute-gifts", | export const REMOVED_GUIDES = ["nothing",
 * @mutate src/pages/info/GiftGuides.tsx | : guide.lead, title: guide.title, tint: guide.tint | : guide.lead, title: guide.slug, tint: guide.tint
 * @mutate src/pages/info/Index.tsx |       <SectionsShowcase />\n |       <SectionsShowcase />\n      <GiftGuidesBand />\n
 * @mutate src/components/Footer.tsx |               <Link to="/safety" className={FOOTER_LINK}> |               <Link to="/gift-guides" className={FOOTER_LINK}>
 * @mutate src/components/sponsor/Sections.tsx |         <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>\n |         <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>\n        <Link to={C.links.giftGuides}>{C.footer.giftGuidesLink}</Link>\n
 * @mutate src/content/giftGuideIndex.ts |   { group: "By store", tint: "green", slug: "store-amazon", title: "Amazon", lead: "shop" }, |   { group: "By store", tint: "green", slug: "store-shopmy", title: "ShopMy", lead: "shop" },\n  { group: "By store", tint: "green", slug: "store-amazon", title: "Amazon", lead: "shop" },
 * @mutate src/content/giftGuideIndex.ts | { group: "By career", tint: "oat", slug: "stay-at-home-parents" | { group: "Life moments", tint: "oat", slug: "stay-at-home-parents"
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx |         {g.age && <span className="gg-count">{g.age}</span>} |         <span className="gg-count">{g.age ?? ""}{g.picks.length} picks</span>
 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx |           <h1 id={titleId}><span className="sr-only">{lead}</span>{" "}{title}</h1>\n        </div> |           <h1 id={titleId}><span className="sr-only">{lead}</span>{" "}{title}</h1>\n          <p className="gg-arch-foot">Louisiana Helpr</p>\n        </div>
 * @mutate src/content/giftGuideCodes.json | {"rank":1,"store":"Muck Boot","code":"TAKE25", | {"rank":8,"store":"Muck Boot US","code":"TAKE25",
 */
import { KIDS_THEME_GUIDES_1124, THEME_GUIDES_1124, isLiveGuide } from "@/content/giftGuideLive.mjs";
import { readFileSync, existsSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  // The header's own row (back target, title, title actions) as PageHeader draws it, so a test can see what rides it.
  PublicHeaderPage: ({ title, titleTag = "h1", backTo, titleActions, hideHeader, children }: { title: string; titleTag?: "h1" | "p"; backTo?: string; titleActions?: React.ReactNode; hideHeader?: boolean; children: React.ReactNode }) => (
    <main>{!hideHeader && <div data-test-header-row="" data-back-to={backTo}>{titleTag === "p" ? <p data-test-title="">{title}</p> : <h1 data-test-title="">{title}</h1>}{titleActions}</div>}{children}</main>
  ),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { GiftGuidesBand, GIFT_GUIDES_PATH } from "@/components/landing/GiftGuidesBand";
import { giftGuides, AFFILIATE_HOSTS, BRAND_SITES, LOUISIANA_SHOPS, SPONSOR_SITES, NATIONAL_SPONSOR_SITES, SHOPMY_COLLECTIONS, discountCodes } from "@/content/giftGuides";
import { SaleCards, liveSales } from "@/pages/info/giftGuides/GiftGuideDealCards";
import { GIFT_WRAP_JOB_PATH } from "@/pages/info/giftGuides/GiftGuideHelpr";
import { AMAZON_GUIDES } from "@/content/giftGuidesAmazon";
import { GUIDE_INDEX } from "@/content/giftGuideIndex";
import { DEAL_CODES, type PickChunk } from "@/content/giftGuidePicks";
import { GUIDES, ROWS, STORES, AMAZON_TAG, KIDS_HUB, MERGED_GUIDES, REMOVED_GUIDES, guidesIn, guideBySlug, loadAllGuidePicks, searchGuides, storeOf, unplacedGuides, STORE_ROW_MIN_PICKS, type CatalogGuide } from "@/content/giftGuideCatalog";
import { GiftGuideView, storeLabel } from "@/pages/info/giftGuides/GiftGuideView";
import { smsHref } from "@/pages/info/giftGuides/GiftGuideShare";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { MERGED_INTO, isFoldedStore } from "@/content/giftGuideMerges.mjs";
import { OLD_PEOPLE_SLUGS, RELATION_PAGES } from "@/content/giftGuidePeople.mjs";
import { RETIRED_SLUGS, newSlugFor } from "@/content/giftGuideCatalog";
import { SEARCH_PAGES } from "@/content/guideSearchPages.mjs";
import { RETIRED_TO_SEARCH_PAGE } from "@/content/retiredGuideForward";
import { CHUNK_PICK_COUNTS, SECTION_ANCHORS } from "@/content/giftGuidePicks";
import { DEAL_DAY_SLUGS, DEALS_SLUG } from "@/content/giftGuideDeals.mjs";
// The fun pages (owner 2026-11-20: swipe, planner, the Secret Santa drawer) are own pages too: in the sitemap, no guide.
// Owner 2026-11-21: the printables are three pages (the old /gift-guides/printables address forwards to them).
const OWN_PAGES = [...DEAL_DAY_SLUGS, "swipe", "planner", "draw-names", "printables/gift-tags", "printables/coloring-books", "printables/banners"];
import { PUBLIC_PAGE_META, NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { giftGuidePageMeta, publicOrGiftGuidePageMetaFor } from "@/lib/giftGuidePageMeta.mjs";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { sponsorPage } from "@/content/sponsorPage";
import { BLOCKED_BRANDS, blockedBrand } from "../../scripts/giftGuideBlocklist.mjs";
import { openPriceSections } from "./helpers/openPriceSections";

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
  // Owner 11-21: no Show more any more; the price sections open on a tap (the first is open), so open them all.
  openPriceSections(root);
  return root;
};
// Owner 2026-11-22 ("Make this small on 1 line"): one line holding both the affiliate words and Amazon's statement.
const DISCLOSURE = "Affiliate links: As an Amazon Associate, Louisiana Helpr earns from qualifying purchases.";
const AMAZON_STATEMENT = "As an Amazon Associate, Louisiana Helpr earns from qualifying purchases.";
const ROW_LABELS = ["By person", "For kids", "By budget", "Louisiana", "Hobbies", "By career", "Life moments", "Pets", "Colors", "By store"];
// @two-way src/test/giftGuidesPage.test.tsx:stale allowed host
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

describe("gift guides: one header on every page (owner 11-21)", () => {
  // Owner 2026-11-21 ("holiday gift guides needs the same set up as the other pages. title on left with back arrow on the
  // left of the title"; then "add holiday to gift guides where it is by the back arrow. remove the repeated title below.
  // then move the 3 icons to the right of order by dec 15 etc"): every gift guides page, the landing too, has the shared
  // header row (back arrow + "Holiday gift guides"), then ONE row: the shipping pill, then search + heart + Share. The
  // centered "top-rated finds / Holiday gift guides" block is gone.
  // Owner 11-21 (later): "all of this should be on the same row": the back arrow + title, the pill and the tools are ONE
  // row the page draws (one line from 768px up; a phone wraps it).
  // Owner 2026-11-24 ~8:30 PM ("Remove by Dec 15 everywhere"): the pill is gone; the row is the title, then the tools.
  // @mutate src/pages/info/giftGuides/GuidesTop.tsx | <GuidesHeadRow backTo={backTo} titleIsH1={!banner} | <GuidesHeadRow backTo={backTo} titleIsH1
  // @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (min-width:768px){.gg-head-title{flex:0 0 auto}.gg-headrow{flex-wrap:nowrap} | @media (min-width:768px){.gg-head-title{flex:1 1 100%}.gg-headrow{flex-wrap:wrap}
  it("one header row: back arrow + 'Holiday gift guides' and the tools (no pill); no second title", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    let checked = 0;
    for (const [url, tag, back] of [["/gift-guides", "H1", "/"], ["/gift-guides/her", "P", "/gift-guides"], ["/gift-guides/him", "P", "/gift-guides"]] as const) {
      const { container } = renderAt(url);
      // The shell's own header row is off; the page's row holds everything.
      expect(container.querySelector("[data-test-header-row]"), url).toBeNull();
      const head = container.querySelector("[data-gift-headrow]");
      expect(head, url).not.toBeNull();
      expect(head!.querySelector("[data-gift-back-to]")?.getAttribute("data-gift-back-to"), url).toBe(back);
      expect(head!.querySelector("[data-gift-back-to] button[aria-label]"), url).not.toBeNull();
      expect(head!.querySelector("[data-gift-head-name]")?.textContent, url).toBe("Holiday gift guides");
      expect(head!.querySelector("[data-gift-head-name]")?.tagName, url).toBe(tag);
      // Arrow + title, then the tools (search, heart, Share), as siblings of the one row; last the phone's three-line
      // menu (owner 11-22), which the CSS shows only up to 767px. No shipping pill (owner 11-24).
      const kids = [...head!.children];
      expect(kids.map((k) => (k.matches("[data-gift-head-title]") ? "title" : k.matches("[data-gift-ship]") ? "ship" : k.matches("[data-gift-quick]") ? "tools" : k.matches("[data-gift-head-phone]") ? "phone" : k.tagName)), url).toEqual(["title", "tools", "phone"]);
      expect(container.querySelector("[data-gift-ship]"), url).toBeNull();
      // No centered title block: the landing has none, a guide keeps only its cover banner (its own h1).
      expect(container.querySelector("[data-gift-words]:not([data-gift-banner])"), url).toBeNull();
      expect(container.textContent, url).not.toMatch(/top-rated finds/i);
      expect(container.querySelectorAll("h1").length, url).toBe(1);
      checked += 1;
      cleanup();
    }
    expect(checked).toBe(3);
    vi.useRealTimers();
  });
});

describe("gift guides: the content inventory", () => {
  it("every link is https on an allowed host; every pick's store is its link host; no prices", () => {
    expect(contentLinks.length).toBeGreaterThan(600);
    // Owner 11-21: only Her, Him, Kids and the sponsors page are live (369 picks measured 2026-11-21; was 600+).
    expect(picks.length).toBeGreaterThan(300);
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
    expect(covers.length).toBeGreaterThan(2); // owner 11-21: Her, Him, Kids and the sponsors page; the relationship views are gone (4)
    // A cover URL carries ?v=<content hash> (owner 11-21; src/test/giftGuideCoverVersions1121.test.ts): the file is the path before it.
    for (const g of covers) expect(existsSync(`public${g.cover!.split("?")[0]}`), g.cover).toBe(true);
    expect(ROWS.map((r) => r.label)).toEqual(ROW_LABELS);
    // Owner 11-21: only Her, Him, Kids and the sponsors page are live (src/content/giftGuideLive.mjs), so only their
    // rows hold a guide; the other rows stay on the owner's list for the guides' return.
    expect(ROWS.filter((r) => GUIDES.some((g) => g.row === r.row)).map((r) => r.row)).toEqual(["by-person", "for-kids", "louisiana"]);
    // The old section slugs (pins link to them) still open a guide (a merged one at its section), unless the owner's list
    // dropped it (its picks stay in ShopMy) or its guide is retired (owner 11-21: it lands on the landing, null).
    let opened = 0;
    for (const s of giftGuides.sections) {
      if (REMOVED_GUIDES.includes(s.id)) continue;
      const to = newSlugFor(s.id);
      if (to === null) continue;
      // Lead 11-24: a retired section slug with an honest search page opens that page (retiredGuideForward.ts); it must be
      // the mapped one and a real search page.
      if (Object.prototype.hasOwnProperty.call(RETIRED_TO_SEARCH_PAGE, s.id) && !slugs.includes(to.split("#")[0])) {
        expect(to, s.id).toBe(RETIRED_TO_SEARCH_PAGE[s.id]);
        expect(SEARCH_PAGES.map((p) => p.slug), s.id).toContain(to);
        opened += 1;
        continue;
      }
      expect(slugs, s.id).toContain(to.split("#")[0]);
      opened += 1;
    }
    expect(opened).toBeGreaterThan(0);
  });

  it("Kids is ONE guide by age (Babies to Teens), each age mixing girls, boys and any; removed guides are gone", () => {
    // Follow-up 1120 (owner pop-up 11-20 ~1:10 AM, "FINAL MERGES"): Girls, Boys and Gender-Neutral, with their five ages
    // each, are one Kids guide whose sections are the ages; every old slug opens its age section (a hub's own picks lead).
    const kids = guideBySlug(KIDS_HUB)!;
    expect(kids.children ?? []).toEqual([]);
    const sections = [...new Set(kids.picks.map((p) => p.sectionId).filter(Boolean))];
    expect(sections.filter((x) => x !== "top-picks")).toEqual(["babies", "toddlers", "little-kids", "big-kids", "teens"].filter((x) => sections.includes(x)));
    // Owner 11-21 ~2:47 AM: Kids is her own Amazon kids list, one flat list with no age sections.
    expect(sections).toEqual([]);
    for (const who of ["girls", "boys", "gender-neutral"]) {
      expect(guideBySlug(who), who).toBeUndefined();
      for (const age of GUIDE_INDEX.filter((x) => x.parent === who).map((x) => x.slug)) {
        expect(guideBySlug(age), age).toBeUndefined();
        // Teens is its own guide (owner 11-20 evening): an old teens slug opens it.
        // Owner 11-21: Teens is retired (src/content/giftGuideLive.mjs), so an old teens slug lands on the landing.
        // Lead 11-24: one with a Teens search page opens it (retiredGuideForward.ts), never a guide.
        if (age.endsWith("-teens")) {
          const want = RETIRED_TO_SEARCH_PAGE[age] ?? null;
          expect(newSlugFor(age), age).toBe(want);
          if (want) expect(SEARCH_PAGES.map((p) => p.slug), age).toContain(want);
          continue;
        }
        expect(newSlugFor(age), age).toBe(`${KIDS_HUB}#${SECTION_ANCHORS[age]}`);
        expect(age.endsWith(SECTION_ANCHORS[age]), age).toBe(true);
      }
    }
    for (const empty of REMOVED_GUIDES) expect(guideBySlug(empty), empty).toBeUndefined();
    expect(unplacedGuides()).toEqual([]);
  });

  it("the owner's guide list drives the order and the palettes; every listed guide with content is shown", () => {
    expect(ROWS.map((r) => r.label)).toEqual(ROW_LABELS);
    expect(ROWS.map((r) => r.tint)).toEqual(["green", "red", "oat", "green", "red", "oat", "green", "red", "oat", "green"]);
    // For Her + For Him (owner 11-20): the relationship pages (Mom, Wife ...) are filtered views, listed after the guides.
    const shown = GUIDES.filter((g) => !g.view && GUIDE_INDEX.some((x) => x.slug === g.slug)).map((g) => g.slug);
    expect(shown).toEqual(GUIDE_INDEX.filter((x) => shown.includes(x.slug)).map((x) => x.slug));
    expect(shown).toEqual(GUIDE_INDEX.filter((x) => isLiveGuide(x.slug) && !REMOVED_GUIDES.includes(x.slug) && !MERGED_GUIDES[x.slug] && !MERGED_INTO[x.slug] && !isFoldedStore(x.slug) && !RELATION_PAGES[x.slug] && !OLD_PEOPLE_SLUGS[x.slug]).map((x) => x.slug));
    // Follow-up 1120: 41+ shown, measured 2026-11-20; owner 11-21: only Her, Him, Kids and the sponsors page are live.
    expect(shown.length).toBeGreaterThan(3);
    for (const g of GUIDES) expect(ROWS.find((r) => r.row === g.row), g.slug).toBeTruthy();
    for (const x of GUIDE_INDEX.filter((i) => shown.includes(i.slug))) expect(guideBySlug(x.slug)!.tint).toBe(x.tint);
  });

  it("the disclosure says plainly what the links are, Amazon's in its required words, on one line", () => {
    expect(giftGuides.disclosure).toBe(DISCLOSURE);
    expect(giftGuides.amazonStatement).toBe(AMAZON_STATEMENT);
    // Both parts, never only one: the affiliate words (FTC) and Amazon's statement word for word.
    expect(giftGuides.disclosure).toMatch(/\baffiliate\b/i);
    expect(giftGuides.disclosure).toContain(AMAZON_STATEMENT);
    expect(giftGuides.disclosure).toBe(`${giftGuides.disclosureLead} ${giftGuides.amazonStatement}`);
    // Small but still clear (FTC: a disclosure must be readable): 12px, muted, never smaller.
    const disc = /(?:^|\n)\.gg-disc\{([^}]*)\}/.exec(GIFT_GUIDES_CSS)?.[1] ?? "";
    expect(disc).toContain("font-size:12px");
    expect(disc).toContain("color:var(--gg-muted)");
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-disc[^{]*\{[^}]*font-size:(?:[0-9]|1[01])(?:\.\d+)?px/);
  });
});

describe("gift guides: the landing opens to the guides", () => {

  it("every header is compact: the header row and the one tool row; a landing tile's only count is its quiet gifts line", () => {
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector(".gg-band")).toBeNull();
    // Owner 11-21: no title block in the body; the header row is the page's h1 (checked above).
    expect(container.querySelector("[data-gift-words]")).toBeNull();
    // Lead 11-21 landing polish: each landing tile says "Her · 36 gifts" (the count of its list, no chunk loaded).
    const lines = [...container.querySelectorAll("[data-gift-live-guides] [data-gift-tile-name]")].map((n) => n.textContent);
    // The counts are each list's own (owner 11-21: Him and Kids grow to every one of her saves).
    expect(lines).toEqual([...["her", "him", "kids"].map((s) => `${s[0].toUpperCase()}${s.slice(1)} · , ${CHUNK_PICK_COUNTS[s]} gifts`)]); // owner 11-24 6:54 PM: theme guides show only inside Kids, never as landing tiles
    expect(CHUNK_PICK_COUNTS.him).toBeGreaterThan(100);
    cleanup();
    // Owner 2026-11-18: no "25 picks" count and no subtitle under any title. The landing's tiles (checked above) are the
    // only guide tiles now: the group pages that held the rest are gone (holiday audit 1121 #14).
    expect(renderAt("/gift-guides").container.textContent).not.toMatch(/\d+ picks?\b|\d+ guides\b|Coming soon|On ShopMy/);
    cleanup();
    const wordsOf = (path: string) => [...(renderAt(path).container.querySelector("[data-gift-words]")?.children ?? [])].map((c) => c.textContent);
    // A guide's header is its cover's look as a short banner (owner 11-18 PM): gingham in the guide's palette, a cream
    // arch holding the lead and the title (real text, no image; owner 11-21: "remove louisiana helpr from the [banner]").
    // @mutate src/pages/info/GiftGuides.tsx | title: guide.title, tint: guide.tint, sub: false } | title: guide.title, tint: "green" as const, sub: false }
    // The tool row carries no text: an empty My list shows no "0" badge (pre-launch audit 11-18 PM).
    // @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       {n > 0 && <span className="gg-icon-count" |       {true && <span className="gg-icon-count"
    // Owner 11-21: the tool row moved up beside the shipping pill, so the banner holds only its arch.
    // Owner 11-21: "remove louisiana helpr from the [banner]".
    // Holiday audit 1121: the drawn lead (aria-hidden), then the h1, which reads "gifts for Mom" (its lead is sr-only).
    expect(wordsOf("/gift-guides/her")).toEqual(["gifts forgifts for Her"]);
    cleanup();
    expect(renderAt("/gift-guides/her").container.querySelector("[data-gift-headrow] [data-gift-quick]")?.textContent).toBe("");
    cleanup();
    let banners = 0;
    for (const slug of ["kids", "her", "him"]) { // owner 11-21: the live guides (store and budget pages retired)
      const g = guideBySlug(slug)!;
      const c = renderAt(`/gift-guides/${slug}`).container;
      const head = c.querySelector("[data-gift-words]")!;
      expect(head.getAttribute("data-gift-banner"), slug).toBe(g.tint);
      expect(head.querySelector(".gg-banner")?.className, slug).toBe(`gg-banner gg-check gg-${g.tint}`);
      const arch = head.querySelector("[data-gift-arch]")!;
      // Holiday audit 1121: the h1 also carries the lead (sr-only), so it reads "gifts for Mom".
      const lead = g.age ? `${g.lead}, ${g.age}` : g.lead;
      expect([...arch.children].map((x) => x.textContent), slug).toEqual([lead, `${lead} ${g.title}`]);
      // Live audit r3 #7: the guide's name is the page's ONE h1; the header's "Gift guides" is a plain line.
      expect(arch.querySelector("h1")?.id, slug).toBe("gift-guide-title");
      expect(c.querySelectorAll("h1").length, slug).toBe(1);
      expect(head.querySelector("img"), slug).toBeNull();
      banners += 1;
      cleanup();
    }
    expect(banners).toBeGreaterThan(2);
    // The landing keeps its plain header.
    expect(renderAt("/gift-guides").container.querySelector("[data-gift-banner]")).toBeNull();
    cleanup();
    // "Text this guide" (owner 2026-11-18; in Share's menu since the 11-18 PM redesign): an sms: link carrying the
    // guide's URL; iOS's form, else Android's.
    expect(smsHref("https://x.test/g", "Mom", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe("sms:&body=Mom%20https%3A%2F%2Fx.test%2Fg");
    expect(smsHref("https://x.test/g", "Mom", "Mozilla/5.0 (Linux; Android 15)")).toBe("sms:?body=Mom%20https%3A%2F%2Fx.test%2Fg");
    cleanup();
    cleanup();
    const mom = renderAt("/gift-guides/her").container;
    expect(mom.querySelector(".gg-band")).toBeNull();
    expect(mom.querySelector("[data-gift-words] h1")?.textContent).toBe("gifts for Her");
  });

  it("a guide that holds nothing is in no row, search or menu; its own link opens Picks coming soon and related guides", () => {
    // Lead 2026-11-18 (live: 384 of 469 guides opened "Picks coming soon"). Proven red: drop the `!g.empty` filter in
    // guidesIn or searchGuides and the empty guide is listed again.
    const empty = GUIDES.filter((g) => g.empty);
    const holding = GUIDES.filter((g) => !g.empty);
    // Follow-up 1120: 50+ holding picks, measured 2026-11-20; owner 11-21: the live guides and their views (14).
    expect(holding.length).toBeGreaterThan(2);
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
    const probe: CatalogGuide = { ...guideBySlug("her")!, slug: "probe-empty", picks: [], links: [], deals: undefined, empty: true };
    const { container } = render(<MemoryRouter><GiftGuideView guide={probe} /></MemoryRouter>);
    expect(container.querySelector("[data-gift-coming-soon]")?.textContent).toContain("Picks coming soon");
    expect(container.querySelector("[data-gift-list]")).toBeNull();
    const related = [...container.querySelectorAll("[data-gift-related] a[data-gift-tile]")].map((a) => a.getAttribute("data-gift-tile")!);
    expect(related.length).toBeGreaterThan(0);
    for (const r of related) expect(guideBySlug(r)?.empty, r).toBeUndefined();
    cleanup();
    expect(renderAt("/gift-guides/her").container.querySelector("[data-gift-coming-soon]")).toBeNull();
  });

  // Holiday audit 1121 #14: an old "See all" group link opens the landing itself (the group page drew an "All guides"
  // link beside the header's back arrow, a green dot and small tiles).
  it("an old See all group link opens the landing, with no second way back", () => {
    const { container } = renderAt("/gift-guides?group=by-person");
    expect(container.querySelector("[data-gift-row]")).toBeNull();
    expect(container.querySelector("a[data-gift-back]")).toBeNull();
    expect(container.querySelector("[data-gift-live-guides]")).not.toBeNull();
  });

  // Owner 11-21: "since it's just 3 guides now you don't really need to filter it, maybe just do for her, him, kids with
  // their color instead of the filter there"; then the covers swapped to Her beige, Him Christmas green, Kids Christmas red.
  it("the menu is three plain guide links with their cover's colour, no groups; the open guide (or its view's guide) is current; it shows on a phone too", () => {
    const { container } = renderAt("/gift-guides");
    // Owner 11-24 ~7:50 PM: the themed guides are Kids' subsections, a list nested in Kids' row (giftGuideSideThemes1124): Kids' row is the one disclosure.
    expect([...container.querySelectorAll("[data-gift-sidebar] summary")].map((s) => s.querySelector("a")?.getAttribute("data-gift-side"))).toEqual(["kids"]);
    const guides = [...container.querySelectorAll("[data-gift-side-guides] a")];
    // Guide consistency audit 1122 #19: My Wish List closes the group, as in the phone's menu sheet (no dot).
    expect(guides.map((a) => a.getAttribute("href"))).toEqual(["/gift-guides", "/gift-guides/her", "/gift-guides/him", "/gift-guides/kids", ...KIDS_THEME_GUIDES_1124.map((s) => `/gift-guides/${s}`), "/gift-guides/my-list"]);
    // Owner 2026-11-24: Monster Jam sits after Kids, green like its cover ("the green cover with the 6 images").
    // The kids themes; a store deals guide's row sits in Deals (samsClubBlackFriday1125).
    const dots = ["oat", "green", "red", ...KIDS_THEME_GUIDES_1124.map(() => "green")];
    expect(guides.slice(1, 4 + KIDS_THEME_GUIDES_1124.length).map((a) => a.querySelector("[data-gift-side-dot]")?.getAttribute("data-gift-side-dot"))).toEqual(dots);
    expect(guides.slice(1, 4 + KIDS_THEME_GUIDES_1124.length).map((a) => a.querySelector("[data-gift-side-dot]")?.className)).toEqual(dots.map((d) => `gg-dot gg-${d}`));
    expect(guides[4 + KIDS_THEME_GUIDES_1124.length].querySelector("[data-gift-side-dot]")).toBeNull();
    expect(container.querySelector('[data-gift-sidebar] a[aria-current="page"]')?.getAttribute("href")).toBe("/gift-guides");
    cleanup();
    for (const [url, cur] of [["/gift-guides/kids", "/gift-guides/kids"], ["/gift-guides/mom", "/gift-guides/her"], ["/gift-guides/dad", "/gift-guides/him"]]) {
      const view = renderAt(url).container;
      expect([...view.querySelectorAll('[data-gift-sidebar] a[aria-current="page"]')].map((a) => a.getAttribute("href")), url).toEqual([cur]);
      cleanup();
    }
    // Owner 11-21 ("We need a way to organize this on the phones"): a phone draws no sidebar at the page's foot; the
    // chip row and its menu sheet carry the menu (src/test/giftGuidesPhoneNav1121.test.tsx).
    expect(GIFT_GUIDES_CSS).toMatch(/@media \(max-width:767px\)\{[^@]*\.gg-side\{display:none\}/);
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-side\{order:2/);
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
      expect(container.querySelector("[data-gift-words] h1")?.textContent).toBe(`${thin[0].lead} ${thin[0].title}`);
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

  it("an old /gift-guides#<slug> pin opens that guide's page; an unknown slug falls back to the landing", () => {
    renderAt("/gift-guides#for-him");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/him");
    expect(screen.getByRole("heading", { level: 1, name: "gifts for Him" })).toBeTruthy();
    cleanup();
    renderAt("/gift-guides/for-mom");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/her"); // owner 11-21: Mom is no page; it forwards to Her
    cleanup();
    // 1120: Louisiana-Made is a section of Shop Small Louisiana; owner 11-21: that guide is retired. Lead 11-24: a pin opens
    // the same search page the server's 301 sends its address to (retiredGuideForward.ts); one with no match, the landing.
    renderAt("/gift-guides#louisiana-made");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides/louisiana-christmas-gifts");
    cleanup();
    renderAt("/gift-guides#golfer");
    expect(screen.getByTestId("where").textContent).toBe("/gift-guides");
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
      // Guides audit 1126: on a themed guide the owner's own rows (ownerAdd) lead each price section (GiftGuideView
      // ownerAddsFirst), so a row is matched to its pick by link and name, each pick drawn exactly once; the order itself
      // is pinned by giftGuidePrices1126 and giftGuidePriceSort1121.
      const unused = new Set(g.picks.map((_, k) => k));
      rows.forEach((li) => {
        const a = li.querySelector("a")!;
        const i = [...unused].find((k) => g.picks[k].href === a.getAttribute("href") && (a.textContent ?? "").includes(g.picks[k].name));
        expect(i, `${g.slug}: ${a.getAttribute("href")}`).toBeDefined();
        unused.delete(i!);
        const img = a.querySelector("img.gg-thumb");
        if (g.picks[i!].image) {
          expect(img?.getAttribute("loading")).toBe("lazy");
          expect(Number(img?.getAttribute("width"))).toBeGreaterThan(0);
          expect(Number(img?.getAttribute("height"))).toBeGreaterThan(0);
        } else {
          expect(img).toBeNull();
          expect(a.querySelector("[data-gift-letter]")?.textContent).toBe(storeLabel(g.picks[i!]));
        }
      });
      checked += 1;
      cleanup();
    }
    // Follow-up 1120: 49+ list guides measured 2026-11-20; owner 11-21: the live guides and their views (14).
    expect(checked).toBeGreaterThan(2);
    for (const slug of ["her", "him", "kids", "25-days-sponsors"]) {
      const g = guideBySlug(slug)!;
      const { container } = renderAt(`/gift-guides/${slug}`);
      expect(container.querySelector("[data-gift-words] h1")?.textContent, slug).toBe(`${g.age ? `${g.lead}, ${g.age}` : g.lead} ${g.title}`);
      // Owner 2026-11-21: "Remove show more just list everything." Every gift is drawn at once, with no Show more button
      // (was 50 rows, then 50 more per tap); off-screen cards skip their paint (content-visibility) and photos load lazily.
      // @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const upTo = picks.length;\n |   const upTo = Math.min(picks.length, 50);\n
      // Owner 11-21 (first price section open, the rest a tap away): every gift once each section is opened.
      openPriceSections(container);
      expect(container.querySelectorAll("ol[data-gift-list] > li[data-gift-pick]").length, slug).toBe(g.picks.length);
      expect(container.querySelector("[data-gift-more-picks]"), slug).toBeNull();
      expect(container.textContent, slug).not.toMatch(/Show more \(/);
      // Owner 11-18 PM ("double back button?? does the same thing"): one way back, the header's arrow, to All guides.
      expect(container.querySelector("a[data-gift-back]"), slug).toBeNull();
      expect(container.querySelector("[data-gift-back-to]")?.getAttribute("data-gift-back-to"), slug).toBe("/gift-guides");
      cleanup();
    }
  }, 90_000);

  it("every guide's palette is one of the three cover palettes; covers are the owner's files, two-way", () => {
    for (const g of GUIDES) expect(["green", "oat", "red"], g.slug).toContain(g.tint);
    // Owner 11-21: Her beige, Him Christmas green, Kids Christmas red (the covers); Mom is a view of Her, so beige.
    // @mutate src/content/giftGuideIndex.ts |   { group: "By person", tint: "oat", slug: "her", title: "Her", lead: "gifts for" }, |   { group: "By person", tint: "green", slug: "her", title: "Her", lead: "gifts for" },
    expect(["her", "him", "kids"].map((s) => guideBySlug(s)!.tint)).toEqual(["oat", "green", "red"]);
    // The banner's gingham is the covers' own colours (scripts/gift-guide-photo-covers.py FAMILY), not a faded overlay.
    const py = readFileSync("scripts/gift-guide-photo-covers.py", "utf8");
    for (const [fam, css] of [["green", "gg-green"], ["red", "gg-red"]] as const) {
      const m = new RegExp(`"${fam}": \\(\\((\\d+), (\\d+), (\\d+)\\), \\((\\d+), (\\d+), (\\d+)\\)`).exec(py)!;
      expect(m, fam).not.toBeNull();
      const rule = new RegExp(`\\.${css}\\{[^}]*`).exec(GIFT_GUIDES_CSS)![0];
      expect(rule, fam).toContain(`--c-cross:rgb(${m[1]} ${m[2]} ${m[3]})`);
      expect(rule, fam).toContain(`--c-band:rgb(${m[4]} ${m[5]} ${m[6]})`);
    }
    expect(guideBySlug("her")!.cover).toMatch(/^\/gift-guides\/covers\/her\.webp\?v=[0-9a-f]{8}$/); // Mom is a filter of Her (owner 11-20 evening) and shows Her's cover
    for (const g of GUIDES.filter((x) => x.cover)) expect(existsSync(`public${g.cover!.split("?")[0]}`), g.cover).toBe(true);
    // Two-way: every cover file shipped is some guide's cover, or a retired guide's (owner 11-21: kept for its return,
    // src/content/giftGuideLive.mjs), never a stray file.
    const used = new Set(GUIDES.map((g) => g.cover?.split("?")[0]));
    const files = readdirSync("public/gift-guides/covers");
    expect(files.length).toBeGreaterThan(40);
    // Dad and Mom are filter views of Him and Her (owner 11-20 evening); their cover files are the owner's and stay for the views.
    const VIEW_COVERS = new Set(["dad.webp", "mom.webp"]);
    const retired = new Set(RETIRED_SLUGS());
    for (const f of files) expect(used.has(`/gift-guides/covers/${f}`) || VIEW_COVERS.has(f) || retired.has(f.replace(/\.webp$/, "")), f).toBe(true);
  });

  it("every ShopMy collection is a guide's full-guide link or a guide of its own", () => {
    const linked = new Set(GUIDES.flatMap((g) => g.links.map((l) => l.href)));
    expect(SHOPMY_COLLECTIONS.length).toBeGreaterThan(40);
    // Workaholic (8988297) left the owner's list with the non-healthcare careers (REMOVED_GUIDES). Owner 11-21: a
    // collection of a retired guide has no live page to link it (src/content/giftGuideLive.mjs).
    const kept = SHOPMY_COLLECTIONS.filter((c) => c.id !== 8988297 && GUIDES.some((g) => g.links.some((l) => l.href === `https://shopmy.us/collections/${c.id}`)));
    expect(kept.length).toBeGreaterThan(0);
    for (const c of kept) expect(linked.has(`https://shopmy.us/collections/${c.id}`), c.label).toBe(true);
    // Each live guide's own collection is its "full guide" link (owner 11-21: a retired guide's collection may ride a
    // live guide's links, merged in, with no page of its own to label it).
    const labelled = new Set(GUIDES.flatMap((g) => g.links.filter((l) => l.label === `${SHOPMY_COLLECTIONS.find((c) => l.href.endsWith(`/${c.id}`))?.label} on ShopMy`).map((l) => l.href)));
    expect(labelled.size).toBeGreaterThan(0);
  });
});

describe("gift guides: links and disclosures on every view", () => {
  it("the disclosure and Amazon's statement show once each, at the bottom after the guides, as plain lines", () => {
    // Owner 11-22: one line, Amazon's statement a span inside the disclosure (so the disclosure's text is split by it).
    const disclosureLine = (_: string, el: Element | null) => el?.matches("[data-gift-disclosure]") === true && el.textContent === DISCLOSURE;
    for (const url of ["/gift-guides", "/gift-guides/golfer", "/gift-guides/for-her"]) {
      const { container } = renderAt(url);
      expect(screen.getAllByText(disclosureLine).length, url).toBe(1);
      expect(screen.getAllByText(AMAZON_STATEMENT).length, url).toBe(1);
      const last = container.querySelector("[data-gift-browse], [data-gift-row]:last-of-type, [data-gift-guide]")!;
      expect(last, url).toBeTruthy();
      for (const line of [screen.getByText(disclosureLine), screen.getByText(AMAZON_STATEMENT)]) {
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
    const SAMPLE = ["her", "store-amazon", "store-walmart", "gift-wrap-and-cards", "kids", "healthcare"];
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
          // The menu's Louisiana Holiday Hub entry (owner 11-21: moved from the landing's card to the left panel), and only that.
          if (href === "/holidays" && a.hasAttribute("data-gift-side-holiday-hub")) continue;
          // The menu's printables entries open one part of that page at its top (owner 11-21: "not the middle").
          if (/^\/gift-guides\/printables\?show=(tags|coloring|banners)$/.test(href) && a.hasAttribute("data-gift-side-printables")) continue;
          // 1120: a merged guide's section link carries its anchor ("/gift-guides/girls#girls-babies").
          expect(href, url).toMatch(/^\/gift-guides(?:\/[a-z0-9-]+(?:#[a-z0-9-]+)?|\/printables\/(?:gift-tags|coloring-books|banners)(?:#[a-z0-9-]+)?|\?group=[a-z-]+(?:#[a-z-]+)?|\?list=mine|#[a-z0-9-]+)?$/);
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
    // The own pages (the fun pages and the three deals days, owner 11-21: "each day has its own section") are in the
    // sitemap too, but are no catalog guide. The old one-page deals address is a redirect, never listed.
    const guides = listed.filter((x) => x !== "/gift-guides").map((x) => x.replace("/gift-guides/", "")).filter((s) => !OWN_PAGES.includes(s))
      // Search pages (owner 11-23): filtered views, no catalog guide; checked in src/test/guideSearchPages1123.test.ts.
      .filter((s) => !SEARCH_PAGES.some((p) => p.slug === s));
    expect(listed).toEqual(expect.arrayContaining(OWN_PAGES.map((s) => `/gift-guides/${s}`)));
    expect(listed).not.toContain(`/gift-guides/${DEALS_SLUG}`);
    expect(guides.length).toBe(4 + THEME_GUIDES_1124.length); // owner 11-21: Her, Him, Kids and the sponsors page (11-24: + the themed guides); the relationship pages 301 and are out of the sitemap
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
    // Each deals day (owner 2026-11-21) has its own head (src/test/giftGuideDeals1119.test.tsx).
    // My Wish List and a shared list (owner 2026-11-20) are noindex (src/test/giftWishList1120.test.tsx).
    expect(src("src/pages/info/GiftGuides.tsx")).toContain(': deals ? giftGuidePageMeta(deals.id) : sm && search ? sm.searchPageMeta(search) : guide ? guideHead(guide) : PUBLIC_PAGE_META["/gift-guides"],');
    // Owner 11-25 (search): a themed kids guide also passes its picks' prices and stores (src/test/themeGuideSearch1125.test.ts).
    expect(src("src/pages/info/GiftGuides.tsx")).toContain("return giftGuidePageMeta(guide.slug, guide.title, picks.slice(0, 3).map((p) => p.name), picks.length, themePicks);");
    const mom = giftGuidePageMeta("her");
    expect(mom.title).toBe("Gifts for her 2026: Christmas ideas under $25 & $50 | Louisiana Helpr");
    expect(mom.canonical).toBe("https://www.louisianahelpr.com/gift-guides/her");
    expect(mom.robots).toBeUndefined();
    expect(giftGuidePageMeta("kids").title).toBe("Christmas gifts for kids 2026: by age & price | Louisiana Helpr");
    // A guide not in the sitemap (empty, a hub, a thin store page) is noindex under its own title.
    // (Follow-up 1120: every shown guide is in the sitemap now; a probe stands in when none is left out.)
    const unlisted = GUIDES.find((g) => !GIFT_GUIDE_SEO[g.slug]) ?? { slug: "probe-unlisted", title: "Probe" };
    expect(unlisted).toBeTruthy();
    expect(giftGuidePageMeta(unlisted.slug, unlisted.title)).toMatchObject({ title: `${unlisted.title} gift guide | Louisiana Helpr`, robots: expect.stringMatching(/noindex/) });
    expect(Object.keys(GIFT_GUIDE_SEO).sort()).toEqual(guides.sort());
    for (const name of Object.values(GIFT_GUIDE_SEO)) expect(name).not.toMatch(/undefined/);
    // A "gifts for the" / "gifts for a" guide reads as one phrase (batch 11-19: og:title was "Gifts for the: Coffee
    // Lover: holiday gift guide 2026"). No name puts a colon after a dangling article. Owner 11-21: no live guide is a
    // "Gifts for the ..." one (Coffee Lover, Family and the rest are retired), so only the rule over every name stays.
    expect(Object.keys(GIFT_GUIDE_SEO).length).toBe(4 + THEME_GUIDES_1124.length); // + the themed guides (owner 11-24)
    for (const name of Object.values(GIFT_GUIDE_SEO)) expect(name).not.toMatch(/\b(the|a|an):/i);
    // Q178 (CI 11-18: /declutter/item/:id 418 -> 423 KB gz): the guides' name table stays out of publicPageMeta.mjs,
    // which Login, Signup, Index and the Declutter item page load cold; only GiftGuides.tsx and api/share.ts read it.
    // @mutate src/lib/publicPageMeta.mjs | import { townPageMetaFor } from "./townPages.mjs"; | import { townPageMetaFor } from "./townPages.mjs";\nimport { GIFT_GUIDE_SEO } from "../content/giftGuideSeo.mjs";
    expect(src("src/lib/publicPageMeta.mjs")).not.toMatch(/giftGuideSeo|giftGuidePageMeta/);
    expect(src("api/share.ts")).toContain('import { publicOrGiftGuidePageMetaFor as publicPageMetaFor } from "../src/lib/giftGuidePageMeta.mjs";');
    expect(publicOrGiftGuidePageMetaFor("/gift-guides/her", null)?.title).toBe("Gifts for her 2026: Christmas ideas under $25 & $50 | Louisiana Helpr");
    expect(publicOrGiftGuidePageMetaFor("/gift-guides/her/", null)?.title).toBe("Gifts for her 2026: Christmas ideas under $25 & $50 | Louisiana Helpr");
    expect(publicOrGiftGuidePageMetaFor("/browse", null)).toBe(PUBLIC_PAGE_META["/browse"]);
    const rewrites = (JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] }).rewrites;
    expect(rewrites.filter((x) => x.source.startsWith("/gift-guides"))).toEqual([
      { source: "/gift-guides", destination: "/api/share?_og=page&_id=gift-guides" },
      // The old one-page printables address only forwards (owner 2026-11-21: each kind its own page): noindex, its own head.
      { source: "/gift-guides/printables", destination: "/api/share?_og=noindex&_id=gift-guides/printables" },
      { source: "/gift-guides/:slug", destination: "/api/share?_og=page&_id=gift-guides/:slug" },
      // Each printables page (owner 2026-11-21): its own head and share card, then the SPA entry.
      { source: "/gift-guides/printables/gift-tags", destination: "/api/share?_og=page&_id=gift-guides/printables/gift-tags" },
      { source: "/gift-guides/printables/coloring-books", destination: "/api/share?_og=page&_id=gift-guides/printables/coloring-books" },
      { source: "/gift-guides/printables/banners", destination: "/api/share?_og=page&_id=gift-guides/printables/banners" },
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
      { source: "/gift-guides/printables/gift-tags", destination: "/index.html" },
      { source: "/gift-guides/printables/coloring-books", destination: "/index.html" },
      { source: "/gift-guides/printables/banners", destination: "/index.html" },
      // Holiday audit C (2026-11-20): a reveal link gets its own noindex preview card (api/share metaForSanta) first.
      { source: "/gift-guides/secret-santa/:code/:token", destination: "/api/share?_og=santa&_code=:code&_tok=:token" },
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
    // Holiday audit 1121 #31: the band names only the live guides (Her, Him, Kids), never the retired home or
    // Louisiana-made ones, should it come back.
    // @mutate src/components/landing/GiftGuidesBand.tsx | "Gift ideas for her, for him and for the kids." | "Gift ideas for her, for him, for the kids and for the home, plus Louisiana-made favorites."
    expect(screen.getByTestId("landing-gift-guides").textContent).not.toMatch(/home|Louisiana-made/);
    expect(sponsorPage.links.giftGuides).toBe("/gift-guides");
  });
});

describe("gift guides: blocked brands and the CJ input (lead 2026-11-18)", () => {
  it("SheVibe, King Palm, AnyListingSEO, Loren and Restoro never reach a guide, store page or deal; _cj.json is read", () => {
    expect([...BLOCKED_BRANDS]).toEqual(["SheVibe", "King Palm", "AnyListingSEO", "Loren", "Restoro", "Yeloly", "Serika", "Parallels", "HerbsPro", "ZazzMode", "NordVPN", "Surfshark", "Keeper Security", "NordPass", "hide.me", "Intego", "Corel", "Clip Studio Paint", "Daz 3D", "Wondershare", "Roxio", "Pinnacle Studio", "Lalal.ai", "Ashampoo", "AOMEI", "PandaOffice", "Jalbum", "O&O Software", "Abelssoft", "Paragon Software", "GearUP", "YUPLAY", "Whokeys", "DirectDeals", "Hero Wars", "Skytours", "Oojo", "Cheapvuelos", "Ovago", "HopeGoo", "Air India", "Ocean Hotels", "Rent Cars", "VIP Cars", "Carla Car Rental", "RVshare", "Undercover Tourist", "PARISCityVISION", "Ying Mart", "YingMart", "Brooklyn Delhi", "eCreamery", "AimHave", "Minteefy", "Mosaic Weighted Blankets", "Dragontree", "Dragontree Apothecary", "Deme by Gabriella", "Deme", "CHORD", "Life is Good", "The Jacket Maker", "Diamond Art Club", "Lubiwood", "nixplay", "onn.", "Mainstays", "Hyper Tough", "Holiday Time", "Better Homes & Gardens", "Better Homes and Gardens", "Great Value", "Time and Tru", "DiecastModelsWholesale", "Diecast Models Wholesale", "Kaiya Baby", "Magic Story", "TechPals", "ZonliHome", "Zonli", "Kitty Kick Stix", "Makerfire", "Bonne et Filou", "The Fort Kit", "Cocinare", "Maker Wine", "Magic Makers", "The Fidget Company", "Gisada", "Imarku", "TOUCHBeauty", "Baleaf", "SILK THE RICH", "True Beauty Lashes", "Cashmere Boutique", "MelodySusie", "Lofree", "AndaSeat", "Xplora", "Byrokko", "Frost Buddy", "Forte Chocolate", "TempSpike", "TempPro", "Hairmax", "AmScope", "Adagio Teas", "Free Country", "BADESOFA", "Literie", "Ozark Trail",
      "Kendra Scott", "Labubu", "Smiski", "Sonny Angel", "Lovesac", "Fishwife", "Lilly Pulitzer", "Lily Pulitzer", "Vineyard Vines"]);
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
  // Owner: "add the number in parentheses on the right of By Person" (the group pages' count). Holiday audit 1121 #14:
  // the group pages are gone; every old group link, for every row, opens the landing (no group page, no count).
  // @mutate src/pages/info/GiftGuides.tsx |   if (landing && groupParam !== null) return | if (false) return
  it("every old group link opens the landing", () => {
    const Search = () => <p data-testid="search">{useLocation().search}</p>;
    const counts = new Map<string, number>();
    for (const { row } of ROWS) {
      const c = render(
        <MemoryRouter initialEntries={[`/gift-guides?group=${row}`]}>
          <Routes><Route path="/gift-guides" element={<><GiftGuides /><Search /></>} /></Routes>
        </MemoryRouter>,
      ).container;
      // The address drops ?group= (a shared or pinned link reads as the landing it is).
      expect(c.querySelector("[data-testid=search]")?.textContent, row).toBe("");
      expect(c.querySelector(`section[data-gift-row="${row}"]`), row).toBeNull();
      expect(c.querySelector("[data-gift-row-count]"), row).toBeNull();
      counts.set(row, c.querySelectorAll("[data-gift-live-guides] a[data-gift-tile]").length);
      cleanup();
    }
    expect(counts.size).toBeGreaterThan(1); // 10 rows, 2026-11-21
    expect([...new Set(counts.values())]).toEqual([3]); // Her, Him, Kids only (owner 11-24 6:54 PM: themed guides show only inside Kids), from every old group link
  });
});

describe("gift guides: design audit round 2 UI fixes", () => {

  // @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   : pick.store === "shopmy" ? pick.brand ?? "" |   : pick.store === "shopmy" ? "ShopMy"
  it("#9 no pick says \"On ShopMy\"", () => {
    let checked = 0;
    for (const slug of ["her", "him", "kids"]) {
      const { container } = renderAt(`/gift-guides/${slug}`);
      expandAll(container);
      for (const li of container.querySelectorAll("li[data-gift-pick]")) expect(li.textContent, slug).not.toMatch(/On ShopMy/);
      checked += container.querySelectorAll("li[data-gift-pick]").length;
      cleanup();
    }
    expect(checked).toBeGreaterThan(20);
  });

  // @mutate src/content/giftGuideDealCounts.ts |   return sales.filter((x) => x.ends >= today && !seen.has(x.href) && Boolean(seen.add(x.href))); |   return sales.filter((x) => x.ends >= today);
  // Owner 2026-11-22 ("make everything open expanded"): a store's card lists every sale at once (no "+N more").
  it("#10 Sales: one line per link; a store's card shows every sale at once", () => {
    const dup = { slug: "store-walmart", store: "Walmart", offer: "x", href: "https://walmrt.us/x", ends: "2099-01-01" };
    expect(liveSales([dup, { ...dup }], "2026-11-18")).toHaveLength(1);
    const many = Array.from({ length: 20 }, (_, i) => ({ ...dup, href: `https://walmrt.us/${i}` }));
    const c = render(<MemoryRouter><SaleCards stores={[{ store: "Walmart", sales: many }]} /></MemoryRouter>).container;
    expect(c.querySelectorAll("[data-gift-sale-store]").length).toBe(1);
    expect(c.querySelector("[data-gift-sale-more]")).toBeNull();
    expect(c.querySelectorAll("[data-gift-sale]").length).toBe(20);
  });

  // Owner redesign 11-18 PM ("share text search list codes is too much buttons right here"): ONE slim row under every
  // title, at every width: the search field, My list (an icon with its count) and Share (an icon). No pill buttons.
  // @mutate src/pages/info/giftGuides/GuidesTop.tsx |         {toolsInRow && tools}\n |         {null}\n
  // @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       {heart && <MyListIcon current={myList} />}\n |       <a href="#codes">Codes</a>\n      {heart && <MyListIcon current={myList} />}\n
  it("#15 / redesign: the tool row under the title is search, My list and Share, nothing else", () => {
    for (const url of ["/gift-guides", "/gift-guides/her", "/gift-guides/store-walmart"]) {
      const { container } = renderAt(url);
      // Owner 11-21: the row under the header holds the one tool row.
      const head = container.querySelector("[data-gift-headrow]")!;
      const quick = head.querySelector("[data-gift-quick]")!;
      expect(container.querySelectorAll("[data-gift-quick]").length, url).toBe(1);
      expect(quick, url).not.toBeNull();
      expect(quick.getAttribute("aria-label"), url).toBe("Gift guide tools");
      // Owner 11-21 ("make search an icon always"): the search is a magnifier icon (no field until tapped).
      expect(quick.querySelector("input"), url).toBeNull();
      const controls = [...quick.querySelectorAll("a, button")].filter((el) => !el.closest("[data-gift-search-results]"));
      // Owner 11-21: an owner-list guide (Mom is Her's view) adds the price sort menu to the tool row, named "Sort" (one name
      // per sliders action, consistency audit 1122 #6).
      expect(controls.map((el) => el.getAttribute("aria-label")), url).toEqual(url === "/gift-guides/her" ? ["Search gift guides", "Sort", "My Wish List, 0 saved", "Share"] : ["Search gift guides", "My Wish List, 0 saved", "Share"]);
      expect(controls[0].className, url).toMatch(/\bgg-icon\b/);
      const share = controls[controls.length - 1];
      // Icons only: 44px tap targets (RoundIconButton w-11 h-11; .gg-icon 44px), and no visible words.
      expect(share.className, url).toMatch(/\bw-11\b.*\bh-11\b/);
      expect(GIFT_GUIDES_CSS).toMatch(/\.gg-icon\{[^}]*width:44px;height:44px/);
      expect(share.textContent, url).toBe("");
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
    const { container } = renderAt("/gift-guides/her");
    const share = screen.getByRole("button", { name: "Share" });
    expect(share.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-gift-share-menu]")).toBeNull();
    fireEvent.click(share);
    const menu = container.querySelector("[data-gift-share-menu]")!;
    expect(share.getAttribute("aria-expanded")).toBe("true");
    // jsdom has no navigator.share: no third item.
    expect([...menu.querySelectorAll("[role=menuitem]")].map((x) => x.textContent)).toEqual(["Copy link", "Text this guide", "Facebook", "Pinterest"]);
    const text = menu.querySelector("a[data-gift-text]")!;
    expect(text.getAttribute("href")).toMatch(/^sms:[?&]body=.*https%3A%2F%2Fwww\.louisianahelpr\.com%2Fgift-guides%2Fher$/);
    fireEvent.click(menu.querySelector("[data-gift-copy-link]")!);
    expect(write).toHaveBeenCalledWith("https://www.louisianahelpr.com/gift-guides/her");
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
      expect(native).toHaveBeenCalledWith({ title: "Holiday gift guides", url: "https://www.louisianahelpr.com/gift-guides" });
    } finally {
      delete (navigator as { share?: unknown }).share;
    }
  });
});

describe("gift guides: no ShopMy collection lines on a guide page, no ShopMy/Pinterest links in the footer (owner 11-18 PM)", () => {
  // Owner: "you can remove this because my full guides are already here with the links" (Shop the full guide / More
  // on ShopMy), and "same for this" (Every collection on ShopMy / Every gift guide on Pinterest). The disclosures stay.
  // @mutate src/pages/info/giftGuides/GuidesDisclosure.tsx | <span data-gift-amazon-statement="">{G.amazonStatement}</span></p>\n | <span data-gift-amazon-statement="">{G.amazonStatement}</span></p>\n      <p className="gg-more"><a href="https://shopmy.us/shop/lexilombas">Every collection on ShopMy</a></p>\n
  it("Her, Him, Dad and a store page show neither line; the footer keeps the one disclosure line and no other link", () => {
    let pages = 0;
    for (const slug of ["her", "him", "dad", "store-walmart"]) {
      const { container } = renderAt(`/gift-guides/${slug}`);
      expect(container.textContent, slug).not.toMatch(/Shop the full guide|More on ShopMy|Every collection on ShopMy|Every gift guide on Pinterest/);
      const foot = container.querySelector("footer.gg-disc")!;
      expect(foot.querySelector("[data-gift-disclosure]")?.textContent, slug).toBe(giftGuides.disclosure);
      expect(foot.querySelector("[data-gift-amazon-statement]")?.textContent, slug).toBe(AMAZON_STATEMENT);
      // Owner 11-22: one line (one paragraph) holding both; Amazon's statement inside it.
      expect(foot.querySelectorAll("p").length, slug).toBe(1);
      expect(foot.querySelector("[data-gift-disclosure] > [data-gift-amazon-statement]"), slug).not.toBeNull();
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
    // The landing's By budget row: none while the budget guides are retired (owner 11-21, src/content/giftGuideLive.mjs).
    expect(guidesIn("by-budget").map((g) => g.slug)).toEqual([]);
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
    // Holiday audit B (11-20), measured: 291 after B's cuts (was 300+).
    expect(amazonCdn).toBeGreaterThan(100); // owner standard 11-20 (Healthcare by use): 248 measured
    // Brand-site photos (lead 11-18 PM): a photo-less Amazon pick takes the brand's own photo of the same product from
    // amazon-brand-images.json, its Amazon link kept (179 rows from 45 ASINs, measured 2026-11-18).
    // @mutate scripts/gift-guide-picks.mjs | if (!hasOwn && brand?.source === "brand-site" | if (false && brand?.source === "brand-site"
    let brandSite = 0;
    for (const list of Object.values(RESEARCHED_PICKS)) for (const p of list) if (/^https:\/\/www\.amazon\.com\//.test(p.href) && p.image && !p.image.startsWith("https://m.media-amazon.com/")) brandSite += 1;
    expect(brandSite).toBeGreaterThan(5); // owner's standard plan (11-20 evening, 49 guides by use): measured 2026-11-20 night (7); // one guide per product (owner 11-19); 22 after the Amazon page kept its 15 best (1530 train); 12 after the train 1120b re-audit cuts
    // Floor re-measured 2026-11-18 after design audit r2 dropped page titles, store names and promos (4,397 photos).
    expect(photos).toBeGreaterThan(900); // owner's standard plan (11-20 evening, 49 guides by use): measured 2026-11-20 night (965); // audits A+B combined (11-20): 1,402 to 1,456 rows measured on ~30 guides + 26 store pages
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
