/**
 * Only three gift guides are live (owner 2026-11-21 2:47 AM: "launch the 3 guides remove the rest that are live ...
 * should we jsut do him, her and kids?"; decided yes): Her, Him and Kids (src/content/giftGuideLive.mjs), plus the
 * relationship pages that are views of Her and Him (Mom, Wife, Dad ...) and the 25 Days sponsors page, which is no gift
 * guide and stays as it was. Every other guide (interest guides, store pages, the deals and Small Business Saturday
 * pages) is retired: no tile, menu entry, search row, sitemap or SEO entry, no chunk in the bundle, and its old link
 * lands on /gift-guides (in the page, and as a 301 from api/share.ts). The landing is the three tiles, then the 25 Days
 * sponsors' row (its "See all" opens the sponsors page) and the giveaways card.
 *
 * Owner 11-21 (later): "we still need to do the black friday section, small business saturday, and cyber monday deals":
 * the deals page (DEALS_SLUG) is live again as one page with the three day sections; the standalone Small Business
 * Saturday page stays retired (its businesses are the deals page's middle section).
 *
 * @mutate src/content/giftGuideLive.mjs | export const LIVE_GUIDES_1121 = ["her", "him", "kids", "25-days-sponsors", "black-friday-cyber-monday"]; | export const LIVE_GUIDES_1121 = ["her", "him", "kids", "25-days-sponsors", "black-friday-cyber-monday", "teens"];
 * @mutate src/content/giftGuideCatalog.ts | draftOf.has(slug) && isLiveGuide(slug) && | draftOf.has(slug) &&
 * @mutate src/prerender/seoData.ts | else if (!to && !guides[old]) moved[old] = ""; | else if (!to && !guides[old] && old.startsWith("store-")) moved[old] = "";
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       <LiveGuides /> |       {null}
 * @mutate api/share.ts | if ((slug === SMALL_BIZ_SLUG \|\| slug === DEALS_SLUG) && !isLiveGuide(slug)) | if (false)
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";
import { GUIDES, ROWS, guidesIn, newSlugFor, searchGuides } from "@/content/giftGuideCatalog";
import { RELATION_PAGES } from "@/content/giftGuidePeople.mjs";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { CHUNK_SLUGS, PICK_CHUNKS } from "@/content/giftGuidePicks";
import { DEALS_SLUG } from "@/content/giftGuideDeals.mjs";
import { SMALL_BIZ_SLUG } from "@/content/giftGuideSmallBiz.mjs";
import { buildSeoData } from "@/prerender/seoData";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

afterEach(cleanup);

const LIVE = ["her", "him", "kids"];
const SPONSORS = "25-days-sponsors";
/** Guides that were live before 11-21 (one of each kind): an interest guide, a store page, a color guide, a career guide. */
const RETIRED = ["teens", "store-amazon", "gifts-by-color", "healthcare", "car-lover", "store-target", "pets", "splurge"];

function Where() {
  const { pathname, search } = useLocation();
  return <p data-test-where="">{pathname + search}</p>;
}
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<><GiftGuides /><Where /></>} />
        <Route path="/gift-guides/:slug" element={<><GiftGuides /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );

describe("only Her, Him and Kids are live (owner 11-21)", () => {
  it("the live list is exactly Her, Him, Kids and the 25 Days sponsors page; every other guide is a relationship view of Her or Him", () => {
    expect([...LIVE_GUIDES_1121]).toEqual([...LIVE, SPONSORS, DEALS_SLUG]);
    const own = GUIDES.filter((g) => !g.view).map((g) => g.slug).sort();
    expect(own).toEqual([...LIVE, SPONSORS].sort());
    const views = GUIDES.filter((g) => g.view);
    expect(views.length).toBeGreaterThan(5); // Mom, Wife, Dad, Husband ... measured 2026-11-21 (10)
    for (const v of views) {
      expect(RELATION_PAGES[v.slug], v.slug).toBeTruthy();
      expect(["her", "him"], v.slug).toContain(v.view!.of);
    }
  });

  it("the menu groups and rows hold only the live guides", () => {
    const listed = ROWS.flatMap((r) => guidesIn(r.row).map((g) => g.slug)).sort();
    expect(listed).toEqual([...LIVE, SPONSORS].sort());
  });

  it("a retired guide's old link opens the landing page, in the page and as a 301 from the pre-JS page", async () => {
    for (const slug of RETIRED) expect(newSlugFor(slug), slug).toBeNull();
    for (const slug of [...LIVE, SPONSORS, "mom", "dad"]) expect(newSlugFor(slug), slug).toBe(slug);
    for (const slug of ["teens", "store-amazon", "gifts-by-color", SMALL_BIZ_SLUG]) {
      const { container } = renderAt(`/gift-guides/${slug}`);
      expect(container.querySelector("[data-test-where]")?.textContent, slug).toBe("/gift-guides");
      cleanup();
    }
    // A group with no live guide left opens the landing itself.
    expect(renderAt("/gift-guides?group=by-store").container.querySelector("[data-gift-rows]")).toBeNull();
    cleanup();
    const d = await buildSeoData();
    expect(Object.keys(d.guides).sort()).toEqual(GUIDES.map((g) => g.slug).sort());
    for (const slug of RETIRED) expect(d.moved[slug], slug).toBe("");
    // The Small Business Saturday page answers a 301 to the landing before JS too; the deals page answers itself.
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    const handler = (await import(/* @vite-ignore */ sharePath)).default as { fetch: (r: Request) => Promise<Response> };
    for (const slug of [SMALL_BIZ_SLUG]) {
      const res = await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=page&_id=gift-guides/${slug}`), );
      expect(res.status, slug).toBe(301);
      expect(res.headers.get("location"), slug).toBe("https://www.louisianahelpr.com/gift-guides");
    }
  });

  it("the deals page opens as itself (owner 11-21), before JS too", async () => {
    const { container } = renderAt(`/gift-guides/${DEALS_SLUG}`);
    expect(container.querySelector("[data-test-where]")?.textContent).toBe(`/gift-guides/${DEALS_SLUG}`);
    expect(container.querySelector("[data-gift-deals-page]")).not.toBeNull();
    cleanup();
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    const handler = (await import(/* @vite-ignore */ sharePath)).default as { fetch: (r: Request) => Promise<Response> };
    const res = await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=page&_id=gift-guides/${DEALS_SLUG}`));
    expect(res.status).toBe(200);
  });

  it("the 25 Days sponsors page still opens as itself", () => {
    const { container } = renderAt(`/gift-guides/${SPONSORS}`);
    expect(container.querySelector("[data-test-where]")?.textContent).toBe(`/gift-guides/${SPONSORS}`);
    expect(container.querySelector("#gift-guide-title")).not.toBeNull();
  });

  it("the landing is the three guide tiles, then the 25 Days sponsors and giveaways; no Top 10, finder, deals or tools", () => {
    const { container } = renderAt("/gift-guides");
    const tiles = [...container.querySelectorAll<HTMLAnchorElement>("[data-gift-live-guides] a[data-gift-tile]")].map((a) => a.getAttribute("href"));
    expect(tiles).toEqual(LIVE.map((s) => `/gift-guides/${s}`));
    expect(container.querySelector("[data-gift-giveaways]")).not.toBeNull();
    expect(container.querySelector("[data-gift-top], [data-gift-finder], [data-gift-countdown], [data-gift-deals], [data-gift-codes], [data-gift-entries], [data-gift-more-groups], [data-gift-side-tools]")).toBeNull();
    // No link anywhere on the landing to a retired guide.
    const hrefs = [...container.querySelectorAll<HTMLAnchorElement>("a[href^='/gift-guides/']")].map((a) => a.getAttribute("href")!.slice("/gift-guides/".length).split("#")[0]);
    expect(hrefs.length).toBeGreaterThan(2);
    for (const h of hrefs) expect([...LIVE, SPONSORS, DEALS_SLUG, "my-list"], h).toContain(h);
  });

  it("search, the sitemap, the SEO list, the search index and the bundled chunks name no retired guide", async () => {
    for (const q of ["teens", "amazon", "color", "nurse", "coffee"]) {
      for (const g of searchGuides(q)) expect([...LIVE, SPONSORS, ...Object.keys(RELATION_PAGES)], `${q}: ${g.slug}`).toContain(g.slug);
    }
    const allowed = new Set([...LIVE, SPONSORS, DEALS_SLUG, ...Object.keys(RELATION_PAGES)]);
    const sitemap = [...readFileSync("public/sitemap.xml", "utf8").matchAll(/\/gift-guides\/([a-z0-9-]+)</g)].map((m) => m[1]);
    const tools = new Set(["swipe", "planner", "draw-names", "printables"]);
    expect(sitemap.filter((s) => !tools.has(s)).length).toBeGreaterThan(3);
    for (const s of sitemap) if (!tools.has(s)) expect(allowed.has(s), `sitemap: ${s}`).toBe(true);
    for (const s of Object.keys(GIFT_GUIDE_SEO)) expect(allowed.has(s), `SEO: ${s}`).toBe(true);
    // The deals page is in the sitemap; the retired Small Business Saturday page is not.
    expect(sitemap).toContain(DEALS_SLUG);
    expect(sitemap).not.toContain(SMALL_BIZ_SLUG);
    const index = JSON.parse(readFileSync("src/content/giftGuideSearchIndex.json", "utf8")) as [string, string][];
    expect(index.length).toBeGreaterThan(20);
    for (const [, s] of index) expect([...LIVE, SPONSORS], `search index: ${s}`).toContain(s);
    expect([...CHUNK_SLUGS].sort()).toEqual([...LIVE, SPONSORS].sort());
    expect(Object.keys(PICK_CHUNKS).sort()).toEqual([...LIVE, SPONSORS].sort().map((s) => `./giftGuidePicks/${s}.json`));
    // The retired chunks stay on disk (research output and the content guards), never listed.
    expect(readdirSync("src/content/giftGuidePicks").filter((f) => f.endsWith(".json")).length).toBeGreaterThan(CHUNK_SLUGS.length);
  });

  it("the sponsors' row links no retired guide", () => {
    const rows = JSON.parse(readFileSync("src/content/giftGuideSponsorLogos.json", "utf8")) as { href: string }[];
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows.filter((x) => x.href.startsWith("/gift-guides/"))) {
      expect([...LIVE, SPONSORS], r.href).toContain(r.href.slice("/gift-guides/".length).split("#")[0]);
    }
  });
});
