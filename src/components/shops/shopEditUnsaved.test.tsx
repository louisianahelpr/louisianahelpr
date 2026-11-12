/**
 * S2-041 (Shops audit 2): Edit my shop has parts that save on their own. The main "Save my shop" no longer leaves the
 * page while another part holds unsaved edits (it names them instead), and closing the tab with unsaved edits warns.
 * Lead 11-12: the page's back arrow asks before throwing unsaved edits away (like S2-007's item editor).
 * S2-034: the "Custom orders" box shows and sets the one custom-order switch.
 *
 * @mutate src/components/shops/ShopEditView.tsx |       if (myId.data && dirtySections.length > 0) { |       if (false) {
 * @mutate src/components/shops/ShopFaqsEditor.tsx |   useReportUnsaved("Questions buyers ask", | void (
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/lib/toastPolicy", () => ({ confirmConsequential: vi.fn() }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => ({ latitude: 30.15, longitude: -91.96 }) }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) => (
    <main><button type="button" onClick={onBack}>Go back</button><h1>{title}</h1>{children}</main>
  ),
}));
const faqDirty = vi.hoisted(() => ({ on: false }));
vi.mock("./ShopFaqsEditor", async () => {
  const { useReportUnsaved } = await import("./unsavedSections");
  function FaqsStub() {
    useReportUnsaved("Questions buyers ask", faqDirty.on);
    return <p>FAQs</p>;
  }
  return { default: FaqsStub };
});
vi.mock("./ShopPickupAddressSection", () => ({ default: () => null }));
vi.mock("./ShopPermitSection", () => ({ default: () => null }));
vi.mock("./ShopItemsSection", () => ({ default: () => null }));

const api = vi.hoisted(() => ({ fetchShop: vi.fn(), fetchMyShopId: vi.fn(async () => "s1"), saveMyShop: vi.fn(async () => "s1"), setShopHours: vi.fn(async () => undefined) }));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/api")>()),
  ...api,
  fetchShopCategories: async () => [{ slug: "bakery", label: "Bakery", group_slug: "food", group_label: "Food" }],
  shopPhotoUrl: (p: string) => `https://cdn/${p}`,
}));
const orders = vi.hoisted(() => ({ mode: "off", setCustomOrders: vi.fn(async (m: string) => m) }));
vi.mock("@/lib/shops/orders", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/orders")>()),
  fetchCustomOrders: async () => orders.mode,
  setCustomOrders: orders.setCustomOrders,
}));

import ShopEditPage from "@/pages/shops/ShopEditPage";

const page = (): ShopPageData => ({
  id: "s1", owner_id: "u1", name: "Bayou Bakes", about: "Kolaches.", category: "bakery", parishes_served: ["Lafayette"],
  area_label: "Broussard", storefront: false, pin_lat: 30.15, pin_lng: -91.96, offers_selling: true, offers_quotes: true,
  paused: false, badges: {} as ShopPageData["badges"], rating: null, review_count: 0, follower_count: 0, following: false,
  mine: true, sos_number: null, hidden: null, hidden_reason: null, hours: [], photos: [], created_at: "2026-10-15",
});

function renderEdit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/shops/mine"]}>
        <Routes>
          <Route path="/shops/mine" element={<ShopEditPage />} />
          <Route path="/shops/:id" element={<p>Shop page</p>} />
          <Route path="/shops" element={<p>Shops home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchShop.mockResolvedValue(page());
  faqDirty.on = false;
  orders.mode = "off";
});

const beforeUnloadBlocked = () => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

describe("S2-041: unsaved parts of Edit my shop", () => {
  it("the main save stays on the page and names a part with unsaved edits", async () => {
    faqDirty.on = true;
    renderEdit();
    await screen.findByText("FAQs");
    const save = screen.getByRole("button", { name: "Save my shop" });
    await waitFor(() => expect(beforeUnloadBlocked()).toBe(true));
    fireEvent.click(save);
    expect((await screen.findByTestId("shop-still-unsaved")).textContent).toContain("Questions buyers ask");
    expect(screen.queryByText("Shop page")).toBeNull();
  });

  it("with nothing else unsaved the main save goes to the shop page, and an untouched page never warns", async () => {
    renderEdit();
    await screen.findByText("FAQs");
    const save = screen.getByRole("button", { name: "Save my shop" });
    expect(beforeUnloadBlocked()).toBe(false);
    fireEvent.change(screen.getByLabelText("Shop or business name"), { target: { value: "Bayou Bakes Two" } });
    expect(beforeUnloadBlocked()).toBe(true);
    fireEvent.click(save);
    expect(await screen.findByText("Shop page")).toBeTruthy();
  });
});

describe("the back arrow asks before leaving unsaved edits", () => {
  it("asks when the form has changes; Keep editing stays, Leave goes", async () => {
    renderEdit();
    await screen.findByText("FAQs");
    fireEvent.change(screen.getByLabelText("Shop or business name"), { target: { value: "Bayou Bakes Two" } });
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(await screen.findByText("Leave without saving?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Leave without saving?")).toBeNull());
    expect(screen.queryByText("Shops home")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
    expect(await screen.findByText("Shops home")).toBeTruthy();
  });

  it("an untouched page goes straight back", async () => {
    renderEdit();
    await screen.findByText("FAQs");
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(await screen.findByText("Shops home")).toBeTruthy();
  });
});

describe("S2-034: the Custom orders box is the one switch", () => {
  it("shows the switch (not offers_quotes) and ticking it turns custom orders on", async () => {
    renderEdit();
    await screen.findByText("FAQs");
    const box = screen.getByRole("checkbox", { name: /Custom orders \(made to order\)/ });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Save my shop" }));
    await waitFor(() => expect(orders.setCustomOrders).toHaveBeenCalledWith("full_hold"));
  });
});
