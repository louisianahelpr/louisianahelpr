/**
 * Google search setup (owner 2026-11-23 ~8:50 PM: the guide pages had ~3 Google visitors in 4 days). Live audit 11-23
 * (curl of the prerendered HTML): Her/Him/Kids titled just "Gifts for Her — Helpr" (no year, no "Christmas", no price
 * words), descriptions past 155 characters, a one-line generic pre-JS intro, Her linking only Him and Kids/the deals days
 * linking no other guide, and the deals days, swipe/planner pages missing a sitemap <lastmod>.
 *
 * Checks api/share.ts's real output (the request vercel.json's rewrite sends) for Her, Him and Kids: the keyword
 * <title> (at most 60 characters), the description (at most 155, with "Christmas gift ideas"), the visible intro in the
 * body, the cross-links to the other main guides and deals days, and an ItemList of the picks; plus the deals days'
 * titles and the sitemap's lastmod for every guide URL.
 *
 * @mutate src/lib/giftGuidePageMeta.mjs |     title: search ? search.title : `${name} — Helpr`, |     title: `${name} — Helpr`,
 * @mutate src/lib/seoBodies.mjs |       crossLinks(slug) + | "" +
 * @mutate src/lib/seoBodies.mjs | const intro = searchIntro(slug) ?? | const intro = null ??
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { buildSeoData } from "@/prerender/seoData";
import type { SeoData } from "@/lib/seoBodies.mjs";
import { DEAL_DAY_SEARCH_TITLES, GUIDE_CROSS_LINKS, GUIDE_SEARCH, MAX_DESCRIPTION } from "@/content/guideSearch.mjs";
import { giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { GUIDE_UPDATED } from "@/content/guideUpdated.mjs";

const ROOT = resolve(__dirname, "..", "..");
const ORIGIN = "https://www.louisianahelpr.com";
let handler: { fetch: (req: Request) => Promise<Response> };
let data: SeoData;

beforeAll(async () => {
  ensureOgShellSnapshot(ROOT);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline in this test"); }));
  data = await buildSeoData();
  vi.doMock(resolve(ROOT, "scripts/generated/seo-data.js"), () => ({ SEO_DATA: data }));
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
}, 120_000);

const page = async (id: string) => (await handler.fetch(new Request(`${ORIGIN}/api/share?_og=page&_id=${id}`))).text();
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const tag = (doc: string, re: RegExp) => decode(doc.match(re)?.[1] ?? "");
const ldBlocks = (doc: string) =>
  [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);

describe("gift guide search head (Her, Him, Kids)", () => {
  for (const slug of ["her", "him", "kids"] as const) {
    it(`${slug}: keyword title, short description, visible intro, cross-links and ItemList in the served HTML`, async () => {
      const doc = await page(`gift-guides/${slug}`);
      const head = doc.slice(0, doc.indexOf("</head>"));
      const title = tag(head, /<title>([^<]*)<\/title>/);
      expect(title).toBe(GUIDE_SEARCH[slug].title);
      expect(title.length).toBeLessThanOrEqual(60);
      expect(title).toMatch(/2026/);
      const desc = tag(head, /<meta name="description" content="([^"]*)"/);
      expect(desc.length).toBeGreaterThan(80);
      expect(desc.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
      expect(desc).toContain("Christmas gift ideas");
      expect(tag(head, /<meta property="og:description" content="([^"]*)"/)).toBe(desc);
      expect(tag(head, /<link rel="canonical" href="([^"]*)"/)).toBe(`${ORIGIN}/gift-guides/${slug}`);
      // The visible intro, in the body under the H1.
      const body = decode(doc.slice(doc.indexOf('<main id="seo-page"')));
      expect(body).toContain(GUIDE_SEARCH[slug].intro);
      // Every other main guide and live deals day is linked from the body.
      const others = GUIDE_CROSS_LINKS.filter(([s]) => s !== slug);
      expect(others.length).toBeGreaterThan(3);
      for (const [s] of others) expect(body, `${slug} -> ${s}`).toContain(`href="/gift-guides/${s}"`);
      // ItemList of the picks, positions 1..n, each with a name and a URL.
      const list = ldBlocks(doc).find((b) => b["@type"] === "ItemList") as { itemListElement: { position: number; name?: string; url?: string; item?: { name: string; url: string } }[] } | undefined;
      expect(list, "ItemList").toBeTruthy();
      expect(list!.itemListElement.length).toBeGreaterThan(50);
      list!.itemListElement.forEach((e, i) => {
        expect(e.position).toBe(i + 1);
        expect(e.name ?? e.item?.name).toBeTruthy();
        expect(e.url ?? e.item?.url).toMatch(/^https:\/\//);
      });
      expect(ldBlocks(doc).some((b) => b["@type"] === "BreadcrumbList")).toBe(true);
    });
  }

  it("the deals days and the landing carry their search titles (at most 60 characters)", () => {
    for (const [id, t] of Object.entries(DEAL_DAY_SEARCH_TITLES)) {
      expect(giftGuidePageMeta(id).title, id).toBe(t);
      expect(t.length, id).toBeLessThanOrEqual(60);
    }
    expect(PUBLIC_PAGE_META["/gift-guides"].title).toBe("Christmas gift ideas 2026: for her, him & kids — Helpr");
    expect(PUBLIC_PAGE_META["/gift-guides"].description.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
  });

  it("the sitemap gives every guide and deals day a lastmod no older than its Updated day", () => {
    const xml = readFileSync(resolve(ROOT, "public/sitemap.xml"), "utf8");
    const slugs = ["her", "him", "kids", "black-friday", "cyber-monday", "small-business-saturday"];
    for (const s of slugs) {
      const m = xml.match(new RegExp(`<loc>${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/gift-guides/${s}</loc>\\s*<lastmod>(\\d{4}-\\d{2}-\\d{2})</lastmod>`));
      expect(m, s).toBeTruthy();
      expect(m![1] >= GUIDE_UPDATED[s as keyof typeof GUIDE_UPDATED].day, s).toBe(true);
    }
  });
});
