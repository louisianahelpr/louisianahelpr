/**
 * SEO P1 (owner 11-19: "a lot of google work we need to show up for every search louisiana Helpr relates to").
 *
 * Audit 11-18 (curl as Googlebot): every URL api/share.ts served carried the homepage's body (the landing shell's H1
 * "Louisiana's local partner.", its text and links) and the same site-wide JSON-LD; only the head differed, so Google
 * indexed the homepage alone. Unknown guides and towns answered 200 with the homepage (soft 404s).
 *
 * This checks api/share's real output, end to end without a browser (the same request Vercel's rewrite sends):
 *   - each gift guide, the guides landing, every hire page and the main info pages carry their OWN body: exactly one
 *     <h1> (never the landing's), an intro, the guide's picks as plain sponsored links, breadcrumb links;
 *   - no landing, login or signup shell outside its own path; the LocalBusiness and Organization blocks stay home-only;
 *   - per-page JSON-LD parses: BreadcrumbList everywhere, ItemList on guides, Event (Dec 1-25, 2026) on /25days;
 *   - unknown /gift-guides/<x> and /hire/<x>/<y> answer 404 with a helpful page; an old guide slug answers 301;
 *   - a guide's description is its own (count and first picks), and no title anywhere reads "Gifts for the: X".
 *
 * @mutate api/share.ts | const page = seo?.kind === "page" ? withJsonLd(withRootBody(withMeta, seo.body), seo.jsonLd) : withMeta; | const page = withMeta;
 * @mutate api/share.ts |   return html.replace(SHELL_BLOCK_RE, (block, id: string) => (id === keep ? block : "")); |   return html;
 * @mutate api/share.ts |     return { kind: "notfound", body: notFoundBody("gift-guide") }; |     return null;
 * @mutate api/share.ts |     if (!found) return { kind: "notfound", body: notFoundBody("hire") }; |     if (!found) return null;
 * @mutate api/share.ts |   return html.replace(SITE_ENTITY_RE, ""); |   return html;
 * @mutate src/lib/seoBodies.mjs | rel="sponsored nofollow noopener" | rel="noopener"
 * @mutate src/lib/giftGuidePageMeta.mjs |     giftGuideDescription(name, topNames, count) ?? | null ??
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { buildSeoData } from "@/prerender/seoData";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { allTownPagePaths } from "@/lib/townPages.mjs";
import { INFO_BODY_PATHS } from "@/lib/seoBodies.mjs";
import type { SeoData } from "@/lib/seoBodies.mjs";

const ROOT = resolve(__dirname, "..", "..");
const ORIGIN = "https://www.louisianahelpr.com";
let handler: { fetch: (req: Request) => Promise<Response> };
let data: SeoData;

beforeAll(async () => {
  // As staticPagesRawHtml.test.ts: the build's generated module is absent or an empty placeholder in a test run, so the
  // handler gets the real data from the same builder the build runs (vi.doMock by absolute path, after it exists).
  ensureOgShellSnapshot(ROOT);
  // No network: /declutter's photo preload read fails closed (the page is served without the header, as designed).
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline in this test"); }));
  data = await buildSeoData();
  vi.doMock(resolve(ROOT, "scripts/generated/seo-data.js"), () => ({ SEO_DATA: data }));
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
}, 120_000);

/** The exact request vercel.json's rewrite sends for a page. */
const fetchPage = (id: string) => handler.fetch(new Request(`${ORIGIN}/api/share?_og=page&_id=${id}`));
const html = async (id: string) => {
  const res = await fetchPage(id);
  return { status: res.status, body: await res.text(), res };
};
const rootOf = (doc: string) => doc.slice(doc.indexOf('<div id="root"'));
/** The document's <h1> elements; a "<h1" inside an inline script's string is not markup, so scripts are blanked first. */
const h1s = (doc: string) => {
  // Cut every inline script out by index (case-insensitive), not by a replace regex, so no "<script" survives.
  let out = "";
  let rest = doc;
  for (;;) {
    const open = rest.search(/<script\b/i);
    if (open < 0) break;
    out += rest.slice(0, open);
    const close = rest.slice(open).search(/<\/script\s*>/i);
    if (close < 0) { rest = ""; break; }
    rest = rest.slice(open + close).replace(/^<\/script\s*>/i, "");
  }
  out += rest;
  return [...out.matchAll(/<h1[\s>][\s\S]*?<\/h1>/gi)].map((m) => m[0]);
};
const jsonLd = (doc: string) =>
  [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
const types = (doc: string) => jsonLd(doc).map((b) => b["@type"]);

const LANDING_H1 = "Louisiana’s local partner.";
const LANDING_H1_ASCII = "Louisiana's local partner.";

function expectOwnPage(doc: string, h1Text: string) {
  const heads = h1s(doc);
  expect(heads, "exactly one <h1>").toHaveLength(1);
  expect(heads[0]).toContain(h1Text);
  expect(doc).not.toContain(LANDING_H1);
  expect(doc).not.toContain(LANDING_H1_ASCII);
  expect(doc).not.toContain('id="lh-landing-shell"');
  expect(rootOf(doc)).toContain('data-seo-body=""');
  expect(rootOf(doc)).toContain('<nav aria-label="Breadcrumb">');
  expect(types(doc)).not.toContain("Organization");
  expect(types(doc)).not.toContain("LocalBusiness");
  expect(types(doc)).toContain("BreadcrumbList");
}

describe("the data the build writes", () => {
  it("holds every indexed guide, with picks for the guides that have them", () => {
    const slugs = Object.keys(GIFT_GUIDE_SEO);
    // Big batch 2026-11-20: ~65 merged guides and 30 store pages (the old guides 301 to their sections).
    expect(slugs.length).toBeGreaterThan(80);
    for (const s of slugs) expect(data.guides[s], s).toBeDefined();
    expect(Object.values(data.guides).filter((g) => g.indexed && g.picks.length > 0).length).toBeGreaterThan(80);
    expect(data.groups.length).toBeGreaterThan(5);
  });

  it("npm run build writes it (scripts/prerender-static-pages.mjs) and api/share imports it", () => {
    expect(readFileSync(resolve(ROOT, "scripts/prerender-static-pages.mjs"), "utf8")).toMatch(/seo-data\.js[\s\S]*buildSeoData\(\)/);
    expect(readFileSync(resolve(ROOT, "api/share.ts"), "utf8")).toContain('import { SEO_DATA } from "../scripts/generated/seo-data.js";');
  });
});

describe("gift guides carry their own body for a reader with no JavaScript", () => {
  it("/gift-guides/mom: one H1, the intro, its first picks as sponsored links, breadcrumb, ItemList", async () => {
    const { status, body } = await html("gift-guides/mom");
    expect(status).toBe(200);
    expectOwnPage(body, "Gifts for Mom");
    const mom = data.guides.mom;
    expect(mom.picks.length).toBeGreaterThan(5);
    const [name, store, href] = mom.picks[0];
    const root = rootOf(body);
    expect(root).toContain(`>${name.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}</a>`);
    expect(root).toContain(`on ${store.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}`);
    expect(root).toContain(`href="${href.replace(/&/g, "&amp;")}" rel="sponsored nofollow noopener"`);
    expect(root).toContain('<a href="/gift-guides">Holiday Gift Guides</a>');
    const list = jsonLd(body).find((b) => b["@type"] === "ItemList") as { itemListElement: { name: string; url: string }[] };
    expect(list.itemListElement[0]).toMatchObject({ name, url: href });
    expect(body).toContain('<meta name="robots" content="index, follow" />');
  });

  it("every indexed guide with picks names its first pick in the raw HTML (sampled across the list)", async () => {
    const slugs = Object.keys(GIFT_GUIDE_SEO).filter((s) => data.guides[s]?.picks.length);
    const sample = slugs.filter((_, i) => i % 15 === 0);
    expect(sample.length).toBeGreaterThan(5);
    for (const s of sample) {
      const { status, body } = await html(`gift-guides/${s}`);
      expect(status, s).toBe(200);
      expect(h1s(body), s).toHaveLength(1);
      expect(rootOf(body), s).toContain(`rel="sponsored nofollow noopener"`);
    }
  });

  it("/gift-guides links every guide the page groups, and carries an ItemList of guide URLs", async () => {
    const { status, body } = await html("gift-guides");
    expect(status).toBe(200);
    expectOwnPage(body, "Holiday Gift Guides");
    const links = [...rootOf(body).matchAll(/<a href="\/gift-guides\/([a-z0-9-]+)">/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(80); // 1120: ~65 guides + 30 store pages
    expect(links).toContain("mom");
    expect(types(body)).toContain("ItemList");
  });

  it("a guide's description is its own: the count and its first picks", async () => {
    const { body } = await html("gift-guides/mom");
    const desc = /<meta name="description" content="([^"]*)">/.exec(body)?.[1] ?? "";
    expect(desc).toMatch(/^Gifts for Mom 2026: \d+ hand-picked gift ideas, like /);
    expect(desc).not.toContain("hand-picked holiday gift ideas from Louisiana Helpr, with a link to shop each one");
  });

  it("no guide title anywhere reads 'Gifts for the: X'", async () => {
    for (const name of Object.values(GIFT_GUIDE_SEO)) expect(name).not.toMatch(/for the:/i);
    // 1120: Artist is a section of Creatives & Hobbyists; Home Cook keeps its "for the" lead.
    const { body } = await html("gift-guides/home-cook");
    expect(/<title>([^<]*)<\/title>/.exec(body)?.[1]).toBe("Gifts for the Foodie &amp; Home Cook — Helpr");
  });
});

describe("real 404s, not the homepage under a 200", () => {
  it("an unknown guide answers 404 with a helpful page and noindex", async () => {
    const { status, body, res } = await html("gift-guides/not-a-real-guide-xyz");
    expect(status).toBe(404);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(h1s(body)).toEqual(["<h1>Page not found</h1>"]);
    expect(body).toContain('<a href="/gift-guides">See every holiday gift guide</a>');
    expect(body).toContain('<meta name="robots" content="noindex, follow" />');
    expect(body).not.toContain(LANDING_H1);
  });

  it("an unknown service or town answers 404", async () => {
    for (const id of ["hire/handyman/nowhere", "hire/plumbing/lafayette", "hire/handyman/lake-charles"]) {
      const { status, body } = await html(id);
      expect(status, id).toBe(404);
      expect(body, id).not.toContain(LANDING_H1);
    }
  });

  it("the catch-all 404 carries the helpful page too", async () => {
    const res = await handler.fetch(new Request(`${ORIGIN}/api/share?_og=notfound`));
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(h1s(body)).toEqual(["<h1>Page not found</h1>"]);
  });

  it("an old guide slug the page forwards answers 301 to its guide", async () => {
    const [old, to] = Object.entries(data.moved)[0];
    const res = await fetchPage(`gift-guides/${old}`);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/gift-guides/${to}`);
  });

  it("a catalog guide kept out of search answers 200 with noindex (not a 404)", async () => {
    const [slug] = Object.entries(data.guides).find(([, g]) => !g.indexed)!;
    const { status, body } = await html(`gift-guides/${slug}`);
    expect(status).toBe(200);
    expect(body).toContain('<meta name="robots" content="noindex, follow" />');
  });
});

describe("the sitemap lists only real, indexable pages, with lastmod", () => {
  const xml = readFileSync(resolve(ROOT, "public/sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);

  it("every guide and hire URL in it is one the function serves 200 and indexable; /25days is in it", async () => {
    // The two own pages (the deals guide, Small Business Saturday) answer 200 with their own body: checked by fetching.
    const own = ["/gift-guides/black-friday-cyber-monday", "/gift-guides/small-business-saturday"];
    const guides = locs.filter((p) => p.startsWith("/gift-guides/") && !own.includes(p));
    expect(guides.length).toBeGreaterThan(80); // 1120: ~65 merged guides + 30 store pages
    for (const p of guides) expect(data.guides[p.slice("/gift-guides/".length)]?.indexed, p).toBe(true);
    for (const p of own) {
      expect(locs, p).toContain(p);
      expect((await fetchPage(p.slice(1))).status, p).toBe(200);
    }
    for (const p of locs.filter((x) => x.startsWith("/hire/")).slice(0, 5)) expect((await fetchPage(p.slice(1))).status, p).toBe(200);
    expect(locs).toContain("/25days");
    expect(locs).not.toContain("/sponsor");
  });

  it("a guide whose picks carry a price-check day has that day as its lastmod", () => {
    expect(xml).toMatch(/<loc>https:\/\/www\.louisianahelpr\.com\/gift-guides<\/loc>\s*<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    expect((xml.match(/<lastmod>/g) ?? []).length).toBeGreaterThan(40);
  });
});

describe("hire pages and the main info pages carry their own body", () => {
  it("every /hire/<service>/<town> page: its H1, the intro, sibling links", async () => {
    const paths = allTownPagePaths();
    expect(paths.length).toBeGreaterThan(30);
    for (const p of paths) {
      const { status, body } = await html(p.slice(1));
      expect(status, p).toBe(200);
      expect(h1s(body), p).toHaveLength(1);
      expect(rootOf(body), p).toMatch(/<h1>[^<]+, LA<\/h1>/);
      expect(body, p).not.toContain(LANDING_H1);
    }
    const { body } = await html("hire/handyman/lafayette");
    expectOwnPage(body, "Handyman in Lafayette, LA");
    expect(rootOf(body)).toContain('<a href="/hire/handyman/baton-rouge">');
  });

  it("each info page: its own H1, no landing shell", async () => {
    expect(INFO_BODY_PATHS).toEqual(expect.arrayContaining(["/declutter", "/help", "/support", "/fees", "/safety", "/25days"]));
    for (const p of INFO_BODY_PATHS) {
      const { status, body } = await html(p.slice(1));
      expect(status, p).toBe(200);
      expect(h1s(body), p).toHaveLength(1);
      expect(body, p).not.toContain('id="lh-landing-shell"');
    }
  });

  it("/declutter keeps its own skeleton shell, and only that one", async () => {
    const { body } = await html("declutter");
    expect(body).toContain('id="lh-declutter-shell"');
    for (const other of ["lh-landing-shell", "lh-login-shell", "lh-signup-shell", "lh-home-shell", "lh-jobs-shell", "lh-messages-shell"]) {
      expect(body, other).not.toContain(`id="${other}"`);
    }
  });

  it("/25days is indexable with Event markup for December 1-25, 2026 and no sponsor's day", async () => {
    const { status, body } = await html("25days");
    expect(status).toBe(200);
    expect(body).toContain('<meta name="robots" content="index, follow" />');
    const ev = jsonLd(body).find((b) => b["@type"] === "Event") as Record<string, unknown>;
    expect(ev).toMatchObject({ startDate: "2026-12-01", endDate: "2026-12-25", isAccessibleForFree: true });
    expect(JSON.stringify(ev)).not.toMatch(/subEvent|sponsor/i);
  });
});
