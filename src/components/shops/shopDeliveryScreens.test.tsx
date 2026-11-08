/**
 * Shops delivery, slice 1 "Shop delivers" (owner 11-05 answer 3; 20261106180902), the screens:
 *
 *  1. The order sheet: when the shop delivers, the buyer picks Pickup or Delivery; Delivery asks for the drop-off
 *     address, adds the shop's fee to the total, and sends the address with the order (the server checks it again).
 *     A shop that does not deliver shows no choice and sends no address.
 *  2. The order card: the shop sees "Deliver to" only once it accepted the order, and is told it gets its fee too.
 *
 * @mutate src/components/shops/ShopOrderSheet.tsx |   const deliveryCents = delivering ? offer.data?.fee_cents ?? 0 : 0; |   const deliveryCents = 0;
 * @mutate src/components/shops/ShopOrderSheet.tsx |         ...(delivering\n          ? { delivery: | ...(false\n          ? { delivery:
 * @mutate src/components/shops/ShopOrderCard.tsx |       {delivered && (side === "buyer" \|\| order.status === "accepted") && | {delivered &&
 * @mutate src/components/shops/ShopOrderCard.tsx |   const shopDeliveryCents = delivered ? deliveryCents : 0; |   const shopDeliveryCents = 0;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopItem } from "@/lib/shops/items";
import type { OrderTerms, ShopOrder } from "@/lib/shops/orders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("2026-10-21")}>day 2026-10-21</button>
  ),
}));
const ext = vi.hoisted(() => ({ openExternalUrl: vi.fn(async (_url: string, _onReturn?: () => void) => undefined) }));
vi.mock("@/lib/openExternalUrl", () => ext);
const items = vi.hoisted(() => ({ fetchShopItems: vi.fn() }));
vi.mock("@/lib/shops/items", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/items")>()), ...items }));
const orders = vi.hoisted(() => ({ fetchOrderTerms: vi.fn(), requestOrder: vi.fn() }));
vi.mock("@/lib/shops/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/orders")>()), ...orders }));
vi.mock("@/lib/shops/variants", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/variants")>()), fetchItemOptions: async () => new Map() }));
// Preorders (20261108184654): none here (shopOrderScreens.test.tsx covers them).
vi.mock("@/lib/shops/preorders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/preorders")>()), fetchItemPreorders: async () => new Map() }));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), fetchHandoverMode: async () => "in_person" }));
const delivery = vi.hoisted(() => ({ fetchDeliveryOffer: vi.fn(), fetchOrderDeliveryAddress: vi.fn() }));
vi.mock("@/lib/shops/delivery", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/delivery")>()), ...delivery }));
vi.mock("./ShopTalk", () => ({ ShopOrderMessageButton: () => null }));
vi.mock("./ShopReviews", () => ({ ShopOrderReview: () => null }));

import ShopOrderSheet from "./ShopOrderSheet";
import { ShopOrderCard } from "./ShopOrderCard";

const item = (over: Partial<ShopItem>): ShopItem => ({
  id: "i1", kind: "made", subtype: "candles", status: "live", title: "Candle", description: "", price_cents: 2000,
  lead_time_days: 0, stock_count: null, home_kitchen: false, photos: [], ...over,
});
const TERMS: OrderTerms = {
  cancel_policy: "until_accept", paused: false, open_weekdays: [2, 3, 4, 5, 6], daily_order_cap: null,
  today: "2026-10-19", last_day: "2027-01-17", full_days: [],
};

function renderIt(el: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  items.fetchShopItems.mockResolvedValue([item({ id: "p1", title: "Fig candle" })]);
  orders.fetchOrderTerms.mockResolvedValue(TERMS);
  orders.requestOrder.mockResolvedValue("https://checkout.stripe.com/c/pay/test");
  delivery.fetchDeliveryOffer.mockResolvedValue({ delivers: true, fee_cents: 800, radius_miles: 10 });
  delivery.fetchOrderDeliveryAddress.mockResolvedValue({ line1: "100 Main St", city: "Lafayette", postal_code: "70501" });
});

describe("the order sheet when the shop delivers", () => {
  it("adds the fee to the total and sends the drop-off address", async () => {
    renderIt(<ShopOrderSheet shopId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "One more Fig candle" }));
    fireEvent.click(screen.getByText("day 2026-10-21"));
    fireEvent.click(await screen.findByRole("button", { name: "Delivery, $8.00" }));
    // $20 + fee $1.70 + delivery $8 = $29.70.
    expect(screen.getByTestId("shop-order-total").textContent).toBe("$29.70");
    const send = screen.getByRole("button", { name: "Hold my card and send the order" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true); // no address yet
    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "100 Main St" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Lafayette" } });
    fireEvent.change(screen.getByLabelText("ZIP"), { target: { value: "70501" } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(orders.requestOrder).toHaveBeenCalledTimes(1));
    expect(orders.requestOrder.mock.calls[0][0].delivery).toEqual({ line1: "100 Main St", city: "Lafayette", postal_code: "70501" });
  });

  it("a pickup sends no address and no fee", async () => {
    renderIt(<ShopOrderSheet shopId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "One more Fig candle" }));
    fireEvent.click(screen.getByText("day 2026-10-21"));
    await screen.findByRole("button", { name: "Pickup" });
    expect(screen.getByTestId("shop-order-total").textContent).toBe("$21.70");
    fireEvent.click(screen.getByRole("button", { name: "Hold my card and send the order" }));
    await waitFor(() => expect(orders.requestOrder).toHaveBeenCalledTimes(1));
    expect(orders.requestOrder.mock.calls[0][0]).not.toHaveProperty("delivery");
  });

  it("no delivery choice when the shop only offers pickup", async () => {
    delivery.fetchDeliveryOffer.mockResolvedValue({ delivers: false, fee_cents: 0, radius_miles: 10 });
    renderIt(<ShopOrderSheet shopId="s1" />);
    await screen.findByRole("button", { name: "One more Fig candle" });
    expect(screen.queryByTestId("shop-order-delivery")).toBeNull();
  });
});

describe("the order card for a delivered order", () => {
  const order = (over: Partial<ShopOrder>): ShopOrder => ({
    id: "o1", buyer_id: "b1", seller_id: "s1", shop_id: "sh1", status: "held", close_reason: null, ready_date: "2026-10-21",
    cancel_policy: "until_accept", ready_tap_cancel: "from_day_before", note: "", decline_reason: null, items_cents: 2000,
    premium_cents: 170, tax_cents: 0, total_cents: 2970, created_at: "", held_at: null, accept_by: null, accepted_at: null,
    captured_at: null, closed_at: null, handover_mode: "in_person", fulfillment: "shop_delivers", delivery_cents: 800,
    handed_over_at: null, shop_order_lines: [], ...over,
  } as unknown as ShopOrder);

  it("the shop sees the address only once it accepted, and gets its fee", async () => {
    const { unmount } = renderIt(<ul><ShopOrderCard order={order({ status: "held" })} heading="New order" side="shop" /></ul>);
    expect(screen.queryByTestId("shop-order-delivery-address")).toBeNull();
    // Not even asked for before the accept (the server would answer nothing; the card never asks).
    expect(screen.queryByText("Loading the delivery address…")).toBeNull();
    expect(delivery.fetchOrderDeliveryAddress).not.toHaveBeenCalled();
    expect(screen.getByText("$28.00")).toBeTruthy();
    unmount();
    renderIt(<ul><ShopOrderCard order={order({ status: "accepted" })} heading="Order" side="shop" /></ul>);
    expect((await screen.findByTestId("shop-order-delivery-address")).textContent).toContain("100 Main St, Lafayette, LA 70501");
  });
});
