/**
 * Design audit 11-18, Area 07 (Shops), the order card:
 *   M2: a half-paid custom order whose second charge failed (balance_failed_at, not balance_captured_at) offers the shop
 *       neither "Mark ready" nor "Handed over"; it says it waits for the buyer to pay the rest. UI gating only.
 *   M1: one primary per stage. Before the ready mark "Mark ready" is the one filled button and the photo is an optional
 *       link; once marked ready, "Handed over" is the filled one.
 *   M14: after the refund time ends the buyer's button names it ("Cancel order (refund time over)").
 *   L1/L2: a finished card shows its final event; a line reads "2 × Pralines · $24.00".
 *
 * @mutate src/components/shops/ShopHandoverActions.tsx |       {side === "shop" && restOwed ? ( |       {side === "shop" && false ? (
 * @mutate src/components/shops/ShopHandoverActions.tsx | && !order.balance_captured_at && !!order.balance_failed_at; | && !order.balance_captured_at;
 * @mutate src/components/shops/ShopHandoverActions.tsx | variant={h?.ready_at ? "default" : "outline"} className={h?.ready_at ? "btn-grad-primary" : undefined} | className="btn-grad-primary"
 * @mutate src/components/shops/ShopOrderCancel.tsx |         {refundOver ? "Cancel order (refund time over)" : "Cancel order"} |         Cancel order
 * @mutate src/components/shops/ShopOrderCard.tsx |   if (order.status === "handed_over" && order.handed_over_at) return tr("sho.dateHandedOver", { date: stampDateText(order.handed_over_at) }); |
 * @mutate src/components/shops/ShopOrderCard.tsx |           {t("sho.items", { amount: formatCents(order.items_cents) })} |           Items {formatCents(order.items_cents)}
 *   H1: the order card speaks Spanish (enShopOrders.ts / esShopOrders.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { ShopOrder } from "@/lib/shops/orders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const handover = vi.hoisted(() => ({
  fetchHandovers: vi.fn(async (): Promise<Map<string, unknown>> => new Map()),
  fetchMyShopPayouts: vi.fn(async () => []),
  markReady: vi.fn(),
  markHandedOver: vi.fn(async () => undefined),
  confirmPickup: vi.fn(async () => undefined),
  reportNotReceived: vi.fn(),
}));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), ...handover }));

import { ShopHandoverActions } from "./ShopHandoverActions";
import { BuyerCancelOrder, refundTimeOver } from "./ShopOrderCancel";
import { orderDateLine, ShopOrderCard } from "./ShopOrderCard";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";

const order = (over: Partial<ShopOrder> = {}): ShopOrder => ({
  id: "o1", buyer_id: "u1", seller_id: "u2", shop_id: "s1", status: "accepted", close_reason: null, ready_date: "2026-01-01",
  cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before", note: "", decline_reason: null, items_cents: 6000,
  premium_cents: 370, tax_cents: 0, total_cents: 6370, captured_at: "2025-12-30T10:00:00Z", handover_mode: "in_person",
  fulfillment: "pickup", handed_over_at: null, closed_at: null,
  shop_order_lines: [{ id: "l1", item_id: "i1", title: "Candle", kind: "made", unit_cents: 6000, quantity: 1, line_cents: 6000 }],
  ...over,
} as unknown as ShopOrder);

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  handover.fetchHandovers.mockImplementation(async () => new Map());
});

describe("M2: a half-paid custom order waiting on the rest", () => {
  const halfPaid = { payment_plan: "deposit_50", balance_cents: 3000, deposit_cents: 3370, balance_failed_at: "2026-01-01T12:00:00Z", balance_captured_at: null };
  it("offers the shop neither Mark ready nor Handed over, and says why", async () => {
    wrap(<ShopHandoverActions order={order(halfPaid as Partial<ShopOrder>)} side="shop" userId="u2" />);
    expect(await screen.findByTestId("shop-handover-rest-owed")).toBeTruthy();
    expect(screen.getByTestId("shop-handover-rest-owed").textContent).toContain("Waiting for the buyer to pay the rest.");
    expect(screen.queryByRole("button", { name: "Mark ready" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Handed over" })).toBeNull();
  });
  it("once the rest is paid, the steps come back", async () => {
    wrap(<ShopHandoverActions order={order({ ...halfPaid, balance_captured_at: "2026-01-02T12:00:00Z" } as Partial<ShopOrder>)} side="shop" userId="u2" />);
    expect(await screen.findByRole("button", { name: "Mark ready" })).toBeTruthy();
    expect(screen.queryByTestId("shop-handover-rest-owed")).toBeNull();
  });
  it("a balance not yet tried (no failure) is not gated", async () => {
    wrap(<ShopHandoverActions order={order({ ...halfPaid, balance_failed_at: null } as Partial<ShopOrder>)} side="shop" userId="u2" />);
    expect(await screen.findByRole("button", { name: "Handed over" })).toBeTruthy();
  });
});

describe("M1: one primary per stage", () => {
  it("before ready: Mark ready is the filled button, Handed over is outline, the photo is a link", async () => {
    wrap(<ShopHandoverActions order={order()} side="shop" userId="u2" />);
    const mark = await screen.findByRole("button", { name: "Mark ready" });
    const handed = screen.getByRole("button", { name: "Handed over" });
    expect(mark.className).toContain("btn-grad-primary");
    expect(handed.className).not.toContain("btn-grad-primary");
    expect(screen.getByRole("button", { name: "Add a ready photo (optional)" }).className).toContain("link-standard");
    expect(screen.getAllByRole("button").filter((b) => b.className.includes("btn-grad-primary"))).toHaveLength(1);
  });
  it("after ready: Handed over is the one filled button", async () => {
    handover.fetchHandovers.mockImplementation(async () => new Map([["o1", { ready_at: "2025-12-31T10:00:00Z" }]]));
    wrap(<ShopHandoverActions order={order()} side="shop" userId="u2" />);
    // Wait for the ready answer to fill Handed over (Mark ready is absent on a first paint too, so waiting for its
    // absence alone waits for nothing).
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Handed over" }).className).toContain("btn-grad-primary"));
    expect(screen.queryByRole("button", { name: "Mark ready" })).toBeNull();
    expect(screen.getAllByRole("button").filter((b) => b.className.includes("btn-grad-primary"))).toHaveLength(1);
  });
});

describe("M14: the buyer's cancel after the refund time", () => {
  it("names the consequence once the time is over", async () => {
    wrap(<BuyerCancelOrder order={order()} />);
    expect(await screen.findByRole("button", { name: "Cancel order (refund time over)" })).toBeTruthy();
  });
  it("refundTimeOver: open window false, passed window true, preorder never", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(refundTimeOver(order({ ready_date: "2026-02-01" }), now)).toBe(false);
    expect(refundTimeOver(order({ ready_date: "2026-01-05" }), now)).toBe(true);
    expect(refundTimeOver(order({ cancel_policy: "until_accept" } as Partial<ShopOrder>), now)).toBe(true);
    expect(refundTimeOver(order({ ready_date: "2026-01-05", preorder_item_id: "p1" } as Partial<ShopOrder>), now)).toBe(false);
  });
});

describe("L1: a finished card shows its final event", () => {
  it("handed over and closed orders read their own stamp; an open one its ready date", () => {
    expect(orderDateLine(order({ status: "handed_over", handed_over_at: "2026-01-02T18:00:00Z" }))).toMatch(/^Handed over /);
    expect(orderDateLine(order({ status: "expired", closed_at: "2026-01-02T18:00:00Z" }))).toMatch(/^Closed /);
    expect(orderDateLine(order())).toMatch(/^Ready /);
  });
});

describe("H1: the order card in Spanish", () => {
  it("reads its own words from the dictionary", async () => {
    setLang("es");
    await ensureLangLoaded();
    try {
      wrap(<MemoryRouter><ul><ShopOrderCard order={order({ status: "handed_over", handed_over_at: "2026-01-02T18:00:00Z", note: "Sin nueces", buyer_id: null } as Partial<ShopOrder>)} heading="Ana" side="buyer" /></ul></MemoryRouter>);
      const card = await screen.findByTestId("shop-order-card");
      expect(card.textContent).toContain("Artículos $60.00");
      expect(card.textContent).toContain("Nota: Sin nueces");
      expect(card.textContent).toContain("Entregado el");
      expect(card.textContent).not.toContain("Items $60.00");
    } finally {
      __resetLangForTests();
    }
  });
});
