/**
 * Audit 2026-10-28 P5-5: on a phone (375) the owner's "Dashboard" and "Edit
 * shop" buttons took the shop page's title row and cut the shop's name to
 * "B…". On a phone they now sit in the shop card's actions and the title row
 * holds only the name; on the desktop website (title row inside the global top
 * bar, room to spare) they stay beside the title. A visitor's Follow is
 * unchanged on both.
 *
 * @mutate src/components/shops/ShopView.tsx |           titleInDesktopBar ? <div className="flex gap-2">{ownerButtons("sm", "")}</div> : undefined | <div className="flex gap-2">{ownerButtons("sm", "")}</div>
 * @mutate src/components/shops/ShopView.tsx |               {s.mine && !titleInDesktopBar && ownerButtons("default", " rounded-full")} | {null}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopPage as ShopPageData } from "@/lib/shops/api";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
const bar = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/components/header/PageTitleBar", async (orig) => ({
  ...(await orig<typeof import("@/components/header/PageTitleBar")>()),
  useHeaderInDesktopBar: () => bar.desktop,
}));
// AppPage's title row, as PageHeader draws it: the h1 and titleActions on one row.
vi.mock("@/components/AppPage", () => ({
  default: ({ title, titleActions, children }: { title: string; titleActions?: ReactNode; children: ReactNode }) => (
    <main>
      <div data-testid="title-row">
        <h1>{title}</h1>
        {titleActions}
      </div>
      {children}
    </main>
  ),
}));
vi.mock("./ShopItemsList", () => ({ default: () => null }));
vi.mock("./ShopOrderSheet", () => ({ default: () => null }));
vi.mock("./ShopFaqs", () => ({ default: () => null }));
vi.mock("./ShopPolicies", () => ({ default: () => null }));

const api = vi.hoisted(() => ({ fetchShop: vi.fn() }));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/api")>()),
  fetchShop: api.fetchShop,
  fetchShopCategories: async () => [{ slug: "bakery", label: "Bakery", group_label: "Food" }],
  shopPhotoUrl: (p: string) => `https://cdn/${p}`,
}));
vi.mock("@/lib/shops/items", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/items")>()),
  fetchShopItems: async () => [{ id: "i1", status: "live", title: "Mug" }],
}));

import ShopPage from "@/pages/shops/ShopPage";

const page = (over: Partial<ShopPageData> = {}): ShopPageData => ({
  id: "s1", owner_id: "u1", name: "Bayou Pottery DD4-AUDIT-1028", about: "", category: "bakery", parishes_served: [],
  area_label: "Mid City", storefront: false, pin_lat: 30.45, pin_lng: -91.15, offers_selling: true, offers_quotes: false,
  paused: false, badges: {} as ShopPageData["badges"], rating: null, review_count: 0, follower_count: 0, following: false,
  mine: true, sos_number: null, hidden: null, hidden_reason: null, hours: [], photos: [], created_at: "2026-10-28", ...over,
});

function renderShop() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/shops/s1"]}>
        <Routes>
          <Route path="/shops/:id" element={<ShopPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const OWNER = ["Dashboard", "Edit shop"];

beforeEach(() => api.fetchShop.mockReset());

describe("the shop page's title row on a phone holds the name, not the owner's buttons", () => {
  it("phone: Dashboard and Edit shop sit with Share and Print, never in the title row", async () => {
    bar.desktop = false;
    api.fetchShop.mockResolvedValue(page());
    renderShop();
    const share = await screen.findByRole("button", { name: "Share my shop" });
    const row = screen.getByTestId("title-row");
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    const actions = share.parentElement as HTMLElement;
    for (const name of OWNER) expect(within(actions).getByRole("button", { name })).toBeTruthy();
  });

  it("desktop website: they stay beside the title, once", async () => {
    bar.desktop = true;
    api.fetchShop.mockResolvedValue(page());
    renderShop();
    await screen.findByRole("button", { name: "Share my shop" });
    const row = screen.getByTestId("title-row");
    for (const name of OWNER) {
      expect(within(row).getByRole("button", { name })).toBeTruthy();
      expect(screen.getAllByRole("button", { name })).toHaveLength(1);
    }
  });

  it("a visitor keeps Follow on the title row", async () => {
    bar.desktop = false;
    api.fetchShop.mockResolvedValue(page({ mine: false, owner_id: "u2" }));
    renderShop();
    await screen.findByRole("button", { name: "Share" });
    const row = screen.getByTestId("title-row");
    expect(within(row).getByRole("button", { name: "Follow" })).toBeTruthy();
    for (const name of OWNER) expect(screen.queryByRole("button", { name })).toBeNull();
  });
});
