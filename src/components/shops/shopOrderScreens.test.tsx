/**
 * The Shops M1 order screens, rendered through the route pages the router
 * mounts (the vacuity gate's "tested only in isolation" class):
 *
 *  1. /shops/:id (ShopPage -> ShopView) shows the order sheet to a buyer of a
 *     selling, open shop, and never to its owner or while it is paused.
 *  2. The order sheet: sold-out items are not offered; the calendar greys out
 *     closed weekdays, full days and days before the longest lead time (the
 *     rules shops_request_order applies); the total is items + the F1 fee;
 *     the shop's cancel rule is on screen BEFORE paying; sending asks
 *     shop-checkout for the chosen lines and date and opens the Stripe page.
 *  3. /shops/orders (ShopOrdersPage -> ShopMyOrdersView): the buyer's orders,
 *     ?sent=1 says the order went out, Withdraw only while 'held'.
 *  4. /shops/dashboard (ShopDashboardPage -> ShopDashboardView): orders
 *     waiting for an answer with the time left, Accept charges through
 *     acceptOrder, Decline sends the reason; no shop says so.
 *  4b. The cancel rule (owner 2026-10-19: "LET THE SHOPS DECIDE THIS."): under
 *     "until your order is ready" the dashboard shows the shop's 3 ready-tap
 *     choices in plain words and saves the one tapped; the order sheet words
 *     the shop's choice before the buyer pays.
 *  5. The entries: Shops home and the Profile row link the dashboard once the
 *     member has a shop.
 *
 * @mutate src/components/shops/ShopView.tsx |         {s.offers_selling && !s.mine && !s.paused && <ShopOrderSheet shopId={s.id} />} |         {s.offers_selling && !s.paused && <ShopOrderSheet shopId={s.id} />}
 * @mutate src/components/shops/ShopView.tsx |         {s.offers_selling && !s.mine && !s.paused && <ShopOrderSheet shopId={s.id} />} |         {s.offers_selling && !s.mine && <ShopOrderSheet shopId={s.id} />}
 * @mutate src/components/shops/ShopOrderSheet.tsx |     () => (items.data ?? []).filter((i) => i.status === "live" && (i.stock_count == null \|\| i.stock_count > 0)), |     () => (items.data ?? []).filter((i) => i.status === "live"),
 * @mutate src/components/shops/ShopOrderSheet.tsx |   const leadDays = chosen.reduce((m, i) => Math.max(m, i.lead_time_days), 0); |   const leadDays = 0;
 * @mutate src/components/shops/ShopOrderSheet.tsx |   const feeCents = itemsCents > 0 ? buyerFeeCents(itemsCents) : 0; |   const feeCents = 0;
 * @mutate src/components/shops/ShopOrderSheet.tsx |         <p className="text-sm font-semibold">{policy.label}</p> |         <p className="text-sm font-semibold"></p>
 * @mutate src/components/shops/ShopOrderSheet.tsx |   const policy = cancelPolicyText(t.cancel_policy, t.ready_tap_cancel); |   const policy = cancelPolicyText(t.cancel_policy, undefined);
 * @mutate src/components/shops/ShopCancelPolicyPicker.tsx |       {policy.data === "until_handover" && <ReadyTapCancelPicker shopId={shopId} />} |       {false && <ReadyTapCancelPicker shopId={shopId} />}
 * @mutate src/components/shops/ShopCancelPolicyPicker.tsx |       {policy.data === "until_handover" && <ReadyTapCancelPicker shopId={shopId} />} |       <ReadyTapCancelPicker shopId={shopId} />
 * @mutate src/components/shops/ShopReadyTapCancelPicker.tsx |                 onClick={() => { if (!on) save.mutate(c); }} |                 onClick={() => undefined}
 * @mutate src/components/shops/ShopReadyTapCancelPicker.tsx |             const on = choice.data === c; |             const on = c === "from_day_before";
 * @mutate src/components/shops/ShopOrderSheet.tsx |       await openExternalUrl(url, () => { |       await (async (..._a: unknown[]) => undefined)(url, () => {
 * @mutate src/lib/shops/orders.ts |   if (!terms.open_weekdays.includes(new Date(isoToUtc(iso)).getUTCDay())) return "closed"; |   if (false) return "closed";
 * @mutate src/lib/shops/orders.ts |   if (terms.full_days.includes(iso)) return "full"; |   if (false) return "full";
 * @mutate src/components/shops/ShopMyOrdersView.tsx |               {o.status === "held" && ( |               {o.status !== "declined" && (
 * @mutate src/components/shops/ShopMyOrdersView.tsx |     if (params.get("sent") !== "1") return; |     return;
 * @mutate src/components/shops/ShopHandoverActions.tsx | onClick={() => ready.mutate(null)}>Mark ready</Button> | onClick={() => finish.mutate()}>Mark ready</Button>
 * @mutate src/components/shops/ShopHandoverActions.tsx |       {side === "shop" ? ( |       {side === "shop" && false ? (
 * @mutate src/components/shops/ShopDashboardView.tsx |           if (declining) decline.mutate({ id: declining.id, why: reason }); |           if (declining) decline.mutate({ id: declining.id, why: "" });
 * @mutate src/components/shops/ShopDashboardView.tsx |           if (accepting) accept.mutate(accepting.id); |           void accepting;
 * @mutate src/pages/shops/ShopOrdersPage.tsx |         <ShopMyOrdersView embedded />\n | \n
 * @mutate src/pages/shops/ShopDashboardPage.tsx |         <ShopDashboardView embedded />\n | \n
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopPage as ShopPageData } from "@/lib/shops/api";
import type { ShopItem } from "@/lib/shops/items";
import type { OrderTerms, ShopOrder } from "@/lib/shops/orders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children, titleActions }: { title: string; children: ReactNode; titleActions?: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {titleActions}
      {children}
    </main>
  ),
}));
// The tester-only "early preview" read (useSectionTabs) stubbed as not loaded (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/components/sections/SectionScreen", () => ({
  // The section's tabs are the Explore header's second row (SectionScreen `tabs`, owner 2026-10-22).
  SectionScreen: ({ title, children, tabs }: { title: string; children: ReactNode; tabs?: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {tabs}
      {children}
    </main>
  ),
}));
vi.mock("./ShopItemsList", () => ({ default: () => <p>Items list</p> }));
vi.mock("./ShopFaqs", () => ({ default: () => null }));
vi.mock("./ShopPolicies", () => ({ default: () => null }));
// The calendar: a button per day of one week, disabled exactly as the sheet asks.
const WEEK = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ onChange, min, isDateDisabled }: { onChange: (v: string) => void; min?: string; isDateDisabled?: (iso: string) => boolean }) => (
    <div>
      {WEEK.map((d) => (
        <button key={d} type="button" disabled={(min ? d < min : false) || (isDateDisabled ? isDateDisabled(d) : false)} onClick={() => onChange(d)}>
          {`day ${d}`}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@/components/ui/BrandConfirmDialog", () => ({
  BrandConfirmDialog: ({ open, title, primaryLabel, onPrimary, children }: {
    open: boolean; title: string; primaryLabel: string; onPrimary: (e: { preventDefault: () => void }) => void; children?: ReactNode;
  }) => (open ? (
    <div role="dialog" aria-label={title}>
      {children}
      <button type="button" onClick={() => onPrimary({ preventDefault: () => undefined })}>{`confirm ${primaryLabel}`}</button>
    </div>
  ) : null),
}));
const ext = vi.hoisted(() => ({ openExternalUrl: vi.fn(async (_url: string, _onReturn?: () => void) => undefined) }));
vi.mock("@/lib/openExternalUrl", () => ext);

const api = vi.hoisted(() => ({ fetchShop: vi.fn(), fetchMyShopId: vi.fn() }));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/api")>()),
  ...api,
  browseShops: async () => [],
  fetchShopCategories: async () => [{ slug: "bakery", label: "Bakery", group_slug: "food", group_label: "Food" }],
  shopPhotoUrl: (p: string) => `https://cdn/${p}`,
}));
const items = vi.hoisted(() => ({ fetchShopItems: vi.fn() }));
vi.mock("@/lib/shops/items", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/items")>()), ...items }));
const orders = vi.hoisted(() => ({
  fetchOrderTerms: vi.fn(), requestOrder: vi.fn(), fetchMyOrders: vi.fn(), fetchShopOrders: vi.fn(),
  cancelOrderRequest: vi.fn(), acceptOrder: vi.fn(), declineOrder: vi.fn(), fetchCancelPolicy: vi.fn(), setCancelPolicy: vi.fn(),
  fetchReadyTapCancel: vi.fn(), setReadyTapCancel: vi.fn(),
}));
vi.mock("@/lib/shops/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/orders")>()), ...orders }));
// Shops M2: the handover parts load on their own; answered here so the order screens stay offline.
const handover = vi.hoisted(() => ({
  fetchHandoverMode: vi.fn(async () => "in_person"), setHandoverMode: vi.fn(), fetchHandovers: vi.fn(async () => new Map()),
  fetchMyShopPayouts: vi.fn(async () => []), markReady: vi.fn(), confirmPickup: vi.fn(), reportNotReceived: vi.fn(),
}));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), ...handover }));
vi.mock("@/components/declutter/useDeclutterOrigin", () => ({ useDeclutterOrigin: () => ({ origin: { status: "none" } }) }));

import ShopPage from "@/pages/shops/ShopPage";
import ShopOrdersPage from "@/pages/shops/ShopOrdersPage";
import ShopDashboardPage from "@/pages/shops/ShopDashboardPage";
import ShopsPage from "@/pages/shops/ShopsPage";
import { readyDateProblem } from "@/lib/shops/orders";

const page = (over: Partial<ShopPageData> = {}): ShopPageData => ({
  id: "s1", owner_id: "u2", name: "Bayou Bakes", about: "", category: "bakery", parishes_served: [],
  area_label: "Broussard", storefront: false, pin_lat: 30.15, pin_lng: -91.96, offers_selling: true, offers_quotes: false,
  paused: false, badges: {} as ShopPageData["badges"], rating: null, review_count: 0, follower_count: 0, following: false,
  mine: false, sos_number: null, hidden: null, hidden_reason: null, hours: [], photos: [], created_at: "2026-10-15", ...over,
});
const item = (over: Partial<ShopItem>): ShopItem => ({
  id: "i1", kind: "made", subtype: "candles", status: "live", title: "Candle", description: "", price_cents: 1000,
  lead_time_days: 0, stock_count: null, home_kitchen: false, photos: [], ...over,
});
// Monday 2026-10-19; open Tuesday to Saturday; Thursday 10-22 is full.
const TERMS: OrderTerms = {
  cancel_policy: "until_accept", paused: false, open_weekdays: [2, 3, 4, 5, 6], daily_order_cap: 3,
  today: "2026-10-19", last_day: "2027-01-17", full_days: ["2026-10-22"],
};
const order = (over: Partial<ShopOrder>): ShopOrder => ({
  id: "o1", buyer_id: "u1", seller_id: "u2", shop_id: "s1", status: "held", close_reason: null, ready_date: "2026-10-23",
  cancel_policy: "until_accept", ready_tap_cancel: "from_day_before", note: "", decline_reason: null, items_cents: 2000, premium_cents: 170, tax_cents: 0,
  total_cents: 2170, created_at: "2026-10-19T10:00:00Z", held_at: "2026-10-19T10:00:00Z",
  accept_by: new Date(Date.now() + 5 * 3_600_000 + 90_000).toISOString(), accepted_at: null, captured_at: null, closed_at: null, handover_mode: "in_person", handed_over_at: null,
  shop_order_lines: [{ id: "l1", item_id: "i1", title: "Candle", kind: "made", unit_cents: 1000, quantity: 2, line_cents: 2000 }],
  shops: { name: "Bayou Bakes" }, ...over,
});

function renderAt(path: string, route: string, el: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={el} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchShop.mockResolvedValue(page());
  api.fetchMyShopId.mockResolvedValue(null);
  items.fetchShopItems.mockResolvedValue([
    item({ id: "a", title: "Candle", price_cents: 1000, lead_time_days: 0 }),
    item({ id: "b", title: "Cake", price_cents: 500, lead_time_days: 2 }),
    item({ id: "c", title: "Sold out jam", stock_count: 0 }),
  ]);
  orders.fetchOrderTerms.mockResolvedValue(TERMS);
  orders.requestOrder.mockResolvedValue("https://checkout.stripe.com/c/pay/test");
});

describe("the shop page mounts the order sheet for buyers only", () => {
  it("a buyer of a selling, open shop sees it", async () => {
    renderAt("/shops/s1", "/shops/:id", <ShopPage />);
    expect(await screen.findByRole("heading", { name: "Order" })).toBeTruthy();
  });
  it("the owner never does", async () => {
    api.fetchShop.mockResolvedValue(page({ mine: true, owner_id: "u1" }));
    renderAt("/shops/s1", "/shops/:id", <ShopPage />);
    expect(await screen.findByText("Items list")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Order" })).toBeNull();
  });
  it("nor anyone while the shop is paused", async () => {
    api.fetchShop.mockResolvedValue(page({ paused: true }));
    renderAt("/shops/s1", "/shops/:id", <ShopPage />);
    expect(await screen.findByText("Items list")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Order" })).toBeNull();
  });
});

describe("the order sheet", () => {
  it("offers only items in stock, greys out closed, full and too-soon days, totals items + fee, shows the cancel rule, and sends", async () => {
    renderAt("/shops/s1", "/shops/:id", <ShopPage />);
    expect(await screen.findByText("Free to cancel until the shop accepts")).toBeTruthy();
    expect(screen.getByText("Candle")).toBeTruthy();
    expect(screen.queryByText("Sold out jam")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "One more Candle" }));
    fireEvent.click(screen.getByRole("button", { name: "One more Candle" }));
    // 2 x $10 = $20.00; fee 5% ($1.00) + $0.70.
    expect(screen.getByTestId("shop-order-total").textContent).toBe("$21.70");
    const send = screen.getByRole("button", { name: "Hold my card and send the order" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    const day = (d: string) => screen.getByRole("button", { name: `day ${d}` }) as HTMLButtonElement;
    expect(day("2026-10-19").disabled).toBe(true); // Monday: closed
    expect(day("2026-10-20").disabled).toBe(false);
    expect(day("2026-10-22").disabled).toBe(true); // full
    expect(day("2026-10-25").disabled).toBe(true); // Sunday: closed

    // The cake needs 2 days: Tuesday is now too soon.
    fireEvent.click(screen.getByRole("button", { name: "One more Cake" }));
    expect(day("2026-10-20").disabled).toBe(true);
    expect(day("2026-10-21").disabled).toBe(false);

    fireEvent.click(day("2026-10-21"));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(ext.openExternalUrl).toHaveBeenCalled());
    expect(orders.requestOrder).toHaveBeenCalledWith({
      shopId: "s1", lines: [{ item_id: "a", quantity: 2 }, { item_id: "b", quantity: 1 }], readyDate: "2026-10-21", note: "",
      // M3: the cancel terms the buyer read go with the order (shop-checkout refuses terms_changed).
      terms: { cancel_policy: "until_accept", ready_tap_cancel: undefined },
    });
    expect(ext.openExternalUrl.mock.calls[0][0]).toBe("https://checkout.stripe.com/c/pay/test");
  });

  it("words the shop's ready-tap choice before the buyer pays (owner 2026-10-19)", async () => {
    orders.fetchOrderTerms.mockResolvedValue({ ...TERMS, cancel_policy: "until_handover", ready_tap_cancel: "ends_at_tap" });
    const { unmount } = renderAt("/shops/s1", "/shops/:id", <ShopPage />);
    expect(await screen.findByText("Free to cancel until the shop marks it ready")).toBeTruthy();
    expect(screen.getByText(/If the shop marks your order ready sooner, free cancel ends then\./)).toBeTruthy();
    unmount();
    orders.fetchOrderTerms.mockResolvedValue({ ...TERMS, cancel_policy: "until_handover", ready_tap_cancel: "never_shortens" });
    renderAt("/shops/s1", "/shops/:id", <ShopPage />);
    expect(await screen.findByText("Free to cancel until your ready date")).toBeTruthy();
    expect(screen.getByText(/until your ready date begins, even if the shop marks your order ready sooner\./)).toBeTruthy();
    expect(screen.queryByText(/never before the day before/)).toBeNull();
  });

  it("readyDateProblem names the server's reasons in its order", () => {
    expect(readyDateProblem("2026-10-20", TERMS, 2)).toBe("too_soon");
    expect(readyDateProblem("2027-01-19", TERMS, 0)).toBe("too_far");
    expect(readyDateProblem("2026-10-25", TERMS, 0)).toBe("closed");
    expect(readyDateProblem("2026-10-22", TERMS, 0)).toBe("full");
    expect(readyDateProblem("2026-10-23", TERMS, 0)).toBeNull();
  });
});

describe("/shops/orders", () => {
  it("lists the buyer's orders, says a sent order went out, and offers Withdraw only while held", async () => {
    orders.fetchMyOrders.mockResolvedValue([order({ id: "o1" }), order({ id: "o2", status: "accepted", captured_at: "2026-10-19T12:00:00Z" })]);
    orders.cancelOrderRequest.mockResolvedValue(undefined);
    renderAt("/shops/orders?sent=1", "/shops/orders", <ShopOrdersPage />);
    expect(await screen.findAllByTestId("shop-order-card")).toHaveLength(2);
    expect(toast.success).toHaveBeenCalledWith("Order sent. The shop has 24 hours to answer; your card is held, not charged.");
    const withdraw = screen.getAllByRole("button", { name: "Withdraw order" });
    expect(withdraw).toHaveLength(1);
    fireEvent.click(withdraw[0]);
    fireEvent.click(screen.getByRole("button", { name: "confirm Withdraw order" }));
    await waitFor(() => expect(orders.cancelOrderRequest).toHaveBeenCalledWith("o1"));
  });
});

describe("/shops/dashboard", () => {
  it("shows orders waiting with the time left; Accept charges, Decline sends the reason", async () => {
    api.fetchMyShopId.mockResolvedValue("s1");
    orders.fetchCancelPolicy.mockResolvedValue("until_accept");
    orders.fetchShopOrders.mockResolvedValue([order({ id: "o1" }), order({ id: "o2" })]);
    orders.acceptOrder.mockResolvedValue({ charged: true });
    orders.declineOrder.mockResolvedValue(undefined);
    renderAt("/shops/dashboard", "/shops/dashboard", <ShopDashboardPage />);
    expect(await screen.findAllByTestId("shop-order-card")).toHaveLength(2);
    expect(screen.getAllByTestId("shop-order-time-left")[0].textContent).toBe("5 h 1 min left to answer");

    fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "confirm Accept and charge" }));
    await waitFor(() => expect(orders.acceptOrder).toHaveBeenCalledWith("o1"));

    fireEvent.click(screen.getAllByRole("button", { name: "Decline" })[1]);
    fireEvent.change(screen.getByLabelText("Reason for the buyer (optional)"), { target: { value: "Booked up" } });
    fireEvent.click(screen.getByRole("button", { name: "confirm Decline order" }));
    await waitFor(() => expect(orders.declineOrder).toHaveBeenCalledWith("o2", "Booked up"));
    expect(await screen.findByRole("button", { name: /Free to cancel until the shop accepts/ })).toBeTruthy();
  });

  it("under 'until your order is ready' the shop picks what an early ready tap does, in plain words (owner 2026-10-19)", async () => {
    api.fetchMyShopId.mockResolvedValue("s1");
    orders.fetchCancelPolicy.mockResolvedValue("until_handover");
    orders.fetchReadyTapCancel.mockResolvedValue("never_shortens");
    orders.setReadyTapCancel.mockResolvedValue("ends_at_tap");
    orders.fetchShopOrders.mockResolvedValue([]);
    renderAt("/shops/dashboard", "/shops/dashboard", <ShopDashboardPage />);
    const group = await screen.findByRole("group", { name: "If you mark an order ready early" });
    const choices = within(group).getAllByRole("button");
    expect(choices.map((b) => b.textContent?.split("Buyers")[0].split("If you")[0])).toEqual([
      "Marking it ready ends free cancel",
      "Marking it ready counts from the day before (default)",
      "Marking it ready never ends free cancel early",
    ]);
    expect(choices.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    expect(group.textContent).toContain("Buyers can cancel for free until the ready date begins, however early you mark the order ready.");
    fireEvent.click(choices[0]);
    await waitFor(() => expect(orders.setReadyTapCancel).toHaveBeenCalledWith("ends_at_tap"));
    expect(orders.setReadyTapCancel).toHaveBeenCalledTimes(1);
  });

  it("under any other cancel rule the ready-tap choice is not shown (a ready tap changes nothing there)", async () => {
    api.fetchMyShopId.mockResolvedValue("s1");
    orders.fetchCancelPolicy.mockResolvedValue("until_accept");
    orders.fetchShopOrders.mockResolvedValue([]);
    renderAt("/shops/dashboard", "/shops/dashboard", <ShopDashboardPage />);
    expect(await screen.findByRole("button", { name: /Free to cancel until the shop accepts/ })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "If you mark an order ready early" })).toBeNull();
    expect(orders.fetchReadyTapCancel).not.toHaveBeenCalled();
  });

  it("a member with no shop is told so", async () => {
    renderAt("/shops/dashboard", "/shops/dashboard", <ShopDashboardPage />);
    expect(await screen.findByText("You don't have a shop yet.")).toBeTruthy();
    expect(orders.fetchShopOrders).not.toHaveBeenCalled();
  });
});

// Owner 2026-10-18 ~21:00Z: the BUYER must confirm. The shop's own tap never
// finishes an order (no "Picked up"); only "I got it" or the 24-hour clock does.
describe("the handover: the buyer confirms, the shop never finishes its own order", () => {
  const due = order({ id: "o9", status: "accepted", captured_at: "2026-10-19T12:00:00Z", ready_date: "2026-10-01" });
  it("the shop, on an in-person order past its ready date: Mark ready only, no Picked up, and it is told who finishes it", async () => {
    api.fetchMyShopId.mockResolvedValue("s1");
    orders.fetchCancelPolicy.mockResolvedValue("until_accept");
    orders.fetchShopOrders.mockResolvedValue([due]);
    handover.markReady.mockResolvedValue(undefined);
    renderAt("/shops/dashboard", "/shops/dashboard", <ShopDashboardPage />);
    expect(await screen.findByTestId("shop-handover-wait")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /picked up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /got it/i })).toBeNull();
    expect(screen.getByTestId("shop-handover-wait").textContent).toContain("24 hours after the ready date");
    fireEvent.click(screen.getByRole("button", { name: "Mark ready" }));
    await waitFor(() => expect(handover.markReady).toHaveBeenCalledWith("o9", null));
    expect(handover.confirmPickup).not.toHaveBeenCalled();
  });
  it("the buyer taps I got it, and only then is the order finished", async () => {
    orders.fetchMyOrders.mockResolvedValue([due]);
    handover.confirmPickup.mockResolvedValue(undefined);
    renderAt("/shops/orders", "/shops/orders", <ShopOrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "I got it" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm I got it" }));
    await waitFor(() => expect(handover.confirmPickup).toHaveBeenCalledWith("o9"));
  });
});

describe("the dashboard entries", () => {
  // @mutate src/components/sections/SectionTabs.tsx | { value: BROWSE as string, label: "Browse" }, ...tabs.map | ...tabs.map
  it("Shops opens on Browse, leftmost, with one-word tabs (owner, 2026-10-19)", async () => {
    api.fetchMyShopId.mockResolvedValue("s1");
    renderAt("/shops", "/shops", <ShopsPage />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Browse", "Orders", "Shop"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs.length).toBeGreaterThan(2);
  });
  // @mutate src/components/shops/ShopsHomeView.tsx | header={(id) => <MyShopActions shopId={id} />} | header={undefined}
  it("the Shop tab: See my shop links the shop, Share my shop shares it, Licensed & Insured sits in its settings", async () => {
    api.fetchMyShopId.mockResolvedValue("s1");
    orders.fetchShopOrders.mockResolvedValue([]);
    renderAt("/shops?tab=shop", "/shops", <ShopsPage />);
    expect((await screen.findByRole("link", { name: /See my shop/ })).getAttribute("href")).toBe("/shops/s1");
    expect(screen.getByRole("button", { name: /Share my shop/ })).toBeTruthy();
    expect(screen.getByTestId("shop-licensed-insured").getAttribute("href")).toBe("/profile?tab=credentials");
  });
  it("the Shop tab without a shop: Open a shop", async () => {
    api.fetchMyShopId.mockResolvedValue(null);
    renderAt("/shops?tab=shop", "/shops", <ShopsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open a shop" }));
    expect(await screen.findByText("elsewhere")).toBeTruthy();
  });
  // @mutate src/components/shops/ShopMyOrdersView.tsx | {BUYER_GROUPS.filter((g) => status === null \|\| status === g) | {BUYER_GROUPS.filter(() => true)
  it("Orders: a status box shows only its group; a second tap shows every group", async () => {
    orders.fetchMyOrders.mockResolvedValue([order({ id: "o9", status: "accepted", captured_at: "2026-10-19T12:00:00Z", ready_date: "2026-10-01" })]);
    renderAt("/shops?tab=orders", "/shops", <ShopsPage />);
    expect(await screen.findByRole("region", { name: "Accepted" })).toBeTruthy();
    const waiting = document.querySelector('[data-status-box="waiting"]') as HTMLButtonElement;
    fireEvent.click(waiting);
    expect(waiting.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("region", { name: "Accepted" })).toBeNull();
    fireEvent.click(waiting);
    expect(screen.getByRole("region", { name: "Accepted" })).toBeTruthy();
  });
  it("App.tsx routes both screens to their pages", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).toMatch(/path="\/shops\/orders" element=\{[^\n]*<ShopOrdersPage \/>/);
    expect(app).toMatch(/path="\/shops\/dashboard" element=\{[^\n]*<ShopDashboardPage \/>/);
  });
});
