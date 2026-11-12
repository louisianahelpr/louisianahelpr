/**
 * Custom orders (20261106202917): each side's list of requests. Only the member's own side shows; an open request
 * can be withdrawn by the buyer or declined by the shop, through shop-checkout close_request (never the RPC
 * directly, so the buyer's unpaid page for a price is closed too); a closed one offers nothing.
 *
 * @mutate src/components/shops/ShopCustomRequestsList.tsx |   const rows = (list.data ?? []).filter((r) => r.role === side).sort( |   const rows = (list.data ?? []).sort(
 * @mutate src/components/shops/ShopCustomRequestsList.tsx |             {OPEN.has(r.status) && openId !== r.id && ( |             {openId !== r.id && (
 * @mutate src/lib/shops/orders.ts |   await invokeShopCheckout({ action: "close_request", request_id: requestId }); |   await invokeShopCheckout({ action: "close_request", order_id: requestId });
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomRequest } from "@/lib/shops/customRequests";

const sb = vi.hoisted(() => ({ rows: [] as unknown[], invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: sb.rows, error: null }),
    functions: { invoke: sb.invoke },
  },
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import ShopCustomRequestsList from "./ShopCustomRequestsList";

const req = (over: Partial<CustomRequest>): CustomRequest => ({
  id: "r1", shop_id: "sh1", shop_name: "Bayou Bakes", role: "buyer", description: "A blue cake for 12", wanted_date: null,
  payment_plan: "full_hold", status: "requested", quote_cents: null, quote_note: null, quoted_at: null, expires_at: null,
  created_at: "2026-11-06T10:00:00Z", ...over,
});
function show(side: "buyer" | "shop") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ShopCustomRequestsList side={side} /></QueryClientProvider>);
}

beforeEach(() => {
  sb.rows = [];
  sb.invoke.mockReset();
  toast.mockClear();
});

describe("custom requests, each side", () => {
  it("the buyer sees only their own asks, with the shop's price when it came", async () => {
    sb.rows = [
      req({ id: "r1", status: "quoted", quote_cents: 4500, quote_note: "Two tiers", expires_at: "2026-11-13T10:00:00Z" }),
      req({ id: "r2", role: "shop", shop_name: "My shop", description: "Someone else's ask" }),
    ];
    show("buyer");
    const cards = await screen.findAllByTestId("shop-custom-request");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("Bayou Bakes");
    expect(cards[0].textContent).toContain("$45.00");
    expect(cards[0].textContent).toContain("The shop sent a price, good until");
    expect(cards[0].textContent).toContain("Shop's note: Two tiers");
    expect(screen.queryByText("Someone else's ask")).toBeNull();
  });

  it("the shop declines an open request through close_request", async () => {
    sb.rows = [req({ id: "r9", role: "shop" })];
    sb.invoke.mockResolvedValue({ data: { closed: true }, error: null });
    show("shop");
    const card = await screen.findByTestId("shop-custom-request");
    fireEvent.click(within(card).getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Request declined. The buyer is told."));
    expect(sb.invoke.mock.calls[0][0]).toBe("shop-checkout");
    expect(sb.invoke.mock.calls[0][1].body).toMatchObject({ action: "close_request", request_id: "r9" });
  });

  it("a closed request offers nothing to do", async () => {
    sb.rows = [req({ status: "declined" }), req({ id: "r3", status: "accepted", quote_cents: 4500 })];
    show("buyer");
    expect(await screen.findAllByTestId("shop-custom-request")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("no request on this side: nothing shows", async () => {
    sb.rows = [req({ role: "shop" })];
    const { container } = show("buyer");
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
  });
});

describe("S2-017: custom requests that need an answer are not buried", () => {
  it("open requests list first", async () => {
    sb.rows = [
      req({ id: "a", role: "shop", status: "declined", description: "Old declined ask" }),
      req({ id: "b", role: "shop", status: "requested", description: "Fresh ask" }),
    ];
    show("shop");
    const cards = await screen.findAllByTestId("shop-custom-request");
    expect(cards[0].textContent).toContain("Fresh ask");
  });
  it("the dashboard and My orders put the list on top, and new requests count in Waiting for your answer", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dash = readFileSync(resolve(__dirname, "ShopDashboardView.tsx"), "utf8");
    expect(dash.indexOf('<ShopCustomRequestsList side="shop" />')).toBeGreaterThan(-1);
    expect(dash.indexOf('<ShopCustomRequestsList side="shop" />')).toBeLessThan(dash.indexOf('id="shop-waiting"'));
    expect(dash).toMatch(/count: waiting\.length \+ newRequests/);
    const mine = readFileSync(resolve(__dirname, "ShopMyOrdersView.tsx"), "utf8");
    expect(mine.indexOf('<ShopCustomRequestsList side="buyer" />')).toBeLessThan(mine.indexOf("<NoOrdersYet />"));
  });
});
