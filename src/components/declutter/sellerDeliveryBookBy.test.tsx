/**
 * A3-72 (lead 11-01 5:34 PM + 9:05 PM): a seller-delivered order whose delivery lost its time ("needs a time") says
 * by when, on both sides, and what happens then: at book_by (paid + 7 days, 20261102031000) the order is cancelled and
 * the buyer's full payment refunded. A buyer who must pick a time and finds none is told to message the seller or
 * report a problem, with the Message button (the picker said only "No other delivery times are open").
 * Backend proof (book_by, the reminders to both sides, the sweep's close): src/test/pglite/declutterSellerDeliveryBookBy.pglite.mjs.
 *
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |         {b.status === "needs_time" && bookBy && b.order_status === "paid" && ( |         {false && (
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |   if (!shown && current.status === "needs_time" && current.side === "buyer") { |   if (false) {
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |         <OrderTalkButton orderId={orderId} side="buyer" /> |         {null}
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |   const by = bookBy ? bookByWords(bookBy) : null; |   const by = null;
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |   return needsTime ? (q.data?.find((t) => t.id === orderId)?.book_by ?? null) : null; |   return null;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SellerDeliveryBooking } from "@/lib/declutter/sellerDelivery";

const state = vi.hoisted(() => ({ booking: null as unknown, bookBy: "2026-11-08T23:07:00Z" as string | null }));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async () => ({ no_show_reported_at: null }),
  confirmHandover: async () => {},
  uploadHandoverPhoto: async () => "p.jpg",
  handoverPhotoUrl: async () => null,
}));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchSellerDeliveryBooking: async () => state.booking,
  fetchDeliveryOpenTimes: async () => ({ slots: [], slot_minutes: 60 }),
}));
vi.mock("@/lib/declutter/orderPickupTimes", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/orderPickupTimes")>()),
  fetchOrderPickupTimes: async (ids: string[]) => ids.map((id) => ({ id, book_by: state.bookBy, pickup_slot_start: null, pickup_slot_end: null })),
}));

import { SellerDeliveryOrderPanel } from "./SellerDeliveryOrder";
import { deliveryStanding } from "./DeclutterPorchHandover";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const BASE: SellerDeliveryBooking = {
  order_id: "o", side: "buyer", order_status: "paid", status: "needs_time", slot_start: null, slot_end: null,
  delivery_cents: 800, dropoff_area: "Mid-City", handoff: "leave", dropoff_address: null, proposed_start: null, proposed_by: null,
  proposals_left: 1, delivered_at: null, delivered_photo_path: null, confirmed_at: null, not_delivered_from: null,
};

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}><SellerDeliveryOrderPanel orderId="o" userId="u1" onProblem={() => {}} /></QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("A3-72: a seller delivery with no time says by when, and what happens then", () => {
  beforeEach(() => {
    state.booking = { ...BASE };
    state.bookBy = "2026-11-08T23:07:00Z"; // Sun 11/8, 5:07 PM in Louisiana
  });

  it("the buyer: pick a time by book_by, or the order is cancelled and the full payment refunded", async () => {
    show();
    expect(await screen.findByText("If no time is picked by Sun 11/8, 5:07 PM, the order is cancelled and your full payment is refunded.")).toBeInTheDocument();
  });

  it("the seller is told the same deadline", async () => {
    state.booking = { ...BASE, side: "seller" };
    show();
    expect(await screen.findByText("If the buyer picks no time by Sun 11/8, 5:07 PM, the order is cancelled and they get a full refund.")).toBeInTheDocument();
  });

  it("a booked delivery says no deadline", async () => {
    state.booking = { ...BASE, status: "booked", slot_start: iso(72 * HOUR), slot_end: iso(73 * HOUR), not_delivered_from: iso(73.25 * HOUR) };
    show();
    await screen.findByRole("button", { name: "Report a problem" });
    expect(screen.queryByText(/the order is cancelled/)).toBeNull();
  });

  it("no open times: the buyer is told to message the seller or report a problem, with the Message button", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Pick a time" }));
    expect(await screen.findByText("The seller has no open delivery times right now. Message them to ask for one, or report a problem.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Message the seller" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument();
    expect(screen.queryByText(/No other delivery times are open/)).toBeNull();
  });

  it("the card's next step carries by <book_by> on both sides", () => {
    expect(deliveryStanding("buyer", 0, false, false, null, "2026-11-08T23:07:00Z")).toEqual({ who: "you", text: "Pick a delivery time", by: "by Sun 11/8, 5:07 PM" });
    expect(deliveryStanding("seller", 0, false, false, null, "2026-11-08T23:07:00Z"))
      .toEqual({ who: "them", text: "Paid. Waiting on the buyer to pick a delivery time", by: "by Sun 11/8, 5:07 PM" });
    expect(deliveryStanding("buyer", 0, false).by).toBeNull();
  });
});
