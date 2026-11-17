/**
 * Owner 2026-11-16 ("i think we should add this to our landing pages on louisiana helpr so people can see our gift
 * guides"; pop-up "New gift guide page"): a public /gift-guides page with picks and affiliate links, reachable from
 * the landing pages.
 *
 * THE CLASS: an affiliate page that hides its disclosure, leaks a link without rel="sponsored", goes private, or has
 * no way in. Checked from the content inventory (src/content/giftGuides.ts) and the rendered page:
 *   1. the route is public (no ProtectedRoute), routed by vercel.json before the catch-all, indexed (sitemap, own head,
 *      no noindex);
 *   2. the FTC disclosure (16 CFR Part 255) renders, word for word, above the first link;
 *   3. EVERY anchor on the page is sponsored + noopener and opens a new tab, and every content link is drawn;
 *   4. content links are https on shopmy.us / pinterest.com / an approved brand site, picks carry no price, images are lazy with a fixed size;
 *   5. the landing (Index.tsx), the public footer and the /25days footer each link to /gift-guides.
 *
 * @mutate src/pages/info/GiftGuides.tsx | rel="sponsored noopener" | rel="noopener"
 * @mutate src/pages/info/GiftGuides.tsx | target="_blank" rel= | rel=
 * @mutate src/pages/info/GiftGuides.tsx |             {G.disclosure}\n |             {null}\n
 * @mutate src/pages/info/GiftGuides.tsx |           loading="lazy" |           loading="eager"
 * @mutate src/pages/info/Index.tsx |       <GiftGuidesBand />\n |
 * @mutate src/components/Footer.tsx |               <Link to="/gift-guides" className={FOOTER_LINK}> |               <Link to="/gifts" className={FOOTER_LINK}>
 * @mutate src/components/sponsor/Sections.tsx |         <Link to={C.links.giftGuides}>{C.footer.giftGuidesLink}</Link>\n |
 * @mutate src/lib/publicPageMeta.mjs |     canonical: `${SITE_ORIGIN}/gift-guides`, |     canonical: `${SITE_ORIGIN}/gift-guides`,\n    robots: "noindex, follow",
 * @mutate src/App.tsx | <Route path="/gift-guides" element={<RouteErrorBoundary>{routeEl(<PageTransition><GiftGuides /></PageTransition>)}</RouteErrorBoundary>} /> | <Route path="/gift-guides" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><GiftGuides /></ProtectedRoute>)}</RouteErrorBoundary>} />
 * @mutate vercel.json |       "source": "/gift-guides",\n      "destination": "/index.html" |       "source": "/gift-guides-moved",\n      "destination": "/index.html"
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
const DISCLOSURE = "Some links are affiliate links. We may earn a small commission at no extra cost to you.";
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

  it("the disclosure is the required sentence, word for word", () => {
    expect(giftGuides.disclosure).toBe(DISCLOSURE);
  });
});

describe("gift guides: the rendered page", () => {
  const renderPage = () => render(<MemoryRouter><GiftGuides /></MemoryRouter>);

  it("shows the disclosure above the first link, and every section", () => {
    const { container } = renderPage();
    const disclosure = screen.getByText(DISCLOSURE);
    const firstLink = container.querySelector("a");
    expect(firstLink).toBeTruthy();
    expect(disclosure.compareDocumentPosition(firstLink!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const t of SECTION_TITLES) expect(screen.getByRole("heading", { level: 2, name: t })).toBeTruthy();
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
});

describe("gift guides: public, routed and indexed", () => {
  it("App.tsx serves /gift-guides with no ProtectedRoute around it", () => {
    const app = src("src/App.tsx");
    const route = app.split("\n").find((l) => l.includes('path="/gift-guides"'));
    expect(route).toBeTruthy();
    expect(route).not.toMatch(/ProtectedRoute|AdminRoute/);
    expect(route).toContain("<GiftGuides />");
  });

  it("vercel.json routes it to its own head and to the app, both before the catch-all", () => {
    const rewrites = (JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] }).rewrites;
    const at = (dest: string) => rewrites.findIndex((r) => r.source === "/gift-guides" && r.destination === dest);
    const catchAll = rewrites.findIndex((r) => r.destination === "/api/share?_og=notfound");
    expect(at("/api/share?_og=page&_id=gift-guides")).toBeGreaterThan(-1);
    expect(at("/index.html")).toBeGreaterThan(-1);
    expect(at("/api/share?_og=page&_id=gift-guides")).toBeLessThan(catchAll);
    expect(at("/index.html")).toBeLessThan(catchAll);
  });

  it("is indexed: in the sitemap, with its own head, and never noindex", () => {
    const meta = PUBLIC_PAGE_META["/gift-guides"] as { canonical: string; robots?: string };
    expect(meta.canonical).toBe("https://www.louisianahelpr.com/gift-guides");
    expect(meta.robots ?? "").not.toMatch(/noindex/);
    expect(Object.keys(NOINDEX_PAGE_META)).not.toContain("/gift-guides");
    expect(readFileSync("public/sitemap.xml", "utf8")).toContain("<loc>https://www.louisianahelpr.com/gift-guides</loc>");
    expect(src("src/pages/info/GiftGuides.tsx")).toContain('usePageMeta(PUBLIC_PAGE_META["/gift-guides"])');
  });
});

describe("gift guides: the ways in", () => {
  it("the landing renders the gift guides card, and it links to /gift-guides", () => {
    expect(src("src/pages/info/Index.tsx")).toMatch(/<GiftGuidesBand \/>/);
    render(<MemoryRouter><GiftGuidesBand /></MemoryRouter>);
    expect(GIFT_GUIDES_PATH).toBe("/gift-guides");
    expect(screen.getByTestId("landing-gift-guides-link").getAttribute("href")).toBe("/gift-guides");
  });

  it("the public footer links to /gift-guides", () => {
    expect(src("src/components/Footer.tsx")).toMatch(/<Link to="\/gift-guides"/);
  });

  it("the /25days page's footer links to /gift-guides", () => {
    expect(sponsorPage.links.giftGuides).toBe("/gift-guides");
    expect(src("src/components/sponsor/Sections.tsx")).toContain("<Link to={C.links.giftGuides}>{C.footer.giftGuidesLink}</Link>");
  });
});
