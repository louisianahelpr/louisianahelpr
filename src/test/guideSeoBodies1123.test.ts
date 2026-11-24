/**
 * Seo bodies 1123 (technical SEO audit 11-23, ~/Desktop/Louisiana Helpr Work/Gift guides and affiliate/
 * Audit-technical-seo-1123.md; owner 11-22: be found and recommended by Google, Bing and AI assistants). What a reader
 * with no JavaScript (Bingbot, GPTBot, PerplexityBot, ClaudeBot) gets from api/share.ts:
 *   - TS2: a deals day's ItemList drops a card the day the page does (dealShows: an undated card through Dec 1 only);
 *   - TS3: Black Friday and Cyber Monday list the page's three sections (Top deals, Discount codes, Sales) with the
 *     same counts the page, the guides menu and the Q&A give; Small Business Saturday lists every business with its
 *     link; /25days lists the undated lineup (never a day, never how to enter) and links the sponsors' gift guide;
 *   - TS4: a guide lists every pick, not the 40 cheapest, and its ItemList counts what its intro says;
 *   - TS5: every link an info page's body carries opens a live page (no retired guide);
 *   - TS10, TS12, TS13, TS15, TS16: the /25days Event's organizer, typed short URLs, the deleted store guides' 301,
 *     the gift guides level in tool breadcrumbs, no canonical on a 404.
 */
// @mutate src/lib/seoBodies.mjs | dealShows({ ends: ends \|\| undefined }, today) | !(ends && ends < today)
// @mutate src/lib/seoBodies.mjs | (codes ? `<h2>Discount codes</h2><ul>${codes}</ul>` : "") + | "" +
// @mutate src/lib/seoBodies.mjs | (sales ? `<h2>Sales</h2><ul>${sales}</ul>` : "") + | "" +
// @mutate src/lib/seoBodies.mjs | const extra = path === "/25days" ? lineupHtml(lineup) : ""; | const extra = "";
// @mutate src/prerender/seoData.ts |     for (const p of indexed ? g.picks : []) { |     for (const p of indexed ? g.picks.slice(0, 40) : []) {
// @mutate src/lib/seoBodies.mjs | links: [["/gift-guides/planner", "Gift planner"], ["/gift-guides/swipe", "Swipe to find gifts"], ["/gift-guides", "Holiday gift guides"]], | links: [["/gift-guides/secret-santa", "Secret Santa and White Elephant gift ideas"], ["/gift-guides", "Holiday gift guides"]],
// @mutate src/content/giftGuideCatalog.ts |   "store-kaiya-baby", "store-lofree", "store-magic-story", "store-xplora"]; |   "store-kaiya-baby", "store-lofree", "store-xplora"];
// @mutate src/lib/seoBodies.mjs | ${code ? ` (code <code>${escapeHtml(code)}</code>)` : ""} |  (code <code>${escapeHtml(code)}</code>)
// @mutate api/share.ts | return withRootBody(head.replace(/<link rel="canonical" href="[^"]*">\s*/, ""), body); | return withRootBody(head, body);
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { buildSeoData } from "@/prerender/seoData";
import { dealsItemListLd, INFO_BODY_LINKS, INFO_BODY_PATHS, type SeoData } from "@/lib/seoBodies.mjs";
import { dealDayParts, STORE_CODES } from "@/content/giftGuideDealCounts";
import { DEAL_EVENTS, DEALS_WORDS, STEAL_CATEGORIES, liveDeals, dealsIn, type Deal } from "@/content/giftGuideDeals.mjs";
import { isLiveGuide } from "@/content/giftGuideLive.mjs";
import deals from "@/content/giftGuideDeals.json";

const ROOT = resolve(__dirname, "..", "..");
const ORIGIN = "https://www.louisianahelpr.com";
let handler: { fetch: (req: Request) => Promise<Response> };
let data: SeoData;

beforeAll(async () => {
  ensureOgShellSnapshot(ROOT);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline in this test"); }));
  data = await buildSeoData();
  vi.doMock(resolve(ROOT, "scripts/generated/seo-data.js"), () => ({ SEO_DATA: data }));
  handler = (await import(/* @vite-ignore */ ["..", "..", "api", "share"].join("/"))).default;
}, 120_000);

afterEach(() => {
  vi.useRealTimers();
});

const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${iso}T18:00:00Z`));
};
const fetchPage = (id: string) => handler.fetch(new Request(`${ORIGIN}/api/share?_og=page&_id=${id}`));
const page = async (id: string) => (await fetchPage(id)).text();
const seoBody = (doc: string) => {
  const i = doc.indexOf('<main id="seo-page"');
  return doc.slice(i, doc.indexOf("</main>", i));
};
/** The body's sections by <h2>: heading -> its list items (the Q&A section after it is no list). */
const sections = (body: string) =>
  Object.fromEntries(
    body
      .split("<h2>")
      .slice(1)
      .map((s) => [s.slice(0, s.indexOf("</h2>")), (s.match(/<li>/g) ?? []).length] as const),
  );
const jsonLd = (doc: string) =>
  [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
const itemList = (doc: string) => jsonLd(doc).find((b) => b["@type"] === "ItemList") as { numberOfItems: number; itemListElement: { name?: string; url?: string; item?: { name: string; url: string } }[] } | undefined;

const DEAL_DAYS = DEAL_EVENTS.filter((e) => e.kind === "deals" && isLiveGuide(e.id)).map((e) => e.id);

describe("TS2: a deals day's ItemList drops a card the day the page does", () => {
  it("an undated card is in the markup through Dec 1 and gone on Dec 2 (the page's dealShows rule)", () => {
    const rows = data.deals ?? [];
    const undated = rows.filter((r) => r[2] === "" && r[3] === "black-friday");
    // 13 undated Black Friday cards with no code (audit 11-23); a floor, not an exact count (the deals file moves).
    expect(undated.length).toBeGreaterThan(5);
    const names = (ld: ReturnType<typeof dealsItemListLd>) => (ld?.itemListElement as { url: string }[] | undefined)?.map((x) => x.url) ?? [];
    const dec1 = names(dealsItemListLd("Black Friday Deals", rows, "2026-12-01", "black-friday"));
    const dec2 = names(dealsItemListLd("Black Friday Deals", rows, "2026-12-02", "black-friday"));
    for (const r of undated) {
      expect(dec1, r[0]).toContain(r[1]);
      expect(dec2, r[0]).not.toContain(r[1]);
    }
  });

  it("on every day from Nov 20 to Jan 5 the Top deals the markup counts are the page's (liveDeals)", () => {
    for (const id of DEAL_DAYS) {
      for (let t = Date.parse("2026-11-20T12:00:00Z"); t <= Date.parse("2027-01-05T12:00:00Z"); t += 864e5) {
        const day = new Date(t).toISOString().slice(0, 10);
        const page = dealsIn(liveDeals(deals as Deal[], day, STORE_CODES), id).filter((d) => d.item && d.href).length;
        const ld = dealsItemListLd("x", data.deals ?? [], day, id);
        expect(ld ? (ld.itemListElement as unknown[]).length : 0, `${id} ${day}`).toBe(page);
      }
    }
  });
});

describe("TS3: the deals days and /25days list what the page shows", () => {
  it("Black Friday and Cyber Monday list Top deals, Discount codes and Sales with the page's counts, on several days", async () => {
    let checked = 0;
    for (const day of ["2026-11-23", "2026-11-27", "2026-11-30", "2026-12-02", "2026-12-20"]) {
      at(day);
      for (const id of DEAL_DAYS) {
        const doc = await page(`gift-guides/${id}`);
        const body = seoBody(doc);
        const parts = dealDayParts(id, deals as Deal[], day);
        const got = sections(body);
        // Owner pop-up 11-24: "Biggest store sales" (was "Top deals"), then the steals under their category headings.
        expect(got[DEALS_WORDS.topTitle] ?? 0, `${id} ${day} store sales`).toBe(parts.deals);
        expect(STEAL_CATEGORIES.reduce((n, c) => n + (got[c.title.replace(/&/g, "&amp;")] ?? 0), 0), `${id} ${day} steals`).toBe(parts.steals);
        expect(got["Discount codes"] ?? 0, `${id} ${day} codes`).toBe(parts.codes);
        expect(got["Sales"] ?? 0, `${id} ${day} sales`).toBe(parts.sales);
        // The ItemList names the same cards: one per row of the lists.
        expect(itemList(doc)?.numberOfItems ?? 0, `${id} ${day} ItemList`).toBe(parts.deals + parts.steals + parts.codes + parts.sales);
        for (const x of itemList(doc)?.itemListElement ?? []) {
          expect(x.name, `${id} ${day}`).toBeTruthy();
          expect(x.url, `${id} ${day}`).toMatch(/^https:\/\//);
        }
        checked += parts.deals + parts.steals + parts.codes + parts.sales;
      }
    }
    // 61 + 42 rows on 2026-11-23 alone (audit 11-23).
    expect(checked).toBeGreaterThan(100);
  });

  it("a no-code sale in Discount codes (Bruno Marc 25% off, code \"\", 2026-11-23) prints no empty code", async () => {
    at("2026-11-23");
    const noCode = Object.values(data.dealLists ?? {}).flatMap((l) => l.codes).filter((c) => c[1] === "");
    // Bruno Marc's Black Friday sale (giftGuides.ts STORE_CODES, 2026-11-23); a floor, not an exact count.
    expect(noCode.length).toBeGreaterThan(0);
    for (const id of DEAL_DAYS) {
      const body = seoBody(await page(`gift-guides/${id}`));
      expect(body, id).not.toContain("<code></code>");
      expect(body, id).not.toContain("(code )");
    }
    expect(seoBody(await page("gift-guides/black-friday"))).toContain("no code needed");
  });

  it("every outbound deals link is marked sponsored", async () => {
    at("2026-11-23");
    const body = seoBody(await page("gift-guides/black-friday"));
    const out = [...body.matchAll(/<a href="https:[^"]*"([^>]*)>/g)];
    expect(out.length).toBeGreaterThan(20);
    for (const m of out) expect(m[1]).toContain('rel="sponsored nofollow noopener"');
  });

  it("Small Business Saturday lists every business, each linking where its card does", async () => {
    at("2026-11-23");
    const body = seoBody(await page("gift-guides/small-business-saturday"));
    const shops = data.smallBiz ?? [];
    expect(shops.length).toBeGreaterThan(20);
    // The "Gift guides and deals" cross-links (seo 1123) are their own list after the businesses.
    const bizList = body.split("<h2>Gift guides and deals</h2>")[0];
    expect((bizList.match(/<li>/g) ?? []).length).toBe(shops.length);
    for (const [name, , , , href] of shops) {
      const label = name.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
      if (href) expect(body, name).toContain(`href="${href.replace(/&/g, "&amp;")}" rel="noopener noreferrer" target="_blank">${label}</a>`);
      else expect(body, name).toContain(label);
    }
  });

  it("/25days lists the undated lineup and links the sponsors' gift guide; no day and no way to enter", async () => {
    const body = seoBody(await page("25days"));
    const partners = data.lineup?.partners ?? [];
    expect(partners.length).toBeGreaterThan(50);
    for (const [brand] of partners) expect(body, brand).toContain(brand.replace(/&/g, "&amp;").replace(/'/g, "&#39;"));
    expect(body).toContain('<a href="/gift-guides/25-days-sponsors">');
    // Owner 11-17: no sponsor's day; owner 11-21: the rules and how to enter live only on Facebook.
    const lineup = body.slice(body.indexOf("<h2>"), body.indexOf("</ul>", body.indexOf("<h2>")));
    expect(lineup.length).toBeGreaterThan(1000);
    // Exactly the page's lineup rows (publicPartners: brand and prize words only; a prize's own event date, like a show on
    // Dec 6, is the prize's words on the page too), and no giveaway day.
    expect((lineup.match(/<li>/g) ?? []).length).toBe(partners.length);
    expect(lineup).not.toMatch(/\bDay \d|\bgiveaway day\b/i);
    expect(body).not.toMatch(/\b(tag|share|follow|comment)\b[^<]{0,40}\bto enter\b/i);
  });
});

describe("TS4: a guide lists every pick", () => {
  it("Her, Him, Kids and the sponsors' guide list as many picks as their intro counts, and the ItemList does too", async () => {
    at("2026-11-23");
    for (const slug of ["her", "him", "kids", "25-days-sponsors"]) {
      const g = data.guides[slug];
      expect(g.count, slug).toBeGreaterThan(40);
      expect(g.picks.length, slug).toBe(g.count);
      const doc = await page(`gift-guides/${slug}`);
      const ol = /<ol>([\s\S]*?)<\/ol>/.exec(seoBody(doc))?.[1] ?? "";
      expect((ol.match(/<li>/g) ?? []).length, slug).toBe(g.count);
      expect(seoBody(doc), slug).toContain(`${g.count} hand-picked`);
      expect(itemList(doc)?.numberOfItems, slug).toBe(g.count);
    }
  });

  it("the longest guide's page stays small (under 60 KB gzipped; Googlebot reads 15 MB)", async () => {
    const { gzipSync } = await import("node:zlib");
    let longest = "";
    for (const slug of ["her", "him", "kids", "25-days-sponsors"]) {
      const doc = await page(`gift-guides/${slug}`);
      if (doc.length > longest.length) longest = doc;
    }
    expect(gzipSync(longest).length).toBeLessThan(60_000);
  });
});

describe("Lows", () => {
  it("TS5: every link an info page's body carries opens a live page (no retired guide)", () => {
    const guideLinks = INFO_BODY_LINKS.filter((h) => h.startsWith("/gift-guides/"));
    expect(guideLinks.length).toBeGreaterThan(10);
    for (const href of guideLinks) {
      const slug = href.slice("/gift-guides/".length);
      expect(INFO_BODY_PATHS.includes(href) || isLiveGuide(slug), href).toBe(true);
    }
  });

  it("TS13: the store guides deleted outright answer 301 to the gift guides landing page", async () => {
    const slugs = ["store-adagio-teas", "store-amscope", "store-andaseat", "store-cashmere-boutique", "store-forte-chocolate", "store-hairmax", "store-kaiya-baby", "store-lofree", "store-magic-story", "store-xplora"];
    for (const s of slugs) {
      const r = await fetchPage(`gift-guides/${s}`);
      expect(r.status, s).toBe(301);
      expect(r.headers.get("location"), s).toBe(`${ORIGIN}/gift-guides`);
    }
  });

  it("TS16: a 404 names no canonical", async () => {
    const r = await fetchPage("gift-guides/nonexistent-guide-1123");
    expect(r.status).toBe(404);
    const doc = await r.text();
    expect(doc).not.toContain('rel="canonical"');
    expect(doc).toContain("noindex");
  });

  it("TS15: tools and printables under /gift-guides carry the gift guides level in their breadcrumb", async () => {
    for (const id of ["gift-guides/draw-names", "gift-guides/printables/gift-tags"]) {
      const crumbs = jsonLd(await page(id)).find((b) => b["@type"] === "BreadcrumbList") as { itemListElement: { name: string }[] };
      expect(crumbs.itemListElement.map((c) => c.name), id).toContain("Holiday gift guides");
    }
  });

  it("TS10: the /25days Event's organizer is the homepage's Organization node", async () => {
    const ev = jsonLd(await page("25days")).find((b) => b["@type"] === "Event") as { organizer: Record<string, string>; description: string };
    expect(ev.organizer["@id"]).toBe(`${ORIGIN}/#organization`);
    expect(readFileSync(resolve(ROOT, "index.html"), "utf8")).toContain(`"@id": "${ORIGIN}/#organization"`);
    expect(ev.description).toContain("national brands");
  });

  it("TS12: typed short URLs redirect permanently to their page", () => {
    const config = JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8")) as { redirects: { source: string; destination: string; permanent?: boolean }[] };
    const want: Record<string, string> = {
      "/25-days": "/25days", "/25-days-of-giveaways": "/25days", "/giveaway": "/25days", "/giveaways": "/25days",
      "/black-friday": "/gift-guides/black-friday", "/cyber-monday": "/gift-guides/cyber-monday", "/small-business-saturday": "/gift-guides/small-business-saturday",
    };
    for (const [from, to] of Object.entries(want)) {
      const r = config.redirects.find((x) => x.source === from);
      expect(r, from).toMatchObject({ destination: to, permanent: true });
    }
  });
});
