/**
 * Owner 11-21 (9:04 PM, screenshot of live Declutter Browse at desktop width: "clean up its listed twice"): the
 * "New this week" row showed one card (the Vintage Duck Touch Lamp, a smaller card with no heart) and the grid right
 * under it began with the same lamp again.
 *
 * The rule now: the row is cut from the page's own list, it shows only with NEW_THIS_WEEK_MIN or more listings, its
 * cards leave the grid below (so no listing is on the page twice, and the count stays the whole list), and its cards
 * are the grid's own card (same render: heart, photo tag, price), at the grid's column width.
 *
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |   const gridRows = rows.filter((r) => !freshIds.has(r.item.id)); |   const gridRows = rows;
 * @mutate src/lib/declutter/newThisWeek.ts |   return fresh.length < NEW_THIS_WEEK_MIN \|\| fresh.length >= others ? [] : fresh; |   return fresh.length >= others ? [] : fresh;
 * @mutate src/components/declutter/DeclutterNewThisWeek.tsx |             {card(it, n)} |             <a data-item-card="" href={`/declutter/item/${it.id}`}>{it.title}</a>
 * @mutate src/components/declutter/DeclutterNewThisWeek.tsx |       <ul className={full ? DECLUTTER_ROW_FULL : DECLUTTER_ROW} data-new-this-week-scroller=""> |       <ul className="flex gap-3 overflow-x-auto" data-new-this-week-scroller="">
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |         count: listLoading \|\| preview \|\| items.isError ? undefined : rows.length, |         count: listLoading \|\| preview \|\| items.isError ? undefined : gridRows.length,
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { live: [] as unknown[], desktop: false };
vi.mock("@/lib/declutter/saveCounts", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/saveCounts")>()), fetchSaveCounts: async () => new Map<string, number>() }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchLiveItems: async () => state.live,
  fetchPhotos: async () => [],
  fetchDropStates: async () => new Map(),
  fetchWatching: async () => new Set(),
  fetchMapPins: async () => new Map(),
  fetchItemWays: async () => new Map(),
  fetchDroppedIntoBudget: async () => new Set(),
}));
vi.mock("@/lib/declutter/bundle", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/bundle")>()), fetchBundleSellers: async () => new Set() }));
vi.mock("@/components/declutter/useDeclutterOrigin", () => ({
  useDeclutterOrigin: () => ({ origin: { status: "none" }, askDevice: () => undefined, asked: false, asking: false, canAskAgain: false, deviceNote: null, zip: null }),
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => state.desktop }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/components/sections/SectionScreen", () => ({
  SectionScreen: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
// A member's desktop shows the map beside the list; its token read is not this test's business.
vi.mock("@/components/declutter/DeclutterMap", () => ({ default: () => <div data-map-stub="" /> }));
vi.mock("@/components/sections/BrowseEndCard", () => ({ BrowseEndCard: () => <p>end of the list</p> }));

import { NEW_THIS_WEEK_MIN } from "@/lib/declutter/newThisWeek";
import { DeclutterBrowse, type DeclutterBrowseHeader } from "@/components/declutter/DeclutterBrowseView";
import { DECLUTTER_GRID, DECLUTTER_GRID_FULL, DECLUTTER_ROW, DECLUTTER_ROW_FULL } from "@/components/declutter/DeclutterSkeletons";

const day = 24 * 60 * 60 * 1000;
const card = (n: number, ageDays: number, extra: Record<string, unknown> = {}) => {
  const at = new Date(Date.now() - ageDays * day).toISOString();
  return {
    id: `i${n}`, seller_id: `s${n}`, status: "live", title: `Thing ${n}`, description: "", category: "home_decor", condition_stars: 4, delivery_size: "small",
    price_cents: 8500, current_price_cents: 8500, area_label: "Delcambre", area_lat: 29.95, area_lng: -91.99, created_at: at, live_at: at, porch_ok: false, accepts_offers: true, ...extra,
  };
};

let header: DeclutterBrowseHeader | null = null;
function browse(userId: string | null, entry = "/declutter") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <DeclutterBrowse userId={userId} chrome={(h) => { header = h; return { tabs: null }; }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const itemHrefs = () => [...document.querySelectorAll<HTMLAnchorElement>("a[data-item-card]")].map((a) => a.getAttribute("href"));
const settleRow = async () => {
  await import("@/components/declutter/DeclutterNewThisWeek");
  await new Promise((r) => setTimeout(r, 50));
};

afterEach(() => {
  cleanup();
  header = null;
  state.desktop = false;
});

describe("New this week never lists an item twice (owner 11-21)", () => {
  // Four new this week, six older: the row has four, the grid the other six, ten cards in all.
  const LIST = () => [card(1, 0.5), card(2, 1), card(3, 2), card(4, 3), ...[5, 6, 7, 8, 9, 10].map((n) => card(n, 10 + n))];

  for (const [who, userId] of [["a member", "me"], ["a guest", null]] as const) {
    for (const desktop of [false, true]) {
      it(`${who}, ${desktop ? "desktop" : "phone"}: every listing is on the page exactly once, the row's ones out of the grid`, async () => {
        state.live = LIST();
        state.desktop = desktop;
        browse(userId);
        const row = await screen.findByRole("region", { name: "New this week" }, { timeout: 3000 });
        await waitFor(() => expect(itemHrefs().length).toBe(10));
        const hrefs = itemHrefs();
        expect(new Set(hrefs).size).toBe(hrefs.length);
        expect(hrefs.length).toBeGreaterThan(9);
        const inRow = [...row.querySelectorAll<HTMLAnchorElement>("a[data-item-card]")].map((a) => a.getAttribute("href"));
        expect(inRow.sort()).toEqual(["/declutter/item/i1", "/declutter/item/i2", "/declutter/item/i3", "/declutter/item/i4"]);
        if (desktop) expect(header?.count).toBe(10);
      });
    }
  }

  for (const [who, userId] of [["a member (map beside the list)", "me"], ["a guest (no map, full-width grid)", null]] as const) {
    it(`${who}: the row's cards are the grid's card, a heart and the one price (fee included) on each, at the grid's column width`, async () => {
      state.live = LIST();
      state.desktop = true;
      browse(userId);
      const row = await screen.findByRole("region", { name: "New this week" }, { timeout: 3000 });
      await waitFor(() => expect(row.querySelectorAll("a[data-item-card]").length).toBe(4));
      const grid = document.querySelector<HTMLUListElement>("main ul:not([data-new-this-week-scroller])")!;
      const rowCards = [...row.querySelectorAll("li")];
      const gridCards = [...grid.querySelectorAll(":scope > li")];
      expect(rowCards.length).toBe(4);
      expect(gridCards.length).toBe(6);
      for (const li of [...rowCards, ...gridCards]) {
        expect(li.querySelector("[data-card-heart]")).not.toBeNull();
        // Owner 11-27 ("One price, fee included"): $85 shows as $89.95, with no second incl.-fee line.
        expect(li.querySelector("[data-card-base-price]")?.textContent).toContain("$89.95");
        expect(li.querySelector("[data-card-price]")?.textContent).not.toMatch(/incl\. fee/);
      }
      // Same markup shape: one row card and one grid card differ only in their words and link.
      const shape = (li: Element) => li.innerHTML.replace(/Thing \d+/g, "T").replace(/i\d+/g, "x");
      expect(shape(rowCards[0])).toBe(shape(gridCards[0]));
      // Same size: the row's columns are the grid's (2 / 3 / 4 / 5 across with the grid's gaps).
      const scroller = row.querySelector("[data-new-this-week-scroller]")!;
      const full = userId === null;
      expect(grid.className).toBe(full ? DECLUTTER_GRID_FULL : DECLUTTER_GRID);
      expect(scroller.className).toBe(full ? DECLUTTER_ROW_FULL : DECLUTTER_ROW);
    });
  }

  it("the row's column widths are the grid's columns and gaps", () => {
    expect(DECLUTTER_GRID).toContain("grid-cols-2 gap-x-2");
    expect(DECLUTTER_ROW).toContain("auto-cols-[calc((100%_-_0.5rem)/2)]");
    expect(DECLUTTER_ROW).toContain("sm:auto-cols-[calc((100%_-_1.5rem)/3)]");
    expect(DECLUTTER_ROW_FULL).toContain("xl:auto-cols-[calc((100%_-_3rem)/5)]");
  });

  it("one new listing (the live lamp case): no one-card row, the grid shows it once", async () => {
    state.live = [card(1, 0.5), ...[5, 6, 7, 8].map((n) => card(n, 10 + n))];
    state.desktop = true;
    browse("me");
    await waitFor(() => expect(itemHrefs().length).toBe(5));
    await settleRow();
    expect(document.querySelector("[data-new-this-week]")).toBeNull();
    expect(new Set(itemHrefs()).size).toBe(5);
    expect(header?.count).toBe(5);
    expect(NEW_THIS_WEEK_MIN).toBeGreaterThan(2);
  });

  it("a category chip view: no row, every match once, the count is the matches", async () => {
    state.live = [...LIST(), card(11, 0.2, { category: "kitchen" }), card(12, 15, { category: "kitchen" })];
    state.desktop = true;
    browse("me", "/declutter?cat=kitchen");
    await waitFor(() => expect(itemHrefs().length).toBeGreaterThan(0));
    await settleRow();
    expect(document.querySelector("[data-new-this-week]")).toBeNull();
    const hrefs = itemHrefs();
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(header?.count).toBe(hrefs.length);
  });
});
