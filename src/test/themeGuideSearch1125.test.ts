/**
 * Owner 2026-11-25 1:15 AM ("Add the guides so they are seen in Google searches and with other ai searches"): each
 * themed kids guide (THEME_GUIDE_NAMES_1124) gets a search title, description, card text, intro, Q&A with FAQPage
 * JSON-LD and llms.txt line built from its own picks (src/content/themeGuideSearch.mjs, src/lib/guideQa.mjs), Kids links
 * every theme in its pre-JS body and each theme links Kids and the other themes. Before: "Monster Jam gift guide —
 * Helpr", a description naming its three cheapest picks, no Q&A, and Kids' pre-JS body linked 6 of the 9 themes.
 * The served HTML is checked through api/share.ts with the build's own seo data (as seoPageBodies.test.ts does).
 *
 * @mutate src/lib/giftGuidePageMeta.mjs | if (theme) { | if (false) {
 * @mutate src/lib/guideQa.mjs | if (Object.prototype.hasOwnProperty.call(THEME_GUIDE_NAMES_1124, slug)) return themeGuideQa( | if (false) return themeGuideQa(
 * @mutate src/lib/seoBodies.mjs | (themes ? `<h2>Gifts by theme</h2><ul>${themes}</ul>` : "") + | "" +
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { buildSeoData } from "@/prerender/seoData";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { KIDS_THEME_GUIDES_1124, THEME_GUIDES_1124, THEME_GUIDE_NAMES_1124, isDealTheme } from "@/content/giftGuideLive.mjs";
import { giftKind, themeGuideSearch, THEME_DESCRIPTION_MAX, THEME_TITLE_MAX } from "@/content/themeGuideSearch.mjs";
import { giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { catalogGuideQa, newestPriceDay } from "@/lib/guideQa.mjs";
import { themeSearchPicks, type SeoData } from "@/lib/seoBodies.mjs";
import { lastmodDates } from "../../scripts/generate-sitemap.mjs";

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

const page = async (slug: string) => (await handler.fetch(new Request(`${ORIGIN}/api/share?_og=page&_id=gift-guides/${slug}`))).text();
const attr = (doc: string, re: RegExp) => (re.exec(doc)?.[1] ?? "").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const titleOf = (doc: string) => attr(doc, /<title>([^<]*)<\/title>/);
const descOf = (doc: string) => attr(doc, /<meta name="description" content="([^"]*)"/);
const jsonLd = (doc: string) => [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
/** Owner rules for public copy: no "y'all", no act-by dates, no hype, no emoji. */
const BANNED = /y'all|\bby dec\b|\bbest\b|\bamazing\b|\bultimate\b|\bmust-have\b|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/iu;
/** Our own words in a line: every product and store name (data, "Amazing Spider-Man", "Best Buy") cut out first. */
const ownWords = (text: string, names: readonly string[]) => [...names].sort((a, b) => b.length - a.length).reduce((t, n) => (n ? t.split(n).join(" ") : t), text);

describe("themed kids guides in search (owner 2026-11-25)", () => {
  it("every theme is indexed, so the sitemap, llms.txt and IndexNow list it (a new theme follows THEME_GUIDE_NAMES_1124)", () => {
    expect(THEME_GUIDES_1124.length).toBeGreaterThan(5);
    for (const s of THEME_GUIDES_1124) expect(Object.keys(GIFT_GUIDE_SEO), s).toContain(s);
    const xml = readFileSync(resolve(ROOT, "public/sitemap.xml"), "utf8");
    const llms = readFileSync(resolve(ROOT, "public/llms.txt"), "utf8");
    // Each theme's <lastmod> is its newest price check (or a newer Q&A day), never missing.
    const dates = lastmodDates(THEME_GUIDES_1124.map((s) => `/gift-guides/${s}`));
    for (const s of THEME_GUIDES_1124) {
      expect(xml, s).toContain(`<loc>${ORIGIN}/gift-guides/${s}</loc>`);
      const chunk = JSON.parse(readFileSync(resolve(ROOT, `src/content/giftGuidePicks/${s}.json`), "utf8")) as { picks: { priceAt?: string }[] };
      expect(dates[`/gift-guides/${s}`] >= (newestPriceDay(chunk.picks) ?? ""), s).toBe(true);
      // llms.txt: the theme's search title and its data line, never the old template.
      const line = llms.split("\n").find((l) => l.includes(`(${ORIGIN}/gift-guides/${s})`)) ?? "";
      expect(line, s).toContain(`[${THEME_GUIDE_NAMES_1124[s as keyof typeof THEME_GUIDE_NAMES_1124]} `);
      // A store deals guide (Sam's Club Black Friday, owner 11-25) counts deals, never "for kids".
      expect(line, s).toMatch(isDealTheme(s) ? /\d+ .+ deals?\b/ : /\d+ .+ Christmas gift ideas? for kids/);
      if (isDealTheme(s)) expect(line, s).not.toMatch(/for kids/i);
      expect(line, s).not.toContain("hand-picked holiday gift ideas");
    }
  });

  it("each theme's title, description and card text come from its own picks, short and plain", () => {
    for (const s of THEME_GUIDES_1124) {
      const g = data.guides[s];
      const name = THEME_GUIDE_NAMES_1124[s as keyof typeof THEME_GUIDE_NAMES_1124];
      const picks = themeSearchPicks(g.picks);
      const meta = giftGuidePageMeta(s, "", [], g.count, picks, today());
      const t = themeGuideSearch(name, picks, g.count, today(), { deals: isDealTheme(s) });
      expect(t, s).not.toBeNull();
      expect(meta.title, s).toBe(t!.title);
      expect(meta.title.startsWith(`${name} `), s).toBe(true);
      expect(meta.title, s).toMatch(/ 2026[: ].* — Helpr$/);
      expect(meta.title.length, s).toBeLessThanOrEqual(THEME_TITLE_MAX);
      expect(meta.description.length, s).toBeLessThanOrEqual(THEME_DESCRIPTION_MAX);
      expect(meta.description.startsWith(isDealTheme(s) ? `${g.count} ${name} deal` : `${g.count} ${name} Christmas gift idea`), s).toBe(true);
      expect(meta.ogTitle, s).toBe(meta.title.replace(/ — Helpr$/, ""));
      expect(meta.ogDescription, s).toBe(meta.description);
      expect(meta.robots, s).toBeUndefined();
      // Every kind the title names is one at least three of its gifts are, and every store the description names sells
      // a priced gift on the list.
      const kinds = g.picks.map((p) => giftKind(p[0]));
      for (const k of ["trucks", "clothes", "plush", "toys", "books", "games", "LEGO sets", "room decor", "cars", "school gear"]) {
        if (meta.title.includes(` ${k}`)) expect(kinds.filter((x) => x === k).length, `${s} ${k}`).toBeGreaterThanOrEqual(3);
      }
      for (const store of new Set(g.picks.map((p) => p[1]).filter(Boolean))) {
        if (meta.description.includes(store)) expect(g.picks.some((p) => p[1] === store && p[3]?.price), `${s} ${store}`).toBe(true);
      }
      expect(ownWords(`${meta.title} ${meta.description} ${t!.intro}`, g.picks.flatMap((p) => [p[0], p[1]])), s).not.toMatch(BANNED);
    }
    // Any other guide ignores theme picks: Her keeps its keyword head.
    expect(giftGuidePageMeta("her", "", [], 10, [{ name: "x", price: 5, priceAt: today(), store: "Walmart" }]).title).toBe("Gifts for her 2026: Christmas ideas under $25 & $50 — Helpr");
  });

  it("each theme's Q&A answers only from its own picks", () => {
    for (const s of THEME_GUIDES_1124) {
      const g = data.guides[s];
      const name = THEME_GUIDE_NAMES_1124[s as keyof typeof THEME_GUIDE_NAMES_1124];
      expect(g.qa?.length, s).toBeGreaterThan(0);
      const qa = catalogGuideQa(s, g.qa!, today());
      expect(qa.length, s).toBeGreaterThanOrEqual(3);
      expect(qa.some((x) => x.q.startsWith("Where can I buy")), s).toBe(true);
      for (const { q, a } of qa) {
        expect(q === "How current are the prices?" || q.includes(name), `${s}: ${q}`).toBe(true);
        expect(ownWords(`${q} ${a}`, g.qa!.flatMap((p) => [p.name, p.store ?? ""])), s).not.toMatch(BANNED);
      }
      // A named gift is a real pick on the list.
      const names = new Set(g.qa!.map((p) => p.name));
      for (const { a } of qa.filter((x) => /A few: |The priciest: /.test(x.a))) {
        const first = a.split(/A few: |The priciest: /)[1].split(" (~$")[0];
        expect(names.has(first), `${s}: ${first}`).toBe(true);
      }
    }
  });

  it("Monster Jam and Bluey are served with their search head, intro, Q&A and FAQPage JSON-LD before JavaScript", async () => {
    for (const s of ["monster-jam", "bluey"]) {
      const doc = await page(s);
      const meta = giftGuidePageMeta(s, "", [], data.guides[s].count, themeSearchPicks(data.guides[s].picks), today());
      expect(titleOf(doc), s).toBe(meta.title);
      expect(descOf(doc), s).toBe(meta.description);
      expect(attr(doc, /<meta property="og:title" content="([^"]*)"/), s).toBe(meta.ogTitle);
      // The Facebook picture is unchanged: the theme's wide card.
      expect(doc, s).toContain(`<meta property="og:image" content="${ORIGIN}/gift-guides/og-wide/${s}.jpg?v=`);
      const types = jsonLd(doc).map((b) => b["@type"]);
      expect(types, s).toEqual(expect.arrayContaining(["BreadcrumbList", "ItemList", "FAQPage"]));
      // Google's Product snippet rules: no Product without offers.
      const list = jsonLd(doc).find((b) => b["@type"] === "ItemList") as { itemListElement: { item?: { "@type": string; offers?: { price: number; priceCurrency: string } } }[] };
      for (const e of list.itemListElement) if (e.item?.["@type"] === "Product") expect(e.item.offers?.priceCurrency, s).toBe("USD");
      const body = doc.slice(doc.indexOf('<main id="seo-page"'));
      expect(body, s).toContain(`${THEME_GUIDE_NAMES_1124[s as "bluey"]} Christmas gifts for kids`);
      expect(body, s).toContain('<section id="guide-qa"');
      expect(body, s).toMatch(/Updated [A-Z][a-z]{2} \d{1,2}, 2026/);
      // Links back to Kids and to every other theme.
      expect(body, s).toContain('<a href="/gift-guides/kids">');
      for (const o of KIDS_THEME_GUIDES_1124.filter((x) => x !== s)) expect(body, `${s} -> ${o}`).toContain(`<a href="/gift-guides/${o}">`);
    }
  });

  it("Kids' pre-JS body links every themed guide by its theme's name", async () => {
    const body = (await page("kids")).split('<main id="seo-page"')[1] ?? "";
    expect(body).toContain("<h2>Gifts by theme</h2>");
    // The kids themes (a store deals guide is not one: samsClubBlackFriday1125).
    for (const s of KIDS_THEME_GUIDES_1124) {
      expect(body, s).toContain(`<a href="/gift-guides/${s}">${THEME_GUIDE_NAMES_1124[s as keyof typeof THEME_GUIDE_NAMES_1124].replace(/&/g, "&amp;")} gifts</a>`);
    }
  });
});
