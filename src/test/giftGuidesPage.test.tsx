/**
 * Owner 2026-11-16 ("i think we should add this to our landing pages on louisiana helpr so people can see our gift
 * guides"; pop-up "New gift guide page"): a public /gift-guides page with picks and affiliate links, reachable from
 * the landing pages.
 *
 * THE CLASS: an affiliate page that hides its disclosure, leaks a link without rel="sponsored", goes private, or has
 * no way in. Checked from the content inventory (src/content/giftGuides.ts) and the rendered page:
 *   1. the route is public (no ProtectedRoute), routed by vercel.json before the catch-all, indexed (sitemap, own head,
 *      no noindex) [hidden since 2026-11-17, see below];
 *   2. the FTC disclosure (16 CFR Part 255) renders, word for word, above the first link;
 *   3. EVERY anchor on the page is sponsored + noopener and opens a new tab, and every content link is drawn;
 *   4. content links are https on shopmy.us / pinterest.com / an approved brand site, picks carry no price, images are lazy with a fixed size;
 *   5. the landing (Index.tsx), the public footer and the /25days footer each link to /gift-guides.
 *
 * OWNER 2026-11-17: the gift guides are NOT visible yet (the next version is being built on feat/gift-guides-v2). Until
 * then 1 and 5 are inverted: /gift-guides sends everyone home (App.tsx's GiftGuidesPreviewGate; only the owner's
 * ?preview=1 renders the page), it is noindex and out of the sitemap, and the landing card, the public footer link and
 * the /25days footer link are gone. vercel.json still gives it the app shell, as every App.tsx route gets
 * (unknownUrlsAnswer404). The page code and its content stay, and 2-4 still hold for the page itself.
 *
 * @mutate src/pages/info/GiftGuides.tsx | rel="sponsored noopener" | rel="noopener"
 * @mutate src/pages/info/GiftGuides.tsx | target="_blank" rel= | rel=
 * @mutate src/pages/info/GiftGuides.tsx |             {G.disclosure}\n |             {null}\n
 * @mutate src/pages/info/GiftGuides.tsx |           loading="lazy" |           loading="eager"
 * @mutate src/pages/info/Index.tsx |       <SectionsShowcase />\n |       <SectionsShowcase />\n      <GiftGuidesBand />\n
 * @mutate src/components/Footer.tsx |               <Link to="/safety" className={FOOTER_LINK}> |               <Link to="/gift-guides" className={FOOTER_LINK}>
 * @mutate src/components/sponsor/Sections.tsx |         <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>\n |         <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>\n        <Link to={C.links.giftGuides}>{C.footer.giftGuidesLink}</Link>\n
 * @mutate src/App.tsx |   if (params.get("preview") !== "1") return <Navigate to="/" replace />;\n |
 * @mutate src/App.tsx |   if (params.get("preview") !== "1") return <Navigate to="/" replace />; |   if (params.get("preview") !== "1") return <Navigate to="/home" replace />;
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

describe("gift guides: hidden until the next version (owner 2026-11-17)", () => {
  it("App.tsx: /gift-guides renders the gate, which sends anyone without ?preview=1 home", () => {
    const app = src("src/App.tsx");
    expect(app).toContain('<Route path="/gift-guides" element={<GiftGuidesPreviewGate><RouteErrorBoundary>{routeEl(<PageTransition><GiftGuides /></PageTransition>)}</RouteErrorBoundary></GiftGuidesPreviewGate>} />');
    expect(app).toContain('if (params.get("preview") !== "1") return <Navigate to="/" replace />;');
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
