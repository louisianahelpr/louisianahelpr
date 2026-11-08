/**
 * Q2705 (lead 11-07): a guest's Browse shows the entry's PREVIEW (declutter_guest_preview: the top 24, card columns
 * only) and reads the full list (67 KB gz on 11-07, every description) only once the first photos are in, so on a slow
 * link the full list never shares the line with the photos the guest is waiting for.
 *
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |       .then((p) => p ?? (member ? null : readGuestPreview())) |       .then((p) => p)
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | (!previewFits \|\| firstPhotosIn \|\| waitedForPhotos) | (true)
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | (!previewFits \|\| firstPhotosIn \|\| waitedForPhotos) | (!previewFits \|\| waitedForPhotos)
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | (!previewFits \|\| firstPhotosIn \|\| waitedForPhotos) | (!previewFits \|\| firstPhotosIn)
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |   const fullListWaiting = !fullListNow && !fullListAsked && items.data === undefined; |   const fullListWaiting = false;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetFirstRowPhotoGate } from "./firstRowPhotoGate";

const item = (n: number) => ({
  id: `i${n}`, seller_id: "s1", status: "live", title: `Thing ${n}`, category: "furniture", condition_stars: 4, delivery_size: "small",
  price_cents: 1000, current_price_cents: 1000, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-30", live_at: "2026-10-30",
  porch_ok: true, accepts_offers: true, sale_mode: null, last_price_drop_on: null, drop_pct: 0, drops_stopped: false,
});
const state: {
  origin: { status: string; lat?: number; lng?: number; approximate?: boolean; zipOnFile?: boolean };
  fullAsked: number;
  finishFull: (rows: unknown[]) => void;
  withPhotos: boolean;
} = { origin: { status: "none", zipOnFile: false }, fullAsked: 0, finishFull: () => undefined, withPhotos: true };

vi.mock("@/lib/declutter/saveCounts", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/saveCounts")>()), fetchSaveCounts: async () => new Map<string, number>() }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchLiveItems: () => { state.fullAsked++; return new Promise((resolve) => { state.finishFull = resolve; }); },
  fetchPhotos: async (ids: string[]) => (state.withPhotos ? ids.map((id) => ({ id: `p-${id}`, item_id: id, storage_path: `u/declutter/${id}/a.jpg`, position: 0 })) : []),
  fetchDropStates: async () => new Map(),
  fetchWatching: async () => new Set(),
  fetchMapPins: async () => new Map(),
}));
vi.mock("./useDeclutterOrigin", () => ({
  useDeclutterOrigin: () => ({ origin: state.origin, askDevice: () => undefined, asked: false, asking: false, canAskAgain: false, deviceNote: null, zip: null }),
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true }) }));
vi.mock("@/components/sections/SectionScreen", () => ({
  SectionScreen: ({ children, tabs }: { children: React.ReactNode; tabs?: React.ReactNode }) => <main>{tabs}{children}</main>,
}));
vi.mock("@/components/sections/BrowseEndCard", () => ({ BrowseEndCard: () => <p>end of the list</p> }));
vi.mock("./DeclutterSkeletons", async (orig) => ({ ...(await orig<typeof import("./DeclutterSkeletons")>()), DeclutterBrowseBones: () => <p>bones</p> }));

import { DeclutterBrowse } from "./DeclutterBrowseView";

const preview = Array.from({ length: 24 }, (_, n) => item(n));
const full = Array.from({ length: 40 }, (_, n) => ({ ...item(n), description: `About thing ${n}` }));

function show(previewAnswer: Promise<unknown> = Promise.resolve({ items: preview, photos: [], more: true })) {
  (window as unknown as Record<string, unknown>).__lhGuestDeclutterPrefetch = {
    at: Date.now(),
    open: Promise.resolve(["declutter"]),
    preview: previewAnswer,
    items: Promise.resolve(null),
    photos: Promise.resolve([]),
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/declutter"]}>
        <DeclutterBrowse userId={null} chrome={() => ({ tabs: null })} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
};
const titles = () => screen.queryAllByText(/^Thing \d+$/).map((e) => e.textContent);

afterEach(() => {
  cleanup();
  (window as unknown as Record<string, unknown>).__lhGuestDeclutterPrefetch = undefined;
  resetFirstRowPhotoGate();
  state.fullAsked = 0;
  state.withPhotos = true;
  state.origin = { status: "none", zipOnFile: false };
});

describe("a guest's Browse from the preview", () => {
  it("shows the preview's 24 cards, reads the full list only once the first photos are in, and keeps their places", async () => {
    show();
    await waitFor(() => expect(titles()).toHaveLength(24));
    expect(titles()[0]).toBe("Thing 0");
    await settle();
    expect(state.fullAsked, "the full list waits for the first photos").toBe(0);
    // The eager (above the fold) photos load: the gate opens, and the full list is asked.
    const eager = [...document.querySelectorAll<HTMLImageElement>('img[loading="eager"]')];
    expect(eager.length).toBeGreaterThan(0);
    await act(async () => { for (const img of eager) fireEvent.load(img); });
    await waitFor(() => expect(state.fullAsked).toBe(1));
    await act(async () => { state.finishFull(full); });
    await waitFor(() => expect(titles()).toHaveLength(40));
    expect(titles().slice(0, 24)).toEqual(preview.map((i) => i.title));
  });

  it("with no photo to wait for, the full list is asked after a short wait, never left out", async () => {
    state.withPhotos = false;
    show();
    await waitFor(() => expect(titles()).toHaveLength(24));
    expect(state.fullAsked).toBe(0);
    await waitFor(() => expect(state.fullAsked).toBe(1), { timeout: 4500 });
  });

  it("while the preview is still on its way, the list shows bones, never \"Nothing for sale\"", async () => {
    show(new Promise(() => undefined));
    await settle();
    expect(screen.queryByText(/Nothing for sale/)).toBeNull();
    expect(screen.getByText("bones")).toBeTruthy();
  });

  it("measuring from a position the preview was not sorted from: no preview, the full list at once, bones meanwhile", async () => {
    state.origin = { status: "ready", lat: 30.1, lng: -91.9, approximate: true };
    show();
    await settle();
    expect(titles()).toEqual([]);
    expect(screen.getByText("bones")).toBeTruthy();
    expect(state.fullAsked).toBe(1);
  });
});
