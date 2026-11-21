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
 * Owner 11-21, later ("remove small business stuff from black friday stuff. like each day has its own section, no need
 * to put them all in 1"; "[Deals & codes box] should open collapsed"): each deals day is its own live page,
 * /gift-guides/black-friday, /gift-guides/small-business-saturday and /gift-guides/cyber-monday (DEAL_DAY_SLUGS), each
 * with its codes box collapsed; the old one-page address opens Black Friday (its #<day> anchors that day), a 301 before JS.
 *
 * Owner 11-21, later the same day ("put like a line ... under search bar"; "i also dont see the fun features anymore
 * like the quiz, etc. or the tags"; "i dont see the discount codes or sales on the left section either"; "there will
 * also need to be a free section for our tags color book elf guides"; "move the 25 days of giveaways up"): the deals
 * page is live again with its own sidebar entry and its codes and sales open on it, never on the landing ("Codes and
 * deals shouldn't randomly show in sections"); the landing has a hairline under the search row, the 25 Days card right
 * under the tiles, then the gift finder, the fun tools, the free printables (ready ones only) and the deals card. The
 * tiles stay exactly Her, Him and Kids.
 *
 * Owner 11-21 ~12:05 PM and after ("move the holiday hub into the left column and remove it from the main holiday
 * screen"; "move 25 day sponsors to the left panel too"; "i have already said free printables, louisiana hub, sponsors go
 * in the left panel ... and black friday deals, small business saturday and cyber monday"): the main column is the
 * three tiles, the 25 Days giveaways card and the gift finder; no Holiday Hub card, sponsors' row, printables or deals
 * card. The left menu holds Her, Him, Kids, then Black Friday deals, Small Business Saturday, Cyber Monday (the deals
 * page's sections), Free printables, Louisiana Holiday Hub and 25 Days sponsors, then the fun tools.
 *
 * @mutate src/content/giftGuideLive.mjs | export const LIVE_GUIDES_1121 = ["her", "him", "kids", "25-days-sponsors", "black-friday", "small-business-saturday", "cyber-monday"]; | export const LIVE_GUIDES_1121 = ["her", "him", "kids", "25-days-sponsors", "black-friday", "small-business-saturday", "cyber-monday", "teens"];
 * @mutate src/content/giftGuideLive.mjs | export const LIVE_GUIDES_1121 = ["her", "him", "kids", "25-days-sponsors", "black-friday", "small-business-saturday", "cyber-monday"]; | export const LIVE_GUIDES_1121 = ["her", "him", "kids", "25-days-sponsors", "black-friday", "cyber-monday"];
 * @mutate src/pages/info/GiftGuides.tsx |   if (slug === DEALS_SLUG) return <Navigate to={`/gift-guides/${oldDealsTarget(hash)}`} replace />; |   if (slug === DEALS_SLUG) return <Navigate to="/gift-guides/black-friday" replace />;
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |   LIVE_GUIDES_1121.filter((slug) => !NOT_TILES.has(slug)).flatMap((slug) => { |   LIVE_GUIDES_1121.flatMap((slug) => {
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       {finderAsked(search, hash) && <GiftFinder />} |       <GiftFinder />
 * @mutate src/pages/info/GiftGuides.tsx |         {landing && <hr className="gg-divider" data-gift-divider="" />} |         {null}
 * @mutate src/content/printables.ts |   if (!p.ready) return false; |   if (false) return false;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |           <DealsAndCodes on={codesDay(day, today)} /> |           {null}
 * @mutate src/content/giftGuideCatalog.ts | draftOf.has(slug) && isLiveGuide(slug) && | draftOf.has(slug) &&
 * @mutate src/prerender/seoData.ts | else if (!to && !guides[old]) moved[old] = ""; | else if (!to && !guides[old] && old.startsWith("store-")) moved[old] = "";
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       <LiveGuides /> |       {null}
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |         <li><Link to="/holidays" data-gift-side-holiday-hub="">{G.holidayHub.title}</Link></li> |         {null}
 * @mutate src/content/giftGuides.ts |     { id: "cyber-monday", label: "Cyber Monday" }, |
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       {finderAsked(search, hash) && <GiftFinder />} |       {finderAsked(search, hash) && <GiftFinder />}<aside data-gift-holiday-hub="" />
 * @mutate api/share.ts |     if (slug === DEALS_SLUG) return { kind: "moved", |     if (false) return { kind: "moved",
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
import { GUIDES, ROWS, guidesIn, loadAllGuidePicks, newSlugFor, searchGuides } from "@/content/giftGuideCatalog";
import { RELATION_PAGES } from "@/content/giftGuidePeople.mjs";
import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { CHUNK_SLUGS, PICK_CHUNKS } from "@/content/giftGuidePicks";
import { DEAL_DAY_SLUGS, DEALS_SLUG } from "@/content/giftGuideDeals.mjs";
import { shownPrintables } from "@/content/printables";
import { buildSeoData } from "@/prerender/seoData";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

afterEach(cleanup);

const LIVE = ["her", "him", "kids"];
const SPONSORS = "25-days-sponsors";
/** The fun tools' pages the landing and the sidebar link (App.tsx routes), and the printables page. */
const TOOLS = ["/gift-guides/swipe", "/gift-guides/draw-names", "/gift-guides/planner"];
const PRINTABLES = "/gift-guides/printables";
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
  it("the live list is exactly Her, Him, Kids, the 25 Days sponsors page and the three deals days; every other guide is a relationship view of Her or Him", () => {
    expect([...LIVE_GUIDES_1121]).toEqual([...LIVE, SPONSORS, "black-friday", "small-business-saturday", "cyber-monday"]);
    expect([...DEAL_DAY_SLUGS]).toEqual(["black-friday", "small-business-saturday", "cyber-monday"]);
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
    for (const slug of ["teens", "store-amazon", "gifts-by-color"]) {
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
  });

  it("each deals day opens as its own page with its own banner title, its codes box collapsed, and the menu marks the deals (owner 11-21)", () => {
    const titles: Record<string, string> = { "black-friday": "Black Friday Deals", "small-business-saturday": "Small Business Saturday", "cyber-monday": "Cyber Monday Deals" };
    for (const slug of DEAL_DAY_SLUGS) {
      const { container } = renderAt(`/gift-guides/${slug}`);
      expect(container.querySelector("[data-test-where]")?.textContent, slug).toBe(`/gift-guides/${slug}`);
      expect(container.querySelector("[data-gift-deal-day-page]")?.getAttribute("data-gift-deal-day-page"), slug).toBe(slug);
      expect(container.querySelector("#gift-guide-title")?.textContent, slug).toBe(titles[slug]);
      // The banner holds the lead and the title only (owner 11-21: "remove louisiana helpr from the [banner]").
      expect(container.querySelector("[data-gift-arch]")?.textContent, slug).not.toMatch(/Louisiana Helpr/i);
      expect(container.querySelector("[data-gift-deals-jump]"), slug).toBeNull();
      const codes = container.querySelector<HTMLDetailsElement>("[data-gift-deals-page] details[data-gift-deals-codes]");
      if (slug === "small-business-saturday") expect(codes, slug).toBeNull();
      else {
        expect(codes, `${slug}: the codes and sales box`).not.toBeNull();
        expect(codes!.open, slug).toBe(false);
      }
      expect(container.querySelector("[data-gift-side-deals='black-friday']")?.getAttribute("aria-current"), slug).toBe("page");
      expect(container.querySelector("[data-gift-sidebar] a[data-gift-side='']")?.getAttribute("aria-current"), slug).toBeNull();
      cleanup();
    }
  });

  it("the old one-page deals address opens Black Friday, and each old #day anchor that day's page, before JS too", async () => {
    for (const [from, to] of [
      [`/gift-guides/${DEALS_SLUG}`, "/gift-guides/black-friday"],
      [`/gift-guides/${DEALS_SLUG}#black-friday`, "/gift-guides/black-friday"],
      [`/gift-guides/${DEALS_SLUG}#small-business-saturday`, "/gift-guides/small-business-saturday"],
      [`/gift-guides/${DEALS_SLUG}#cyber-monday`, "/gift-guides/cyber-monday"],
    ]) {
      const { container } = renderAt(from);
      expect(container.querySelector("[data-test-where]")?.textContent, from).toBe(to);
      cleanup();
    }
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    const handler = (await import(/* @vite-ignore */ sharePath)).default as { fetch: (r: Request) => Promise<Response> };
    const old = await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=page&_id=gift-guides/${DEALS_SLUG}`));
    expect(old.status).toBe(301);
    expect(old.headers.get("location")).toBe("https://www.louisianahelpr.com/gift-guides/black-friday");
    for (const slug of DEAL_DAY_SLUGS) {
      const res = await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=page&_id=gift-guides/${slug}`));
      expect(res.status, slug).toBe(200);
      const html = await res.text();
      expect(html, slug).toContain(`https://www.louisianahelpr.com/gift-guides/${slug}`);
    }
  });

  it("the 25 Days sponsors page still opens as itself", () => {
    const { container } = renderAt(`/gift-guides/${SPONSORS}`);
    expect(container.querySelector("[data-test-where]")?.textContent).toBe(`/gift-guides/${SPONSORS}`);
    expect(container.querySelector("#gift-guide-title")).not.toBeNull();
  });

  it("the landing: a divider, the three guide tiles and the 25 Days card; the rest is in the left menu; no Top 10, Gift of the Day or codes", () => {
    const { container } = renderAt("/gift-guides");
    const tiles = [...container.querySelectorAll<HTMLAnchorElement>("[data-gift-live-guides] a[data-gift-tile]")].map((a) => a.getAttribute("href"));
    expect(tiles).toEqual(LIVE.map((s) => `/gift-guides/${s}`));
    // The hairline sits between the search row and the menu + guides (owner 11-21), on the landing only.
    const divider = container.querySelector("hr[data-gift-divider]");
    expect(divider).not.toBeNull();
    expect(divider!.nextElementSibling?.classList.contains("gg-layout")).toBe(true);
    // The main column, in order and nothing else (owner 11-21): the tiles and the 25 Days card right under them. The
    // finder (the quiz) shows under them only when the menu's link (#gift-finder) or a shared finder link asks for it.
    const kinds = (c: HTMLElement) => [...c.querySelector(".gg-landing")!.children].map((x) => (x.matches("[data-gift-browse]") ? "tiles" : x.matches("[data-gift-giveaways]") ? "giveaways" : x.matches("[data-gift-finder]") ? "finder" : x.outerHTML.slice(0, 60)));
    expect(kinds(container)).toEqual(["tiles", "giveaways"]);
    for (const url of ["/gift-guides#gift-finder", "/gift-guides?who=her&budget=50&vibe=cozy"]) {
      const asked = renderAt(url).container;
      expect(kinds(asked), url).toEqual(["tiles", "giveaways", "finder"]);
      asked.remove();
    }
    expect(container.querySelector(".gg-main")!.querySelector("[data-gift-holiday-hub], [data-gift-sponsors], .gg-spons, [data-gift-tools], [data-gift-extras], a[data-gift-printables], a[data-gift-deals-link]"), "main column").toBeNull();
    // The left menu: the three guides, then the deals days, printables, the Holiday Hub and the sponsors, then the tools.
    const more = [...container.querySelectorAll("[data-gift-side-more] a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(more).toEqual([
      ["Black Friday deals", `/gift-guides/${DEALS_SLUG}#black-friday`],
      ["Small Business Saturday", `/gift-guides/${DEALS_SLUG}#small-business-saturday`],
      ["Cyber Monday", `/gift-guides/${DEALS_SLUG}#cyber-monday`],
      ["Free printables", PRINTABLES],
      ["Louisiana Holiday Hub", "/holidays"],
      ["25 Days sponsors", `/gift-guides/${SPONSORS}`],
    ]);
    expect([...container.querySelectorAll("[data-gift-side-tools] a")].map((a) => a.getAttribute("href"))).toEqual(["/gift-guides#gift-finder", ...TOOLS]);
    // The free printables show only what is ready (the gift tags and, owner 11-21 "boys coloring pages are ready for
    // site", the coloring book; owner 11-21 "add this to the free printables", the Thanksgiving banner), never the elf kit.
    expect(shownPrintables().map((p) => p.title)).toEqual(["Gift tags with names", "Christmas coloring book", "Happy Thanksgiving banner"]);
    // Codes and sales live only on the deals page; the deleted Gift of the Day and the retired strips stay gone.
    expect(container.querySelector("[data-gift-top], [data-gift-countdown], [data-gift-of-the-day], [data-gift-deals-codes], [data-gift-codes], [data-gift-sales], [data-gift-entries], [data-gift-more-groups]")).toBeNull();
    // No link anywhere on the landing to a retired guide.
    const hrefs = [...container.querySelectorAll<HTMLAnchorElement>("a[href^='/gift-guides/']")].map((a) => a.getAttribute("href")!.slice("/gift-guides/".length).split("#")[0]);
    expect(hrefs.length).toBeGreaterThan(2);
    const pages = ["my-list", DEALS_SLUG, ...[...TOOLS, PRINTABLES].map((t) => t.slice("/gift-guides/".length))];
    for (const h of hrefs) expect([...LIVE, SPONSORS, ...pages], h).toContain(h);
    cleanup();
    // A guide's page has no divider and no deals box (owner 11-21: "Codes and deals shouldn't randomly show in sections").
    const her = renderAt("/gift-guides/her").container;
    expect(her.querySelector("hr[data-gift-divider]")).toBeNull();
    expect(her.querySelector("[data-gift-deals-codes]")).toBeNull();
    cleanup();
    const sponsors = renderAt(`/gift-guides/${SPONSORS}`).container;
    expect(sponsors.querySelector("[data-gift-side-sponsors]")?.getAttribute("aria-current")).toBe("page");
    expect(sponsors.querySelector("[data-gift-deals-codes]")).toBeNull();
  });

  it("the gift finder asks only about people with a live guide, and offers only budgets their picks can fill", async () => {
    await loadAllGuidePicks();
    const { container } = renderAt("/gift-guides?who=him#gift-finder");
    const who = [...container.querySelectorAll('[data-gift-finder-step="who"] [data-gift-finder-choice]')].map((b) => b.getAttribute("data-gift-finder-choice"));
    expect(who).toEqual(["who:her", "who:him", "who:mom", "who:dad", "who:kids"]);
    const budgets = [...container.querySelectorAll('[data-gift-finder-step="budget"] [data-gift-finder-choice]')].map((b) => b.getAttribute("data-gift-finder-choice"));
    // Owner 11-21 ~12:05 PM ("each item also needs a price"; "Show Amazon prices anyway"): Him's Amazon picks carry
    // their captured prices now, so every budget his picks can fill is offered (was only "$100" and "Any budget").
    expect(budgets).toEqual(["budget:25", "budget:50", "budget:100", "budget:0"]);
    cleanup();
    const herBudgets = [...renderAt("/gift-guides?who=her#gift-finder").container.querySelectorAll('[data-gift-finder-step="budget"] [data-gift-finder-choice]')].length;
    expect(herBudgets).toBeGreaterThan(1);
    cleanup();
    const done = renderAt("/gift-guides?who=him&budget=0&vibe=cozy").container;
    expect(done.querySelectorAll("[data-gift-finder-results] li[data-gift-pick]").length).toBeGreaterThan(2);
    cleanup();
    // An old link naming a retired guide's person starts the finder over (no results, no dead step).
    expect(renderAt("/gift-guides?who=teen&budget=0&vibe=cozy").container.querySelector("[data-gift-finder-results]")).toBeNull();
  });

  it("search, the sitemap, the SEO list, the search index and the bundled chunks name no retired guide", async () => {
    for (const q of ["teens", "amazon", "color", "nurse", "coffee"]) {
      for (const g of searchGuides(q)) expect([...LIVE, SPONSORS, ...Object.keys(RELATION_PAGES)], `${q}: ${g.slug}`).toContain(g.slug);
    }
    const allowed = new Set([...LIVE, SPONSORS, ...DEAL_DAY_SLUGS, ...Object.keys(RELATION_PAGES)]);
    const sitemap = [...readFileSync("public/sitemap.xml", "utf8").matchAll(/\/gift-guides\/([a-z0-9-]+)</g)].map((m) => m[1]);
    const tools = new Set(["swipe", "planner", "draw-names", "printables"]);
    expect(sitemap.filter((s) => !tools.has(s)).length).toBeGreaterThan(3);
    for (const s of sitemap) if (!tools.has(s)) expect(allowed.has(s), `sitemap: ${s}`).toBe(true);
    for (const s of Object.keys(GIFT_GUIDE_SEO)) expect(allowed.has(s), `SEO: ${s}`).toBe(true);
    // The three deals days are in the sitemap; the old one-page address (a redirect now) is not.
    for (const slug of DEAL_DAY_SLUGS) expect(sitemap).toContain(slug);
    expect(sitemap).not.toContain(DEALS_SLUG);
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
