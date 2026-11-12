/**
 * S2-039 (Shops audit 2): the signed-out shop page keeps a readable width, its sign-up button is sized like other
 * primaries from sm up (not a 1,358px bar at 1440), its text links have a 44px tap area, and the shop's name shows
 * once (the header says "Shop").
 * S2-038: an item with options says "From $18" (has_options, 20261112210500), and tapping an item opens a read-only
 * sheet with "Sign up to order".
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const ID = "00000000-0000-4000-8000-00000000a001";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("./ShopFaqs", () => ({ default: () => null }));
vi.mock("./ShopPolicies", () => ({ default: () => null }));
const fx = vi.hoisted(() => ({ selling: false }));
const itemOf = (id: string, title: string, price: number, has_options: boolean) => ({
  id, shop_id: "x", kind: "made", subtype: "candles", status: "live", title, description: `About ${title}`, price_cents: price,
  lead_time_days: 2, stock_count: null, home_kitchen: false, photos: [], has_options,
});
vi.mock("@/lib/shops/publicShop", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/publicShop")>()),
  fetchPublicShop: async () => ({
    id: ID, name: "TEST Mae's Bakery", about: "", category: "bakery", category_label: "Bakery and cakes", group_label: null,
    parishes_served: [], area_label: "Broussard", storefront: false, offers_selling: fx.selling, offers_quotes: false,
    badges: { id_checked: false, licensed: false, insured: false, registered: false, permit: false },
    rating: null, review_count: 0, hours: [], photos: [],
    items: fx.selling ? [itemOf("i1", "Soy candle", 1800, true), itemOf("i2", "Pecan pie", 2500, false)] : [],
  }),
}));

import PublicShopView from "./PublicShopView";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/s/${ID}`]}>
        <Routes><Route path="/s/:id" element={<PublicShopView />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("S2-039: the signed-out shop page layout", () => {
  it("caps the width, sizes the CTA, gives links 44px, and names the shop once", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/s/${ID}`]}>
          <Routes><Route path="/s/:id" element={<PublicShopView />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const cta = await screen.findByRole("link", { name: "Sign up to order or message" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Shop");
    expect(screen.getAllByText("TEST Mae's Bakery")).toHaveLength(1);
    expect(cta.className).toContain("sm:w-auto");
    expect(cta.className.split(/\s+/)).toContain("h-14");
    for (const name of ["Sign in", "Sign in to report it"]) {
      expect(screen.getByRole("link", { name }).className).toContain("min-h-11");
    }
    expect((document.querySelector("[data-public-shop-body]") as HTMLElement).className).toContain("max-w-5xl");
  });
});

describe("S2-038: signed-out items", () => {
  it("say From for an item with options and open a read-only sheet with Sign up to order", async () => {
    fx.selling = true;
    mount();
    expect(await screen.findByText("From $18")).toBeTruthy();
    expect(screen.getByText("$25")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Soy candle" }));
    const sheet = await screen.findByText("About Soy candle");
    expect(sheet).toBeTruthy();
    const signup = screen.getByRole("link", { name: "Sign up to order" });
    expect(signup.getAttribute("href")).toBe(`/signup?redirect=${encodeURIComponent(`/shops/${ID}`)}`);
    expect(screen.queryByRole("button", { name: /Add to order/ })).toBeNull();
  });
});
