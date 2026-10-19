/**
 * Shops M3 screens (migration 20261019071055_shops_refunds_cancels_strikes),
 * rendered through the route pages the router mounts:
 *
 *  1. /shops/orders: "Cancel order" shows only on an accepted, CHARGED order
 *     with no open problem; the dialog reads shops_order_cancel_quote and says
 *     free (the refund, less the card-processing cost and its tax) or late
 *     (nothing back, the shop is paid); the tap sends what was shown
 *     (expect 'free' / 'late'); cancel_terms_changed re-reads the quote and
 *     says so instead of cancelling.
 *  2. /shops/dashboard: "Cancel order" (full refund, card fee, strike; the
 *     optional reason goes along) on an accepted charged order; "Buyer didn't
 *     show" only on an in-person order the shop marked ready whose ready date
 *     is over (/code-review of shops-m3-v1 #2).
 *  3. The new endings in each side's words.
 *  4. The lib sends the right shop-checkout bodies: terms with every order,
 *     expect with a buyer cancel.
 *
 * @mutate src/components/shops/ShopOrderCancel.tsx |   const open = order.status === "accepted" && !!order.captured_at && !order.handed_over_at; |   const open = order.status === "accepted";
 * @mutate src/components/shops/ShopOrderCancel.tsx |   return { cancellable: open && !handover.data?.problem_at && !handover.isLoading, | return { cancellable: open && !handover.isLoading,
 * @mutate src/components/shops/ShopOrderCancel.tsx |           if (q?.can_cancel) cancel.mutate(q.free ? "free" : "late"); |           if (q?.can_cancel) cancel.mutate("free");
 * @mutate src/components/shops/ShopOrderCancel.tsx |         setChanged(true);\n        void quote.refetch();\n        return; |         setChanged(true);
 * @mutate src/components/shops/ShopOrderCancel.tsx |   const noShowOpen = order.handover_mode === "in_person" && markedReady && louisianaToday() > order.ready_date; |   const noShowOpen = true;
 * @mutate src/components/shops/ShopOrderCancel.tsx |   const noShowOpen = order.handover_mode === "in_person" && markedReady && louisianaToday() > order.ready_date; |   const noShowOpen = order.handover_mode === "in_person" && louisianaToday() > order.ready_date;
 * @mutate src/lib/shops/orders.ts |   if (error && (error as { code?: string }).code === "PGRST202") return { can_cancel: false, unavailable: true }; |
 * @mutate src/lib/shops/orders.ts |   if (closed && o.status === "partially_refunded") { |   if (false) {
 * @mutate src/components/shops/ShopOrderCancel.tsx |     mutationFn: (what: "cancel" \| "no_show") => (what === "cancel" ? shopCancelOrder(order.id, reason) : reportNoShow(order.id)), |     mutationFn: (what: "cancel" \| "no_show") => (what === "cancel" ? shopCancelOrder(order.id, "") : reportNoShow(order.id)),
 * @mutate src/components/shops/ShopMyOrdersView.tsx |               {o.status === "accepted" && <BuyerCancelOrder order={o} />} | {null}
 * @mutate src/components/shops/ShopDashboardView.tsx |                       <ShopCancelOrder order={o} />\n | \n
 * @mutate src/lib/shops/orders.ts |   if (closed && (o.status === "refunded" \|\| o.status === "cancelled")) return closed[side]; |   if (false) return closed[side];
 * @mutate src/lib/shops/orders.ts |   const data = await invokeShopCheckout({ action: "buyer_cancel", order_id: orderId, expect }); |   const data = await invokeShopCheckout({ action: "buyer_cancel", order_id: orderId });
 * @mutate src/lib/shops/orders.ts |     terms: { cancel_policy: args.terms.cancel_policy, ready_tap_cancel: args.terms.ready_tap_cancel ?? "from_day_before" }, |     terms: undefined,
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopOrder } from "@/lib/shops/orders";

const invoke = vi.hoisted(() => vi.fn(async (_fn: string, _opts: { body: Record<string, unknown> }) =>
  ({ data: { ok: true } as Record<string, unknown>, error: null as unknown })));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke }, rpc } }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("@/components/ui/BrandConfirmDialog", () => ({
  BrandConfirmDialog: ({ open, title, description, primaryLabel, primaryDisabled, onPrimary, children }: {
    open: boolean; title: string; description?: string; primaryLabel: string; primaryDisabled?: boolean;
    onPrimary: (e: { preventDefault: () => void }) => void; children?: ReactNode;
  }) => (open ? (
    <div role="dialog" aria-label={title}>
      <p>{description}</p>
      {children}
      <button type="button" disabled={primaryDisabled} onClick={() => onPrimary({ preventDefault: () => undefined })}>{`confirm ${primaryLabel}`}</button>
    </div>
  ) : null),
}));
const orders = vi.hoisted(() => ({ fetchMyOrders: vi.fn(), fetchShopOrders: vi.fn(), fetchCancelPolicy: vi.fn(async () => "until_accept"),
  fetchReadyTapCancel: vi.fn(async () => "from_day_before") }));
vi.mock("@/lib/shops/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/orders")>()), ...orders }));
const handover = vi.hoisted(() => ({
  fetchHandoverMode: vi.fn(async () => "in_person"), setHandoverMode: vi.fn(), fetchHandovers: vi.fn(async () => new Map()),
  fetchMyShopPayouts: vi.fn(async () => []),
}));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), ...handover }));
const api = vi.hoisted(() => ({ fetchMyShopId: vi.fn(async () => "s1") }));
vi.mock("@/lib/shops/api", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/api")>()), ...api }));
vi.mock("@/components/declutter/useDeclutterOrigin", () => ({ useDeclutterOrigin: () => ({ origin: { status: "none" } }) }));
vi.mock("./ShopItemsSection", () => ({ default: () => null, ShopItemsSection: () => null }));

import ShopOrdersPage from "@/pages/shops/ShopOrdersPage";
import ShopDashboardPage from "@/pages/shops/ShopDashboardPage";
import { orderStatusLabel, requestOrder } from "@/lib/shops/orders";

const order = (over: Partial<ShopOrder>): ShopOrder => ({
  id: "o1", buyer_id: "u1", seller_id: "u1", shop_id: "s1", status: "accepted", close_reason: null, ready_date: "2026-10-23",
  cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before", note: "", decline_reason: null, items_cents: 2000,
  premium_cents: 170, tax_cents: 200, total_cents: 2370, created_at: "2026-10-19T10:00:00Z", held_at: "2026-10-19T10:00:00Z",
  accept_by: null, accepted_at: "2026-10-19T11:00:00Z", captured_at: "2026-10-19T11:00:01Z", closed_at: null,
  handover_mode: "in_person", handed_over_at: null,
  shop_order_lines: [{ id: "l1", item_id: "i1", title: "Candle", kind: "made", unit_cents: 1000, quantity: 2, line_cents: 2000 }],
  shops: { name: "Bayou Bakes" }, ...over,
});

function renderAt(path: string, el: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={path} element={el} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}
const bodies = () => invoke.mock.calls.map((c) => c[1].body);
const quoteCalls = () => rpc.mock.calls.filter((c) => c[0] === "shops_order_cancel_quote");

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ data: { cancelled: true, refund_cents: 2250 }, error: null });
  rpc.mockImplementation(async (fn: string) => (fn === "shops_order_cancel_quote"
    ? { data: { can_cancel: true, free: true, refund_cents: 2250, kept_cents: 120, paid_cents: 2370 }, error: null }
    : { data: null, error: null }));
  handover.fetchHandovers.mockResolvedValue(new Map());
});

describe("the buyer's Cancel order (M3)", () => {
  it("shows only on an accepted, charged order with no open problem", async () => {
    orders.fetchMyOrders.mockResolvedValue([
      order({ id: "charged" }),
      order({ id: "charging", captured_at: null, shops: { name: "Not charged yet" } }),
    ]);
    renderAt("/shops/orders", <ShopOrdersPage />);
    await screen.findByText("Not charged yet");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Cancel order" })).toHaveLength(1));
    const cards = screen.getAllByTestId("shop-order-card");
    expect(within(cards[1]).queryByRole("button", { name: "Cancel order" })).toBeNull();
  });

  it("is hidden while a problem report is open", async () => {
    orders.fetchMyOrders.mockResolvedValue([order({})]);
    handover.fetchHandovers.mockResolvedValue(new Map([["o1", { order_id: "o1", problem_at: "2026-10-23T12:00:00Z" }]]) as never);
    renderAt("/shops/orders", <ShopOrdersPage />);
    await screen.findByText(/You reported a problem/);
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
  });

  it("free: says the refund less the card cost and its tax, and sends expect 'free'", async () => {
    orders.fetchMyOrders.mockResolvedValue([order({})]);
    renderAt("/shops/orders", <ShopOrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this order?" });
    await within(dialog).findByText(/You get \$22\.50 back, less the card-processing cost and the sales tax on it/);
    fireEvent.click(within(dialog).getByRole("button", { name: "confirm Cancel order" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(bodies()[0]).toMatchObject({ action: "buyer_cancel", order_id: "o1", expect: "free" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order cancelled. $22.50 is on its way back to your card."));
  });

  it("late: says nothing comes back and sends expect 'late'", async () => {
    rpc.mockResolvedValue({ data: { can_cancel: true, free: false, refund_cents: 0, kept_cents: 2370 }, error: null });
    invoke.mockResolvedValue({ data: { cancelled: true, refund_cents: 0 }, error: null });
    orders.fetchMyOrders.mockResolvedValue([order({})]);
    renderAt("/shops/orders", <ShopOrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this order?" });
    await within(dialog).findByText(/free-cancel time is over\. If you cancel now, nothing is refunded and the shop is paid\./);
    fireEvent.click(within(dialog).getByRole("button", { name: "confirm Cancel without a refund" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(bodies()[0]).toMatchObject({ action: "buyer_cancel", expect: "late" });
  });

  // /code-review of shops-m3-v1 #8: the quote RPC not deployed yet says so and offers no cancel (never a raw error).
  it("quote not on the server yet (PGRST202): says so, and the confirm stays off", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.shops_order_cancel_quote" } });
    orders.fetchMyOrders.mockResolvedValue([order({})]);
    renderAt("/shops/orders", <ShopOrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this order?" });
    await within(dialog).findByText(/isn't available yet/);
    expect((within(dialog).getByRole("button", { name: /^confirm/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("cancel_terms_changed: re-reads the quote and says so, nothing else", async () => {
    orders.fetchMyOrders.mockResolvedValue([order({})]);
    invoke.mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify({ error: "cancel_terms_changed" }), { status: 409 }) },
    } as never);
    renderAt("/shops/orders", <ShopOrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this order?" });
    await within(dialog).findByText(/You get \$22\.50 back/);
    expect(quoteCalls()).toHaveLength(1);
    rpc.mockResolvedValue({ data: { can_cancel: true, free: false, refund_cents: 0, kept_cents: 2370 }, error: null });
    fireEvent.click(within(dialog).getByRole("button", { name: "confirm Cancel order" }));
    expect(await within(dialog).findByTestId("shop-cancel-terms-changed")).toBeTruthy();
    await within(dialog).findByText(/nothing is refunded and the shop is paid/);
    expect(quoteCalls()).toHaveLength(2);
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Cancel this order?" })).toBeTruthy();
  });
});

describe("the shop's Cancel order and Buyer didn't show (M3)", () => {
  it("Cancel order warns of the full refund, fee and strike, and sends the reason", async () => {
    orders.fetchShopOrders.mockResolvedValue([order({ ready_date: "2999-01-01" })]);
    renderAt("/shops/dashboard", <ShopDashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
    // A future ready date: no no-show yet.
    expect(screen.queryByRole("button", { name: "Buyer didn't show" })).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "Cancel this accepted order?" });
    expect(within(dialog).getByText(/The buyer gets everything back\. The card fee comes out of your next payout, and it counts as a Shops strike/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Tell the buyer why (optional)"), { target: { value: "Oven broke" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "confirm Cancel and refund" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(bodies()[0]).toMatchObject({ action: "shop_cancel", order_id: "o1", reason: "Oven broke" });
  });

  it("Buyer didn't show: only in person, only marked ready, only after the ready date", async () => {
    orders.fetchShopOrders.mockResolvedValue([
      order({ id: "past", ready_date: "2020-01-02" }),
      order({ id: "porch", ready_date: "2020-01-02", handover_mode: "porch" }),
      order({ id: "unready", ready_date: "2020-01-02" }),
    ]);
    handover.fetchHandovers.mockImplementation((async (ids: string[]) => new Map(ids.filter((id) => id !== "unready")
      .map((id) => [id, { order_id: id, ready_at: "2020-01-02T09:00:00Z", problem_at: null }]))) as never);
    renderAt("/shops/dashboard", <ShopDashboardPage />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Cancel order" })).toHaveLength(3));
    const noShows = screen.getAllByRole("button", { name: "Buyer didn't show" });
    expect(noShows).toHaveLength(1);
    fireEvent.click(noShows[0]);
    const dialog = await screen.findByRole("dialog", { name: "The buyer didn't come?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "confirm Report a no-show" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(bodies()[0]).toMatchObject({ action: "no_show", order_id: "past" });
  });
});

describe("the new endings and the lib's bodies", () => {
  it("words each ending for each side", () => {
    const o = (status: ShopOrder["status"], close_reason: string) => ({ status, close_reason, captured_at: "x" });
    expect(orderStatusLabel(o("refunded", "buyer_cancelled_free"))).toBe("Cancelled by you (refunded, less the card-processing cost)");
    expect(orderStatusLabel(o("cancelled", "buyer_cancelled_late"), "shop")).toBe("Cancelled by the buyer late (you are paid)");
    expect(orderStatusLabel(o("cancelled", "buyer_no_show"))).toBe("Missed pickup (not refunded; the shop is paid)");
    expect(orderStatusLabel(o("refunded", "shop_cancelled"))).toBe("Cancelled by the shop (refunded in full)");
    expect(orderStatusLabel(o("refunded", "no_ready_photo"), "shop")).toBe("Refunded to the buyer (no ready photo)");
    expect(orderStatusLabel(o("refunded", "admin_refunded"))).toBe("Refunded by Louisiana Helpr");
    // A refund made by hand in Stripe (/code-review of shops-m3-v1 #1).
    expect(orderStatusLabel(o("refunded", "refunded_by_hand"), "shop")).toBe("Refunded to the buyer by Louisiana Helpr");
    expect(orderStatusLabel(o("partially_refunded", "refunded_by_hand"))).toBe("Partly refunded by Louisiana Helpr");
    expect(orderStatusLabel(o("partially_refunded", "refunded_by_hand"), "shop")).toBe("Partly refunded to the buyer by Louisiana Helpr");
    // M1's endings are unchanged.
    expect(orderStatusLabel(o("cancelled", "buyer_cancelled"))).toBe("Withdrawn (nothing charged)");
  });

  it("an order carries the cancel terms the buyer read", async () => {
    invoke.mockResolvedValue({ data: { url: "https://checkout.stripe.com/x" }, error: null });
    await requestOrder({ shopId: "s1", lines: [{ item_id: "a", quantity: 1 }], readyDate: "2026-10-21", note: "",
      terms: { cancel_policy: "until_handover", ready_tap_cancel: "ends_at_tap" } });
    expect(bodies()[0]).toMatchObject({ action: "order", terms: { cancel_policy: "until_handover", ready_tap_cancel: "ends_at_tap" } });
    await requestOrder({ shopId: "s1", lines: [{ item_id: "a", quantity: 1 }], readyDate: "2026-10-21", note: "",
      terms: { cancel_policy: "until_accept" } });
    expect(bodies()[1]).toMatchObject({ terms: { cancel_policy: "until_accept", ready_tap_cancel: "from_day_before" } });
  });
});
