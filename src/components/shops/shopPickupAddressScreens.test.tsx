/**
 * Shops M1b part 2, the private pickup address on screen (migration
 * 20261018180859_shops_pickup_address; the access rules themselves are proven
 * in SQL by src/test/pglite/shopsPickupAddress.pglite.mjs):
 *
 *  1. The buyer's order card shows where to pick up ONLY once the shop accepted
 *     (accepted only: after handover the buyer no longer reads it, authz review
 *     2026-10-18); a held or handed-over order never asks, and the shop's own
 *     card never shows it.
 *  2. The owner's pickup form (ShopPickupAddressSection): says an address is
 *     needed to take orders, refuses a non-Louisiana ZIP before sending, sends
 *     the fields, and loads a saved address back.
 *  3. ShopEditView mounts the form for an existing shop.
 *
 * @mutate src/components/shops/ShopOrderCard.tsx | const PICKUP_VISIBLE = new Set(["accepted"]); | const PICKUP_VISIBLE = new Set(["held", "accepted", "handed_over"]);
 * @mutate src/components/shops/ShopOrderCard.tsx |       {side === "buyer" && PICKUP_VISIBLE.has(order.status) && <PickupAddress orderId={order.id} />} |       {PICKUP_VISIBLE.has(order.status) && <PickupAddress orderId={order.id} />}
 * @mutate src/components/shops/ShopPickupAddressSection.tsx |     if (!LOUISIANA_ZIP.test(zip.trim())) { |     if (false) {
 * @mutate src/components/shops/ShopPickupAddressSection.tsx |     mutationFn: () => saveMyPickupAddress({ line1, line2, city, postal_code: zip.trim() }), |     mutationFn: async () => undefined,
 * @mutate src/components/shops/ShopEditView.tsx |       {myId.data && <div className="pb-6"><ShopPickupAddressSection /></div>} |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopOrder } from "@/lib/shops/orders";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const api = vi.hoisted(() => ({
  fetchOrderPickupAddress: vi.fn(),
  fetchMyPickupAddress: vi.fn(),
  saveMyPickupAddress: vi.fn(),
}));
vi.mock("@/lib/shops/pickupAddress", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/pickupAddress")>()),
  ...api,
}));

import { ShopOrderCard } from "./ShopOrderCard";
import ShopPickupAddressSection from "./ShopPickupAddressSection";

const ADDRESS = { line1: "705 W University Ave", line2: null, city: "Lafayette", state: "LA", postal_code: "70506" };

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const order = (status: ShopOrder["status"]): ShopOrder => ({
  id: `order-${status}`, buyer_id: "u1", seller_id: "u2", shop_id: "s1", status, close_reason: null,
  ready_date: "2026-10-30", cancel_policy: "until_accept", note: null, decline_reason: null,
  items_cents: 3600, premium_cents: 250, tax_cents: 0, total_cents: 3850, captured_at: null,
  shop_order_lines: [{ id: "l1", title: "Kolache dozen", quantity: 2, unit_cents: 1800, line_cents: 3600 }],
} as unknown as ShopOrder);

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchOrderPickupAddress.mockResolvedValue(ADDRESS);
  api.fetchMyPickupAddress.mockResolvedValue(null);
  api.saveMyPickupAddress.mockResolvedValue(undefined);
});

describe("the buyer sees where to pick up only once the shop accepted", () => {
  it.each(["accepted"] as const)("%s: the address is on the buyer's card", async (status) => {
    wrap(<ul><ShopOrderCard order={order(status)} side="buyer" heading="Bayou Bakes" /></ul>);
    const box = await screen.findByTestId("shop-order-pickup-address");
    expect(box.textContent).toContain("705 W University Ave");
    expect(box.textContent).toContain("Lafayette, LA 70506");
    expect(api.fetchOrderPickupAddress).toHaveBeenCalledWith(`order-${status}`);
  });

  it.each(["held", "handed_over", "declined", "expired", "cancelled"] as const)("%s: never asked for, never shown", async (status) => {
    wrap(<ul><ShopOrderCard order={order(status)} side="buyer" heading="Bayou Bakes" /></ul>);
    await screen.findByText("Bayou Bakes");
    expect(screen.queryByTestId("shop-order-pickup-address")).toBeNull();
    expect(api.fetchOrderPickupAddress).not.toHaveBeenCalled();
  });

  it("the shop's own card does not show its address back", async () => {
    wrap(<ul><ShopOrderCard order={order("accepted")} side="shop" heading="Accepted order" /></ul>);
    await screen.findByText("Accepted order");
    expect(api.fetchOrderPickupAddress).not.toHaveBeenCalled();
  });

  it("a failed read says so, with a way to try again", async () => {
    api.fetchOrderPickupAddress.mockRejectedValue(new Error("boom"));
    wrap(<ul><ShopOrderCard order={order("accepted")} side="buyer" heading="Bayou Bakes" /></ul>);
    expect(await screen.findByText(/couldn't load the pickup address/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("the owner's pickup address form", () => {
  const fill = (line1: string, city: string, zip: string) => {
    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: line1 } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: city } });
    fireEvent.change(screen.getByLabelText("ZIP code"), { target: { value: zip } });
  };

  it("with none saved, says orders need one", async () => {
    wrap(<ShopPickupAddressSection />);
    expect(await screen.findByText("Add your pickup address to start taking orders.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add pickup address" })).toBeTruthy();
  });

  it("refuses a ZIP outside Louisiana before sending anything", async () => {
    wrap(<ShopPickupAddressSection />);
    await screen.findByLabelText("Street address");
    fill("12 Main St", "Houston", "77002");
    fireEvent.click(screen.getByRole("button", { name: "Add pickup address" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Louisiana ZIP code/);
    expect(api.saveMyPickupAddress).not.toHaveBeenCalled();
  });

  it("sends the fields and says it is saved", async () => {
    wrap(<ShopPickupAddressSection />);
    await screen.findByLabelText("Street address");
    fill("705 W University Ave", "Lafayette", " 70506 ");
    fireEvent.click(screen.getByRole("button", { name: "Add pickup address" }));
    await waitFor(() => expect(api.saveMyPickupAddress).toHaveBeenCalledWith({ line1: "705 W University Ave", line2: "", city: "Lafayette", postal_code: "70506" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pickup address saved."));
  });

  it("a refusal shows the server's words", async () => {
    api.saveMyPickupAddress.mockRejectedValue(Object.assign(new Error("payout_setup_incomplete"), { userMessage: "Finish payout setup first." }));
    wrap(<ShopPickupAddressSection />);
    await screen.findByLabelText("Street address");
    fill("705 W University Ave", "Lafayette", "70506");
    fireEvent.click(screen.getByRole("button", { name: "Add pickup address" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Finish payout setup first."));
  });

  it("loads a saved address back into the form", async () => {
    api.fetchMyPickupAddress.mockResolvedValue({ ...ADDRESS, line2: "Suite 2" });
    wrap(<ShopPickupAddressSection />);
    await waitFor(() => expect((screen.getByLabelText("Street address") as HTMLInputElement).value).toBe("705 W University Ave"));
    expect((screen.getByLabelText("Apt, suite or unit (optional)") as HTMLInputElement).value).toBe("Suite 2");
    expect((screen.getByLabelText("ZIP code") as HTMLInputElement).value).toBe("70506");
    expect(screen.getByRole("button", { name: "Save pickup address" })).toBeTruthy();
  });
});

describe("ShopEditView mounts the form for an existing shop", () => {
  it("renders ShopPickupAddressSection behind myId.data", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/shops/ShopEditView.tsx"), "utf8"));
    expect(src).toMatch(/\{myId\.data && <div className="pb-6"><ShopPickupAddressSection \/><\/div>\}/);
  });
});
