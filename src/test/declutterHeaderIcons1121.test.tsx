/**
 * Owner 11-21 (desktop Declutter Browse screenshot: "237 items", the search box, "Use my location", a round filter
 * button, the category chip row):
 *   1. "i clicked use my location and when i click the button just goes away": a fix now shows "Near you" over the
 *      cards (with Change); a failed read says why; the ask itself lives in Filters' Distance block.
 *   2. "move them all into the filter button": on desktop the category chips and "Use my location" are inside the
 *      Filters panel; the row keeps the count, search and Filters (members: the map toggle as before). The button
 *      shows how many filters are on, and the panel has Clear all.
 *   3. "make search an icon to open when clicked": the search is an icon that opens into the field (focused); Escape
 *      folds it back; words in the address keep it open.
 *   4. "remove the circle around filter": the Filters icon is plain (no circle, edge or tint), like the search icon.
 *
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |             <InlineListSearch value={query} onChange={setQuery} label={t("decl.searchItems")} /> |             <InlineListSearch value={query} onChange={setQuery} label={t("decl.searchItems")} pinned />
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |             <FiltersIconButton plain open={filtersOpen} |             <FiltersIconButton open={filtersOpen}
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | sellerDelivery: sellerDeliveryOn, categoryUp: desktop })} | sellerDelivery: sellerDeliveryOn })}
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx |       more: !categoryUp, |       more: true,
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |         {itemsPhase !== "offline-empty" && <DeclutterNearYou ask={ask} maxMiles={maxMiles} closest={sortNow === "closest"} onChange={() => setFiltersOpen(true)} />} |
 * @mutate src/components/declutter/DeclutterMilesFrom.tsx |   const words = maxMiles !== null ? t("decl.loc.nearWithin", { miles: maxMiles }) : closest ? t("decl.loc.near") : t("decl.loc.nearPlain"); |   const words = closest ? t("decl.loc.near") : t("decl.loc.nearPlain");
 * @mutate src/components/dashboard/browseTasksToolbar/FiltersIconButton.tsx |     ? `!rounded-ds-md ctl-tint ${on ? "text-[hsl(var(--bark))]" : "text-muted-foreground hover:text-foreground"}` |     ? `ring-1 ring-inset ${on ? "bg-[hsl(var(--bark)/0.12)]" : ""}`
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Ask = { origin: Record<string, unknown>; asked: boolean; asking: boolean; canAskAgain: boolean; deviceNote: string | null };
const NOT_ASKED: Ask = { origin: { status: "none", zipOnFile: false }, asked: false, asking: false, canAskAgain: false, deviceNote: null };
const state = { live: [] as unknown[], desktop: true, ask: NOT_ASKED, askDevice: vi.fn() };
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
  useDeclutterOrigin: () => ({ ...state.ask, askDevice: state.askDevice, zip: null }),
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => state.desktop }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/components/sections/SectionScreen", () => ({
  SectionScreen: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/declutter/DeclutterMap", () => ({ default: () => <div data-map-stub="" /> }));
vi.mock("@/components/sections/BrowseEndCard", () => ({ BrowseEndCard: () => <p>end of the list</p> }));

import { DeclutterBrowse, type DeclutterBrowseHeader } from "@/components/declutter/DeclutterBrowseView";

const card = (n: number, extra: Record<string, unknown> = {}) => {
  const at = new Date(Date.now() - (20 + n) * 86_400_000).toISOString();
  return {
    id: `i${n}`, seller_id: `s${n}`, status: "live", title: `Thing ${n}`, description: "", category: n % 2 ? "kitchen" : "home_decor", condition_stars: 4, delivery_size: "small",
    price_cents: 2000, current_price_cents: 2000, area_label: "Delcambre", area_lat: 29.95 + n / 100, area_lng: -91.99, created_at: at, live_at: at, porch_ok: false, accepts_offers: true, ...extra,
  };
};
const LIST = () => [1, 2, 3, 4, 5, 6].map((n) => card(n));

let header: DeclutterBrowseHeader | null = null;
function browse(userId: string | null, entry = "/declutter") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const out = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <DeclutterBrowse userId={userId} chrome={(h) => { header = h; return { tabs: null }; }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return out;
}
/** The desktop row's controls, drawn on their own (the screen hands them to its chrome as `end`). */
function row() {
  const end = header?.end;
  expect(end).toBeTruthy();
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}
const cardsIn = async () => waitFor(() => expect(document.querySelectorAll("a[data-item-card]").length).toBeGreaterThan(0));

afterEach(() => {
  cleanup();
  header = null;
  state.desktop = true;
  state.ask = NOT_ASKED;
  state.askDevice.mockClear();
});

// The row is rendered by the screen's chrome (SectionTabs `end`); in this test the chrome is a stub, so render `end`.
function renderEnd() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{header!.end}</MemoryRouter>
    </QueryClientProvider>,
    { container: row() },
  );
}

describe("Declutter desktop header (owner 11-21)", () => {
  for (const [who, userId] of [["a member", "me"], ["a guest", null]] as const) {
    it(`${who}: the row is the count, a search icon and a plain Filters icon; no location pill, no chip row on the page`, async () => {
      state.live = LIST();
      browse(userId);
      await cardsIn();
      expect(header?.count).toBe(6);
      const end = renderEnd().container;
      const strip = end.querySelector("[data-feed-strip]")!;
      const search = within(strip as HTMLElement).getByRole("button", { name: "Search items" });
      expect(search.getAttribute("aria-expanded")).toBe("false");
      expect(strip.querySelector("input")).toBeNull();
      const filters = within(strip as HTMLElement).getByRole("button", { name: "Filters" });
      expect(filters.hasAttribute("data-filters-plain")).toBe(true);
      expect(filters.className).not.toMatch(/\bring-1\b|border-\[1\.5px\]|bg-\[hsl\(var\(--bark\)\/0\.12\)\]/);
      expect(filters.className).toContain("!rounded-ds-md");
      expect(strip.textContent).not.toMatch(/Use my location/);
      expect(strip.querySelectorAll("button").length).toBe(userId ? 3 : 2);
      expect(document.querySelector("main [data-chip-row-wrap]")).toBeNull();
    });
  }

  it("search: the icon opens into a focused field; Escape folds it back", async () => {
    state.live = LIST();
    browse("me");
    await cardsIn();
    const end = renderEnd().container;
    fireEvent.click(within(end).getByRole("button", { name: "Search items" }));
    const field = within(end).getByRole("searchbox", { name: "Search items" });
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(within(end).queryByRole("searchbox")).toBeNull();
    expect(within(end).getByRole("button", { name: "Search items" })).toBeTruthy();
  });

  it("Filters holds the categories (open, not folded) and Use my location; the button counts what is on; Clear all clears", async () => {
    state.live = LIST();
    browse(null, "/declutter?cat=kitchen");
    await cardsIn();
    const end = renderEnd().container;
    const filters = within(end).getByRole("button", { name: "Filters (1 active)" });
    expect(filters.querySelector("[data-filters-count]")?.textContent).toBe("1");
    fireEvent.click(filters);
    const panel = await screen.findByRole("dialog");
    const kitchen = within(panel).getByRole("button", { name: "Kitchen" });
    expect(kitchen.getAttribute("aria-pressed")).toBe("true");
    expect(within(panel).getByRole("button", { name: "Use my location" })).toBeTruthy();
    // Category sits third, after Sort and Distance, outside the More filters fold.
    expect(panel.querySelector("#filter-sheet-more [data-category-group]")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Use my location" }));
    expect(state.askDevice).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel).getByRole("button", { name: /clear all/i }));
    await waitFor(() => expect(header?.count).toBe(6));
  });

  it("location worked: the page says Near you (nearest first, or within the distance), with Change", async () => {
    state.live = LIST();
    state.ask = { origin: { status: "ready", lat: 29.95, lng: -91.99, source: "device", approximate: false }, asked: true, asking: false, canAskAgain: false, deviceNote: null };
    browse("me");
    await cardsIn();
    const near = document.querySelector("[data-near-you]")!;
    expect(near.textContent).toContain("Near you · nearest first");
    cleanup();
    browse("me", "/declutter?mi=10");
    await cardsIn();
    expect(document.querySelector("[data-near-you]")?.textContent).toContain("Near you · within 10 mi");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("location refused or timed out: no Near you; the reason shows, and Filters offers to try again", async () => {
    state.live = LIST();
    state.ask = { origin: { status: "none", zipOnFile: false }, asked: true, asking: false, canAskAgain: true, deviceNote: "Location access is off. Turn it on in Settings to use your location." };
    browse(null);
    await cardsIn();
    expect(document.querySelector("[data-near-you]")).toBeNull();
    expect(document.querySelector("[data-device-note]")?.textContent).toMatch(/Location access is off/);
    const end = renderEnd().container;
    fireEvent.click(within(end).getByRole("button", { name: "Filters" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("button", { name: "Try my location again" })).toBeTruthy();
  });

  it("a fix from the ZIP code (not the device) is not called Near you", async () => {
    state.live = LIST();
    state.ask = { origin: { status: "ready", lat: 29.95, lng: -91.99, source: "zip", approximate: true }, asked: true, asking: false, canAskAgain: true, deviceNote: "We couldn't read your device's location." };
    browse("me");
    await cardsIn();
    expect(document.querySelector("[data-near-you]")).toBeNull();
    expect(document.querySelector("[data-device-note]")?.textContent).toMatch(/couldn't read/);
  });

  it("phone keeps its own header: the search bar with Filters inside, and the chip row", async () => {
    state.live = LIST();
    state.desktop = false;
    browse("me");
    await cardsIn();
    expect(header?.search).toBeTruthy();
    expect(header?.chips).toBeTruthy();
  });
});
