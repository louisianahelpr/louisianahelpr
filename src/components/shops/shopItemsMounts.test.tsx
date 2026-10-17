/**
 * The Shops item screens are MOUNTED where members use them (the vacuity
 * gate's "tested only in isolation" class): a shop page that sells shows its
 * items (ShopPage -> ShopView -> ShopItemsList), one that only quotes does
 * not, and /shops/mine shows the owner's items (ShopEditPage -> ShopEditView
 * -> ShopItemsSection) once the shop exists. The children are stubbed; their own behaviour is pinned in
 * shopItemsScreens.test.tsx.
 *
 * @mutate src/components/shops/ShopView.tsx |         {s.offers_selling && <ShopItemsList shopId={s.id} />} |         {false && <ShopItemsList shopId={s.id} />}
 * @mutate src/components/shops/ShopView.tsx |         {s.offers_selling && <ShopItemsList shopId={s.id} />} |         {<ShopItemsList shopId={s.id} />}
 * @mutate src/pages/shops/ShopPage.tsx |       <ShopView />\n | \n
 * @mutate src/pages/shops/ShopEditPage.tsx |       <ShopEditView />\n | \n
 * @mutate src/components/shops/ShopEditView.tsx |       {myId.data && user?.id && <ShopItemsSection shopId={myId.data} ownerId={user.id} />} |       {null}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopPage as ShopPageData } from "@/lib/shops/api";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
const account = { user: { id: "u1" }, profile: {}, isLoading: false };
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => account }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("./ShopItemsList", () => ({ default: ({ shopId }: { shopId: string }) => <p>Items list for {shopId}</p> }));
vi.mock("./ShopItemsSection", () => ({
  default: ({ shopId, ownerId }: { shopId: string; ownerId: string }) => <p>Items section for {shopId} by {ownerId}</p>,
}));

const api = vi.hoisted(() => ({ fetchShop: vi.fn(), fetchMyShopId: vi.fn() }));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/api")>()),
  ...api,
  fetchShopCategories: async () => [{ slug: "bakery", label: "Bakery", group_label: "Food" }],
  shopPhotoUrl: (p: string) => `https://cdn/${p}`,
}));

// Rendered through the route pages (ShopsGate + the view), as the router mounts them.
import ShopPage from "@/pages/shops/ShopPage";
import ShopEditPage from "@/pages/shops/ShopEditPage";

const page = (over: Partial<ShopPageData> = {}): ShopPageData => ({
  id: "s1", owner_id: "u2", name: "Bayou Bakes", about: "Kolaches.", category: "bakery", parishes_served: ["Lafayette"],
  area_label: "Broussard", storefront: false, pin_lat: 30.15, pin_lng: -91.96, offers_selling: true, offers_quotes: false,
  paused: false, badges: {} as ShopPageData["badges"], rating: null, review_count: 0, follower_count: 0, following: false,
  mine: false, sos_number: null, hidden: null, hidden_reason: null, hours: [], photos: [], created_at: "2026-10-15", ...over,
});

function renderAt(path: string, route: string, el: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={el} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.fetchShop.mockReset();
  api.fetchMyShopId.mockReset();
});

describe("where the item screens mount", () => {
  it("a selling shop's page shows its items", async () => {
    api.fetchShop.mockResolvedValue(page());
    renderAt("/shops/s1", "/shops/:id", <ShopPage />);
    expect(await screen.findByText("Items list for s1")).toBeTruthy();
  });

  it("a quotes-only shop's page shows no item list", async () => {
    api.fetchShop.mockResolvedValue(page({ offers_selling: false, offers_quotes: true }));
    renderAt("/shops/s1", "/shops/:id", <ShopPage />);
    expect(await screen.findByRole("heading", { name: "Bayou Bakes" })).toBeTruthy();
    expect(screen.queryByText(/Items list for/)).toBeNull();
  });

  it("/shops/mine shows the owner's items once the shop exists", async () => {
    api.fetchMyShopId.mockResolvedValue("s1");
    api.fetchShop.mockResolvedValue(page({ owner_id: "u1", mine: true }));
    renderAt("/shops/mine", "/shops/mine", <ShopEditPage />);
    expect(await screen.findByText("Items section for s1 by u1")).toBeTruthy();
  });
});
