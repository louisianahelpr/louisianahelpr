/**
 * Holiday Gift Guides (owner 2026-11-16; final layout 2026-11-17), a HIDDEN preview until the owner says go.
 *
 * THE CLASS: an affiliate page that links somewhere other than the product's own affiliate link (her Pinterest, her
 * ShopMy profile or a collection page, an untagged Amazon URL), shows a banned brand, hides its disclosure, leaks a
 * link without rel="sponsored", invents a budget tier, or becomes reachable before the owner says so. Checked from
 * the content inventory (src/content/giftGuides.ts, giftGuideList.ts, giftGuideItems/*) and the rendered page:
 *   1. every pick links in exactly one approved shape: amazon.com/dp/<ASIN>?tag=louisianahelpr-20,
 *      go.shopmy.us/p-<id>, or an approved brand site; nothing anywhere links to pinterest.com or a ShopMy shop page;
 *   2. no CBD, vape, alcohol, gambling or prize-draw brand and no Walmart; no prices;
 *   3. every cover is a webp under public/gift-guide-covers/, with its real size set, and a budget button only for a tier
 *      one of her guides prices;
 *   4. the rendered page: disclosure + Amazon price note, sections closed until opened, covers lazy and sized, every
 *      outbound anchor sponsored + noopener + new tab, a guide shows her cover and a numbered list;
 *   5. HIDDEN: /gift-guides without ?preview=1 goes home; no landing, footer, /25days, nav or sitemap link; noindex.
 *
 * @mutate src/content/giftGuides.ts | export const AMAZON_TAG = "louisianahelpr-20"; | export const AMAZON_TAG = "hggpinterest-20";
 * @mutate src/content/giftGuides.ts | `https://go.shopmy.us/p-${pinId}` | `https://shopmy.us/lexilombas?p=${pinId}`
 * @mutate src/content/giftGuides.ts | walmart)\b/i, | wal-mart)\b/i,
 * @mutate src/content/giftGuides.ts | export const BUDGET_TIERS = [5, 10, 15, 20, 25, 30, 50, 100] as const; | export const BUDGET_TIERS = [10, 25] as const;
 * @mutate src/pages/info/GiftGuides.tsx | target="_blank" rel="sponsored noopener" | target="_blank" rel="noopener"
 * @mutate src/pages/info/GiftGuides.tsx |             loading="lazy"\n |             loading="eager"\n
 * @mutate src/pages/info/GiftGuides.tsx |       <p>{G.disclosure}</p>\n |
 * @mutate src/pages/info/GiftGuides.tsx |       {open && ( |       {(open \|\| true) && (
 * @mutate src/App.tsx |   if (params.get("preview") !== "1") return <Navigate to="/" replace />;\n |
 * @mutate src/App.tsx | element={<GiftGuidesPreviewGate><RouteErrorBoundary>{routeEl(<PageTransition><GiftGuides /></PageTransition>)}</RouteErrorBoundary></GiftGuidesPreviewGate>} | element={<RouteErrorBoundary>{routeEl(<PageTransition><GiftGuides /></PageTransition>)}</RouteErrorBoundary>}
 * @mutate src/components/Footer.tsx |               <Link to="/safety" className={FOOTER_LINK}> |               <Link to="/gift-guides?preview=1" className={FOOTER_LINK}>
 * @mutate src/pages/info/Index.tsx |       <SectionsShowcase />\n |       <SectionsShowcase />\n      <GiftGuidesBand />\n
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdirSync as trackedReaddir } from "./helpers/trackedFiles";
import { walkSource } from "./helpers/walkSource";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children, hidesTitle, phoneHidesTitle }: { title: string; children: React.ReactNode; hidesTitle?: boolean; phoneHidesTitle?: boolean }) => (
    <main data-hides-title={String(!!hidesTitle)} data-phone-hides-title={String(!!phoneHidesTitle)}><h1>{title}</h1>{children}</main>
  ),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import {
  AMAZON_TAG,
  BANNED,
  BRANDS,
  BUDGET_TIERS,
  DISCOUNT_CODES,
  GIFT_GUIDES_PREVIEW,
  GUIDE_SECTIONS,
  giftGuides as G,
  toProduct,
  type ItemData,
} from "@/content/giftGuides";
import { GUIDE_LIST } from "@/content/giftGuideList";
import { ITEMS as people } from "@/content/giftGuideItems/people";
import { ITEMS as interests } from "@/content/giftGuideItems/interests";
import { ITEMS as life } from "@/content/giftGuideItems/life";
import { ITEMS as louisiana } from "@/content/giftGuideItems/louisiana";
import { ITEMS as christmas } from "@/content/giftGuideItems/christmas";
import { ITEMS as deals } from "@/content/giftGuideItems/deals";
import { ITEMS as budget } from "@/content/giftGuideItems/budget";
import { PUBLIC_PAGE_META, NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";

afterEach(cleanup);

const src = (p: string) => blankComments(readFileSync(p, "utf8"));
const BY_SECTION: Record<string, Record<string, ItemData[]>> = { people, interests, life, louisiana, christmas, deals, budget };
const ALL: [string, ItemData][] = Object.values(BY_SECTION).flatMap((m) => Object.entries(m).flatMap(([id, list]) => list.map((it): [string, ItemData] => [id, it])));
const BRAND_HOSTS = Object.values(BRANDS).map((b) => new URL(b.site).hostname);
const AMAZON = new RegExp(`^https://www\\.amazon\\.com/dp/[A-Z0-9]{10}\\?tag=${AMAZON_TAG}$`);
const SHOPMY = /^https:\/\/go\.shopmy\.us\/p-\d+$/;
const linkOk = (href: string) => AMAZON.test(href) || SHOPMY.test(href) || BRAND_HOSTS.includes(new URL(href).hostname);
const CONTENT_FILES = ["src/content/giftGuides.ts", "src/content/giftGuideList.ts", ...trackedReaddir("src/content/giftGuideItems").map((f) => `src/content/giftGuideItems/${f}`)];

describe("gift guides: every pick links straight to its own affiliate link", () => {
  it("the inventory is real (her 46 Amazon guides and her ShopMy collections)", () => {
    expect(GUIDE_LIST.length).toBeGreaterThan(100);
    expect(ALL.length).toBeGreaterThan(2000);
    expect(GUIDE_LIST.filter((g) => g.store === "amazon").length).toBe(46);
  });

  it("the Amazon tag is the website one the owner made (louisianahelpr-20)", () => {
    expect(AMAZON_TAG).toBe("louisianahelpr-20");
  });

  it("each pick has exactly one of asin / shopmy / brand, and its link is one approved shape", () => {
    for (const [id, it] of ALL) {
      expect([it.asin, it.shopmy, it.brand].filter((x) => x !== undefined).length, `${id}: ${JSON.stringify(it)}`).toBe(1);
      if (it.asin) expect(it.asin, id).toMatch(/^[A-Z0-9]{10}$/);
      const href = toProduct(it).href;
      expect(linkOk(href), `${id}: ${href}`).toBe(true);
    }
  });

  it("nothing in the content links to Pinterest, a ShopMy shop or collection page, or an untagged Amazon page", () => {
    for (const f of CONTENT_FILES) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/https?:\/\/(www\.)?pinterest\.com/);
      expect(s, f).not.toMatch(/https?:\/\/(www\.)?shopmy\.us\//);
      expect(s, f).not.toMatch(/hggpinterest-20|louisianahelp-20\b/);
    }
  });

  it("every guide id in the list has its picks, and every picks entry has a guide (exact both ways)", () => {
    const listIds = GUIDE_LIST.map((g) => `${g.section}/${g.id}`).sort();
    const itemIds = Object.entries(BY_SECTION).flatMap(([s, m]) => Object.keys(m).map((id) => `${s}/${id}`)).sort();
    expect(itemIds).toEqual(listIds);
    expect(new Set(GUIDE_LIST.map((g) => g.id)).size).toBe(GUIDE_LIST.length);
    for (const g of GUIDE_LIST) {
      expect(BY_SECTION[g.section][g.id].length, g.id).toBe(g.count);
      expect(g.count, g.id).toBeGreaterThan(0);
    }
  });
});

describe("gift guides: sanity of the data (owner review 2026-11-17)", () => {
  // @mutate src/content/giftGuideItems/christmas.ts | "Butterblu Matching Family Jammies Christmas Pajamas, Sage Trees" | "Butterblu Matching Family Jammies Christmas Pajamas, Navy Plaid"
  it("no guide lists the same product twice: not the same link, not the same name", () => {
    expect(Object.keys(BY_SECTION).length).toBeGreaterThan(5);
    for (const m of Object.values(BY_SECTION)) {
      for (const [id, list] of Object.entries(m)) {
        const keys = list.map((it) => (it.asin ? `a:${it.asin}` : it.shopmy ? `s:${it.shopmy}` : `b:${it.brand}`));
        const names = list.map((it) => (it.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean);
        expect(keys.filter((k, i) => keys.indexOf(k) !== i), id).toEqual([]);
        expect(names.filter((n, i) => names.indexOf(n) !== i), id).toEqual([]);
      }
    }
  });

  it("every product photo is an https image address (no relative or broken path)", () => {
    const withImage = ALL.filter(([, it]) => it.image !== undefined);
    expect(withImage.length).toBeGreaterThan(1500);
    for (const [id, it] of withImage) expect(it.image, id).toMatch(/^https:\/\/(static\.shopmy\.us|i\.pinimg\.com)\/\S+$/);
  });

  // @mutate src/content/giftGuides.ts | ?tag=${AMAZON_TAG}` | `
  it("every Amazon link carries the website tag (tag=louisianahelpr-20)", () => {
    const amazon = ALL.filter(([, it]) => it.asin);
    expect(amazon.length).toBeGreaterThan(500);
    for (const [id, it] of amazon) expect(toProduct(it).href, id).toBe(`https://www.amazon.com/dp/${it.asin}?tag=louisianahelpr-20`);
  });
});

describe("gift guides: no banned brand, no Walmart, no prices", () => {
  const text = (it: ItemData) => `${it.name ?? ""} | ${it.store ?? ""} | ${it.brand ?? ""}`;

  it("the banned-word rule catches what it is for (and not barware)", () => {
    for (const bad of ["Hemp Gummies", "CBD Oil", "Disposable Vape", "Casino Night Kit", "Poker Chip Set", "Sweepstakes Entry", "Tito's Vodka", "Pinot Wine", "Store | Walmart"]) {
      expect(BANNED.words.test(bad) || (BANNED.drink.test(bad) && !BANNED.barware.test(bad)), bad).toBe(true);
    }
    for (const ok of ["Riedel Wine Glasses", "Yeti Cocktail Shaker", "Ben-Amun Bourbon Bangle", "Cast Iron Skillet"]) {
      expect(BANNED.words.test(ok) || (BANNED.drink.test(ok) && !BANNED.barware.test(ok)), ok).toBe(false);
    }
  });

  it("no pick is a CBD, vape, alcohol, gambling or prize-draw product, or sold through Walmart", () => {
    const bad = ALL.filter(([, it]) => BANNED.words.test(text(it)) || (BANNED.drink.test(text(it)) && !BANNED.barware.test(text(it))));
    expect(bad.map(([id, it]) => `${id}: ${text(it)}`)).toEqual([]);
  });

  it("no guide title names a banned brand, and no pick or guide shows a price", () => {
    for (const g of GUIDE_LIST) expect(BANNED.words.test(`${g.lead} ${g.title}`), g.title).toBe(false);
    for (const [id, it] of ALL) expect(it.name ?? "", id).not.toMatch(/\$\s?[1-9]/);
  });
});

describe("gift guides: covers and budget tiers", () => {
  it("every cover is a webp under public/gift-guide-covers/, small, with its size set", () => {
    const covered = GUIDE_LIST.filter((g) => g.cover);
    expect(covered.length).toBeGreaterThan(140);
    // Owner review 2026-11-17: every guide has a cover (her pins, or one rendered with her generator).
    // @mutate src/content/giftGuideList.ts | "cover": {"src": "/gift-guide-covers/amazon-brother.webp", "w": 600, "h": 900} | "cover": null
    expect(GUIDE_LIST.filter((g) => !g.cover).map((g) => g.id)).toEqual([]);
    for (const g of covered) {
      const c = g.cover!;
      expect(c.src, g.id).toBe(`/gift-guide-covers/${g.id}.webp`);
      const file = `public${c.src}`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeLessThan(80 * 1024);
      expect(c.w, g.id).toBeGreaterThan(300);
      // Her pins are 2:3; one (Big Sisters) is square. Drawn at its own ratio, never cropped to another.
      expect([1, 1.5], g.id).toContain(Math.round((c.h / c.w) * 10) / 10);
    }
    // No orphan cover files either way.
    const files = trackedReaddir("public/gift-guide-covers").sort();
    expect(files).toEqual(covered.map((g) => `${g.id}.webp`).sort());
  });

  it("a budget tier shows only when one of her guides prices it (today $10, $25, $50)", () => {
    const priced = BUDGET_TIERS.filter((n) => GUIDE_LIST.some((g) => g.section === "budget" && g.title === G.under(n)));
    expect(priced).toEqual([10, 25, 50]);
    render(<MemoryRouter initialEntries={[GIFT_GUIDES_PREVIEW]}><GiftGuides /></MemoryRouter>);
    const buttons = [...document.querySelectorAll("[data-gift-budget]")].map((a) => a.textContent);
    expect(buttons).toEqual(priced.map((n) => G.under(n)));
  });

  it("the discount codes are the three the owner gave", () => {
    expect(DISCOUNT_CODES.map((c) => `${c.name}:${c.code}`)).toEqual(["Daily Crunch:LEXI15", "Magnifique cookware:LEXI10", "Canopy:SECRETBF"]);
    for (const c of DISCOUNT_CODES) if (c.guide) expect(GUIDE_LIST.some((g) => g.id === c.guide), c.guide).toBe(true);
  });
});

describe("gift guides: the rendered page", () => {
  const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><GiftGuides /></MemoryRouter>);
  const checkAnchors = (root: HTMLElement) => {
    for (const a of root.querySelectorAll("a[href^='http']")) {
      const rel = (a.getAttribute("rel") ?? "").split(/\s+/);
      expect(rel, a.getAttribute("href")!).toContain("sponsored");
      expect(rel, a.getAttribute("href")!).toContain("noopener");
      expect(a.getAttribute("target"), a.getAttribute("href")!).toBe("_blank");
    }
  };

  // @mutate src/pages/info/GiftGuides.tsx | wrapTitle hidesTitle bottom | wrapTitle phoneHidesTitle bottom
  it("the title shows once: the shared header keeps its h1 for screen readers at every width; the band paints it", () => {
    const { container } = at(GIFT_GUIDES_PREVIEW);
    const main = container.querySelector("main") as HTMLElement;
    expect(main.getAttribute("data-hides-title")).toBe("true");
    expect(main.getAttribute("data-phone-hides-title")).toBe("false");
    // The shell forwards it to PageHeader, whose h1 then gets sr-only at every width.
    // @mutate src/components/marketing/PublicHeaderPage.tsx | hidesTitle={hidesTitle} | hidesTitle={false}
    expect(src("src/components/marketing/PublicHeaderPage.tsx")).toContain("hidesTitle={hidesTitle}");
    expect(src("src/components/PageHeader.tsx")).toContain('hidesTitle ? " sr-only"');
  });

  it("home: disclosure and the Amazon price note, codes with copy buttons, sections closed until opened", () => {
    const { container } = at(GIFT_GUIDES_PREVIEW);
    expect(screen.getByText(G.disclosure)).toBeTruthy();
    expect(screen.getByText(G.amazonDisclosure)).toBeTruthy();
    expect(screen.getByText(G.priceNote)).toBeTruthy();
    for (const c of DISCOUNT_CODES) expect(container.querySelector(`[data-gift-copy="${c.code}"]`)).toBeTruthy();
    expect(GUIDE_SECTIONS.map((s) => s.title)).toEqual(["People", "Interests", "Life moments", "Louisiana", "Christmas", "Deals and codes"]);
    for (const s of GUIDE_SECTIONS) expect(screen.getByRole("button", { name: new RegExp(`^${s.title}`) }).getAttribute("aria-expanded")).toBe("false");
    // Nothing heavy before a section opens: no cover in the DOM.
    expect(container.querySelectorAll("img").length).toBe(0);
    checkAnchors(container);
  });

  it("an open section shows her covers 2 across, lazy and sized, each opening its guide on this page", () => {
    const { container } = at(GIFT_GUIDES_PREVIEW);
    fireEvent.click(screen.getByRole("button", { name: /^People/ }));
    const panel = container.querySelector("#gift-panel-people") as HTMLElement;
    expect(panel.querySelector("ul")!.className).toContain("grid-cols-2");
    const imgs = [...panel.querySelectorAll("img")];
    expect(imgs.length).toBe(GUIDE_LIST.filter((g) => g.section === "people" && g.cover).length);
    for (const i of imgs) {
      expect(i.getAttribute("loading")).toBe("lazy");
      expect(i.getAttribute("decoding")).toBe("async");
      expect(Number(i.getAttribute("width"))).toBeGreaterThan(0);
      expect(Number(i.getAttribute("height"))).toBeGreaterThan(0);
    }
    for (const a of panel.querySelectorAll("a")) expect(a.getAttribute("href")).toMatch(/^\/gift-guides\?preview=1&guide=[a-z0-9-]+$/);
  });

  it("a guide: her cover big on top, then a numbered list where every gift links straight to its affiliate link", async () => {
    const { container } = at(`${GIFT_GUIDES_PREVIEW}&guide=amazon-mom`);
    const ol = await vi.waitFor(
      () => {
        const el = container.querySelector("[data-gift-list]");
        if (!el) throw new Error("list not loaded");
        return el as HTMLElement;
      },
      { timeout: 5000 },
    );
    expect(ol.tagName).toBe("OL");
    expect(container.querySelector("[data-gift-cover]")!.getAttribute("src")).toBe("/gift-guide-covers/amazon-mom.webp");
    const rows = within(ol).getAllByRole("link");
    expect(rows.length).toBe(GUIDE_LIST.find((g) => g.id === "amazon-mom")!.count);
    for (const a of rows) expect(AMAZON.test(a.getAttribute("href")!), a.getAttribute("href")!).toBe(true);
    checkAnchors(container);
    expect(screen.getByText(G.priceNote)).toBeTruthy();
  });
});

describe("gift guides: hidden until the owner says go (owner 2026-11-17)", () => {
  it("App.tsx: /gift-guides renders the gate, which sends anyone without ?preview=1 home", () => {
    const app = src("src/App.tsx");
    expect(app).toContain('<Route path="/gift-guides" element={<GiftGuidesPreviewGate><RouteErrorBoundary>{routeEl(<PageTransition><GiftGuides /></PageTransition>)}</RouteErrorBoundary></GiftGuidesPreviewGate>} />');
    expect(app).toContain('if (params.get("preview") !== "1") return <Navigate to="/" replace />;');
    expect(app.split("\n").filter((l) => l.includes("<GiftGuides />")).length).toBe(1);
    expect(app).toMatch(/const GiftGuides = lazyWithPreload\(\(\) => import\("\.\/pages\/info\/GiftGuides"\)\);/);
  });

  it("the page tells search engines to stay away, before and after JavaScript, and stays out of the sitemap", () => {
    expect(src("src/pages/info/GiftGuides.tsx")).toContain('usePageMeta(NOINDEX_PAGE_META["/gift-guides"]);');
    expect(NOINDEX_PAGE_META["/gift-guides"].robots).toMatch(/noindex/);
    expect(Object.keys(PUBLIC_PAGE_META)).not.toContain("/gift-guides");
    expect(readFileSync("public/sitemap.xml", "utf8")).not.toContain("/gift-guides");
    // vercel.json: its noindex head first, then the app shell every App.tsx route gets (unknownUrlsAnswer404).
    const rewrites = (JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] }).rewrites;
    expect(rewrites.filter((x) => x.source.startsWith("/gift-guides"))).toEqual([
      { source: "/gift-guides", destination: "/api/share?_og=noindex&_id=gift-guides" },
      { source: "/gift-guides", destination: "/index.html" },
    ]);
  });

  it("no way in: not on the landing, the footer, the /25days page, any nav, or anywhere else in the app", () => {
    expect(src("src/pages/info/Index.tsx")).not.toMatch(/GiftGuidesBand/);
    expect(src("src/components/Footer.tsx")).not.toMatch(/gift-guides|giftGuides/);
    expect(src("src/components/sponsor/Sections.tsx")).not.toMatch(/giftGuides/);
    // The preview address lives only in the page, its content and App.tsx's gate.
    const allowed = new Set(["src/pages/info/GiftGuides.tsx", "src/content/giftGuides.ts", "src/App.tsx"]);
    const files = walkSource(["src"], [".ts", ".tsx", ".mjs"]).map((f) => f.replace(/^.*?(?=src\/)/, "")).filter((f) => !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    const hits = files.filter((f) => !allowed.has(f) && /GIFT_GUIDES_PREVIEW|guideHref|preview=1/.test(src(f)));
    expect(hits).toEqual([]);
  });
});
