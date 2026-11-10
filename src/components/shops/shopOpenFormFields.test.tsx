/**
 * Shops audit 11-10 (~/.lh-shots/shops-audit-1110/FINDINGS.md), the open-a-shop form:
 *  F7  the common categories are one tap; "More" opens the full list.
 *  F8  the town placeholder reads "e.g. Broussard".
 *
 * @mutate src/components/shops/ShopCategoryQuickPick.tsx | onClick={() => { setMore(false); onChange(c.slug); }} | onClick={() => { setMore(false); }}
 * @mutate src/components/shops/ShopEditView.tsx | placeholder="e.g. Broussard" | placeholder="Broussard"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
const account = { user: { id: "u1" }, profile: { parish: null }, isLoading: false };
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => account }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/toastPolicy", () => ({ confirmConsequential: vi.fn() }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => ({ latitude: 30.15, longitude: -91.96 }) }));
const api = vi.hoisted(() => ({ saveMyShop: vi.fn(async () => "s1"), setShopHours: vi.fn(async () => undefined) }));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/api")>()),
  ...api,
  fetchMyShopId: async () => null,
  fetchShopCategories: async () => [
    { slug: "bakery", label: "Bakery and cakes", group_slug: "food_to_order", group_label: "Food to order" },
    { slug: "crafts_gifts", label: "Crafts and gifts", group_slug: "made_locally", group_label: "Made locally" },
    { slug: "cleaning", label: "Cleaning", group_slug: "home_services", group_label: "Home services" },
    { slug: "tattoo", label: "Tattoo", group_slug: "beauty", group_label: "Beauty" },
  ],
}));

import ShopEditPage from "@/pages/shops/ShopEditPage";

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/shops/mine"]}>
        <Routes>
          <Route path="/shops/mine" element={<ShopEditPage />} />
          <Route path="/shops/:id" element={<p>Shop page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("open-a-shop form (audit 11-10 F7, F8)", () => {
  it("F7: common categories are one tap; More opens the full list", async () => {
    renderForm();
    await screen.findByRole("button", { name: "Open my shop" });
    const bakery = screen.getByRole("radio", { name: "Bakery and cakes" });
    fireEvent.click(bakery);
    expect(bakery.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Tattoo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("button", { name: /Choose another category/ })).toBeTruthy();
  });

  it("F8: the town placeholder says it is an example", async () => {
    renderForm();
    await screen.findByRole("button", { name: "Open my shop" });
    expect(screen.getByLabelText("Town or neighborhood").getAttribute("placeholder")).toBe("e.g. Broussard");
  });
});
