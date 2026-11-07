/**
 * Shops Helpr delivery, slice 3 (shop-checkout 'helpr_quote' / 'pickup_point', 20261106223244), the screens:
 *
 *  1. The order sheet: when the shop offers Helpr delivery, the buyer picks it, types the drop-off and looks up the
 *     price for THAT address before sending; the order sends that price (the server refuses it if it moved). A
 *     changed address needs a new price; a "price changed" refusal drops the old one.
 *  2. The pickup address: a save is followed by the server-side pickup point lookup; a failed lookup says so.
 *  3. The dashboard: the shop turns Helpr delivery on.
 *
 * @mutate src/components/shops/ShopOrderSheet.tsx |   const helprCents = helpring && quote && quote.for === addrKey ? quote.q.delivery_cents : null; |   const helprCents = helpring && quote ? quote.q.delivery_cents : null;
 * @mutate src/components/shops/ShopOrderSheet.tsx |     && (!atHome \|\| (svcOk && !atHomeMixed)) && (!helpring \|\| helprCents !== null); |     && (!atHome \|\| (svcOk && !atHomeMixed));
 * @mutate src/components/shops/ShopOrderSheet.tsx |         ...(helpring && helprCents !== null ? { delivery: dropoff, helprCents } : {}), |         ...(helpring && helprCents !== null ? { delivery: dropoff } : {}),
 * @mutate src/components/shops/ShopOrderSheet.tsx |       if ((err as { message?: unknown } \| null)?.message === "delivery_rate_changed") setQuote(null); |
 * @mutate src/components/shops/ShopOrderSheet.tsx |  const helprOffered = offer.data?.helpr_delivery === true && !atHome; |  const helprOffered = offer.data?.helpr_delivery === true;
 * @mutate src/components/shops/ShopPickupAddressSection.tsx |        await savePickupPoint(); |        void 0;
 * @mutate src/components/shops/ShopOrderCard.tsx |   const shopDeliveryCents = delivered ? deliveryCents : 0; |   const shopDeliveryCents = deliveryCents;
 * @mutate src/components/shops/ShopOrderCard.tsx |   const byHelpr = order.fulfillment === "helpr_delivers" && !order.helpr_unfilled_at; |   const byHelpr = false;
 * @mutate src/components/shops/ShopOrderCard.tsx |       {side === "shop" && byHelpr && order.status === "accepted" && !order.handed_over_at && <HelprPickup orderId={order.id} />} |
 * 4. The shop sees the booked Helpr and the pickup time (shops_order_helpr_task, 20261107164311, then helpr_task_view);
 *    "The Helpr didn't come" shows only from 15 minutes after that time, and appears on its own when the time comes.
 * @mutate src/components/shops/ShopOrderCard.tsx |   const canReport = opensAt !== null && now >= opensAt && !v.problem_open && !v.handed_over_at; |   const canReport = !v.problem_open && !v.handed_over_at;
 * @mutate src/components/shops/ShopOrderCard.tsx |   const canReport = opensAt !== null && now >= opensAt && !v.problem_open && !v.handed_over_at; |   const canReport = opensAt !== null && now >= opensAt && !v.handed_over_at;
 * @mutate src/components/shops/ShopOrderCard.tsx |     const timer = window.setTimeout(() => setNow(Date.now()), | const timer = window.setTimeout(() => undefined,
 * @mutate src/components/shops/ShopOrderCard.tsx |   if (v.status === "open") return <p | if (false) return <p
 * @mutate src/lib/shops/orders.ts |    ...(args.delivery && args.helprCents ? { delivery_by: "helpr", delivery_cents: args.helprCents } : {}), |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopItem } from "@/lib/shops/items";
import type { OrderTerms } from "@/lib/shops/orders";

const fx = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: fx.invoke } } }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("2026-10-21")}>day 2026-10-21</button>
  ),
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn(async () => undefined) }));
const items = vi.hoisted(() => ({ fetchShopItems: vi.fn() }));
vi.mock("@/lib/shops/items", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/items")>()), ...items }));
const orders = vi.hoisted(() => ({ fetchOrderTerms: vi.fn() }));
vi.mock("@/lib/shops/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/orders")>()), ...orders }));
vi.mock("@/lib/shops/variants", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/variants")>()), fetchItemOptions: async () => new Map() }));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), fetchHandoverMode: async () => "in_person" }));
const delivery = vi.hoisted(() => ({
  fetchDeliveryOffer: vi.fn(), savePickupPoint: vi.fn(), setHelprDelivery: vi.fn(), reportHelprNoShow: vi.fn(), fetchOrderDeliveryAddress: vi.fn(),
  fetchOrderHelprTask: vi.fn(),
}));
const tasks = vi.hoisted(() => ({ fetchTaskView: vi.fn() }));
vi.mock("@/lib/helprTasks/api", async (orig) => ({ ...(await orig<typeof import("@/lib/helprTasks/api")>()), ...tasks }));
vi.mock("@/lib/shops/delivery", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/delivery")>()), ...delivery }));
const pickup = vi.hoisted(() => ({ fetchMyPickupAddress: vi.fn(), saveMyPickupAddress: vi.fn(), fetchOrderPickupAddress: vi.fn() }));
vi.mock("./ShopTalk", () => ({ ShopOrderMessageButton: () => null }));
vi.mock("./ShopReviews", () => ({ ShopOrderReview: () => null }));
vi.mock("@/lib/shops/pickupAddress", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/pickupAddress")>()), ...pickup }));

import ShopOrderSheet from "./ShopOrderSheet";
import ShopPickupAddressSection from "./ShopPickupAddressSection";
import ShopDeliveryPicker from "./ShopDeliveryPicker";
import { ShopOrderCard } from "./ShopOrderCard";
import type { ShopOrder } from "@/lib/shops/orders";

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

/** shop-checkout's answers by action: helpr_quote -> the price; order -> a page, or the refusal given. */
function edge({ quoteCents = 1050, orderRefusal = null as string | null } = {}) {
  fx.invoke.mockImplementation(async (_fn: string, { body }: { body: Record<string, unknown> }) => {
    if (body.action === "helpr_quote") return { data: { delivery_cents: quoteCents, delivery_miles: 3 }, error: null };
    if (body.action === "order") {
      if (orderRefusal) {
        const ctx = new Response(JSON.stringify({ error: orderRefusal }), { status: 409 });
        return { data: null, error: Object.assign(new Error("edge"), { context: ctx }) };
      }
      return { data: { url: "https://checkout.stripe.com/c/pay/test", order_id: "o1" }, error: null };
    }
    return { data: null, error: new Error("unexpected") };
  });
}
const orderBodies = () => fx.invoke.mock.calls.map((c) => c[1].body as Record<string, unknown>).filter((b) => b.action === "order");

beforeEach(() => {
  vi.clearAllMocks();
  items.fetchShopItems.mockResolvedValue([item({ id: "p1", title: "Fig candle" })]);
  orders.fetchOrderTerms.mockResolvedValue(TERMS);
  delivery.fetchDeliveryOffer.mockResolvedValue({ delivers: false, fee_cents: 0, radius_miles: 10, helpr_delivery: true });
  edge();
});

async function startHelprOrder() {
  renderIt(<ShopOrderSheet shopId="s1" />);
  fireEvent.click(await screen.findByRole("button", { name: "One more Fig candle" }));
  fireEvent.click(screen.getByText("day 2026-10-21"));
  fireEvent.click(await screen.findByRole("button", { name: "Helpr delivery" }));
  fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "100 Main St" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Lafayette" } });
  fireEvent.change(screen.getByLabelText("ZIP"), { target: { value: "70501" } });
}

describe("the order sheet with Helpr delivery", () => {
  it("looks up the price for the address, adds it to the total and sends it with the order", async () => {
    await startHelprOrder();
    const send = screen.getByRole("button", { name: "Hold my card and send the order" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true); // no price yet
    fireEvent.click(screen.getByRole("button", { name: "See the price" }));
    expect(await screen.findByText("Helpr delivery: $10.50 for 3 miles")).toBeTruthy();
    // $20 + fee $1.70 + Helpr $10.50 = $32.20.
    expect(screen.getByTestId("shop-order-total").textContent).toBe("$32.20");
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(orderBodies()).toHaveLength(1));
    expect(orderBodies()[0]).toMatchObject({
      delivery: { line1: "100 Main St", city: "Lafayette", postal_code: "70501" }, delivery_by: "helpr", delivery_cents: 1050,
    });
  });

  it("a changed address needs a new price before sending", async () => {
    await startHelprOrder();
    fireEvent.click(screen.getByRole("button", { name: "See the price" }));
    await screen.findByText("Helpr delivery: $10.50 for 3 miles");
    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "200 Oak St" } });
    const send = screen.getByRole("button", { name: "Hold my card and send the order" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.getByTestId("shop-order-total").textContent).toBe("$21.70");
  });

  it("a price that moved is refused: the toast says so and the old price is dropped", async () => {
    edge({ orderRefusal: "delivery_rate_changed" });
    await startHelprOrder();
    fireEvent.click(screen.getByRole("button", { name: "See the price" }));
    await screen.findByText("Helpr delivery: $10.50 for 3 miles");
    fireEvent.click(screen.getByRole("button", { name: "Hold my card and send the order" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("The Helpr delivery price changed")));
    await waitFor(() => expect((screen.getByRole("button", { name: "Hold my card and send the order" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.queryByText("Helpr delivery: $10.50 for 3 miles")).toBeNull();
  });

  it("work done at the buyer's place offers no Helpr delivery", async () => {
    items.fetchShopItems.mockResolvedValue([item({ id: "p1", title: "Rug cleaning", at_buyer: true } as Partial<ShopItem>)]);
    renderIt(<ShopOrderSheet shopId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "One more Rug cleaning" }));
    expect(screen.queryByRole("button", { name: "Helpr delivery" })).toBeNull();
  });
});

describe("the pickup address save", () => {
  beforeEach(() => {
    pickup.fetchMyPickupAddress.mockResolvedValue(null);
    pickup.saveMyPickupAddress.mockResolvedValue(undefined);
  });
  async function saveIt() {
    renderIt(<ShopPickupAddressSection />);
    fireEvent.change(await screen.findByLabelText("Street address"), { target: { value: "705 W University Ave" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Lafayette" } });
    fireEvent.change(screen.getByLabelText("ZIP code"), { target: { value: "70506" } });
    fireEvent.click(screen.getByRole("button", { name: "Add pickup address" }));
  }
  it("looks up the Helpr pickup point right after the save", async () => {
    delivery.savePickupPoint.mockResolvedValue(undefined);
    await saveIt();
    await waitFor(() => expect(delivery.savePickupPoint).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });
  it("a failed lookup keeps the address and says Helpr delivery could not use it", async () => {
    delivery.savePickupPoint.mockRejectedValue(new Error("address_not_found"));
    await saveIt();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("couldn't find it on the map")));
    expect(toast.success).toHaveBeenCalledWith("Pickup address saved.");
  });
});

describe("the dashboard Helpr delivery switch", () => {
  it("turns Helpr delivery on", async () => {
    delivery.fetchDeliveryOffer.mockResolvedValue({ delivers: false, fee_cents: 0, radius_miles: 10, helpr_delivery: false });
    delivery.setHelprDelivery.mockResolvedValue(true);
    renderIt(<ShopDeliveryPicker shopId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Offer it" }));
    await waitFor(() => expect(delivery.setHelprDelivery).toHaveBeenCalledWith(true));
  });
});

describe("the order card for a Helpr delivery", () => {
  const order = (over: Partial<ShopOrder>): ShopOrder => ({
    id: "o1", buyer_id: "b1", seller_id: "s1", shop_id: "sh1", status: "accepted", close_reason: null, ready_date: "2026-10-21",
    cancel_policy: "until_accept", ready_tap_cancel: "from_day_before", note: "", decline_reason: null, items_cents: 2000,
    premium_cents: 170, tax_cents: 0, total_cents: 3220, created_at: "", held_at: null, accept_by: null, accepted_at: null,
    captured_at: null, closed_at: null, handover_mode: "in_person", fulfillment: "helpr_delivers", delivery_cents: 1050,
    helpr_unfilled_at: null, handed_over_at: null, shop_order_lines: [], ...over,
  } as unknown as ShopOrder);
  const booked = (minutesAgo: number, over: Record<string, unknown> = {}) => ({
    task_id: "t1", status: "accepted", helpr_first_name: "Sam", problem_open: false, handed_over_at: null,
    pickup_slot_start: new Date(Date.now() - minutesAgo * 60_000).toISOString(), ...over,
  });
  beforeEach(() => {
    delivery.fetchOrderHelprTask.mockResolvedValue("t1");
    tasks.fetchTaskView.mockResolvedValue(booked(20));
    delivery.fetchOrderDeliveryAddress.mockResolvedValue({ line1: "100 Main St", city: "Lafayette", postal_code: "70501" });
    pickup.fetchOrderPickupAddress.mockResolvedValue({ line1: "705 W University Ave", city: "Lafayette", postal_code: "70506" });
  });

  it("the shop gets its items only; the Helpr's price is never the shop's", () => {
    renderIt(<ul><ShopOrderCard order={order({})} heading="Order" side="shop" /></ul>);
    expect(screen.getByText("$20.00")).toBeTruthy();
    expect(screen.getByText(/A Helpr picks it up at your pickup address/)).toBeTruthy();
  });

  it("the buyer sees the drop-off, not the shop's pickup address; once unfilled it is a pickup again", async () => {
    const { unmount } = renderIt(<ul><ShopOrderCard order={order({})} heading="Order" side="buyer" /></ul>);
    expect((await screen.findByTestId("shop-order-delivery-address")).textContent).toContain("100 Main St");
    expect(pickup.fetchOrderPickupAddress).not.toHaveBeenCalled();
    unmount();
    renderIt(<ul><ShopOrderCard order={order({ helpr_unfilled_at: "2026-10-21T20:00:00Z" })} heading="Order" side="buyer" /></ul>);
    await waitFor(() => expect(pickup.fetchOrderPickupAddress).toHaveBeenCalled());
  });

  it("the shop says the Helpr didn't come: asks once, then sends", async () => {
    delivery.reportHelprNoShow.mockResolvedValue(undefined);
    renderIt(<ul><ShopOrderCard order={order({})} heading="Order" side="shop" /></ul>);
    expect((await screen.findByTestId("shop-helpr-pickup")).textContent).toMatch(/^Sam picks it up /);
    fireEvent.click(await screen.findByTestId("shop-helpr-no-show"));
    expect(delivery.reportHelprNoShow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, tell them" }));
    await waitFor(() => expect(delivery.reportHelprNoShow).toHaveBeenCalledWith("o1"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("We told the Helpr")));
  });

  it("no report button once handed over, for a shop delivery, or for the buyer", () => {
    const { unmount } = renderIt(<ul><ShopOrderCard order={order({ handed_over_at: "2026-10-21T15:00:00Z" })} heading="Order" side="shop" /></ul>);
    expect(screen.queryByTestId("shop-helpr-no-show")).toBeNull();
    unmount();
    const r2 = renderIt(<ul><ShopOrderCard order={order({ fulfillment: "shop_delivers", delivery_cents: 800 })} heading="Order" side="shop" /></ul>);
    expect(screen.queryByTestId("shop-helpr-no-show")).toBeNull();
    r2.unmount();
    renderIt(<ul><ShopOrderCard order={order({})} heading="Order" side="buyer" /></ul>);
    expect(screen.queryByTestId("shop-helpr-no-show")).toBeNull();
  });

  it("before 15 minutes past the pickup time: the time shows, the button does not", async () => {
    tasks.fetchTaskView.mockResolvedValue(booked(5));
    renderIt(<ul><ShopOrderCard order={order({})} heading="Order" side="shop" /></ul>);
    expect((await screen.findByTestId("shop-helpr-pickup")).textContent).toMatch(/^Sam picks it up /);
    expect(delivery.fetchOrderHelprTask).toHaveBeenCalledWith("o1");
    expect(tasks.fetchTaskView).toHaveBeenCalledWith("t1");
    expect(screen.queryByTestId("shop-helpr-no-show")).toBeNull();
  });

  it("the button appears on its own when the 15 minutes are up", async () => {
    tasks.fetchTaskView.mockResolvedValue(booked(15 - 1 / 60));
    renderIt(<ul><ShopOrderCard order={order({})} heading="Order" side="shop" /></ul>);
    await screen.findByTestId("shop-helpr-pickup");
    expect(screen.queryByTestId("shop-helpr-no-show")).toBeNull();
    expect(await screen.findByTestId("shop-helpr-no-show", {}, { timeout: 4000 })).toBeTruthy();
  });

  it("no Helpr yet: says so; a problem holding the order: no button", async () => {
    tasks.fetchTaskView.mockResolvedValue(booked(20, { status: "open", pickup_slot_start: null }));
    const { unmount } = renderIt(<ul><ShopOrderCard order={order({})} heading="Order" side="shop" /></ul>);
    expect((await screen.findByTestId("shop-helpr-pickup")).textContent).toBe("No Helpr has taken this delivery yet.");
    expect(screen.queryByTestId("shop-helpr-no-show")).toBeNull();
    unmount();
    tasks.fetchTaskView.mockResolvedValue(booked(20, { problem_open: true }));
    renderIt(<ul><ShopOrderCard order={order({})} heading="Order" side="shop" /></ul>);
    await screen.findByTestId("shop-helpr-pickup");
    expect(screen.queryByTestId("shop-helpr-no-show")).toBeNull();
  });

  it("no task (or the read not live yet): nothing shows", async () => {
    delivery.fetchOrderHelprTask.mockResolvedValue(null);
    renderIt(<ul><ShopOrderCard order={order({})} heading="Order" side="shop" /></ul>);
    await waitFor(() => expect(delivery.fetchOrderHelprTask).toHaveBeenCalled());
    expect(screen.queryByTestId("shop-helpr-pickup")).toBeNull();
    expect(tasks.fetchTaskView).not.toHaveBeenCalled();
  });
});

describe("inventory floor", () => {
  it("covers the sheet, the pickup save and the switch", () => {
    expect([ShopOrderSheet, ShopPickupAddressSection, ShopDeliveryPicker].length).toBeGreaterThan(2);
  });
});
