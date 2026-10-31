/**
 * A seller-delivery order's money moments ask in the app, never window.confirm (lead 2026-10-28,
 * DeclutterConfirmSheet): the buyer's "I got it" and "It wasn't delivered". Each opens a sheet with what
 * happens; nothing is called until the sheet's own button, and "Not now" calls nothing. A failed read is an
 * error with a retry, not a grey line.
 * Owner 2026-10-29 (Q2477, "once they pay it can only be rescheduled once. never cancelled."): neither side
 * has a cancel button on a paid delivery (migration 20261030002630 makes both cancel RPCs refuse).
 *
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |         <button type="button" className={btn} onClick={onProblem}>Report a problem</button> |         <button type="button" className={btn}>Cancel order</button><button type="button" className={btn}>Cancel delivery</button><button type="button" className={btn} onClick={onProblem}>Report a problem</button>
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx | onClick={() => setAsk("notDelivered")}>It wasn't delivered</button>} | onClick={() => notDelivered.mutate(undefined)}>It wasn't delivered</button>}
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |   const late = can.notDelivered && !noShowWaiting; |   const late = false;
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx | !late && <button type="button" className={primary} disabled={busy} onClick={() => setAsk("gotIt")}>I got it</button>} | !late && <button type="button" className={primary} disabled={busy} onClick={() => gotIt.mutate(undefined)}>I got it</button>}
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx | title="We couldn't load this delivery." body={sellerDeliveryErrorMessage(booking.error)} onRetry={() => void booking.refetch()} /> | title="We couldn't load this delivery." body={sellerDeliveryErrorMessage(booking.error)} />
 * #7 (deep audit 2026-10-28): before the delivery day the buyer is told when "I got it" comes, and gets no button.
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |         {b.side === "buyer" && !can.gotIt && !problemOpen && b.order_status === "paid" |         {false && b.order_status === "paid"
 * AUD31-38: after "It wasn't delivered", and once the delivery's hour has passed, the buyer is not offered Leave it at my door / Hand it to me.
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |       {can.changeHandoff && !noShowWaiting && ( |       {can.changeHandoff && (
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx | (b.status === "needs_time" \|\| (b.status === "booked" && !slotOver)), | (b.status === "needs_time" \|\| b.status === "booked"),
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |   const slotOver = booked && now >= Date.parse(b.slot_end ?? b.slot_start!); |   const slotOver = booked && now >= Date.parse(b.not_delivered_from ?? b.slot_start!) + 24 * 3_600_000;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SellerDeliveryBooking } from "@/lib/declutter/sellerDelivery";

const state = { booking: null as SellerDeliveryBooking | null, fail: false, calls: [] as string[], photoUrl: "https://signed.test/s1/declutter/handover/o/door.jpg" as string | null };

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const handoverRow = vi.hoisted(() => ({ reported: null as string | null, reads: 0 }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async () => { handoverRow.reads++; return { no_show_reported_at: handoverRow.reported }; },
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

function show(problemOpen?: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SellerDeliveryOrderPanel orderId="o" userId="u1" onProblem={() => {}} problemOpen={problemOpen} /></QueryClientProvider>);
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

  it("AUD31-2: a late delivery leads with It wasn't delivered, then Ask for a new time; I got it comes after", async () => {
    state.booking = { ...BASE, slot_start: iso(-2 * HOUR), slot_end: iso(-1 * HOUR), not_delivered_from: iso(-0.75 * HOUR) };
    show();
    await screen.findByRole("button", { name: "It wasn't delivered" });
    const row = document.querySelector("[data-seller-delivery-actions]")!;
    const names = [...row.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
    expect(names.length).toBeGreaterThan(2);
    expect(names).toEqual(["It wasn't delivered", "Ask for a new time", "I got it", "Report a problem"]);
  });

  // Audit 2026-10-30 DB-8: the notice said the seller took a photo; neither side's card showed it.
  // @mutate src/components/declutter/SellerDeliveryOrder.tsx |       {b.delivered_at && b.delivered_photo_path && <DeliveredPhoto | {false && b.delivered_photo_path && <DeliveredPhoto
  // @mutate src/components/declutter/SellerDeliveryOrder.tsx |       {url.isSuccess && !url.data && <p className="text-xs" role="alert"> |       {false && <p className="text-xs" role="alert">
  // @mutate src/components/declutter/SellerDeliveryOrder.tsx | mine={b.side === "seller"} /> | mine={false} />
  it("DB-8: once delivered, both sides see the seller's photo from the buyer's door, and a link that fails says so", async () => {
    // AUD31-5: the seller's own card says "Your photo"; the buyer's names the seller.
    for (const [side, words] of [["buyer", "The seller's photo of where it was left"], ["seller", "Your photo of where you left it"]] as const) {
      state.booking = { ...BASE, side, delivered_at: iso(-HOUR), delivered_photo_path: "s1/declutter/handover/o/door.jpg" };
      const { unmount } = show();
      const img = await screen.findByAltText(words);
      expect(img).toHaveAttribute("src", "https://signed.test/s1/declutter/handover/o/door.jpg");
      expect(document.querySelector("[data-delivered-photo] figcaption")?.textContent).toMatch(new RegExp(`^${words}, taken \\w{3}, \\w{3} \\d+, \\d+:\\d{2} (AM|PM)$`));
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

// Audit 1030 DB-2 (live run A): with a problem report open, the delivery panel still offered "I got it" (which then
// failed: the server refuses it with problem_open), the "Tap I got it ... 24 hours to report a problem" line and a
// second "Report a problem". While a problem is open the panel offers none of them; the card's note says why.
// @mutate src/components/declutter/SellerDeliveryOrder.tsx | {can.gotIt && !problemOpen && !late && <button | {can.gotIt && !late && <button
// @mutate src/components/declutter/SellerDeliveryOrder.tsx | {problemOpen ? null : b.side === "buyer" ? | {b.side === "buyer" ?
// @mutate src/components/declutter/SellerDeliveryOrder.tsx | {!problemOpen && <button type="button" className={btn} onClick={onProblem}> | {<button type="button" className={btn} onClick={onProblem}>
// @mutate src/components/declutter/SellerDeliveryOrder.tsx | !can.gotIt && !problemOpen && b.order_status | !can.gotIt && b.order_status
describe("DB-2: a problem is open on the delivery", () => {
  beforeEach(() => {
    state.fail = false;
    state.calls = [];
  });

  it("buyer, delivered: I got it, the 24-hour line and Report a problem show without a problem, and are gone with one", async () => {
    state.booking = { ...BASE, delivered_at: iso(-HOUR) };
    const before = show(false);
    expect(await screen.findByRole("button", { name: "I got it" })).toBeInTheDocument();
    expect(screen.getByText(/24 hours to report a problem/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument();
    before.unmount();
    show(true);
    expect(await screen.findByText("Left at the door.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
    expect(screen.queryByText(/24 hours/)).toBeNull();
    expect(screen.queryByText(/Tap "I got it"/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
  });

  it("buyer, before the delivery day: no promise of I got it while a problem is open", async () => {
    state.booking = { ...BASE };
    const before = show(false);
    expect(await screen.findByText("You can confirm you got it from the delivery day.")).toBeInTheDocument();
    before.unmount();
    show(true);
    await screen.findByText(/^Delivery /);
    expect(screen.queryByText("You can confirm you got it from the delivery day.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
  });

  it("seller, delivered: not told they are paid in about 48 hours while a problem is open, and no second report", async () => {
    state.booking = { ...BASE, side: "seller", handoff: "hand", delivered_at: iso(-HOUR), dropoff_address: "500 Drop Rd" };
    const before = show(false);
    expect(await screen.findByText(/We asked the buyer to confirm. If they say nothing, you're paid in about 48 hours/)).toBeInTheDocument();
    before.unmount();
    show(true);
    expect(await screen.findByText("Handed over.")).toBeInTheDocument();
    expect(screen.queryByText(/you're paid in about 48 hours/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
  });

  it("review of 7496d29c8b #2: during the 24 hours after 'It wasn't delivered' nobody can ask for or accept a new time", async () => {
    state.booking = { ...BASE, side: "buyer", proposed_start: iso(96 * HOUR), proposed_by: "seller" };
    handoverRow.reported = null;
    const before = show();
    expect(await screen.findByRole("button", { name: "Accept the new time" })).toBeInTheDocument();
    before.unmount();
    handoverRow.reported = "2026-10-30T12:00:00Z";
    handoverRow.reads = 0;
    show();
    expect(await screen.findByRole("button", { name: "Keep the current time" })).toBeInTheDocument();
    await vi.waitFor(() => expect(handoverRow.reads).toBeGreaterThan(0));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: "Accept the new time" })).toBeNull();
    state.booking = { ...BASE, side: "buyer" };
    handoverRow.reported = null;
  });

  it("during the seller's 24 hours, It wasn't delivered and the seller's Delivered are gone; both show without a report", async () => {
    const pastDue = { slot_start: iso(-3 * HOUR), slot_end: iso(-2 * HOUR), not_delivered_from: iso(-HOUR) };
    const frozenAfterRead = async () => {
      handoverRow.reads = 0;
      handoverRow.reported = "2026-10-30T12:00:00Z";
      const view = show();
      await vi.waitFor(() => expect(handoverRow.reads).toBeGreaterThan(0));
      await act(async () => { await Promise.resolve(); });
      return view;
    };

    state.booking = { ...BASE, ...pastDue, side: "buyer" };
    handoverRow.reported = null;
    const buyerBefore = show();
    expect(await screen.findByRole("button", { name: "It wasn't delivered" })).toBeInTheDocument();
    buyerBefore.unmount();
    const buyerDuring = await frozenAfterRead();
    expect(screen.queryByRole("button", { name: "It wasn't delivered" })).toBeNull();
    buyerDuring.unmount();

    state.booking = { ...BASE, ...pastDue, side: "seller" };
    handoverRow.reported = null;
    const sellerBefore = show();
    expect(await screen.findByRole("button", { name: "Delivered" })).toBeInTheDocument();
    sellerBefore.unmount();
    await frozenAfterRead();
    expect(screen.queryByRole("button", { name: "Delivered" })).toBeNull();

    state.booking = { ...BASE, side: "buyer" };
    handoverRow.reported = null;
  });

  it("AUD31-38: the door-or-hand choice shows for a delivery to come, and is gone once its hour passed and after It wasn't delivered", async () => {
    const pastDue = { slot_start: iso(-3 * HOUR), slot_end: iso(-2 * HOUR), not_delivered_from: iso(-HOUR) };
    const choice = () => screen.queryByRole("radiogroup", { name: "When the seller arrives" });
    state.booking = { ...BASE, side: "buyer" };
    handoverRow.reported = null;
    const ahead = show();
    expect(await screen.findByRole("radiogroup", { name: "When the seller arrives" })).toBeInTheDocument();
    ahead.unmount();

    state.booking = { ...BASE, ...pastDue, side: "buyer" };
    const late = show();
    expect(await screen.findByRole("button", { name: "It wasn't delivered" })).toBeInTheDocument();
    expect(choice()).toBeNull();
    late.unmount();

    state.booking = { ...BASE, side: "buyer" };
    handoverRow.reads = 0;
    handoverRow.reported = "2026-10-30T12:00:00Z";
    show();
    await screen.findByRole("button", { name: /Ask for a new time|Pick a time|Report a problem/ });
    await vi.waitFor(() => expect(handoverRow.reads).toBeGreaterThan(0));
    await act(async () => { await Promise.resolve(); });
    expect(choice()).toBeNull();
    state.booking = { ...BASE, side: "buyer" };
    handoverRow.reported = null;
  });
});
