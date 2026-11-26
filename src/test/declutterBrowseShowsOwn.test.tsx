/**
 * GUARD (owner 2026-11-25, phone audit #40, reverses 2026-11-16): Declutter Browse HIDES the viewer's own listings;
 * they show only under Selling. Browse is for discovering other people's items.
 *   - Browse and the Free tab leave out the viewer's own live listings (no "Yours" card in the feed);
 *   - a seller whose only live listings are their own sees "Nothing for sale" bones-then-empty, never their own cards;
 *   - someone else's card is unchanged: its heart, at the photo's BOTTOM-RIGHT (owner 11-25: "a heart in the bottom
 *     right of the picture"), for members and guests alike (a guest's heart opens sign-up);
 *   - the boot photo preloads skip the own listing (they match the grid's cards), and index.html's early skeleton
 *     photos skip it too.
 *
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |   const others = useMemo(() => (listed ?? []).filter((i) => !userId \|\| i.seller_id !== userId), [listed, userId]); |   const others = useMemo(() => listed ?? [], [listed]);
 * @mutate src/components/declutter/DeclutterFreeView.tsx |     const theirs = (items.data ?? []).filter((i) => i.seller_id !== userId); |     const theirs = items.data ?? [];
 * @mutate src/boot/declutterPrefetch.ts |     if (viewerId && i.seller_id === viewerId) continue; |
 * @mutate src/components/declutter/DeclutterItemCard.tsx |         className="pointer-events-auto absolute bottom-0.5 right-0.5 disabled:opacity-100 [&_svg]:size-4" |         className="pointer-events-auto absolute right-0.5 top-0.5 disabled:opacity-100 [&_svg]:size-4"
 * @mutate src/components/declutter/DeclutterItemCard.tsx |           className="pointer-events-auto absolute bottom-0.5 right-0.5 flex h-11 |           className="pointer-events-auto absolute right-0.5 top-0.5 flex h-11
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ME = "me";
const item = (n: number, seller: string, price = 1000) => ({
  id: `i${n}`, seller_id: seller, status: "live", title: `Thing ${n}`, description: "", category: "furniture", condition_stars: 4, delivery_size: "small",
  price_cents: price, current_price_cents: price, area_label: "Mid City", area_lat: 30.45 + n / 100, area_lng: -91.15, created_at: "2026-11-16", live_at: "2026-11-16",
  porch_ok: false, accepts_offers: true,
});
const state = { live: [] as unknown[], bundleSellers: new Set<string>() };

vi.mock("@/lib/declutter/saveCounts", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/saveCounts")>()), fetchSaveCounts: async () => new Map<string, number>() }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchLiveItems: async () => state.live,
  fetchPhotos: async () => [],
  fetchDropStates: async () => new Map(),
  fetchWatching: async () => new Set(),
  fetchMapPins: async () => new Map(),
  setWatch: async () => "watching",
}));
vi.mock("@/lib/declutter/bundle", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/bundle")>()), fetchBundleSellers: async () => state.bundleSellers }));
vi.mock("@/components/declutter/useDeclutterOrigin", () => ({
  useDeclutterOrigin: () => ({ origin: { status: "none" }, askDevice: () => undefined, asked: false, asking: false, canAskAgain: false, deviceNote: null, zip: null }),
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/components/sections/SectionScreen", () => ({
  SectionScreen: ({ children, tabs }: { children: React.ReactNode; tabs?: React.ReactNode }) => <main>{tabs}{children}</main>,
}));
vi.mock("@/components/sections/BrowseEndCard", () => ({ BrowseEndCard: () => <p>end of the list</p> }));

import { DeclutterBrowse } from "@/components/declutter/DeclutterBrowseView";
import { FreeView } from "@/components/declutter/DeclutterFreeView";
import { firstCardPhotoPreloads } from "@/boot/declutterPrefetch";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/declutter"]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const cardOf = (title: string) => screen.getByText(title).closest("li") as HTMLElement;

afterEach(() => {
  cleanup();
  state.bundleSellers = new Set();
});

describe("Declutter Browse hides the viewer's own listings (owner 2026-11-25, #40)", () => {
  it("a seller whose only live listings are their own sees none of them on Browse", async () => {
    state.live = [item(1, ME), item(2, ME), item(3, ME)];
    wrap(<DeclutterBrowse userId={ME} chrome={() => ({ tabs: null })} />);
    await waitFor(() => expect(screen.getByText(/Nothing for sale/i)).toBeTruthy());
    expect(screen.queryAllByText(/^Thing \d$/)).toHaveLength(0);
    expect(document.querySelectorAll("[data-card-mine]")).toHaveLength(0);
  });

  it("someone else's card shows, with its heart at the photo's bottom-right; your own card is left out", async () => {
    state.live = [item(1, ME), item(2, "s2"), item(3, "s3")];
    wrap(<DeclutterBrowse userId={ME} chrome={() => ({ tabs: null })} />);
    await waitFor(() => expect(screen.queryAllByText(/^Thing \d$/)).toHaveLength(2));
    // Inventory floor: the other sellers' cards really rendered.
    expect(document.querySelectorAll("[data-item-card]").length).toBeGreaterThan(1);
    expect(screen.queryByText("Thing 1")).toBeNull();
    const theirs = cardOf("Thing 2");
    expect(theirs.querySelector("[data-card-mine]")).toBeNull();
    const heart = theirs.querySelector("[data-card-heart]") as HTMLElement;
    expect(heart).not.toBeNull();
    expect(heart.className).toMatch(/\bbottom-0\.5\b/);
    expect(heart.className).not.toMatch(/\btop-0\.5\b/);
    // The corner is the PHOTO's: the heart's layer has the photo tile's own shape.
    const corner = heart.closest("[data-card-photo-corner]") as HTMLElement;
    expect(corner?.className).toContain("aspect-[3/4]");
  });

  it("a guest's heart (opens sign-up) sits at the photo's bottom-right too", async () => {
    state.live = [item(2, "s2")];
    wrap(<DeclutterBrowse userId={null} chrome={() => ({ tabs: null })} />);
    await waitFor(() => expect(screen.queryAllByText(/^Thing \d$/)).toHaveLength(1));
    const heart = cardOf("Thing 2").querySelector("[data-card-guest-heart]") as HTMLElement;
    expect(heart).not.toBeNull();
    expect(heart.className).toMatch(/\bbottom-0\.5\b/);
    expect(heart.closest("[data-card-photo-corner]")).not.toBeNull();
  });

  it("the Free tab leaves out your own free listing", async () => {
    state.live = [item(1, ME, 0), item(2, "s2", 0)];
    wrap(<FreeView userId={ME} />);
    await waitFor(() => expect(screen.queryAllByText(/^Thing \d$/)).toHaveLength(1));
    expect(screen.queryByText("Thing 1")).toBeNull();
    expect(cardOf("Thing 2").querySelector("[data-card-heart]")).not.toBeNull();
  });

  it("the boot photo preloads skip the own listing's photo, as the grid does", async () => {
    await act(async () => undefined);
    const answer = { items: [{ id: "mine", seller_id: ME }, { id: "a", seller_id: "s1" }], photos: [{ item_id: "mine", storage_path: "u/declutter/mine/1.jpg" }, { item_id: "a", storage_path: "u/declutter/a/1.jpg" }] };
    const got = firstCardPhotoPreloads("https://x.supabase.co", answer, { width: 375, height: 812 }, ME);
    expect(got).toHaveLength(1);
    expect(got[0].href).toContain("/a/1.jpg");
    expect(got[0].high).toBe(true);
  });

  it("index.html's early skeleton photos skip the viewer's own item", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toContain('if (typeof it.id !== "string" || it.seller_id === me) continue;');
  });
});
