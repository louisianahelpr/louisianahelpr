/**
 * Custom orders (lead 11-06 ~3:35 PM): a shop's "What this shop offers" card said "Quotes open here soon." even when
 * the shop takes custom orders, whose request sheet IS how to ask it for work. The line now shows only while custom
 * orders are off (the same shops.custom_orders read as the sheet).
 * S030 (Shops audit 11-12): "Quotes open here soon." was a dead-end promise. "Gives quotes" now shows only while the
 * shop takes custom orders, as "takes custom orders" with a button to the request sheet; otherwise the line drops.
 *
 * @mutate src/components/shops/ShopView.tsx |   const takesCustom = !!customOrders.data && customOrders.data !== "off"; |   const takesCustom = !!customOrders.data;
 * @mutate src/components/shops/ShopView.tsx |             {takesCustom && !s.mine && !s.paused && ( |             {false && (
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopPage as ShopPageData } from "@/lib/shops/api";

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
vi.mock("./ShopItemsList", () => ({ default: () => null }));
vi.mock("./ShopFaqs", () => ({ default: () => null }));
vi.mock("./ShopPolicies", () => ({ default: () => null }));
vi.mock("./ShopCustomRequestSheet", () => ({ default: () => null }));
vi.mock("./ShopOrderSheet", () => ({ default: () => null }));
vi.mock("./ShopReviews", () => ({ ShopReviewsCard: () => null }));

const api = vi.hoisted(() => ({ fetchShop: vi.fn(), fetchShopItems: vi.fn() }));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/api")>()),
  fetchShop: api.fetchShop,
  fetchMyShopId: async () => null,
  fetchShopCategories: async () => [{ slug: "bakery", label: "Bakery", group_label: "Food" }],
  shopPhotoUrl: (p: string) => `https://cdn/${p}`,
}));
vi.mock("@/lib/shops/items", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/items")>()),
  fetchShopItems: api.fetchShopItems,
}));
const orders = vi.hoisted(() => ({ mode: "off" as string, reads: 0 }));
vi.mock("@/lib/shops/orders", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/orders")>()),
  fetchCustomOrders: async () => {
    orders.reads += 1;
    return orders.mode;
  },
}));

import ShopPage from "@/pages/shops/ShopPage";

const page = (over: Partial<ShopPageData> = {}): ShopPageData => ({
  id: "s1", owner_id: "u2", name: "Bayou Cakes", about: "Cakes.", category: "bakery", parishes_served: [],
  area_label: "Mid City", storefront: false, pin_lat: 30.45, pin_lng: -91.15, offers_selling: true, offers_quotes: true,
  paused: false, badges: {} as ShopPageData["badges"], rating: null, review_count: 0, follower_count: 0, following: false,
  mine: false, sos_number: null, hidden: null, hidden_reason: null, hours: [], photos: [], created_at: "2026-10-28", ...over,
});

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/shops/:id" element={<ShopPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.fetchShop.mockReset();
  api.fetchShopItems.mockReset();
  api.fetchShopItems.mockResolvedValue([]);
  orders.mode = "off";
  orders.reads = 0;
});

describe("S030: 'gives quotes' shows only while the shop takes custom orders, and points at the request sheet", () => {
  it("custom orders off: no quotes promise; the card says only what the shop sells", async () => {
    api.fetchShop.mockResolvedValue(page());
    renderAt("/shops/s1");
    const title = await screen.findByRole("heading", { name: "What this shop offers" });
    await vi.waitFor(() => expect(orders.reads).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    const card = title.closest("section") as HTMLElement;
    expect(card.querySelector("p")?.textContent).toBe("Sells items.");
    expect(document.body.textContent).not.toMatch(/open here soon|gives quotes/i);
    expect(screen.queryByRole("button", { name: "Ask for a custom order" })).toBeNull();
  });

  it("custom orders off and the shop only gave quotes: the card is not shown", async () => {
    api.fetchShop.mockResolvedValue(page({ offers_selling: false }));
    renderAt("/shops/s1");
    await screen.findByText("Bayou Cakes");
    await vi.waitFor(() => expect(orders.reads).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("heading", { name: "What this shop offers" })).toBeNull();
  });

  it.each(["full_hold", "deposit_50"])("custom orders on (%s): 'takes custom orders' with a button to the request sheet", async (mode) => {
    orders.mode = mode;
    api.fetchShop.mockResolvedValue(page());
    renderAt("/shops/s1");
    expect(await screen.findByText("Sells items and takes custom orders.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask for a custom order" })).toBeTruthy();
  });
});
