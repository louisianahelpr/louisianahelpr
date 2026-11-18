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
 * @mutate src/pages/info/GiftGuides.tsx | {guide ? <GiftGuideView guide={guide} /> : <GiftGuideLanding group={group} />}{footer} | {footer}{guide ? <GiftGuideView guide={guide} /> : <GiftGuideLanding group={group} />}
 * @mutate src/content/giftGuideCatalog.ts |   return { row: rowId(group), label: group, tint }; |   return { row: rowId(group), label: group, tint: "oat" as GuideTint };
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx | <Link to={`/gift-guides/${g.slug}`} | <Link to={`/gift-guides#${g.slug}`}
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <details key={row} open={row === active?.row} | <details key={row} open
 * @mutate src/content/giftGuideCatalog.ts |     ...(children ? { children } : {}), | 
 * @mutate src/content/giftGuideCatalog.ts | (g.parent ? g.parent === KIDS_HUB : g.slug !== KIDS_HUB) | !g.parent
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx | <Link to={`/gift-guides?group=${row}`} | <Link to="/gift-guides"
 * @mutate src/content/giftGuideCatalog.ts | 8978491: "mom", | 8978491: "nowhere", 
 * @mutate src/content/giftGuideCatalog.ts | 9000047: "gardener", | 9000047: "no-guide", 
 * @mutate src/content/giftGuideCatalog.ts | "for-him": "him", | "for-him": "him-x",

 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx | loading="lazy" decoding="async" data-gift-cover | decoding="async" data-gift-cover
 * @mutate src/pages/info/GiftGuides.tsx |   const { slug } = useParams<{ slug?: string }>(); |   const slug = undefined as string \| undefined; useParams();
 * @mutate src/pages/info/GiftGuides.tsx |   if (!slug && fromHash) return | if (!slug && fromHash && false) return
 * @mutate src/pages/info/GiftGuides.tsx |   if (moved) return | if (moved && false) return
 * @mutate src/pages/info/GiftGuides.tsx | {guide && <Link to="/gift-guides" className="gg-link" | {guide && <Link to="/gift-guides/" className="gg-link"
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | loading="lazy" decoding="async" /> | decoding="async" />
 * @mutate src/content/giftGuidesAmazon.ts | ["8Bitdo Retro Mechanical Keyboard", "https://www.amazon.com/dp/B0DKXH5WCD?tag=louisianahelpr-20"], | ["8Bitdo Retro Mechanical Keyboard", "https://www.amazon.com/dp/B0DKXH5WCD?tag=hggguidepage-20"],
 * @mutate src/content/giftGuideCatalog.ts |   return hit; |   return "amazon" as GiftStore;
 * @mutate src/content/giftGuides.ts | const shopmy = (id: number) => `https://shopmy.us/collections/${id}`; | const shopmy = (id: number) => `http://shopmy.us/collections/${id}`;
 * @mutate src/App.tsx |       <Route path="/gift-guides/:slug" element={<RouteErrorBoundary> |       <Route path="/gift-guides/:slug" element={<ProtectedRoute><RouteErrorBoundary>
 * @mutate src/pages/info/GiftGuides.tsx | "gg w-full" | "gg page-column"
 * @mutate src/content/giftGuides.ts |   for (const c of [...codes].sort((a, b) => a.rank - b.rank)) stores.set(c.store, [...(stores.get(c.store) ?? []), c]); |   for (const c of codes) stores.set(`${c.store} ${c.code}`, [c]);
 * @mutate src/content/giftGuideCatalog.ts |   const to = MERGED_GUIDES[s]?.[0] ?? s; |   const to = s;
 * @mutate src/content/giftGuideCatalog.ts | picks: uniqueByHref([...d.picks, ...src.picks]) | picks: [...d.picks, ...src.picks, ...src.picks]
 * @mutate src/content/giftGuides.ts | export const activeCodes = (codes: DiscountCode[], today: string) => codes.filter((c) => !c.expires \|\| c.expires >= today); | export const activeCodes = (codes: DiscountCode[], today: string) => codes.filter((c) => today === today);
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |   if (codes.length === 0) return null; |   if (codes.length === 0) return <details data-gift-codes="" />;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | {!guide.children && guide.picks.length === 0 && guide.links.length === 0 && ( | {false && (
 * @mutate src/content/giftGuideCatalog.ts | export const REMOVED_GUIDES = ["last-minute-gifts", | export const REMOVED_GUIDES = ["nothing",
 * @mutate src/pages/info/GiftGuides.tsx | <GiftGuidesWords lead={guide.lead} title={guide.title} | <GiftGuidesWords lead={guide.lead} title={guide.slug}
 * @mutate src/pages/info/Index.tsx |       <SectionsShowcase />\n |       <SectionsShowcase />\n      <GiftGuidesBand />\n
 * @mutate src/components/Footer.tsx |               <Link to="/safety" className={FOOTER_LINK}> |               <Link to="/gift-guides" className={FOOTER_LINK}>
 * @mutate src/components/sponsor/Sections.tsx |         <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>\n |         <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>\n        <Link to={C.links.giftGuides}>{C.footer.giftGuidesLink}</Link>\n
 * @mutate src/content/giftGuideIndex.ts |   { group: "By store", tint: "green", slug: "store-amazon", title: "Amazon", lead: "shop" }, |   { group: "By store", tint: "green", slug: "store-shopmy", title: "ShopMy", lead: "shop" },\n  { group: "By store", tint: "green", slug: "store-amazon", title: "Amazon", lead: "shop" },
 * @mutate src/content/giftGuideIndex.ts | { group: "By career", tint: "oat", slug: "stay-at-home-parents" | { group: "Life moments", tint: "oat", slug: "stay-at-home-parents"
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx |         {g.age && <span className="gg-count">{g.age}</span>} |         <span className="gg-count">{g.age ?? ""}{g.picks.length} picks</span>
 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx |       <h2 id={titleId}>{title}</h2>\n |       <h2 id={titleId}>{title}</h2>\n      <p className="gg-line">25 picks</p>\n
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
import { giftGuides, BRAND_SITES, SHOPMY_COLLECTIONS, activeCodes, codesByStore, discountCodes } from "@/content/giftGuides";
import { DiscountCodes } from "@/pages/info/giftGuides/GiftGuidesSidebar";
import { AMAZON_GUIDES } from "@/content/giftGuidesAmazon";
import { GUIDE_INDEX } from "@/content/giftGuideIndex";
import { GUIDES, ROWS, STORES, AMAZON_TAG, KIDS_HUB, MERGED_GUIDES, OLD_SLUGS, REMOVED_GUIDES, guidesIn, childrenOf, guideBySlug, storeOf, unplacedGuides } from "@/content/giftGuideCatalog";
import { PUBLIC_PAGE_META, NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { sponsorPage } from "@/content/sponsorPage";

afterEach(cleanup);

const src = (p: string) => blankComments(readFileSync(p, "utf8"));
const DISCLOSURE = "Some links are affiliate links. We may earn a small share of the sale at no extra cost to you.";
const AMAZON_STATEMENT = "As an Amazon Associate, Louisiana Helpr earns from qualifying purchases.";
const ROW_LABELS = ["By person", "For kids", "By budget", "Louisiana", "Experiences", "Hobbies", "By career", "Life moments", "Pets", "Colors", "By store"];
// @two-way src/test/giftGuidesPage.test.tsx:stale allowed host
const ALLOWED_HOSTS = ["shopmy.us", "www.pinterest.com", "www.amazon.com", "amazon.com", "amzn.to", ...BRAND_SITES];
const isAmazon = (href: string) => ["www.amazon.com", "amazon.com", "amzn.to"].includes(new URL(href).hostname);

const picks = GUIDES.flatMap((g) => g.picks);
const contentLinks = [
  ...giftGuides.allLinks.map((l) => l.href),
  ...giftGuides.sections.flatMap((s) => [s.shop.href, ...s.more.map((m) => m.href), ...s.picks.map((p) => p.href)]),
  ...AMAZON_GUIDES.flatMap((g) => g.items.map(([, href]) => href)),
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
    expect(Object.keys(STORES).sort()).toEqual(["amazon", "diecast", "shopmy", "zchocolat"]);
  });

  it("syncs the owner's 2026-11-18 list: Experiences after Louisiana, Stay-at-Home Parents, Gift Wrap after Stocking Stuffers, no ShopMy store tile", () => {
    const rows = ROWS.map((r) => r.label);
    expect(rows.indexOf("Experiences")).toBe(rows.indexOf("Louisiana") + 1);
    expect(guidesIn("experiences").map((g) => g.slug)).toEqual([
      "gift-cards", "louisiana-restaurants", "swamp-and-bayou-tours", "spa-days", "date-night", "concerts-and-events", "classes-and-workshops", "subscriptions", "family-fun-days",
    ]);
    expect(guideBySlug("stay-at-home-parents")?.row).toBe("by-career");
    const budget = guidesIn("by-budget").map((g) => g.slug);
    expect(budget.indexOf("gift-wrap-and-cards")).toBe(budget.indexOf("stocking-stuffers") + 1);
    // The By store row is the list's store entries, in its order (Louisiana popularity).
    const listed = GUIDE_INDEX.filter((g) => g.group === "By store").map((g) => g.slug);
    expect(listed.length).toBeGreaterThan(200);
    expect(guidesIn("by-store").map((g) => g.slug)).toEqual(listed);
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
      expect(childrenOf(guideBySlug(who)!).map((c) => c.slug)).toEqual(GUIDE_INDEX.filter((x) => x.parent === who).map((x) => x.slug));
      expect(childrenOf(guideBySlug(who)!).length).toBe(5);
    }
    for (const empty of REMOVED_GUIDES) expect(guideBySlug(empty), empty).toBeUndefined();
    expect(unplacedGuides()).toEqual([]);
    expect(guideBySlug("girls-toddlers")!.age).toBe("ages 1–3");
    // The old For Kids section's picks (Toddlers collection) lead the gender-neutral Toddlers guide, so nothing was lost.
    for (const p of giftGuides.sections.find((x) => x.id === "for-kids")!.picks) {
      expect(guideBySlug("gender-neutral-toddlers")!.picks.map((x) => x.name)).toContain(p.name);
    }
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
    const top = ROWS.flatMap((r) => GUIDES.filter((g) => g.row === r.row && (g.parent ? g.parent === KIDS_HUB : g.slug !== KIDS_HUB)));
    const { container } = renderAt("/gift-guides");
    const rows = [...container.querySelectorAll("[data-gift-row]")];
    expect(rows.map((r) => r.querySelector("h2")?.textContent)).toEqual(ROW_LABELS);
    expect([...container.querySelectorAll("a[data-gift-see-all]")].map((a) => a.getAttribute("href"))).toEqual(ROWS.map((r) => `/gift-guides?group=${r.row}`));
    const tiles = [...container.querySelectorAll("a[data-gift-tile]")];
    expect(tiles.length).toBeGreaterThan(30);
    expect(tiles.map((a) => a.getAttribute("href"))).toEqual(top.map((g) => `/gift-guides/${g.slug}`));
    expect(container.querySelectorAll("[data-gift-pick]").length).toBe(0);
    for (const img of container.querySelectorAll("img.gg-cover")) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(Number(img.getAttribute("width"))).toBe(480);
      expect(Number(img.getAttribute("height"))).toBe(480);
    }
    expect(container.querySelectorAll("img.gg-cover").length).toBe(top.filter((g) => g.cover).length);
    // A guide with no cover gets a plain gingham tile with its name only (owner 2026-11-18: no footer text).
    const text = [...container.querySelectorAll("[data-gift-textcover]")];
    expect(text.length).toBe(top.filter((g) => !g.cover).length);
    for (const t of text) expect(t.textContent).not.toMatch(/LOUISIANA HELPR/i);
  });

  it("every header is compact: italic lead, title and a small Share pill; no subtitle, no pick count anywhere", () => {
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector(".gg-band")).toBeNull();
    const words = container.querySelector("[data-gift-words]");
    expect([...(words?.children ?? [])].map((c) => c.textContent)).toEqual(["top-rated finds", "Holiday Gift Guides", "Share"]);
    // Owner 2026-11-18: no "25 picks" count and no subtitle under any title; a tile is its cover and its name (a kids
    // age guide keeps its age band).
    const tiles = [...container.querySelectorAll("a[data-gift-tile]")];
    expect(tiles.length).toBeGreaterThan(100);
    for (const t of tiles) {
      const g = guideBySlug(t.getAttribute("data-gift-tile")!)!;
      expect(t.textContent, g.slug).toBe(`${g.title}${g.age ?? ""}`);
    }
    expect(container.textContent).not.toMatch(/\d+ picks?\b|\d+ guides\b|Coming soon|On ShopMy/);
    cleanup();
    const wordsOf = (path: string) => [...(renderAt(path).container.querySelector("[data-gift-words]")?.children ?? [])].map((c) => c.textContent);
    expect(wordsOf("/gift-guides/mom")).toEqual(["gifts for", "Mom", "Share"]);
    cleanup();
    cleanup();
    const mom = renderAt("/gift-guides/mom").container;
    expect(mom.querySelector(".gg-band")).toBeNull();
    expect(mom.querySelector("[data-gift-words] h2")?.textContent).toBe("Mom");
  });

  it("a guide with no picks yet opens Picks coming soon (no list, no dead link); its tile shows no count", () => {
    const empty = GUIDES.filter((g) => !g.children && !g.parent && g.picks.length === 0 && g.links.length === 0);
    expect(empty.length).toBeGreaterThan(5);
    const { container } = renderAt(`/gift-guides/${empty[0].slug}`);
    expect(container.querySelector("[data-gift-coming-soon]")?.textContent).toContain("Picks coming soon");
    expect(container.querySelector("[data-gift-list]")).toBeNull();
    cleanup();
    const landing = renderAt("/gift-guides").container;
    expect(landing.querySelector(`a[data-gift-tile="${empty[0].slug}"]`)?.textContent).toBe(empty[0].title);
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
    for (const hub of ["healthcare", "oilfield-and-trades", "service-industry", "educators", "first-responders", "military"]) {
      const g = guideBySlug(hub)!;
      expect(g?.row, hub).toBe("by-career");
      expect(childrenOf(g).length, hub).toBeGreaterThan(4);
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
    expect(activeCodes(discountCodes, "2026-11-24").map((c) => c.code)).not.toContain("PD50");
    expect(activeCodes(discountCodes, "2026-11-23").map((c) => c.code)).toContain("PD50");
    expect(activeCodes(discountCodes, "2026-12-07").map((c) => c.code)).not.toContain("CYBER");
    expect(discountCodes.find((c) => c.code === "CYBER")?.dates).toBe("Nov 29 – Dec 6");
    expect(render(<MemoryRouter><DiscountCodes codes={[]} /></MemoryRouter>).container.querySelector("[data-gift-codes]")).toBeNull();
    cleanup();
    // At the top of the menu.
    const side = renderAt("/gift-guides").container.querySelector("[data-gift-sidebar]")!;
    expect(side.firstElementChild?.hasAttribute("data-gift-codes")).toBe(true);
    cleanup();
    const write = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: write } });
    // Ranked by Louisiana popularity; a store with two codes is one box with both.
    expect(codesByStore(discountCodes).map((x) => x.store)).toEqual(["Muck Boot", "Durango Boots", "Magnifique", "Free Country", "Bruno Marc", "HerbsPro", "Parallels Desktop"]);
    const both = render(<MemoryRouter><DiscountCodes codes={discountCodes} /></MemoryRouter>).container;
    expect(both.querySelectorAll('[data-gift-code-store="Parallels Desktop"]').length).toBe(1);
    expect([...both.querySelectorAll('[data-gift-code-store="Parallels Desktop"] [data-gift-code]')].map((x) => x.getAttribute("data-gift-code"))).toEqual(["PD50", "PD35"]);
    cleanup();
    const { container } = render(<MemoryRouter><DiscountCodes codes={[{ rank: 1, store: "Example Shop", code: "TEST10", offer: "10% off" }]} /></MemoryRouter>);
    expect(container.querySelector('[data-gift-code-store="Example Shop"]')?.textContent).toContain("TEST10");
    fireEvent.click(screen.getByRole("button", { name: "Copy TEST10" }));
    expect(write).toHaveBeenCalledWith("TEST10");
  });

  it("Female and Male Nurses fold into RNs, LPNs and CNAs (each pick once), and their old links open RNs", () => {
    for (const gone of Object.keys(MERGED_GUIDES)) expect(guideBySlug(gone), gone).toBeUndefined();
    for (const t of ["rns", "lpns", "cnas"]) {
      const g = guideBySlug(t)!;
      expect(g.picks.length, t).toBeGreaterThan(10);
      expect(new Set(g.picks.map((p) => p.href)).size, t).toBe(g.picks.length);
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
    let checked = 0;
    for (const g of GUIDES.filter((x) => !x.children)) {
      const { container } = renderAt(`/gift-guides/${g.slug}`);
      expect(screen.getByRole("heading", { level: 2, name: g.title })).toBeTruthy();
      expect(container.querySelector("[data-gift-words] h2")?.textContent, g.slug).toBe(g.title);
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
          expect(a.querySelector("[data-gift-letter]")?.textContent).toBe(g.picks[i].name.trim().charAt(0).toUpperCase());
        }
      });
      const back = container.querySelector("a[data-gift-back]");
      expect(back?.getAttribute("href")).toBe("/gift-guides");
      expect(back?.textContent).toContain("All guides");
      expect(back!.compareDocumentPosition(container.querySelector("[data-gift-words]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      checked += 1;
      cleanup();
    }
    expect(checked).toBeGreaterThan(50);
  });

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
    for (const url of ["/gift-guides", ...GUIDES.map((g) => `/gift-guides/${g.slug}`)]) {
      const { container } = renderAt(url);
      for (const a of container.querySelectorAll("a")) {
        const href = a.getAttribute("href") ?? "";
        if (href.startsWith("/")) {
          expect(href, url).toMatch(/^\/gift-guides(?:\/[a-z0-9-]+|\?group=[a-z-]+)?$/);
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
  });

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

  it("is noindex before and after JavaScript and out of the sitemap; vercel.json gives /gift-guides its noindex head, and both paths the app (a guide page sets noindex once its JavaScript runs)", () => {
    expect(readFileSync("public/sitemap.xml", "utf8")).not.toContain("/gift-guides");
    expect(Object.keys(PUBLIC_PAGE_META)).not.toContain("/gift-guides");
    expect(NOINDEX_PAGE_META["/gift-guides"].robots).toMatch(/noindex/);
    expect(src("src/pages/info/GiftGuides.tsx")).toContain('usePageMeta(NOINDEX_PAGE_META["/gift-guides"]);');
    const rewrites = (JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] }).rewrites;
    expect(rewrites.filter((x) => x.source.startsWith("/gift-guides"))).toEqual([
      { source: "/gift-guides", destination: "/api/share?_og=noindex&_id=gift-guides" },
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
