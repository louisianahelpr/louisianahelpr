/**
 * A seller-delivery order's money moments ask in the app, never window.confirm (lead 2026-10-28,
 * DeclutterConfirmSheet): the buyer's "I got it" and "It wasn't delivered". Each opens a sheet with what
 * happens; nothing is called until the sheet's own button, and "Not now" calls nothing. A failed read is an
 * error with a retry, not a grey line.
 * Owner 2026-10-29 (Q2477, "once they pay it can only be rescheduled once. never cancelled."): neither side
 * has a cancel button on a paid delivery (migration 20261030002630 makes both cancel RPCs refuse).
 *
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |         <button type="button" className={btn} onClick={onProblem}>Report a problem</button> |         <button type="button" className={btn}>Cancel order</button><button type="button" className={btn}>Cancel delivery</button><button type="button" className={btn} onClick={onProblem}>Report a problem</button>
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

const state = { booking: null as SellerDeliveryBooking | null, fail: false, calls: [] as string[], photoUrl: "https://signed.test/s1/declutter/handover/o/door.jpg" as string | null };

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/declutter/handover", () => ({
  confirmHandover: async () => { state.calls.push("got_it"); },
  uploadHandoverPhoto: async () => "p.jpg",
  handoverPhotoUrl: async () => state.photoUrl,
}));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchSellerDeliveryBooking: async () => {
    if (state.fail) throw new Error("boom");
    return state.booking;
  },
  reportNotDelivered: async () => { state.calls.push("not_delivered"); },
  fetchDeliveryOpenTimes: async () => [],
  // Anti-lying #1 (20261028235709): the "left at your door" photo carries where it was taken.
  deliveryPhotoPosition: async () => ({ lat: 30.5, lng: -91.15 }),
  markDelivered: async (...a: unknown[]) => { state.calls.push(JSON.stringify(["delivered", ...a])); },
}));

import { SellerDeliveryOrderPanel } from "./SellerDeliveryOrder";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const BASE: SellerDeliveryBooking = {
  order_id: "o", side: "buyer", order_status: "paid", status: "booked", slot_start: iso(72 * HOUR), slot_end: iso(73 * HOUR),
  delivery_cents: 2000, dropoff_area: "Mid-City", handoff: "leave", dropoff_address: null, proposed_start: null, proposed_by: null,
  proposals_left: 1, delivered_at: null, delivered_photo_path: null, confirmed_at: null, not_delivered_from: iso(73.25 * HOUR),
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
    state.photoUrl = "https://signed.test/s1/declutter/handover/o/door.jpg";
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("owner 2026-10-29: a paid delivery has no cancel for either side, only a new time and Report a problem", async () => {
    for (const side of ["buyer", "seller"] as const) {
      state.booking = { ...BASE, side };
      const { unmount } = show();
      expect(await screen.findByRole("button", { name: "Report a problem" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ask for a new time" })).toBeInTheDocument();
      expect(screen.queryAllByRole("button").map((b) => b.textContent ?? "").filter((t) => /cancel/i.test(t))).toEqual([]);
      unmount();
    }
  });

  // Anti-lying #1 (20261028235709): the seller's "left at your door" photo is sent with the device's position, which
  // the server checks against the buyer's drop-off point.
  // @mutate src/components/declutter/SellerDeliveryOrder.tsx |     const where = photo ? await deliveryPhotoPosition() : null; |     const where = null;
  it("seller: the \"Delivered\" photo is sent with where it was taken", async () => {
    state.booking = { ...BASE, side: "seller", slot_start: iso(-HOUR), slot_end: iso(0), dropoff_address: "500 Drop Rd" };
    show();
    const input = await screen.findByLabelText(/Photo of the items at the buyer's door/);
    fireEvent.change(input, { target: { files: [new File(["x"], "door.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Delivered" }));
    await waitFor(() => expect(state.calls).toEqual([JSON.stringify(["delivered", "o", "p.jpg", { lat: 30.5, lng: -91.15 }])]));
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

  // Audit 2026-10-30 DB-8: the notice said the seller took a photo; neither side's card showed it.
  // @mutate src/components/declutter/SellerDeliveryOrder.tsx |       {b.delivered_at && b.delivered_photo_path && <DeliveredPhoto | {false && b.delivered_photo_path && <DeliveredPhoto
  // @mutate src/components/declutter/SellerDeliveryOrder.tsx |       {url.isSuccess && !url.data && <p className="text-xs" role="alert"> |       {false && <p className="text-xs" role="alert">
  it("DB-8: once delivered, both sides see the seller's photo from the buyer's door, and a link that fails says so", async () => {
    for (const side of ["buyer", "seller"] as const) {
      state.booking = { ...BASE, side, delivered_at: iso(-HOUR), delivered_photo_path: "s1/declutter/handover/o/door.jpg" };
      const { unmount } = show();
      const img = await screen.findByAltText("The seller's photo of where it was left");
      expect(img).toHaveAttribute("src", "https://signed.test/s1/declutter/handover/o/door.jpg");
      expect(document.querySelector("[data-delivered-photo] figcaption")?.textContent).toMatch(/^The seller's photo of where it was left, taken \w{3}, \w{3} \d+, \d+:\d{2} (AM|PM)$/);
      unmount();
    }
    state.booking = { ...BASE, handoff: "hand", delivered_at: iso(-HOUR), delivered_photo_path: "s1/declutter/handover/o/door.jpg" };
    state.photoUrl = null;
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("The photo couldn't load.");
    expect(document.querySelector("[data-delivered-photo] figcaption")).toHaveTextContent(/^The seller's photo of the handover, taken /);
    expect(document.querySelector("[data-delivered-photo] img")).toBeNull();
  });

  it("DB-8: no photo before it is delivered, nor when the seller handed it over without one", async () => {
    state.booking = { ...BASE, delivered_photo_path: null, delivered_at: iso(-HOUR), handoff: "hand" };
    show();
    await screen.findByText(/Handed over\./);
    expect(document.querySelector("[data-delivered-photo]")).toBeNull();
  });

  it("a failed read is an error with a retry", async () => {
    state.fail = true;
    show();
    expect(await screen.findByText("We couldn't load this delivery.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
