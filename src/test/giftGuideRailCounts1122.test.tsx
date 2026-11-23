/**
 * The gift guides menu's numbers (owner 2026-11-22, 7:52 PM: "should we put the number of items in each section on the
 * right of the section name? like her (# of items) same for the free printable ones below?"; pop-up 7:55 PM: "Number on
 * the right"). Every number must be the one its page shows, recomputed here from the real data and the real pages:
 *   1. Every menu row is classified: a row with a list shows a number, a tool shows none, and a row in neither list fails
 *      (a new page row must be counted or named a tool). Two-way: a counted row with no number fails too.
 *   2. Her, Him, Kids and the 25 Days sponsors: the number equals the page's own count line (guide.picks.length once its
 *      picks are in, the "159 gifts" line).
 *   3. Gift tags, Coloring books, Banners: the number equals what each printables page draws (its design tiles, its books,
 *      its download cards).
 *   4. Black Friday and Cyber Monday: on each day from Nov 22 to Dec 3 the chunk's number equals the sum of the page's
 *      Top deals + Discount codes + Sales counts, the page rendered on that day.
 *   5. The Holiday Hub: the generated schedule (src/content/giftGuideRailCounts.json) is current, and at every day of the
 *      window (4 times a day) and either side of every leaving minute it equals what /holidays lists with no filter
 *      (filterHolidayItems minus endedEarlierToday, the page's own count).
 *   6. Small Business Saturday (owner 8:36 PM: "add the count to small business saturday too"): with the same approved
 *      "Featured local" read on both sides, the menu's number equals the businesses the page draws (sponsor cards +
 *      featured local cards); a failed read gives the sponsors alone; the sponsors' count in the generated file is current.
 * The menu loads none of the pick data (CHUNK_PICK_COUNTS, printables.ts and a lazy chunk only): the critical-path budget
 * (scripts/perf/critical-path.mjs) holds that.
 *
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | {g.title}<N n={CHUNK_PICK_COUNTS[g.slug]} noun="gifts" /> | {g.title}<N n={CHUNK_PICK_COUNTS[g.slug] + 1} noun="gifts" />
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | {G.sideSponsorsLabel}<N n={CHUNK_PICK_COUNTS[SPONSORS_SLUG]} noun="gifts" /> | {G.sideSponsorsLabel}
 * @mutate src/content/printables.ts | n + (p.kind === "overlay" ? pickerDesigns(p).length : booksOf(p)?.length ?? 1) | n + (p.kind === "overlay" ? p.designs.length : booksOf(p)?.length ?? 1)
 * @mutate src/content/giftGuideDealCounts.ts | codes: codesOn(on, today).filter((c) => !shown.has(c.code.toUpperCase())), | codes: codesOn(on, today),
 * @mutate src/pages/info/giftGuides/railCounts.ts | return hub.stay + hub.gone.filter((g) => g > at).length; | return hub.stay + hub.gone.filter((g) => g >= at).length;
 * @mutate scripts/gift-guide-rail-counts.mjs | else if (item.start === days[d]) | else if (false)
 * @mutate src/pages/info/giftGuides/railCounts.ts | return RAIL.smallBiz + (await featuredLocalCount()); | return RAIL.smallBiz;
 * @mutate src/pages/info/giftGuides/railCounts.ts | return RAIL.smallBiz; | return RAIL.smallBiz + 1;
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | put({ "small-business-saturday": n }) | put({})
 * @mutate src/pages/info/giftGuides/railCounts.ts | import { dealDayParts } from "@/content/giftGuideDealCounts"; | import { dealDayParts } from "@/content/giftGuideDealCounts"; import "./GiftGuideDealCards";
 * @mutate vite.config.ts |               name: "sbs-featured-reads", |               name: "sbs-featured-reads-off",
 * @mutate src/content/giftGuideCatalog.ts | import { loadModule, untilReload } from "@/lib/loadModule"; | import { loadModule, untilReload } from "@/lib/loadModule"; import "@/content/giftGuideSponsorGiftTypes";
 */
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RAIL from "@/content/giftGuideRailCounts.json";
import { HOLIDAY_LIGHTS } from "@/content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import { endedEarlierToday, filterHolidayItems } from "@/content/holidayHub/holidayHub.mjs";
import DEALS from "@/content/giftGuideDeals.json";
import { DEAL_EVENTS, type Deal } from "@/content/giftGuideDeals.mjs";
import { guideBySlug } from "@/content/giftGuideCatalog";
import { loadGuidePicks } from "@/content/giftGuideCatalog";
import { PRINTABLE_PAGES } from "@/content/printables";
import { FUN_TOOLS } from "@/content/giftGuideFun1120";
import { FINDER_ANCHOR } from "@/content/giftGuideExtras1120";
import { MY_LIST_SLUG } from "@/pages/info/giftGuides/giftList";
import { buildHub, buildRailCounts } from "../../scripts/gift-guide-rail-counts.mjs";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
/** The approved "Featured local" read, the same one for the page and the menu: two listings, or a failed read. */
const featured = vi.hoisted(() => ({ fail: false, rows: [1, 2].map((i) => ({ id: `t${i}`, name: `Test Local ${i}`, town: "Lafayette", category: "Food & Sweets", link: `https://example.com/${i}`, deal: null, has_logo: false })) }));
// The real count (src/test/setup.ts gives every other test 0), over the mocked read below.
vi.unmock("@/lib/sbsFeaturedCount");
vi.mock("@/lib/sbsFeaturedApi", () => ({
  listFeaturedLocal: async () => {
    if (featured.fail) throw new Error("read failed");
    return featured.rows;
  },
  sbsLogoUrl: () => "",
}));
import { GiftGuidesMenu } from "@/pages/info/giftGuides/GiftGuidesSidebar";
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import Printables from "@/pages/info/giftGuides/printables/Printables";
import { dealDayCount, hubCountAt, smallBizCount } from "@/pages/info/giftGuides/railCounts";
import SMALL_BIZ from "@/content/giftGuideSmallBiz.json";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { signedInOnlyModules, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

afterEach(cleanup);

/** Each menu row by its link target: the rows with a list (a number), and the tools (none). */
const COUNTED = ["/gift-guides/her", "/gift-guides/him", "/gift-guides/kids", "/gift-guides/black-friday", "/gift-guides/small-business-saturday",
  "/gift-guides/cyber-monday", ...PRINTABLE_PAGES.map((p) => p.path), "/holidays", "/gift-guides/25-days-sponsors"];
const NO_NUMBER = ["/gift-guides", `/gift-guides#${FINDER_ANCHOR}`, `/gift-guides/${MY_LIST_SLUG}`, ...FUN_TOOLS.map((t) => t.to)];

const rowNumber = (a: Element) => {
  const n = a.querySelector(".gg-side-n");
  return n ? Number(/\d+/.exec(n.textContent!)![0]) : null;
};
const renderMenu = () => render(<MemoryRouter><GiftGuidesMenu active={null} wishList /></MemoryRouter>).container;

describe("gift guides menu numbers (owner 11-22: Number on the right)", () => {
  it("every row is counted or a tool, both ways; the number is announced with its noun", async () => {
    // A fixed day inside the season (the deals days and the Hub each list something), so the run never depends on the date.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
    onTestFinished(() => void vi.useRealTimers());
    const box = renderMenu();
    // The date-bound numbers arrive from their chunk.
    await waitFor(() => expect(rowNumber(box.querySelector("a[href='/holidays']")!)).not.toBeNull());
    // Small Business Saturday's number shows once its featured-local read is back: the sponsors plus the two listings.
    await waitFor(() => expect(rowNumber(box.querySelector("a[href='/gift-guides/small-business-saturday']")!)).toBe(SMALL_BIZ.length + 2));
    const rows = [...box.querySelectorAll("a")];
    expect(rows.length).toBeGreaterThan(12);
    const tools = new Set(NO_NUMBER);
    for (const a of rows) {
      const to = a.getAttribute("href")!;
      const n = rowNumber(a);
      if (COUNTED.includes(to)) {
        expect(n, to).toBeGreaterThan(0);
        // Read as "Her 159 gifts": a space before the number, the noun after it (sr-only).
        expect(a.querySelector(".gg-side-n .sr-only")?.textContent, to).toMatch(/^ (gifts|items)$/);
        expect(a.textContent, to).toMatch(/[a-z] \d+ (gifts|items)$/);
      } else {
        // A tool (All guides, the finder, Swipe, Secret Santa, the planner, My Wish List) or Small Business Saturday; any other row must be classified.
        expect(tools.has(to), `unclassified menu row ${to}`).toBe(true);
        expect(n, to).toBeNull();
      }
    }
    for (const to of COUNTED) expect(rows.some((a) => a.getAttribute("href") === to), `counted row missing: ${to}`).toBe(true);
  });

  it("Her, Him, Kids and the 25 Days sponsors show the page's own count line", async () => {
    const box = renderMenu();
    for (const slug of ["her", "him", "kids", "25-days-sponsors"]) {
      await loadGuidePicks(slug);
      const page = guideBySlug(slug)!.picks.length;
      expect(page, slug).toBeGreaterThan(20);
      expect(rowNumber(box.querySelector(`a[href='/gift-guides/${slug}']`)!), slug).toBe(page);
    }
  });

  it("each printables page's number is what that page draws", async () => {
    const menu = renderMenu();
    const want = Object.fromEntries([...menu.querySelectorAll("a[data-gift-side-printables]")].map((a) => [a.getAttribute("href"), rowNumber(a)]));
    cleanup();
    for (const page of PRINTABLE_PAGES) {
      const { container } = render(<MemoryRouter initialEntries={[page.path]}><Printables /></MemoryRouter>);
      // A name maker's design tiles arrive with its lazy chunk.
      if (page.key === "tags") await waitFor(() => expect(container.querySelector("[data-printable-design]")).not.toBeNull());
      const drawn = container.querySelectorAll("[data-printable-design]").length + container.querySelectorAll("[data-printable-book]").length
        + container.querySelectorAll("li[data-printable-card]:not(.pr-books)").length;
      expect(drawn, page.path).toBeGreaterThan(1);
      expect(want[page.path], page.path).toBe(drawn);
      cleanup();
    }
  });

  it("Black Friday and Cyber Monday: the number is the page's Top deals + Discount codes + Sales, day by day", async () => {
    let checked = 0;
    for (let d = 22; d <= 33; d++) {
      const ymd = d <= 30 ? `2026-11-${d}` : `2026-12-0${d - 30}`;
      for (const day of DEAL_EVENTS.filter((e) => e.kind === "deals")) {
        const { container } = render(<MemoryRouter><GiftGuideDeals day={day} now={new Date(`${ymd}T18:00:00Z`)} /></MemoryRouter>);
        // One wait: the page's sections (or its "none" line) are drawn AND no loading status is left (waitForEmptyIsVacuous:
        // a wait for the status's absence alone passes on the first paint).
        await waitFor(() => {
          expect(container.querySelector("[data-gift-deal-sections], [data-gift-deals-none]")).not.toBeNull();
          expect(container.querySelector("[role=status]")).toBeNull();
        });
        const page = [...container.querySelectorAll("[data-gift-section-count]")].reduce((n, x) => n + Number(/\d+/.exec(x.textContent!)![0]), 0);
        expect(dealDayCount(day.id, DEALS as Deal[], ymd), `${day.id} on ${ymd}`).toBe(page);
        if (page > 0) checked++;
        cleanup();
      }
    }
    expect(checked).toBeGreaterThan(12);
  }, 60_000);

  it("Small Business Saturday: the number is the businesses the page draws, sponsors + featured local; a failed read gives the sponsors", async () => {
    expect(RAIL).toEqual(buildRailCounts());
    expect(RAIL.smallBiz).toBe(SMALL_BIZ.length);
    expect(RAIL.smallBiz).toBeGreaterThan(10);
    const day = DEAL_EVENTS.find((e) => e.kind === "small-biz")!;
    const drawn = async () => {
      const { container } = render(<MemoryRouter><GiftGuideDeals day={day} now={new Date("2026-11-22T18:00:00Z")} /></MemoryRouter>);
      await waitFor(() => expect(container.querySelectorAll("li[data-gift-sb]").length).toBeGreaterThan(0));
      // The featured-local cards arrive with their own chunk and read.
      await waitFor(() => expect(container.querySelectorAll("li[data-gift-sbs-local]").length).toBe(featured.rows.length));
      const n = container.querySelectorAll("li[data-gift-sb]").length + container.querySelectorAll("li[data-gift-sbs-local]").length;
      cleanup();
      return n;
    };
    featured.fail = false;
    const both = await drawn();
    expect(both).toBe(SMALL_BIZ.length + featured.rows.length);
    expect(await smallBizCount()).toBe(both);
    featured.fail = true;
    onTestFinished(() => void (featured.fail = false));
    expect(await smallBizCount()).toBe(RAIL.smallBiz);
  });

  it("the Holiday Hub's schedule is current and equals what /holidays lists, at every day and every leaving minute", () => {
    expect(RAIL.hub).toEqual(buildHub());
    const page = (today: string, minutes: number) =>
      filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today).filter((i) => !endedEarlierToday(i, today, minutes)).length;
    const dayOf = (i: number) => new Date(Date.parse(`${RAIL.hub.from}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10);
    const moments = new Set<number>();
    for (let d = 0; d < RAIL.hub.days; d++) for (const m of [0, 600, 1200, 1439]) moments.add(d * 1440 + m);
    for (const g of RAIL.hub.gone) for (const t of [g - 1, g, g + 1]) if (t >= 0 && t < RAIL.hub.days * 1440) moments.add(t);
    for (const t of moments) {
      const today = dayOf(Math.floor(t / 1440));
      expect(hubCountAt(RAIL.hub, today, t % 1440), `${today} minute ${t % 1440}`).toBe(page(today, t % 1440));
    }
    expect(moments.size).toBeGreaterThan(600);
    expect(RAIL.hub.gone.length).toBeGreaterThan(50);
    // Outside the window: no number.
    expect(hubCountAt(RAIL.hub, dayOf(RAIL.hub.days), 0)).toBeNull();
    expect(hubCountAt(RAIL.hub, dayOf(-1), 0)).toBeNull();
  });
});

/**
 * What the menu's numbers cost (lead 11-22): the lazy railCounts chunk reaches only counting rules (no React, no cards,
 * heart or wish list: those were ~14 KB gz after the menu drew), and every signed-in-only module it reaches is won by a
 * public group (sbs-featured-reads: in signed-in-deep the Featured local read pulled ~310 KB gz after the menu drew).
 * The 25 Days sponsors' gift-type table (~1.9 KB gz) loads with that guide's picks, never on a guide page's first paint.
 */
describe("the menu's numbers stay off the guide pages' load (lead 11-22)", () => {
  const ROOT = resolve(__dirname, "../..");
  const rel = (abs: string) => abs.slice(ROOT.length + 1).split("\\").join("/");
  const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
  const groupTest = (name: string) => new RegExp(config.match(new RegExp(`name:\\s*"${name}",[\\s\\S]*?\\}`))?.[0].match(/test:\s*\/(.*)\/,\s*\n/)?.[1] ?? "^$");

  it("railCounts reaches no React file and no signed-in-only module a public group does not win", () => {
    const reach = [...staticReach(ROOT, [resolve(ROOT, "src/pages/info/giftGuides/railCounts.ts")])].map(rel);
    expect(reach).toContain("src/content/giftGuideDealCounts.ts");
    expect(reach).toContain("src/lib/sbsFeaturedApi.ts");
    expect(reach.length).toBeGreaterThan(8);
    expect(reach.filter((f) => f.endsWith(".tsx"))).toEqual([]);
    const { signedInOnly } = signedInOnlyModules(ROOT);
    const won = [groupTest("public-page-reads"), groupTest("sbs-featured-reads")];
    const loose = reach.filter((f) => signedInOnly.has(resolve(ROOT, f).split("\\").join("/")) && !won.some((t) => t.test(`/x/${f}`)));
    expect(loose).toEqual([]);
    expect(won[1].test("/x/src/lib/sbsFeaturedCount.ts")).toBe(true);
  });

  it("the sponsors' gift-type table is not on any guide page's first paint", () => {
    const reach = [...staticReach(ROOT, [resolve(ROOT, "src/pages/info/GiftGuides.tsx")])].map(rel);
    expect(reach.length).toBeGreaterThan(100);
    expect(reach).toContain("src/content/giftGuideCatalog.ts");
    expect(reach).not.toContain("src/content/giftGuideSponsorGiftTypes.ts");
  });
});
