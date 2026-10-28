/**
 * A seller-delivery order's money moments ask in the app, never window.confirm (lead 2026-10-28,
 * DeclutterConfirmSheet): the buyer's "I got it", "It wasn't delivered" and "Cancel order", the seller's
 * "Cancel delivery". Each opens a sheet with what happens; nothing is called until the sheet's own button, and
 * "Keep ..." / "Not now" calls nothing. A failed read is an error with a retry, not a grey line.
 *
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |             onClick={() => setAsk("buyerCancel")}> |             onClick={() => buyerCancel.mutate(undefined)}>
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |             onClick={() => setAsk("sellerCancel")}> |             onClick={() => sellerCancel.mutate(undefined)}>
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |             onClick={() => setAsk("notDelivered")}> |             onClick={() => notDelivered.mutate(undefined)}>
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx | onClick={() => setAsk("gotIt")}>I got it</button>} | onClick={() => gotIt.mutate(undefined)}>I got it</button>}
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx | title="We couldn't load this delivery." body={sellerDeliveryErrorMessage(booking.error)} onRetry={() => void booking.refetch()} /> | title="We couldn't load this delivery." body={sellerDeliveryErrorMessage(booking.error)} />
 * #7 (deep audit 2026-10-28): before the delivery day the buyer is told when "I got it" comes, and gets no button.
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |         {b.side === "buyer" && !can.gotIt && b.order_status === "paid" |         {false && b.order_status === "paid"
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SellerDeliveryBooking } from "@/lib/declutter/sellerDelivery";

const state = { booking: null as SellerDeliveryBooking | null, fail: false, calls: [] as string[] };

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/declutter/handover", () => ({
  confirmHandover: async () => { state.calls.push("got_it"); },
  uploadHandoverPhoto: async () => "p.jpg",
}));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchSellerDeliveryBooking: async () => {
    if (state.fail) throw new Error("boom");
    return state.booking;
  },
  reportNotDelivered: async () => { state.calls.push("not_delivered"); },
  buyerCancelDelivery: async () => { state.calls.push("buyer_cancel"); },
  sellerCancelDelivery: async () => { state.calls.push("seller_cancel"); },
  fetchDeliveryOpenTimes: async () => [],
}));

import { SellerDeliveryOrderPanel } from "./SellerDeliveryOrder";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const BASE: SellerDeliveryBooking = {
  order_id: "o", side: "buyer", order_status: "paid", status: "booked", slot_start: iso(72 * HOUR), slot_end: iso(73 * HOUR),
  delivery_cents: 2000, dropoff_area: "Mid-City", handoff: "leave", dropoff_address: null, proposed_start: null, proposed_by: null,
  proposals_left: 3, delivered_at: null, delivered_photo_path: null, confirmed_at: null, not_delivered_from: iso(73.25 * HOUR),
};

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SellerDeliveryOrderPanel orderId="o" userId="u1" onProblem={() => {}} /></QueryClientProvider>);
}

async function askAndConfirm(button: string, title: RegExp, confirm: string, call: string) {
  fireEvent.click(await screen.findByRole("button", { name: button }));
  const sheet = await screen.findByRole("dialog");
  expect(sheet).toHaveTextContent(title);
  expect(state.calls).toEqual([]);
  fireEvent.click(within(sheet).getByRole("button", { name: confirm }));
  await waitFor(() => expect(state.calls).toEqual([call]));
}

describe("seller-delivery order: the money moments ask in the app", () => {
  beforeEach(() => {
    state.booking = { ...BASE };
    state.fail = false;
    state.calls = [];
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("buyer: Cancel order asks first; Keep the order calls nothing", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Cancel this order?");
    expect(sheet).toHaveTextContent("Most of what you paid comes back.");
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep the order" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.getByRole("button", { name: "Cancel order" })).toBeEnabled(); });
    expect(state.calls).toEqual([]);
    await askAndConfirm("Cancel order", /Cancel this order\?/, "Cancel order", "buyer_cancel");
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("#7: before the delivery day there is no I got it, only when it can be tapped", async () => {
    show();
    expect(await screen.findByText("You can confirm you got it from the delivery day.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
  });

  it("buyer: I got it says the seller is paid, and asks first", async () => {
    state.booking = { ...BASE, delivered_at: iso(-HOUR) };
    show();
    await askAndConfirm("I got it", /Do you have it\?.*the seller is paid/, "I got it", "got_it");
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("buyer, after the hour: It wasn't delivered asks first", async () => {
    state.booking = { ...BASE, slot_start: iso(-2 * HOUR), slot_end: iso(-1 * HOUR), not_delivered_from: iso(-0.75 * HOUR) };
    show();
    await askAndConfirm("It wasn't delivered", /It wasn't delivered\?.*everything back/, "It wasn't delivered", "not_delivered");
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("seller: Cancel delivery names the strike and the payout, and asks first", async () => {
    state.booking = { ...BASE, side: "seller" };
    show();
    await askAndConfirm("Cancel delivery", /Cancel this delivery\?.*Declutter strike.*next payout/, "Cancel delivery", "seller_cancel");
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("a failed read is an error with a retry", async () => {
    state.fail = true;
    show();
    expect(await screen.findByText("We couldn't load this delivery.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
