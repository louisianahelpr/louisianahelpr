/**
 * Shops audit 11-12 S010 + S036: a Shops buyer total names no fee rate or fee number (the 10-25 rule, lead 11-12; the
 * total says in words that a service fee is in it), and the order card's total is what the card was really charged:
 * total_cents plus the one-time setup fee when this order carried it (setup_fee_state 'claimed', outside total_cents).
 *
 * @mutate src/lib/shops/orders.ts |   return o.setup_fee_state === "claimed" ? Math.max(0, Number(o.setup_fee_cents ?? 0)) : 0; |   return 0;
 * @mutate src/components/shops/ShopOrderCard.tsx |           Items {formatCents(order.items_cents)}\n |           Items {formatCents(order.items_cents)} + service fee {formatCents(order.premium_cents)}\n
 * @mutate src/components/shops/ShopDigitalOrder.tsx |         Download {formatCents(order.items_cents)}\n |         Download {formatCents(order.items_cents)} + service fee {formatCents(order.premium_cents)}\n
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShopOrder } from "@/lib/shops/orders";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: vi.fn(async () => ({ data: [], error: null })),
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }), eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("./ShopTalk", () => ({ ShopOrderMessageButton: () => null }));
vi.mock("./ShopReviews", () => ({ ShopOrderReview: () => null }));

import { ShopOrderCard } from "./ShopOrderCard";
import { buyerPaidCents } from "@/lib/shops/orders";

const order = (over: Partial<ShopOrder> = {}): ShopOrder => ({
  id: "o1", buyer_id: null, seller_id: "s1", shop_id: "sh1", status: "declined", close_reason: null, ready_date: "2026-11-20",
  cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before", note: "", decline_reason: null,
  items_cents: 4000, premium_cents: 270, tax_cents: 0, total_cents: 4270, created_at: "2026-11-01T10:00:00Z",
  held_at: null, accept_by: null, accepted_at: null, captured_at: null, closed_at: null,
  handover_mode: "in_person", handed_over_at: null, shop_order_lines: [],
  ...over,
});
function show(o: ShopOrder) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ul><ShopOrderCard order={o} heading="Cake" side="buyer" /></ul></QueryClientProvider>);
}

describe("S036: the buyer's total is what the card carried", () => {
  it("adds the setup fee only when this order claimed it", () => {
    expect(buyerPaidCents(order({ setup_fee_cents: 200, setup_fee_state: "claimed" }))).toBe(4470);
    expect(buyerPaidCents(order({ setup_fee_cents: 200, setup_fee_state: "put_back" }))).toBe(4270);
    expect(buyerPaidCents(order({ setup_fee_cents: 200, setup_fee_state: null }))).toBe(4270);
    expect(buyerPaidCents(order())).toBe(4270);
  });

  it("the card shows $44.70 and names the setup fee as its own part", () => {
    show(order({ setup_fee_cents: 200, setup_fee_state: "claimed" }));
    const card = screen.getByTestId("shop-order-card");
    expect(card.textContent).toContain("$44.70");
    expect(card.textContent).toContain("+ one-time account setup fee $2.00.");
  });
});

describe("S010: no fee name or number on the order card", () => {
  it("says the service fee is included, in words only", () => {
    show(order());
    const text = screen.getByTestId("shop-order-card").textContent ?? "";
    expect(text).toContain("Items $40.00. Includes a small Louisiana Helpr service fee.");
    expect(text).not.toMatch(/service fee \$|\$2\.70|5% \+/i);
  });

  it("a download card says the same", () => {
    show(order({ is_digital: true, status: "accepted", captured_at: "2026-11-01T11:00:00Z" }));
    const text = screen.getByTestId("shop-order-card").textContent ?? "";
    expect(text).toContain("Includes a small Louisiana Helpr service fee.");
    expect(text).not.toMatch(/service fee \$|\$2\.70/i);
  });
});
