/**
 * Shops audit 11-10 (~/.lh-shots/shops-audit-1110/FINDINGS.md), the open-a-shop form:
 *  F6  a new shop starts open Monday to Friday 9 to 5, and its parish is picked from the town typed (the full list is
 *      behind "Add other parishes"); the optional business number waits behind "Have a Louisiana business number?".
 *  F7  the common categories are one tap; "More" opens the full list.
 *  F8  the town placeholder reads "e.g. Broussard".
 *
 * @mutate src/components/shops/ShopEditView.tsx |   Object.fromEntries(WEEKDAYS.map((_, i) => [i, { open: i >= 1 && i <= 5, opens: "09:00", closes: "17:00" }])); |   Object.fromEntries(WEEKDAYS.map((_, i) => [i, { open: false, opens: "09:00", closes: "17:00" }]));
 * @mutate src/components/shops/ShopEditView.tsx |     const fromTown = parishForCity(form.areaLabel)?.name ?? null; |     const fromTown = null;
 * @mutate src/components/shops/ShopEditView.tsx |   const [showSos, setShowSos] = useState(false); |   const [showSos, setShowSos] = useState(true);
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

describe("open-a-shop form (audit 11-10 F6, F7, F8)", () => {
  it("F6: Monday to Friday 9 to 5 is set, and the parish follows the town", async () => {
    renderForm();
    await screen.findByRole("button", { name: "Open my shop" });
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
      expect(screen.getByRole("checkbox", { name: day }).getAttribute("aria-checked") ?? screen.getByRole("checkbox", { name: day }).getAttribute("data-state")).toMatch(/true|checked/);
      expect((screen.getByLabelText(`${day} opens`) as HTMLInputElement).value).toBe("09:00");
    }
    expect(screen.getByRole("checkbox", { name: "Sunday" }).getAttribute("data-state")).toBe("unchecked");
    expect(screen.queryByRole("checkbox", { name: "Lafayette" })).toBeNull(); // the long list waits behind the button
    fireEvent.change(screen.getByLabelText("Town or neighborhood"), { target: { value: "Broussard" } });
    expect(await screen.findByRole("button", { name: "Remove Lafayette" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add other parishes" }));
    expect(screen.getByRole("checkbox", { name: "Lafayette" }).getAttribute("data-state")).toBe("checked");
  });

  it("F6: the optional business number waits behind one tap", async () => {
    renderForm();
    await screen.findByRole("button", { name: "Open my shop" });
    expect(screen.queryByLabelText(/Secretary of State number/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Have a Louisiana business number?" }));
    expect(screen.getByLabelText(/Secretary of State number/)).toBeTruthy();
  });

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
