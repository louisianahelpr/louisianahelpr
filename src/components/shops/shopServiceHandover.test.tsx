/**
 * Shops audit 11-08 #3: services and at-home work get their own completion step. The server keeps such an order in
 * person (20261108200421_shops_services_in_person.sql; src/test/pglite/shopsServicesInPerson.pglite.mjs), and the
 * screen gives it service words: the shop taps "Mark complete" (no ready photo, no "Mark ready"), the buyer taps "It's
 * done" or "Something's wrong". Goods keep "Handed over" / "I got it" and the photo. #14: a delivery never reads
 * "Pick up in person".
 *
 * @mutate src/lib/shops/handoverWords.ts |   return order.shop_order_lines.some((l) => l.kind === "service" \|\| !!l.at_buyer); |   return false;
 * @mutate src/components/shops/ShopHandoverActions.tsx |       ) : side === "shop" && service ? ( |       ) : side === "shop" && false ? (
 * @mutate src/lib/shops/handoverWords.ts |   if (order.fulfillment === "shop_delivers") return shop ? "You deliver it." : "The shop delivers."; |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopOrder } from "@/lib/shops/orders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/ui/BrandConfirmDialog", () => ({
  BrandConfirmDialog: ({ open, title, primaryLabel, onPrimary }: {
    open: boolean; title: string; primaryLabel: string; onPrimary: (e: { preventDefault: () => void }) => void; children?: ReactNode;
  }) => (open ? (
    <div role="dialog" aria-label={title}>
      <button type="button" onClick={() => onPrimary({ preventDefault: () => undefined })}>{`confirm ${primaryLabel}`}</button>
    </div>
  ) : null),
}));
const handover = vi.hoisted(() => ({
  fetchHandovers: vi.fn(async () => new Map()),
  fetchMyShopPayouts: vi.fn(async () => []),
  markReady: vi.fn(),
  markHandedOver: vi.fn(async () => undefined),
  confirmPickup: vi.fn(async () => undefined),
  reportNotReceived: vi.fn(),
}));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), ...handover }));

import { ShopHandoverActions } from "./ShopHandoverActions";

const order = (over: Partial<ShopOrder> = {}, line: Record<string, unknown> = {}): ShopOrder => ({
  id: "o1", buyer_id: "u1", seller_id: "u2", shop_id: "s1", status: "accepted", close_reason: null, ready_date: "2026-01-01",
  cancel_policy: "until_accept", note: "", decline_reason: null, items_cents: 6000, premium_cents: 370, tax_cents: 0,
  total_cents: 6370, captured_at: "2025-12-30T10:00:00Z", handover_mode: "in_person", fulfillment: "pickup", handed_over_at: null,
  shop_order_lines: [{ id: "l1", item_id: "i1", title: "Carpet cleaning", kind: "service", unit_cents: 6000, quantity: 1, line_cents: 6000, ...line }],
  ...over,
} as unknown as ShopOrder);

function show(o: ShopOrder, side: "buyer" | "shop") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ShopHandoverActions order={o} side={side} userId="u2" /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a service's shop side", () => {
  it("offers Mark complete, never a ready photo or Mark ready", async () => {
    show(order(), "shop");
    const done = await screen.findByRole("button", { name: "Mark complete" });
    expect(screen.queryByRole("button", { name: /photo/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark ready" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Handed over" })).toBeNull();
    // Q2154: the shop is never told what "the shop" does; its wait line names its own step.
    expect(screen.getByTestId("shop-handover-actions").textContent).not.toContain("The shop");
    expect(screen.getByTestId("shop-handover-wait").textContent).toContain("Tap \"Mark complete\" when the work is finished.");
    fireEvent.click(done);
    fireEvent.click(screen.getByRole("button", { name: "confirm Mark complete" }));
    await vi.waitFor(() => expect(handover.markHandedOver).toHaveBeenCalledWith("o1"));
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Marked done. The buyer has 48 hours to report a problem."));
  });

  it("at-home work (a cleaning at the buyer's place) gets the same step", async () => {
    show(order({}, { kind: "service", at_buyer: true }), "shop");
    expect(await screen.findByRole("button", { name: "Mark complete" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /photo/i })).toBeNull();
  });
});

describe("a service's buyer side", () => {
  it("reads It's done and Something's wrong", async () => {
    show(order(), "buyer");
    expect(await screen.findByRole("button", { name: "It's done" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Something's wrong" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
  });
});

describe("goods keep the goods step", () => {
  it("the shop still has the photo and Handed over", async () => {
    show(order({}, { kind: "made", title: "Candle" }), "shop");
    expect(await screen.findByRole("button", { name: "Handed over" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a ready photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
  });

  it("a shop delivery never reads Pick up in person (#14)", async () => {
    show(order({ fulfillment: "shop_delivers" }, { kind: "made", title: "Candle" }), "buyer");
    const box = await screen.findByTestId("shop-handover-actions");
    expect(box.textContent).toContain("The shop delivers.");
    expect(box.textContent).not.toContain("Pick up in person");
  });
});
