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
 * The menu loads none of the pick data (CHUNK_PICK_COUNTS, printables.ts and a lazy chunk only): the critical-path budget
 * (scripts/perf/critical-path.mjs) holds that.
 *
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | {g.title}<N n={CHUNK_PICK_COUNTS[g.slug]} noun="gifts" /> | {g.title}<N n={CHUNK_PICK_COUNTS[g.slug] + 1} noun="gifts" />
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | {G.sideSponsorsLabel}<N n={CHUNK_PICK_COUNTS[SPONSORS_SLUG]} noun="gifts" /> | {G.sideSponsorsLabel}
 * @mutate src/content/printables.ts | n + (p.kind === "overlay" ? pickerDesigns(p).length : booksOf(p)?.length ?? 1) | n + (p.kind === "overlay" ? p.designs.length : booksOf(p)?.length ?? 1)
 * @mutate src/pages/info/giftGuides/railCounts.ts | return list.length + codeCardCount(codesOn(on).filter((c) => !shown.has(c.code.toUpperCase()))) + salesOn(on).length; | return list.length + codeCardCount(codesOn(on)) + salesOn(on).length;
 * @mutate src/pages/info/giftGuides/railCounts.ts | return hub.stay + hub.gone.filter((g) => g > at).length; | return hub.stay + hub.gone.filter((g) => g >= at).length;
 * @mutate scripts/gift-guide-rail-counts.mjs | else if (item.start === days[d]) | else if (false)
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
import { buildHub } from "../../scripts/gift-guide-rail-counts.mjs";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/sbsFeaturedApi", () => ({ listFeaturedLocal: async () => [], sbsLogoUrl: () => "" }));
import { GiftGuidesMenu } from "@/pages/info/giftGuides/GiftGuidesSidebar";
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import Printables from "@/pages/info/giftGuides/printables/Printables";
import { dealDayCount, hubCountAt } from "@/pages/info/giftGuides/railCounts";

afterEach(cleanup);

/** Each menu row by its link target: the rows with a list (a number), and the tools (none). */
const COUNTED = ["/gift-guides/her", "/gift-guides/him", "/gift-guides/kids", "/gift-guides/black-friday", "/gift-guides/cyber-monday",
  ...PRINTABLE_PAGES.map((p) => p.path), "/holidays", "/gift-guides/25-days-sponsors"];
/** Small Business Saturday: no number (it also lists live "Featured local" businesses from the database; railCounts.ts). */
const NO_NUMBER = ["/gift-guides", `/gift-guides#${FINDER_ANCHOR}`, `/gift-guides/${MY_LIST_SLUG}`, ...FUN_TOOLS.map((t) => t.to), "/gift-guides/small-business-saturday"];

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
        await waitFor(() => expect(container.querySelector("[data-gift-deal-sections], [data-gift-deals-none]")).not.toBeNull());
        await waitFor(() => expect(container.querySelector("[role=status]")).toBeNull());
        const page = [...container.querySelectorAll("[data-gift-section-count]")].reduce((n, x) => n + Number(/\d+/.exec(x.textContent!)![0]), 0);
        expect(dealDayCount(day.id, DEALS as Deal[], ymd), `${day.id} on ${ymd}`).toBe(page);
        if (page > 0) checked++;
        cleanup();
      }
    }
    expect(checked).toBeGreaterThan(12);
  }, 60_000);

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
