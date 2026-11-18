/**
 * Owner 2026-11-16 ("i think we should add this to our landing pages on louisiana helpr so people can see our gift
 * guides"; pop-up "New gift guide page"): a public /gift-guides page with picks and affiliate links, reachable from
 * the landing pages.
 *
 * THE CLASS: an affiliate page that hides its disclosure, leaks a link without rel="sponsored", goes private, or has
 * no way in. Checked from the content inventory (src/content/giftGuides.ts) and the rendered page:
 *   1. the route is public (no ProtectedRoute), routed by vercel.json before the catch-all, indexed (sitemap, own head,
 *      no noindex) [still noindex, see below];
 *   2. the FTC disclosure (16 CFR Part 255) renders once, word for word, as a plain muted line at the BOTTOM, after
 *      the last section (owner decision 2026-11-18 ~8:50 AM, made after the lead explained the FTC guidance and the
 *      affiliate-program risk; it sat above the first link until then);
 *   3. EVERY anchor on the page is sponsored + noopener and opens a new tab, and every content link is drawn;
 *   4. content links are https on shopmy.us / pinterest.com / an approved brand site, picks carry no price, images are lazy with a fixed size;
 *   5. the landing (Index.tsx), the public footer and the /25days footer each link to /gift-guides.
 *
 * OWNER 2026-11-17 hid the page behind ?preview=1; OWNER 2026-11-18 made it public again (Pinterest pins link to
 * /gift-guides#<section id>, so every section carries its guide slug as its id). Still inverted from 1 and 5: it is
 * noindex and out of the sitemap, and the landing card, the public footer link and the /25days footer link are gone. vercel.json still gives it the app shell, as every App.tsx route gets
 * (unknownUrlsAnswer404). The page code and its content stay, and 2-4 still hold for the page itself.
 *
 * @mutate src/pages/info/GiftGuides.tsx | rel="sponsored noopener" | rel="noopener"
 * @mutate src/pages/info/GiftGuides.tsx | target="_blank" rel= | rel=
 * @mutate src/pages/info/GiftGuides.tsx |           {G.disclosure}\n |           {null}\n
 * @mutate src/pages/info/GiftGuides.tsx |         {G.sections.map((s) => <Section key={s.id} s={s} />)}\n | \n
 * @mutate src/pages/info/GiftGuides.tsx | <section id={s.id} aria-labelledby | <section aria-labelledby
 * @mutate src/pages/info/GiftGuides.tsx |   useScrollToHashSection(useLocation().hash);\n | \n
 * @mutate src/pages/info/GiftGuides.tsx |           loading="lazy" |           loading="eager"
 * @mutate src/pages/info/Index.tsx |       <SectionsShowcase />\n |       <SectionsShowcase />\n      <GiftGuidesBand />\n
 * @mutate src/components/Footer.tsx |               <Link to="/safety" className={FOOTER_LINK}> |               <Link to="/gift-guides" className={FOOTER_LINK}>
 * @mutate src/components/sponsor/Sections.tsx |         <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>\n |         <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>\n        <Link to={C.links.giftGuides}>{C.footer.giftGuidesLink}</Link>\n
 * @mutate src/App.tsx |       <Route path="/gift-guides" element={<RouteErrorBoundary> |       <Route path="/gift-guides" element={<ProtectedRoute><RouteErrorBoundary>
 * @mutate src/pages/info/GiftGuides.tsx | xl:grid-cols-5" data-gift-grid | xl:grid-cols-3" data-gift-grid
 * @mutate src/pages/info/GiftGuides.tsx | "w-full space-y-section font-sans" | "page-column space-y-section font-sans"
 * @mutate src/pages/info/GiftGuides.tsx | <p className="text-ds-13 text-muted-foreground" data-gift-disclosure=""> | <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-ds-13 text-muted-foreground" data-gift-disclosure="">
 * @mutate src/content/giftGuides.ts | const shopmy = (id: number) => `https://shopmy.us/collections/${id}`; | const shopmy = (id: number) => `http://shopmy.us/collections/${id}`;
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { GiftGuidesBand, GIFT_GUIDES_PATH } from "@/components/landing/GiftGuidesBand";
import { giftGuides, BRAND_SITES } from "@/content/giftGuides";
import { PUBLIC_PAGE_META, NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { sponsorPage } from "@/content/sponsorPage";

afterEach(cleanup);

const src = (p: string) => blankComments(readFileSync(p, "utf8"));
const DISCLOSURE = "Some links are affiliate links. We may earn a small share of the sale at no extra cost to you.";
const SECTION_TITLES = ["For Her", "For Him", "For Kids and Little Ones", "For the Home", "Stocking Stuffers", "Louisiana-made"];

const contentLinks = [
  ...giftGuides.allLinks.map((l) => l.href),
  ...giftGuides.sections.flatMap((s) => [s.shop.href, ...s.more.map((m) => m.href), ...s.picks.map((p) => p.href)]),
];
const picks = giftGuides.sections.flatMap((s) => s.picks);

describe("gift guides: the content inventory", () => {
  it("has the six owner-named sections, in order", () => {
    expect(giftGuides.sections.map((s) => s.title)).toEqual(SECTION_TITLES);
  });

  it("every link is https on shopmy.us, pinterest.com or an approved brand site; picks carry an image and no price", () => {
    expect(contentLinks.length).toBeGreaterThan(20);
    expect(picks.length).toBeGreaterThan(5);
    for (const href of contentLinks) {
      const u = new URL(href);
      expect(u.protocol, href).toBe("https:");
      expect(["shopmy.us", "www.pinterest.com", ...BRAND_SITES], href).toContain(u.hostname);
    }
    for (const p of picks) {
      expect(new URL(p.image).protocol, p.name).toBe("https:");
      expect(`${p.name} ${p.line}`, p.name).not.toMatch(/\$\s?\d/);
    }
  });

  it("the disclosure says plainly that links are affiliate links and we may earn from them", () => {
    expect(giftGuides.disclosure).toBe(DISCLOSURE);
  });
});

describe("gift guides: the rendered page", () => {
  const renderPage = () => render(<MemoryRouter><GiftGuides /></MemoryRouter>);

  // Owner decision 2026-11-18 (~8:50 AM, after the FTC 16 CFR Part 255 guidance and the affiliate-program risk were
  // explained): the disclosure moves to the bottom, below the last section, above the all-guides links.
  it("shows the disclosure once, at the bottom after the last section, and every section", () => {
    const { container } = renderPage();
    expect(screen.getAllByText(DISCLOSURE).length).toBe(1);
    const disclosure = screen.getByText(DISCLOSURE);
    const sections = [...container.querySelectorAll("[data-gift-section]")];
    expect(sections.length).toBe(SECTION_TITLES.length);
    expect(sections.at(-1)!.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const t of SECTION_TITLES) expect(screen.getByRole("heading", { level: 2, name: t })).toBeTruthy();
  });

  // Owner 2026-11-18: Pinterest pins link to louisianahelpr.com/gift-guides#<guide slug>.
  it("every section is anchored at its guide slug, clears the sticky header, and a #hash scrolls to it", () => {
    const { container } = renderPage();
    const ids = [...container.querySelectorAll("section[data-gift-section]")].map((el) => {
      expect(el.className).toMatch(/(?:^|\s)scroll-mt-\d+/);
      return el.id;
    });
    expect(ids).toEqual(giftGuides.sections.map((x) => x.id));
    expect(ids.length).toBeGreaterThan(5);
    cleanup();
    const seen: string[] = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { seen.push(this.id); };
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
    try {
      render(<MemoryRouter initialEntries={["/gift-guides#for-him"]}><GiftGuides /></MemoryRouter>);
      expect(seen).toEqual(["for-him"]);
    } finally {
      raf.mockRestore();
      Element.prototype.scrollIntoView = orig;
    }
  });

  it("every anchor is rel sponsored + noopener and opens a new tab, and every content link is drawn", () => {
    const { container } = renderPage();
    const anchors = [...container.querySelectorAll("a")];
    expect(anchors.length).toBe(contentLinks.length);
    for (const a of anchors) {
      const rel = (a.getAttribute("rel") ?? "").split(/\s+/);
      expect(rel, a.href).toContain("sponsored");
      expect(rel, a.href).toContain("noopener");
      expect(a.getAttribute("target"), a.href).toBe("_blank");
    }
    expect(new Set(anchors.map((a) => a.getAttribute("href")))).toEqual(new Set(contentLinks));
  });

  it("every image is lazy, async-decoded, sized, and named", () => {
    const { container } = renderPage();
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.length).toBe(picks.length);
    for (const i of imgs) {
      expect(i.getAttribute("loading")).toBe("lazy");
      expect(i.getAttribute("decoding")).toBe("async");
      expect(Number(i.getAttribute("width"))).toBeGreaterThan(0);
      expect(Number(i.getAttribute("height"))).toBeGreaterThan(0);
      expect(i.getAttribute("sizes")).toBeTruthy();
      expect(i.getAttribute("alt")).toBeTruthy();
    }
  });

  // Owner 2026-11-18 at ~1750px signed in: "fill the screen better". The page uses the full public container (78rem)
  // and the grid reaches at least 4 cards a row at xl; no page column, page measure or narrower max-width in between.
  it("fills the public container: no narrow column, and at least 4 cards a row at xl", () => {
    const { container } = renderPage();
    const root = container.querySelector("[data-gift-guides]");
    expect(root).toBeTruthy();
    const capped: string[] = [];
    for (let el: Element | null = root; el && el !== container; el = el.parentElement) {
      for (const c of (el.getAttribute("class") ?? "").split(/\s+/)) {
        if (c === "page-column" || c === "page-measure" || (/^(?:[a-z0-9]+:)*max-w-/.test(c) && c !== "max-w-[78rem]")) capped.push(c);
      }
    }
    expect(capped).toEqual([]);
    // PublicHeaderPage is mocked above, so its container is read from source: the body sits in PUBLIC_CONTAINER
    // (78rem) with no narrower wrapper, and the page passes no width override.
    expect(src("src/lib/publicContainer.ts")).toContain('PUBLIC_CONTAINER = "max-w-[78rem] mx-auto"');
    expect(src("src/components/marketing/PublicHeaderPage.tsx")).toMatch(/<div data-public-container="" className=\{PUBLIC_CONTAINER\}>[\s\S]*?<div className=\{`px-5 sm:px-8 lg:px-12 \$\{bottomPaddingClassName\}`\}>/);
    expect(src("src/pages/info/GiftGuides.tsx")).not.toMatch(/<PublicHeaderPage[^>]*\bwidth=/);
    const grids = [...container.querySelectorAll("[data-gift-grid]")];
    expect(grids.length).toBeGreaterThan(3);
    for (const g of grids) {
      const cols = (bp: string) => Number((g.className.match(new RegExp(`(?:^|\\s)${bp}grid-cols-(\\d+)(?:\\s|$)`)) ?? [])[1] ?? 0);
      expect(cols("")).toBe(2);
      expect(cols("lg:")).toBeGreaterThanOrEqual(3);
      expect(cols("xl:")).toBeGreaterThanOrEqual(4);
    }
    expect(src("src/pages/info/GiftGuides.tsx")).not.toMatch(/PAGE_COLUMN|page-column|page-measure/);
  });

  it("the disclosure is a plain muted line: no box, border, fill or padding", () => {
    renderPage();
    const d = screen.getByText(DISCLOSURE);
    const classes = (d.getAttribute("class") ?? "").split(/\s+/);
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.filter((c) => /^(?:[a-z0-9]+:)*(?:border|rounded|bg-|shadow|ring|p[xytblr]?-|outline)/.test(c))).toEqual([]);
    expect(classes).toContain("text-muted-foreground");
  });
});

describe("gift guides: public but not yet indexed or linked (owner 2026-11-17, public 2026-11-18)", () => {
  it("App.tsx: /gift-guides renders the page for everyone, with no ?preview=1 gate", () => {
    const app = src("src/App.tsx");
    expect(app).toContain('<Route path="/gift-guides" element={<RouteErrorBoundary>{routeEl(<PageTransition><GiftGuides /></PageTransition>)}</RouteErrorBoundary>} />');
    expect(app).not.toMatch(/GiftGuidesPreviewGate|params\.get\("preview"\)/);
    expect(app.split("\n").filter((l) => l.includes("<GiftGuides />")).length).toBe(1);
  });

  it("is noindex before and after JavaScript and out of the sitemap; vercel.json gives it its noindex head, then the app", () => {
    expect(readFileSync("public/sitemap.xml", "utf8")).not.toContain("/gift-guides");
    expect(Object.keys(PUBLIC_PAGE_META)).not.toContain("/gift-guides");
    expect(NOINDEX_PAGE_META["/gift-guides"].robots).toMatch(/noindex/);
    expect(src("src/pages/info/GiftGuides.tsx")).toContain('usePageMeta(NOINDEX_PAGE_META["/gift-guides"]);');
    const rewrites = (JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] }).rewrites;
    expect(rewrites.filter((x) => x.source.startsWith("/gift-guides"))).toEqual([
      { source: "/gift-guides", destination: "/api/share?_og=noindex&_id=gift-guides" },
      { source: "/gift-guides", destination: "/index.html" },
    ]);
  });

  it("no way in: not on the landing, not in the public footer, not in the /25days footer", () => {
    expect(src("src/pages/info/Index.tsx")).not.toMatch(/GiftGuidesBand/);
    expect(src("src/components/Footer.tsx")).not.toMatch(/gift-guides|giftGuides/);
    expect(src("src/components/sponsor/Sections.tsx")).not.toMatch(/giftGuides/);
    // The card component itself is kept (feat/gift-guides-v2) and still points at the page.
    render(<MemoryRouter><GiftGuidesBand /></MemoryRouter>);
    expect(GIFT_GUIDES_PATH).toBe("/gift-guides");
    expect(screen.getByTestId("landing-gift-guides-link").getAttribute("href")).toBe("/gift-guides");
    expect(sponsorPage.links.giftGuides).toBe("/gift-guides");
  });
});
