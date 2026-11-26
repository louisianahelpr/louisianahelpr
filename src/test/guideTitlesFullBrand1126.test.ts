/**
 * SEO 1126 (owner Thu 11-26 ~2:35 AM: "Make us well known in Google. We need to show up everywhere as much as
 * possible"; lead lexilombas-14). Measured live with a Googlebot fetch before this change: every gift guide title ended
 * " — Helpr" ("Helpr" alone is another company on Google: SEO plan 11-19), themed guides led with gift kinds instead of
 * the words people type, the deals days said "gift deals & codes", and no guide carried a dateModified.
 *
 * This guard holds, for EVERY indexed gift guide page (the catalog guides in GIFT_GUIDE_SEO, the deals days, the
 * search pages and the /gift-guides pages in PUBLIC_PAGE_META):
 *  - its <title> ends " | Louisiana Helpr" and never " — Helpr";
 *  - a themed kids guide's title leads "<Theme> gifts 2026: <count> ... toys & gift ideas" (the owner's example);
 *  - the deals days lead "Black Friday deals 2026 + discount codes" / "Cyber Monday deals 2026 + discount codes";
 *  - the served HTML of a guide with an "Updated" line carries a CollectionPage whose dateModified IS that shown day,
 *    and a deals day's crawler intro counts what the page lists.
 *
 * @mutate src/content/guideSearch.mjs | export const GUIDE_TITLE_SUFFIX = " \| Louisiana Helpr"; | export const GUIDE_TITLE_SUFFIX = " — Helpr";
 * @mutate src/content/themeGuideSearch.mjs |     `${theme} gifts 2026: ${f.count} ${theme} toys & gift ideas`, |     `${theme} gifts 2026: ${theme} toys & gift ideas`,
 * @mutate api/share.ts | shownDay: qa.length ? day : undefined }; | shownDay: undefined };
 * @mutate src/lib/seoBodies.mjs |   const more = dealsCountLine(day); |   const more = "";
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { buildSeoData } from "@/prerender/seoData";
import type { SeoData } from "@/lib/seoBodies.mjs";
import { GUIDE_TITLE_SUFFIX } from "@/content/guideSearch.mjs";
import { SEARCH_PAGES } from "@/content/guideSearchPages.mjs";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { THEME_GUIDE_NAMES_1124 } from "@/content/giftGuideLive.mjs";
import { publicOrGiftGuidePageMetaFor } from "@/lib/giftGuidePageMeta.mjs";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";

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
const titleOf = (doc: string) => decode(doc.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
const ldBlocks = (doc: string) =>
  [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

describe("gift guide titles carry the full brand (SEO 1126)", () => {
  it("every indexed gift guide head ends ' | Louisiana Helpr'", () => {
    expect(GUIDE_TITLE_SUFFIX).toBe(" | Louisiana Helpr");
    const paths = [
      ...Object.keys(GIFT_GUIDE_SEO).map((s) => `/gift-guides/${s}`),
      "/gift-guides/black-friday",
      "/gift-guides/cyber-monday",
      "/gift-guides/small-business-saturday",
      ...Object.keys(PUBLIC_PAGE_META).filter((k) => k.startsWith("/gift-guides")),
    ];
    expect(paths.length).toBeGreaterThan(15);
    const heads = paths.map((p) => [p, publicOrGiftGuidePageMetaFor(p, null)?.title ?? ""] as const);
    expect(heads.filter(([, t]) => !t.endsWith(GUIDE_TITLE_SUFFIX) || / — Helpr$/.test(t))).toEqual([]);
    const search = (SEARCH_PAGES as { slug: string; title: string }[]).map((sp) => [sp.slug, sp.title] as const);
    expect(search.length).toBeGreaterThan(20);
    expect(search.filter(([, t]) => !t.endsWith(GUIDE_TITLE_SUFFIX))).toEqual([]);
  });

  it("served titles: themes lead with '<Theme> gifts 2026: <count> ... toys & gift ideas', deals days with the searched phrase", async () => {
    const themes = Object.keys(THEME_GUIDE_NAMES_1124).filter((s) => data.guides[s]?.picks.length && !/black-friday/.test(s));
    expect(themes.length).toBeGreaterThan(5);
    for (const slug of themes) {
      const t = titleOf(await page(`gift-guides/${slug}`));
      const name = THEME_GUIDE_NAMES_1124[slug];
      expect(t, slug).toMatch(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} gifts 2026: (\\d+ )?(.+ )?toys & gift ideas \\| Louisiana Helpr$`));
    }
    expect(titleOf(await page("gift-guides/black-friday"))).toBe("Black Friday deals 2026 + discount codes | Louisiana Helpr");
    expect(titleOf(await page("gift-guides/cyber-monday"))).toBe("Cyber Monday deals 2026 + discount codes | Louisiana Helpr");
    expect(titleOf(await page("gift-guides/bluey"))).toMatch(/^Bluey gifts 2026: \d+ Bluey toys & gift ideas \| Louisiana Helpr$/);
  });

  it("a guide's dateModified is exactly the Updated day its page shows", async () => {
    let checked = 0;
    for (const slug of ["her", "him", "kids", "bluey", "monster-jam", "black-friday"]) {
      const doc = await page(`gift-guides/${slug}`);
      const shown = doc.match(/Updated ([A-Z][a-z]{2}) (\d{1,2})/);
      const cp = ldBlocks(doc).find((b) => b["@type"] === "CollectionPage");
      if (!shown) {
        expect(cp, `${slug}: no Updated line, so no dateModified`).toBeUndefined();
        continue;
      }
      expect(cp, slug).toBeDefined();
      const [, mon, day] = (cp!.dateModified as string).split("-");
      expect(`${MONTHS[Number(mon) - 1]} ${Number(day)}`, slug).toBe(`${shown[1]} ${shown[2]}`);
      expect(cp!.url, slug).toBe(`${ORIGIN}/gift-guides/${slug}`);
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });

  it("a deals day's crawler intro says what the page lists", async () => {
    const doc = await page("gift-guides/black-friday");
    expect(decode(doc)).toMatch(/<h1>Black Friday Deals<\/h1><p>[^<]+ This page lists \d+ deals?[^<]*a link straight to the store\.<\/p>/);
  });
});
