/**
 * S026 (Shops audit 11-12), the rest: the item card is the place to order. Tapping a card's title opens an item sheet
 * (photos, description, quantity, "Add to order"); the order it builds is the SAME order the order sheet below shows,
 * and a sticky "Review order (n) $X" bar appears once the order holds something. Follow is secondary (outline).
 * The card's "Order" button (7795fae173) keeps going to the item's row in the order sheet.
 *
 * @mutate src/components/shops/ShopItemsList.tsx |           onOpen={orderable && sharesOrder ? setOpenId : undefined} /> |           onOpen={undefined} />
 * @mutate src/components/shops/ShopOrderSheet.tsx |   const { qty, setQty } = useShopCart(); |   const [qty, setQty] = useState<Record<string, number>>({});
 * @mutate src/components/shops/ShopView.tsx |             variant="outline" |             variant="default"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ShopItem } from "@/lib/shops/items";
import type { OrderTerms } from "@/lib/shops/orders";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/DatePickerField", () => ({ DatePickerField: () => <span>date</span> }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeKnown: () => true }));
const items = vi.hoisted(() => ({ fetchShopItems: vi.fn() }));
vi.mock("@/lib/shops/items", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/items")>()), ...items }));
const orders = vi.hoisted(() => ({ fetchOrderTerms: vi.fn(), requestOrder: vi.fn() }));
vi.mock("@/lib/shops/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/orders")>()), ...orders }));
vi.mock("@/lib/shops/variants", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/variants")>()), fetchItemOptions: async () => new Map() }));
vi.mock("@/lib/shops/preorders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/preorders")>()), fetchItemPreorders: async () => new Map() }));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), fetchHandoverMode: async () => "in_person" }));
vi.mock("@/lib/shops/delivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/delivery")>()),
  fetchDeliveryOffer: async () => ({ delivers: false, fee_cents: 0, radius_miles: 0 }),
}));
vi.mock("./ShopMyStrikes", () => ({ default: () => null }));
vi.mock("./ShopReport", () => ({ ShopReportItem: () => null }));

import ShopItemsList from "./ShopItemsList";
import ShopOrderSheet from "./ShopOrderSheet";
import ShopReviewOrderBar from "./ShopReviewOrderBar";
import { ShopCartProvider } from "./shopCart";

const item = (id: string, title: string, cents: number, description = "") => ({
  id, kind: "made", subtype: "candles", status: "live", title, description, price_cents: cents,
  lead_time_days: 0, stock_count: null, home_kitchen: false, photos: [],
}) as unknown as ShopItem;
const TERMS: OrderTerms = {
  cancel_policy: "until_accept", paused: false, open_weekdays: [2, 3, 4, 5, 6], daily_order_cap: null,
  today: "2026-10-19", last_day: "2027-01-17", full_days: [],
};

function page() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ShopCartProvider>
          <ShopItemsList shopId="s1" reportable orderable />
          <ShopOrderSheet shopId="s1" />
          <ShopReviewOrderBar shopId="s1" />
        </ShopCartProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  items.fetchShopItems.mockResolvedValue([item("a", "Fig candle", 2000, "Hand-poured, 8 oz."), item("b", "Tea towel", 1150)]);
  orders.fetchOrderTerms.mockResolvedValue(TERMS);
});

describe("S026: the item card opens an item sheet that adds to the one order", () => {
  it("tap a card -> item sheet with the description; Add to order fills the order sheet and the Review order bar", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Fig candle" }));
    const sheet = await screen.findByTestId("shop-item-sheet");
    expect(within(sheet).getByText("Hand-poured, 8 oz.")).toBeTruthy();
    expect(screen.queryByText(/^Review order/)).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "One more Fig candle" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "One more Fig candle" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to order" }));
    // The order sheet's own stepper shows the same order, and its total counts it.
    const row = document.querySelector<HTMLElement>('#shop-order-sheet [data-order-item="a"]') as HTMLElement;
    expect(within(row).getByRole("group", { name: "How many Fig candle" }).textContent).toContain("2");
    const bar = document.querySelector('[data-shop-review-bar]') as HTMLElement;
    expect(bar.textContent).toBe("Review order (2)$40.00");
    // A change in the order sheet moves the bar too (one order, not two).
    fireEvent.click(screen.getByRole("button", { name: "One more Tea towel" }));
    expect(bar.textContent).toBe("Review order (3)$51.50");
  });

  it("closing the sheet without Add keeps the order as it was; reopening can remove it", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Tea towel" }));
    fireEvent.click(within(await screen.findByTestId("shop-item-sheet")).getByRole("button", { name: "One more Tea towel" }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(document.querySelector("[data-shop-review-bar]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tea towel" }));
    fireEvent.click(within(await screen.findByTestId("shop-item-sheet")).getByRole("button", { name: "One more Tea towel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to order" }));
    expect(document.querySelector("[data-shop-review-bar]")?.textContent).toBe("Review order (1)$11.50");
    fireEvent.click(screen.getByRole("button", { name: "Tea towel" }));
    fireEvent.click(within(await screen.findByTestId("shop-item-sheet")).getByRole("button", { name: "One less Tea towel" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from order" }));
    expect(document.querySelector("[data-shop-review-bar]")).toBeNull();
  });

  it("the card's Order button stays; Follow is secondary; the page shares one order", () => {
    const src = (f: string) => blankComments(readFileSync(resolve(__dirname, f), "utf8"));
    expect(src("ShopItemsList.tsx")).toMatch(/onOrder=\{orderable \? goToOrderRow : undefined\}/);
    const view = src("ShopView.tsx");
    expect(view).toMatch(/<ShopCartProvider>/);
    expect(view).toMatch(/<ShopReviewOrderBar shopId=\{s\.id\} \/>/);
    expect(view).not.toMatch(/following \? "whitespace-nowrap" : "btn-grad-primary/);
  });
});
