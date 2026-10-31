/**
 * Audit 2026-10-28 P5-2: an owner's new, empty shop showed "Share my shop" and
 * "Print a sign" first and, far below, "No items listed yet." with no way to
 * add one. Now an owner whose selling shop lists nothing sees the empty state
 * with "Add an item" FIRST in the shop card, ahead of Share and Print, and the
 * button opens the item editor on /shops/mine (#add-item). Visitors still see
 * the Items card's "No items listed yet."; an owner with a listed item sees
 * the usual list.
 *
 * @mutate src/components/shops/ShopView.tsx |   const ownerEmpty = s.mine && s.offers_selling && ownItems.isSuccess && !ownItems.data.some((i) => i.status === "live"); |   const ownerEmpty = false;
 * @mutate src/components/shops/ShopView.tsx | onClick={() => navigate("/shops/mine#add-item")} | onClick={() => navigate("/shops/mine")}
 * @mutate src/components/shops/ShopItemsSection.tsx | useState<string \| "new" \| null>(startAdding ? "new" : null) | useState<string \| "new" \| null>(null)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopPage as ShopPageData } from "@/lib/shops/api";
import type { ShopItem } from "@/lib/shops/items";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
const account = { user: { id: "u1" }, profile: {}, isLoading: false };
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => account }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("./ShopItemsList", () => ({ default: ({ shopId }: { shopId: string }) => <p>Items list for {shopId}</p> }));
vi.mock("./ShopFaqs", () => ({ default: () => null }));
vi.mock("./ShopPolicies", () => ({ default: () => null }));
vi.mock("./ShopFaqsEditor", () => ({ default: () => null }));
vi.mock("./ShopPickupAddressSection", () => ({ default: () => null }));
vi.mock("./ShopDailyCap", () => ({ default: () => null }));
vi.mock("./ShopItemEditor", () => ({ default: ({ item }: { item: unknown }) => <p>Item editor ({item ? "edit" : "new"})</p> }));

const api = vi.hoisted(() => ({ fetchShop: vi.fn(), fetchMyShopId: vi.fn(), fetchShopItems: vi.fn() }));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/api")>()),
  fetchShop: api.fetchShop,
  fetchMyShopId: api.fetchMyShopId,
  fetchShopCategories: async () => [{ slug: "bakery", label: "Bakery", group_label: "Food" }],
  shopPhotoUrl: (p: string) => `https://cdn/${p}`,
}));
vi.mock("@/lib/shops/items", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/items")>()),
  fetchShopItems: api.fetchShopItems,
}));

import ShopPage from "@/pages/shops/ShopPage";
import ShopEditPage from "@/pages/shops/ShopEditPage";

const page = (over: Partial<ShopPageData> = {}): ShopPageData => ({
  id: "s1", owner_id: "u1", name: "Bayou Pottery", about: "Mugs.", category: "bakery", parishes_served: [],
  area_label: "Mid City", storefront: false, pin_lat: 30.45, pin_lng: -91.15, offers_selling: true, offers_quotes: false,
  paused: false, badges: {} as ShopPageData["badges"], rating: null, review_count: 0, follower_count: 0, following: false,
  mine: true, sos_number: null, hidden: null, hidden_reason: null, hours: [], photos: [], created_at: "2026-10-28", ...over,
});
const item = (status: ShopItem["status"]) => ({ id: `i-${status}`, status, title: "Mug" }) as unknown as ShopItem;

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.hash}</p>;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/shops/mine" element={<><ShopEditPage /><Where /></>} />
          <Route path="/shops/:id" element={<ShopPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.fetchShop.mockReset();
  api.fetchMyShopId.mockReset();
  api.fetchShopItems.mockReset();
});

describe("an owner's empty shop leads with Add an item", () => {
  it("shows the empty state and Add an item before Share and Print, and no second Items card", async () => {
    api.fetchShop.mockResolvedValue(page());
    api.fetchShopItems.mockResolvedValue([item("draft")]);
    renderAt("/shops/s1");
    const block = await screen.findByTestId("shop-owner-empty");
    expect(block.textContent).toContain("No items listed yet.");
    const add = screen.getByRole("button", { name: "Add an item" });
    const share = screen.getByRole("button", { name: "Share my shop" });
    const print = screen.getByRole("button", { name: "Print a sign" });
    expect(add.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(add.compareDocumentPosition(print) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Items list for/)).toBeNull();
  });

  it("Add an item opens the item editor on /shops/mine", async () => {
    api.fetchShop.mockResolvedValue(page());
    api.fetchShopItems.mockResolvedValue([]);
    api.fetchMyShopId.mockResolvedValue("s1");
    renderAt("/shops/s1");
    fireEvent.click(await screen.findByRole("button", { name: "Add an item" }));
    expect((await screen.findByTestId("where")).textContent).toBe("/shops/mine#add-item");
    expect(await screen.findByText("Item editor (new)")).toBeTruthy();
  });

  it("/shops/mine without #add-item keeps the editor closed", async () => {
    api.fetchShop.mockResolvedValue(page());
    api.fetchShopItems.mockResolvedValue([]);
    api.fetchMyShopId.mockResolvedValue("s1");
    renderAt("/shops/mine");
    expect(await screen.findByRole("button", { name: "Add an item" })).toBeTruthy();
    expect(screen.queryByText(/Item editor/)).toBeNull();
  });

  it("an owner with a listed item sees the usual list, no empty state", async () => {
    api.fetchShop.mockResolvedValue(page());
    api.fetchShopItems.mockResolvedValue([item("live")]);
    renderAt("/shops/s1");
    expect(await screen.findByText("Items list for s1")).toBeTruthy();
    expect(screen.queryByTestId("shop-owner-empty")).toBeNull();
  });

  it("a visitor never sees Add an item", async () => {
    api.fetchShop.mockResolvedValue(page({ mine: false, owner_id: "u2" }));
    renderAt("/shops/s1");
    expect(await screen.findByText("Items list for s1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add an item" })).toBeNull();
    expect(screen.queryByTestId("shop-owner-empty")).toBeNull();
  });
});
