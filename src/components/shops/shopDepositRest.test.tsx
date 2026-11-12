/**
 * Shops custom orders (50% deposit, slice 2b + slice 4 card): what each side reads about the rest on the order card,
 * and the buyer's "Pay the rest" button (shop-checkout pay_balance). The server decides what is owed
 * (src/test/edge/shop-balance.test.ts, src/test/pglite/shopsCustomBalance.pglite.mjs); this proves the card says it
 * plainly, offers the button ONLY to the buyer and ONLY once the saved card did not take it, and opens the page.
 *
 * @mutate src/components/shops/ShopOrderCard.tsx |       {side === "buyer" && owedNow && ( |       {owedNow && (
 * @mutate src/components/shops/ShopOrderCard.tsx |   const owedNow = !paid && !!order.balance_failed_at && order.status === "accepted"; |   const owedNow = !paid && order.status === "accepted";
 * @mutate src/components/shops/ShopOrderCard.tsx |   if (order.payment_plan !== "deposit_50" \|\| rest === null \|\| rest <= 0) return null; |   if (rest === null \|\| rest <= 0) return null;
 * @mutate src/lib/shops/orders.ts |   const data = await invokeShopCheckout({ action: "pay_balance", order_id: orderId }); |   const data = await invokeShopCheckout({ action: "charge_rest", order_id: orderId });
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShopOrder } from "@/lib/shops/orders";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const ext = vi.hoisted(() => ({ openExternalUrl: vi.fn(async (_url: string, _onReturn?: () => void) => undefined) }));
vi.mock("@/lib/openExternalUrl", () => ext);
vi.mock("./ShopTalk", () => ({ ShopOrderMessageButton: () => null }));
vi.mock("./ShopReviews", () => ({ ShopOrderReview: () => null }));

import { ShopOrderCard } from "./ShopOrderCard";

const order = (over: Partial<ShopOrder> = {}): ShopOrder => ({
  id: "o1", buyer_id: null, seller_id: "s1", shop_id: "sh1", status: "accepted", close_reason: null, ready_date: "2026-11-09",
  cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before", note: "", decline_reason: null,
  items_cents: 6000, premium_cents: 375, tax_cents: 290, total_cents: 6665, created_at: "2026-11-01T10:00:00Z",
  held_at: null, accept_by: null, accepted_at: "2026-11-01T11:00:00Z", captured_at: "2026-11-01T11:00:00Z", closed_at: null,
  handover_mode: "in_person", handed_over_at: null, shop_order_lines: [],
  payment_plan: "deposit_50", deposit_cents: 3520, balance_cents: 3145, balance_captured_at: null, balance_failed_at: null,
  ...over,
});
function show(o: ShopOrder, side: "buyer" | "shop") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ul><ShopOrderCard order={o} heading="Cake" side={side} /></ul>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  ext.openExternalUrl.mockClear();
  toast.error.mockClear();
});

describe("the order card: a 50% deposit order's rest", () => {
  it("before the ready date both sides read what was paid and when the rest is charged; no button", () => {
    show(order(), "buyer");
    expect(screen.getByTestId("shop-order-deposit").textContent).toBe(
      "Paid when the shop accepted: $35.20. The rest, $31.45, is charged to your card on the ready date.");
    expect(screen.queryByRole("button", { name: /pay the rest/i })).toBeNull();
  });

  // S037 (Shops audit 11-12): the shop's box read the buyer's charged amounts (service fee and tax inside), which never
  // added up to the shop's price; it now says the halves in words, and the card's own line says "Your price".
  // @mutate src/components/shops/ShopOrderCard.tsx |   if (side === "shop") {\n    return ( |   if (false) {\n    return (
  // @mutate src/components/shops/ShopOrderCard.tsx |                 : `Your price: ${formatCents(shopGets)}.`} |                 : `You get the item price in full: ${formatCents(shopGets)}.`}
  it("the shop reads it in its own terms: no buyer amounts, and 'Your price', never 'in full' (S037)", () => {
    show(order(), "shop");
    expect(screen.getByTestId("shop-order-deposit").textContent).toBe(
      "Half was charged to the buyer's card when you accepted. The other half is charged to the buyer's card on the ready date.");
    expect(screen.getByTestId("shop-order-deposit").textContent).not.toMatch(/\$/);
    expect(screen.getByTestId("shop-order-your-price").textContent).toMatch(/^Your price: \$/);
    expect(document.body.textContent).not.toMatch(/in full/);
  });

  it("when the card did not take it, ONLY the buyer gets Pay the rest, which opens the page for exactly this order", async () => {
    invoke.mockResolvedValue({ data: { url: "https://checkout.stripe.com/rest", order_id: "o1" }, error: null });
    show(order({ balance_failed_at: "2026-11-09T15:00:00Z" }), "buyer");
    expect(screen.getByTestId("shop-order-deposit").textContent).toContain("didn't go through on your card. Pay it to get your order.");
    fireEvent.click(screen.getByRole("button", { name: "Pay the rest ($31.45)" }));
    await waitFor(() => expect(ext.openExternalUrl).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][0]).toBe("shop-checkout");
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: "pay_balance", order_id: "o1" });
    expect(ext.openExternalUrl.mock.calls[0][0]).toBe("https://checkout.stripe.com/rest");
  });

  it("the shop sees it is waiting on the buyer, with no button", () => {
    show(order({ balance_failed_at: "2026-11-09T15:00:00Z" }), "shop");
    expect(screen.getByTestId("shop-order-deposit").textContent).toContain("We asked them to pay it; hand over the order once it's paid.");
    expect(screen.getByTestId("shop-order-deposit").textContent).toContain("The other half didn't go through on the buyer's card.");
    expect(screen.queryByRole("button", { name: /pay the rest/i })).toBeNull();
  });

  it("a page that cannot open says so in plain words", async () => {
    const ctx = new Response(JSON.stringify({ error: "nothing_owed" }), { status: 409 });
    invoke.mockResolvedValue({ data: null, error: { context: ctx } });
    show(order({ balance_failed_at: "2026-11-09T15:00:00Z" }), "buyer");
    fireEvent.click(screen.getByRole("button", { name: /pay the rest/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nothing more is owed on this order."));
    expect(ext.openExternalUrl).not.toHaveBeenCalled();
  });

  it("once paid it says so; a full-hold order shows nothing", () => {
    const { unmount } = show(order({ balance_captured_at: "2026-11-09T15:00:00Z" }), "buyer");
    expect(screen.getByTestId("shop-order-deposit").textContent).toContain("The rest, $31.45, is paid.");
    unmount();
    show(order({ payment_plan: "full_hold", deposit_cents: null, balance_cents: null }), "buyer");
    expect(screen.queryByTestId("shop-order-deposit")).toBeNull();
  });
});
