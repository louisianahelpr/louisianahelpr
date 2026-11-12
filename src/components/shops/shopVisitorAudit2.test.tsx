/**
 * Shops audit 2 (11-12), visitor shop page:
 * - S2-028: the sticky "Review order" bar hides while the order sheet is on screen (it covered the note box), and the
 *   sheet has a scroll margin so "Review order" lands on its heading.
 * - S2-029: an item's option lists show their names ("Scent", "Size") above each select.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ShopItem } from "@/lib/shops/items";
import type { ShopItemOptions } from "@/lib/shops/variants";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const item = { id: "a", kind: "made", subtype: "candles", status: "live", title: "Soy candle", description: "", price_cents: 2000,
  lead_time_days: 0, stock_count: null, home_kitchen: false, photos: [] } as unknown as ShopItem;
vi.mock("@/lib/shops/items", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/items")>()), fetchShopItems: async () => [item] }));
vi.mock("@/lib/shops/variants", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/variants")>()), fetchItemOptions: async () => new Map() }));
vi.mock("@/lib/shops/preorders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/preorders")>()), fetchItemPreorders: async () => new Map() }));

import ShopReviewOrderBar from "./ShopReviewOrderBar";
import ShopOrderOptions from "./ShopOrderOptions";
import { ShopCartProvider, useShopCart } from "./shopCart";
import { useEffect } from "react";

afterEach(() => { vi.unstubAllGlobals(); });

function Seed() {
  const { setQty } = useShopCart();
  useEffect(() => { setQty({ a: 2 }); }, [setQty]);
  return null;
}

describe("S2-028: the Review order bar steps aside for the order sheet", () => {
  it("hides while the order sheet intersects the screen, and comes back when it leaves", async () => {
    let cb: IntersectionObserverCallback = () => {};
    vi.stubGlobal("IntersectionObserver", class {
      constructor(c: IntersectionObserverCallback) { cb = c; }
      observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ShopCartProvider>
          <section id="shop-order-sheet" />
          <Seed />
          <ShopReviewOrderBar shopId="s1" />
        </ShopCartProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("Review order (2)");
    act(() => cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(document.querySelector("[data-shop-review-bar]")).toBeNull();
    act(() => cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(document.querySelector("[data-shop-review-bar]")).not.toBeNull();
  });

  it("the order sheet carries a scroll margin so it lands on its heading", () => {
    const src = readFileSync(resolve(__dirname, "ShopOrderSheet.tsx"), "utf8");
    expect(src).toMatch(/id="shop-order-sheet" className="scroll-mt-\d+/);
  });
});

describe("S2-029: option lists show their names", () => {
  it("each select has a visible name above it", () => {
    const options: ShopItemOptions = {
      item_id: "a", option_names: ["Scent", "Size"],
      variants: [{ id: "v1", values: ["Fig", "8 oz"], price_cents: 2000, stock_count: null, active: true }],
    };
    render(<ul><ShopOrderOptions item={item} options={options} qty={{}} maxPerLine={10} onQty={() => {}} /></ul>);
    const names = [...document.querySelectorAll("[data-option-name]")].map((n) => n.textContent);
    expect(names).toEqual(["Scent", "Size"]);
    expect(screen.getByRole("combobox", { name: "Scent for Soy candle" }).closest("label")?.textContent).toContain("Scent");
  });
});

describe("S2-030: a cancel rule that keeps the card processing cost never says Free", async () => {
  const { CANCEL_POLICIES, READY_TAP_CANCELS, cancelPolicyText } = await import("@/lib/shops/orders");
  it("every buyer label whose detail keeps a cost reads as a refund, not free", () => {
    const all = CANCEL_POLICIES.flatMap((p) => READY_TAP_CANCELS.map((t) => cancelPolicyText(p, t)));
    for (const { label, detail } of all) {
      if (/isn't refunded/.test(detail)) expect(label, label).not.toMatch(/free/i);
      expect(detail, detail).not.toMatch(/free cancel/i);
    }
    expect(cancelPolicyText("until_accept", null).label).toBe("Free to cancel until the shop accepts");
  });
});

describe("S2-032: the item card title clamps on a span, not on the button", () => {
  it("no <button> carries line-clamp in ShopProfile", () => {
    const src = readFileSync(resolve(__dirname, "ShopProfile.tsx"), "utf8");
    expect(src).not.toMatch(/<button[^>]*className="[^"]*line-clamp/);
    expect(src).toMatch(/<span className="line-clamp-2" data-item-title="">\{item\.title\}<\/span>/);
  });
});
