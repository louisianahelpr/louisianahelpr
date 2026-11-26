/**
 * Search pages (owner Mon 2026-11-23 ~9:15 PM: "Can you add a lot of different searches so it's seen a lot more").
 * Each page in src/content/guideSearchPages.mjs is a filtered view of the live Her, Him and Kids guides. Checked here:
 *   - every page holds at least 8 picks, every one a pick of a guide it lists, and fewer than those guides hold (a real
 *     subset, never a copy of a guide: owner 11-21 retired the relationship pages for copying Her and Him);
 *   - unique slugs that no guide, old slug or other page answers; unique titles (<= 60), descriptions (<= 155) and
 *     canonicals;
 *   - api/share.ts serves each one as its own indexed page before JavaScript: the title, canonical, H1, intro, the picks,
 *     a BreadcrumbList and an ItemList of at least 8, and the link back to its guide;
 *   - every page is in the sitemap (the generator and the committed public/sitemap.xml) with a lastmod;
 *   - Her, Him and Kids link their search pages ("Popular searches") before and after JavaScript.
 *
 * @mutate src/content/guideSearchView.ts |   if (m.types && !(pick.type && m.types.includes(pick.type))) return false; |
 * @mutate api/share.ts | giftGuideHead(id) ?? (search ? searchPageMeta(search) : null) ?? | giftGuideHead(id) ??
 * @mutate src/content/guideSearchIndex.mjs |   "gifts-for-teens": ["kids"],
 |
 * @mutate src/lib/seoBodies.mjs |       searchLinks("Popular searches", searchPagesOf(slug)) + |
 * @mutate scripts/generate-sitemap.mjs | DEAL_DAY_SLUGS.filter(isLiveGuide).map((slug) => `/gift-guides/${slug}`), ...searches.sort()]; | DEAL_DAY_SLUGS.filter(isLiveGuide).map((slug) => `/gift-guides/${slug}`)];
 * @mutate api/share.ts |     if (sp && spPicks) { |     if (sp && spPicks && false) {
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { buildSeoData } from "@/prerender/seoData";
import type { SeoData } from "@/lib/seoBodies.mjs";
import { SEARCH_PAGES, searchPageMeta, searchPagesOf } from "@/content/guideSearchPages.mjs";
import { searchGuide, searchPagePicks } from "@/content/guideSearchView";
import { GUIDES, OLD_SLUGS, RETIRED_SLUGS, guideBySlug, loadAllGuidePicks, newSlugFor, picksReady } from "@/content/giftGuideCatalog";
import { dealDay } from "@/content/giftGuideDeals.mjs";
import { SEARCH_PAGE_GUIDES } from "@/content/guideSearchIndex.mjs";
import { isOwnerList } from "@/content/giftGuidePeople.mjs";
import type { KidTags } from "@/content/giftGuideKidsFilter";
import kidTagsFile from "@/content/giftGuideKidsTags.json";
import { allGiftGuidePaths } from "../../scripts/generate-sitemap.mjs";
import { GuideSearchLinks } from "@/pages/info/giftGuides/GuideSearchLinks";

const ROOT = resolve(__dirname, "..", "..");
const ORIGIN = "https://www.louisianahelpr.com";
const MIN = 8;
const tags = (kidTagsFile as unknown as { tags: KidTags }).tags;
let handler: { fetch: (req: Request) => Promise<Response> };
let data: SeoData;

beforeAll(async () => {
  ensureOgShellSnapshot(ROOT);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline in this test"); }));
  await loadAllGuidePicks();
  data = await buildSeoData();
  vi.doMock(resolve(ROOT, "scripts/generated/seo-data.js"), () => ({ SEO_DATA: data }));
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
}, 120_000);

const served = async (slug: string) => {
  const res = await handler.fetch(new Request(`${ORIGIN}/api/share?_og=page&_id=gift-guides/${slug}`));
  return { status: res.status, doc: await res.text() };
};
// &amp; last, so "&amp;quot;" never double-unescapes (CodeQL).
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const tag = (doc: string, re: RegExp) => decode(doc.match(re)?.[1] ?? "");
const ldBlocks = (doc: string) =>
  [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
const key = (p: { href: string; name: string }) => `${p.href} ${p.name}`;

describe("gift guide search pages", () => {
  it("defines a real set of pages (inventory floor)", () => {
    expect(SEARCH_PAGES.length).toBeGreaterThan(24);
    for (const g of ["her", "him", "kids"]) expect(searchPagesOf(g).length, g).toBeGreaterThan(5);
  });

  for (const sp of SEARCH_PAGES) {
    it(`${sp.slug}: at least ${MIN} picks, all on its guides, a real subset`, () => {
      const picks = searchPagePicks(sp, (s) => guideBySlug(s)?.picks ?? [], tags);
      expect(picks.length, sp.slug).toBeGreaterThanOrEqual(MIN);
      const parent = new Set(sp.guides.flatMap((g) => (guideBySlug(g)?.picks ?? []).map(key)));
      expect(parent.size).toBeGreaterThan(picks.length);
      for (const p of picks) expect(parent.has(key(p)), `${sp.slug}: ${p.name}`).toBe(true);
      // The page the browser draws holds the same picks, its chunks are loaded and it draws as the owner's flat list.
      expect(picksReady(sp.slug)).toBe(true);
      expect(searchGuide(sp.slug, tags)?.picks.map(key)).toEqual(picks.map(key));
      expect(isOwnerList(sp.slug)).toBe(true);
    });
  }

  it("the slug map the guide pages carry (guideSearchIndex.mjs) names exactly the pages, and the words stay off the first paint", () => {
    expect(Object.keys(SEARCH_PAGE_GUIDES).sort()).toEqual(SEARCH_PAGES.map((p) => p.slug).sort());
    for (const sp of SEARCH_PAGES) expect(sp.guides, sp.slug).toEqual(SEARCH_PAGE_GUIDES[sp.slug]);
    // Q178 (/gift-guides/<slug> budget): the page's own chunk imports only the slug map; the words load lazily.
    for (const f of ["src/pages/info/GiftGuides.tsx", "src/content/giftGuideCatalog.ts", "src/content/giftGuidePeople.mjs", "src/lib/giftGuidePageMeta.mjs", "src/pages/info/giftGuides/GiftGuideView.tsx"]) {
      expect(readFileSync(resolve(ROOT, f), "utf8"), f).not.toMatch(/from "[^"]*(guideSearchPages\.mjs|guideSearchView|GuideSearchLinks)"/);
    }
    expect(readFileSync(resolve(ROOT, "src/pages/info/GiftGuides.tsx"), "utf8")).toContain('import("./giftGuides/GuideSearchLinks")');
  });

  it("slugs, titles, descriptions and canonicals are unique, short, and answered by nothing else", () => {
    const fields = { slug: new Set<string>(), title: new Set<string>(), description: new Set<string>(), h1: new Set<string>() };
    const retired = new Set(RETIRED_SLUGS());
    for (const sp of SEARCH_PAGES) {
      for (const f of Object.keys(fields) as (keyof typeof fields)[]) {
        expect(fields[f].has(sp[f]), `${f} repeated: ${sp[f]}`).toBe(false);
        fields[f].add(sp[f]);
      }
      // The keywords before the brand fit Google's ~60 characters; a longer title loses only the brand off its end (1126).
      expect(sp.title.replace(/ \| Louisiana Helpr$/, "").length, sp.slug).toBeLessThanOrEqual(60);
      expect(sp.title).toMatch(/ \| Louisiana Helpr$/);
      expect(sp.description.length, sp.slug).toBeLessThanOrEqual(155);
      expect(sp.description.length, sp.slug).toBeGreaterThan(80);
      expect(sp.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(GUIDES.some((g) => g.slug === sp.slug), sp.slug).toBe(false);
      expect(newSlugFor(sp.slug), sp.slug).toBeNull();
      expect(retired.has(sp.slug) || Object.prototype.hasOwnProperty.call(OLD_SLUGS, sp.slug) || Boolean(dealDay(sp.slug)), sp.slug).toBe(false);
      const meta = searchPageMeta(sp);
      expect(meta?.title).toBe(sp.title);
      expect(meta?.canonical).toBe(`${ORIGIN}/gift-guides/${sp.slug}`);
    }
  });

  it("api/share.ts serves every search page's own head, body, BreadcrumbList and ItemList before JavaScript", async () => {
    for (const sp of SEARCH_PAGES) {
      const { status, doc } = await served(sp.slug);
      expect(status, sp.slug).toBe(200);
      const head = doc.slice(0, doc.indexOf("</head>"));
      expect(tag(head, /<title>([^<]*)<\/title>/), sp.slug).toBe(sp.title);
      expect(tag(head, /<meta name="description" content="([^"]*)"/), sp.slug).toBe(sp.description);
      expect(tag(head, /<link rel="canonical" href="([^"]*)"/), sp.slug).toBe(`${ORIGIN}/gift-guides/${sp.slug}`);
      expect(tag(head, /<meta name="robots" content="([^"]*)"/), sp.slug).not.toMatch(/noindex/);
      const body = decode(doc.slice(doc.indexOf('<main id="seo-page"')));
      expect(body, sp.slug).toContain(`<h1>${sp.h1}</h1>`);
      expect(body, sp.slug).toContain(sp.intro);
      expect((body.match(/rel="sponsored nofollow noopener"/g) ?? []).length, sp.slug).toBeGreaterThanOrEqual(MIN);
      if (sp.guides.length === 1) expect(body, sp.slug).toContain(`href="/gift-guides/${sp.guides[0]}"`);
      const ld = ldBlocks(doc);
      const list = ld.find((b) => b["@type"] === "ItemList") as { numberOfItems: number; url: string } | undefined;
      expect(list?.numberOfItems ?? 0, sp.slug).toBeGreaterThanOrEqual(MIN);
      expect(list?.url).toBe(`${ORIGIN}/gift-guides/${sp.slug}`);
      expect(ld.some((b) => b["@type"] === "BreadcrumbList"), sp.slug).toBe(true);
    }
  }, 60_000);

  it("every search page is in the sitemap with a lastmod", () => {
    const paths = allGiftGuidePaths();
    const xml = readFileSync(resolve(ROOT, "public/sitemap.xml"), "utf8");
    for (const sp of SEARCH_PAGES) {
      expect(paths, sp.slug).toContain(`/gift-guides/${sp.slug}`);
      const at = xml.indexOf(`<loc>${ORIGIN}/gift-guides/${sp.slug}</loc>`);
      expect(at, sp.slug).toBeGreaterThanOrEqual(0);
      expect(xml.slice(at), sp.slug).toMatch(/^<loc>[^<]*<\/loc>\s*<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    }
  });

  it("Her, Him and Kids link their search pages before and after JavaScript", async () => {
    for (const g of ["her", "him", "kids"]) {
      const { doc } = await served(g);
      const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(GuideSearchLinks, { slug: g })));
      expect(html).toContain("Popular searches");
      for (const sp of searchPagesOf(g)) {
        expect(doc, `${g} pre-JS -> ${sp.slug}`).toContain(`href="/gift-guides/${sp.slug}"`);
        expect(html, `${g} page -> ${sp.slug}`).toContain(`href="/gift-guides/${sp.slug}"`);
      }
    }
  }, 60_000);
});
