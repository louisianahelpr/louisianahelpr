/**
 * Browse with more listings than the first answer holds (declutter_first_screen): the first cards show at once ONLY when
 * they are exactly the top of the final list. Nothing moves when the rest arrive, and no screen goes back to bones.
 *
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | const listLoading = (items.isLoading && !preview) \|\| photos.isLoading | const listLoading = items.isLoading \|\| photos.isLoading
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |   const preview =\n    !items.data && !!capped && origin.status !== "pending" &&\n    previewIsTopOfList(capped.near, from, query.trim() === "" && filters.sort === "closest" && activeFilterCount(filters, maxMiles) === 0); |   const preview = !items.data && !!capped;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |     queryFn: () => fetchPhotos(others.map((i) => i.id)),\n    enabled: others.length > 0,\n    placeholderData: keepPreviousData, |     queryFn: () => fetchPhotos(others.map((i) => i.id)),\n    enabled: others.length > 0,
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |         {rows.length > 0 && !preview && ( |         {rows.length > 0 && (
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const HERE = { lat: 30.45, lng: -91.15 };
const item = (n: number) => ({
  id: `i${n}`, seller_id: "s1", status: "live", title: `Thing ${n}`, description: "", category: "furniture", condition_stars: 4, delivery_size: "small",
  price_cents: 1000, current_price_cents: 1000, area_label: "Mid City", area_lat: 30.45 + n / 100, area_lng: -91.15, created_at: "2026-10-30", live_at: "2026-10-30",
  porch_ok: true, accepts_offers: true,
});
const state: {
  origin: { status: string; lat?: number; lng?: number; approximate?: boolean };
  finishFull: (rows: unknown[]) => void;
  photoReads: string[][];
} = { origin: { status: "none", zipOnFile: false } as never, finishFull: () => undefined, photoReads: [] };

vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchLiveItems: () => new Promise((resolve) => { state.finishFull = resolve; }),
  fetchPhotos: async (ids: string[]) => { state.photoReads.push(ids); return []; },
  fetchDropStates: async () => new Map(),
  fetchWatching: async () => new Set(),
  fetchMapPins: async () => new Map(),
  setWatch: async () => "watching",
}));
vi.mock("@/lib/declutter/bundle", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/bundle")>()), fetchBundleSellers: async () => new Set<string>() }));
vi.mock("./useDeclutterOrigin", () => ({
  useDeclutterOrigin: () => ({ origin: state.origin, askDevice: () => undefined, asked: false, asking: false, canAskAgain: false, deviceNote: null, zip: null }),
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/components/sections/SectionScreen", () => ({
  SectionScreen: ({ children, tabs }: { children: React.ReactNode; tabs?: React.ReactNode }) => <main>{tabs}{children}</main>,
}));
vi.mock("@/components/sections/BrowseEndCard", () => ({ BrowseEndCard: () => <p>end of the list</p> }));
vi.mock("./DeclutterSkeletons", async (orig) => ({
  ...(await orig<typeof import("./DeclutterSkeletons")>()),
  DeclutterBrowseBones: () => <p>bones</p>,
}));

import { DeclutterBrowse } from "./DeclutterBrowseView";

const capped = Array.from({ length: 24 }, (_, n) => item(n));
const full = Array.from({ length: 40 }, (_, n) => item(n));

function show(url = "/declutter") {
  (window as unknown as Record<string, unknown>).__lhDeclutterPrefetch = {
    at: Date.now(),
    userId: "me",
    answer: Promise.resolve({ switches: {}, items: capped, more: true, near: HERE, photos: [], watching: [], bundle_sellers: [] }),
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <DeclutterBrowse userId="me" tabs={() => null} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
/** Long enough for the first answer to reach the screen: the two "wait" tests must see it arrive and be refused. */
const settle = async () => {
  // Several turns: React applies updates only as each act() ends, and each one starts the next read.
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
};
const titles = () => screen.queryAllByText(/^Thing \d+$/).map((e) => e.textContent);

afterEach(() => {
  cleanup();
  (window as unknown as Record<string, unknown>).__lhDeclutterPrefetch = undefined;
  state.photoReads = [];
});

describe("Browse's first cards when the list is longer than the first answer", () => {
  it("show before the full list, and keep their places when it lands, with no bones between", async () => {
    state.origin = { status: "ready", ...HERE, approximate: false };
    show();
    await waitFor(() => expect(titles()).toHaveLength(24));
    const first = titles();
    expect(first[0]).toBe("Thing 0");
    expect(screen.queryByText("end of the list")).toBeNull();

    const seen: (string | null)[] = [];
    const watch = new MutationObserver(() => { if (screen.queryByText("bones")) seen.push("bones"); });
    watch.observe(document.body, { childList: true, subtree: true });
    await act(async () => { state.finishFull(full); });
    await waitFor(() => expect(titles()).toHaveLength(40));
    watch.disconnect();
    expect(titles().slice(0, 24)).toEqual(first);
    expect(seen).toEqual([]);
    expect(screen.getByText("end of the list")).toBeTruthy();
  });

  it("wait for the full list when the browser measures from somewhere else, since they might move", async () => {
    state.origin = { status: "ready", lat: 30.1, lng: -91.9, approximate: true };
    show();
    await settle();
    expect(titles()).toEqual([]);
    expect(screen.getByText("bones")).toBeTruthy();
    await act(async () => { state.finishFull(full); });
    await waitFor(() => expect(titles()).toHaveLength(40));
  });

  it("wait for the full list on a search, a filter or a distance: an answer of 24 can't serve them", async () => {
    state.origin = { status: "ready", ...HERE, approximate: false };
    for (const url of ["/declutter?q=thing", "/declutter?cat=furniture", "/declutter?mi=10", "/declutter?free=1"]) {
      show(url);
      await settle();
      expect(titles()).toEqual([]);
      expect(screen.getByText("bones")).toBeTruthy();
      cleanup();
    }
  });
});
