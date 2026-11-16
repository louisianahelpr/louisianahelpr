/**
 * GUARD (owner 2026-11-16: "my declutter page shows nothing right now and that should not happen"). Every live listing
 * on prod was the owner's own, and Browse left out the viewer's own listings, so the owner's /declutter was empty while
 * guests saw 236 items. Now, as Vinted does:
 *   - Browse and the Free tab show the viewer's own live listings, marked "Yours" (the shared PhotoTag);
 *   - an own card has no heart (you don't save your own item) and no "Bundle deal" chip, and it opens the item page,
 *     which for its seller is the manage view (DeclutterItemView isSeller: no buy, offer or message);
 *   - someone else's card is unchanged: no "Yours", its heart;
 *   - the boot photo preloads count the own listing's slot (they match the grid's cards).
 * Server half (declutter_first_screen holds the caller's own rows): src/test/pglite/declutterFirstScreenIncludesOwn.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |   const others = useMemo(() => listed ?? [], [listed]); |   const others = useMemo(() => (listed ?? []).filter((i) => i.seller_id !== userId), [listed, userId]);
 * @mutate src/components/declutter/DeclutterFreeView.tsx |     return applyBrowseFilters(nearestFirst(items.data ?? [], from, null), FREE_ONLY, "", undefined); |     return applyBrowseFilters(nearestFirst((items.data ?? []).filter((i) => i.seller_id !== userId), from, null), FREE_ONLY, "", undefined);
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |                   mine={!!userId && item.seller_id === userId} |
 * @mutate src/components/declutter/DeclutterItemCard.tsx |             {mine && <PhotoTag data-card-mine="" tone="plain">{t("decl.card.yours")}</PhotoTag>} |
 * @mutate src/components/declutter/DeclutterItemCard.tsx |   const save = mine ? undefined : saveProp; |   const save = saveProp;
 * @mutate src/boot/declutterPrefetch.ts |     if (typeof i?.id !== "string") continue; |     if (typeof i?.id !== "string" \|\| i.id === "mine") continue;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("Declutter Browse shows the viewer's own live listings (owner 2026-11-16)", () => {
  it("the only seller sees their own listings, not an empty feed; each says Yours, has no heart, opens its item page", async () => {
    state.live = [item(1, ME), item(2, ME), item(3, ME)];
    state.bundleSellers = new Set([ME]);
    wrap(<DeclutterBrowse userId={ME} chrome={() => ({ tabs: null })} />);
    await waitFor(() => expect(screen.queryAllByText(/^Thing \d$/)).toHaveLength(3));
    // Inventory floor: the cards really rendered.
    expect(document.querySelectorAll("[data-item-card]").length).toBeGreaterThan(2);
    expect(screen.queryByText(/Nothing for sale/i)).toBeNull();
    for (const n of [1, 2, 3]) {
      const li = cardOf(`Thing ${n}`);
      expect(li.querySelector("[data-card-mine]")?.textContent).toBe("Yours");
      expect(li.querySelector("[data-card-heart]")).toBeNull();
      expect(li.querySelector("[data-card-bundle]")).toBeNull();
      expect(li.querySelector("a[data-item-card]")?.getAttribute("href")).toBe(`/declutter/item/i${n}`);
    }
  });

  it("someone else's card is unchanged: no Yours, its heart", async () => {
    state.live = [item(1, ME), item(2, "s2")];
    wrap(<DeclutterBrowse userId={ME} chrome={() => ({ tabs: null })} />);
    await waitFor(() => expect(screen.queryAllByText(/^Thing \d$/)).toHaveLength(2));
    const theirs = cardOf("Thing 2");
    expect(theirs.querySelector("[data-card-mine]")).toBeNull();
    expect(theirs.querySelector("[data-card-heart]")).not.toBeNull();
    expect(cardOf("Thing 1").querySelector("[data-card-mine]")).not.toBeNull();
  });

  it("the Free tab shows your own free listing too, marked Yours", async () => {
    state.live = [item(1, ME, 0), item(2, "s2", 0)];
    wrap(<FreeView userId={ME} />);
    await waitFor(() => expect(screen.queryAllByText(/^Thing \d$/)).toHaveLength(2));
    expect(cardOf("Thing 1").querySelector("[data-card-mine]")?.textContent).toBe("Yours");
    expect(cardOf("Thing 1").querySelector("[data-card-heart]")).toBeNull();
    expect(cardOf("Thing 2").querySelector("[data-card-mine]")).toBeNull();
  });

  it("the boot photo preloads give the own listing its grid slot, as the grid draws it", async () => {
    await act(async () => undefined);
    const answer = { items: [{ id: "mine", seller_id: ME }, { id: "a", seller_id: "s1" }], photos: [{ item_id: "mine", storage_path: "u/declutter/mine/1.jpg" }, { item_id: "a", storage_path: "u/declutter/a/1.jpg" }] };
    const got = firstCardPhotoPreloads("https://x.supabase.co", answer, { width: 375, height: 812 });
    expect(got).toHaveLength(2);
    expect(got[0].href).toContain("/mine/1.jpg");
    expect(got[0].high).toBe(true);
  });
});
