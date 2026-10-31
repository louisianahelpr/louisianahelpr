/**
 * The screens of Declutter slice 4 (docs/specs/declutter-auctions.md rows 25-28, 45,
 * 93-99; B49-B58): what each paid-order STATE renders, in plain words, and
 * which call each button makes. The API module is stubbed; the backend proof
 * is src/test/pglite/declutterSlice4.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.side === "seller" && !problem && buyerOnWayToday(booking) && ( |           {false && (
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.side === "seller" && !problem && buyerOnWayToday(booking) && ( |           {!problem && buyerOnWayToday(booking) && (
 * @mutate src/lib/declutter/pickupDay.ts |   return !!booking?.buyer_on_way_at && ymd(new Date(booking.buyer_on_way_at)) === ymd(now); |   return !!booking?.buyer_on_way_at;
 * @mutate src/components/declutter/DeclutterNoShowAnswer.tsx |   if (Date.now() < new Date(slotStart).getTime() + 15 * 60_000) return null; |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {booking?.slot_start && <HandoverPanel order={order} userId={userId} slotStart={booking.slot_start} pickupDay={booking.pickup_day ?? null} anyProblem={!!problem} who={who} problemOpen={!!problem && problem.reporter_side !== "system"} onProblem={() => { setAtHandover(true); setProblemOpen(true); }} />} |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     if (order.handover !== "pickup_home" && order.handover !== "meetup") { |     if (true) {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     if (Date.now() < new Date(slotStart).getTime()) { |     if (false) {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.handover === "pickup_home" && !problem && !noShowWaiting && <DoorPickupTips side={order.side} />} |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (!booked && order.side === "seller") { |   if (false) {
 * @mutate src/components/declutter/paidOrders.ts |     if (l.status !== "paid" \|\| !l.order_id) continue; |     if (!l.order_id) continue;
 * @mutate src/components/declutter/DeclutterOrderBits.tsx |     queries: lines.map((l) => ({ |     queries: lines.slice(0, 1).map((l) => ({
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       ) : order.handover === "delivery" ? ( |       ) : false ? (
 */
// @mutate src/components/declutter/DeclutterFoldedTime.tsx |       <DateTimeField id={id} label={fieldLabel} value={value} onChange={setValue} /> |       <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
// @mutate src/components/declutter/DeclutterPorchHandover.tsx |     out: !!h.data?.set_out_at, |     out: false,
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | day={booking?.pickup_day ?? null}\n          itemsCents={items} | day={booking?.pickup_day ?? null}\n          itemsCents={order.lines[0]?.total_cents ?? 0}
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  bookings: [] as unknown[],
  payouts: [] as unknown[],
  calls: [] as unknown[][],
  handover: null as Record<string, unknown> | null,
  /** Deep audit #2: the seller's windows for the order (declutter_order_pickup_windows); null = not deployed. */
  windows: null as { windows: { weekday: number; starts: string; ends: string }[]; latestPickupAt: string | null } | null,
  /** Q2425: the spot frozen on a meetup order (declutter_order_meetups). */
  meetup: null as Record<string, unknown> | null,
  /** Hidden switches on for this test (none by default, as before this mock). */
  features: [] as string[],
  /** Porch DAYS the buyer may pick (declutter_porch_days); null = the migration is not live (the time picker). */
  porchDays: null as string[] | null,
  /** A1-B2: declutter_my_paid_cents per order (the card charge); absent = no answer yet. */
  paid: {} as Record<string, number>,
  /** Audit 1b D2-2: the open problems both sides read (declutter_problems, status open). */
  problems: [] as unknown[],
  /** D2-7: whether the server takes problem photos (problemPhotos.ts; off until it does). */
  problemPhotos: false,
  /** DC-16: the seller-delivery booking the card's tracker reads (declutter_seller_delivery_booking); null = none yet. */
  sd: null as Record<string, unknown> | null,
  /** DB-12: the order's newest problem as declutter_order_problem returns it (decision once decided). */
  orderProblem: null as Record<string, unknown> | null,
};
// The porch places reads (D-NEW14; proved in porchPlacesUi.test.tsx): none saved.
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
vi.mock("@/lib/declutter/sellerDelivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchSellerDeliveryBooking: async () => state.sd,
}));
vi.mock("@/lib/declutter/problemPhotos", () => ({
  PROBLEM_PHOTO_MAX: 3,
  get PROBLEM_FORM_PHOTOS_READY() { return state.problemPhotos; },
  REFUND_FORM_PHOTOS_READY: false,
}));

vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => state.features.includes(key) }));
// Board 141's refund panel has its own test; here a stub says whether the card offers it.
// It renders the problem form the card hands it, so the card's choice to hand one (D2-2) is visible here.
// NIGHT-SELL-soldstates-7: a handed-over card reads the refund request (refundedInFull) on both sides.
vi.mock("@/lib/declutter/refundRequests", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/refundRequests")>()),
  fetchRefundRequestView: async (orderId: string) => ({ order_id: orderId, side: "seller", handed_over: true, full_refund_cents: 0, request: null }),
}));
vi.mock("./DeclutterRefundRequest", () => ({ DeclutterRefundPanel: ({ problemForm }: { problemForm: import("react").ReactNode }) => <div><p>Refund panel</p>{problemForm}</div> }));

// The shared day + time pickers are exercised in their own tests; here a plain input stands in, same value shape.
vi.mock("@/components/DateTimeField", () => ({
  DateTimeField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me" } }) }));
// Anti-lying #1 (20261028235709): every handover photo carries the device's position (the server checks the place).
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => ({ lat: 30.45, lng: -91.15 }) }));
vi.mock("@/lib/declutter/paidCents", () => ({
  fetchMyPaidCents: async (ids: string[]) => new Map(ids.filter((id) => id in state.paid).map((id) => [id, state.paid[id]])),
}));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyBookings: async () => state.bookings,
  fetchMyPayouts: async () => state.payouts,
  fetchOpenProblems: async () => state.problems,
  fetchOrderProblem: async () => state.orderProblem,
  fetchMyHandover: async (orderId: string) => ({ order_id: orderId, status: "paid", side: "buyer", confirmed_at: null, set_out_at: null, set_out_photo_path: null, picked_up_at: null, ...state.handover }),
  handoverPhotoUrl: async (path: string) => `https://signed.test/${path}`,
  fetchOrderPickupWindows: async () => state.windows,
  fetchItemAddress: async (itemId: string) => ({
    pickup_address: itemId === "i2" ? "9 Far Rd, Baton Rouge" : "1234 Example St, Baton Rouge", pickup_lat: 30.45, pickup_lng: -91.15,
  }),
  bookPickup: async (...a: unknown[]) => { state.calls.push(["book", ...a]); return { result: "booked" }; },
  fetchPorchDays: async () => state.porchDays,
  bookPorchDay: async (...a: unknown[]) => { state.calls.push(["book_day", ...a]); return { result: "booked" }; },
  confirmHandover: async (...a: unknown[]) => { state.calls.push(["confirm", ...a]); return { result: "handed_over" }; },
  sellerPickedUp: async (...a: unknown[]) => { state.calls.push(["seller_picked_up", ...a]); return { result: "handed_over" }; },
  setPorchTime: async (...a: unknown[]) => { state.calls.push(["porch_time", ...a]); },
  porchPhoto: async (...a: unknown[]) => { state.calls.push(["porch_photo", ...a]); return { result: "set_out" }; },
  porchNote: async (...a: unknown[]) => { state.calls.push(["porch_note", ...a]); return a[1]; },
  uploadHandoverPhoto: async () => "me/declutter/handover/o1/x.jpg",
  uploadProblemPhoto: async (orderId: string, f: File) => { state.calls.push(["problem_photo", orderId, f.name]); return `me/declutter/problem/${orderId}/${f.name}`; },
  reportNoShow: async (...a: unknown[]) => { state.calls.push(["no_show", ...a]); return { result: "rebook_offered" }; },
  reportProblem: async (...a: unknown[]) => { state.calls.push(["problem", ...a]); return "p1"; },
  leaveReview: async (...a: unknown[]) => { state.calls.push(["review", ...a]); return "r1"; },
}));

// Q2425: the meetup reads and the check-in.
vi.mock("@/lib/declutter/meetup", () => ({
  fetchOrderMeetup: async () => state.meetup,
  meetupHere: async (...a: unknown[]) => { state.calls.push(["here", ...a]); return "here"; },
  meetupMapUrl: (m: { spot_lat: number; spot_lng: number }) => `https://maps.apple.com/?ll=${m.spot_lat},${m.spot_lng}`,
  chooseMeetupSpot: async () => undefined,
}));

// Boards 159/160 name the other person; the name read has its own test (declutterReviewForm.test.tsx).
vi.mock("./useOrderOtherPerson", () => ({ useOrderOtherPerson: () => ({ otherId: "u2", name: "Dana R", avatarUrl: null, first: "Dana", who: "Dana" }) }));

// Board 163: the review sheet has its own test (declutterReviewForm.test.tsx).
vi.mock("./DeclutterReviewForm", () => ({
  DeclutterReviewForm: ({ orderId, side, userId }: { orderId: string; side: string; userId: string }) => <p>Review {orderId} as the {side} ({userId})</p>,
}));

// Slice 5: the delivery card has its own test (declutterDeliveryViews.test.tsx).
vi.mock("./DeclutterDeliveryViews", () => ({
  // BUY-22: the real panel shows "Report a problem" once the Helpr has it (deliveryProblemWaits.test.tsx); here, a task that has.
  OrderDeliveryPanel: ({ taskId, side, tipOnly, problemForm }: { taskId: string; side: string; tipOnly?: boolean; problemForm?: boolean }) =>
    <><p>{tipOnly ? `Tip panel ${taskId}` : `Delivery card ${taskId}`} for the {side}</p>{problemForm && <button type="button">Report a problem</button>}</>,
}));

// Seller delivery's own panel has its own test (sellerDeliveryOrder.test.tsx); this stub keeps its one
// "Report a problem" button, which opens the card's problem form (#51), and says whether the card told it a problem
// is open (DB-2; what the panel hides then is in sellerDeliveryOrder.test.tsx).
vi.mock("./SellerDeliveryOrder", () => ({
  SellerDeliveryOrderPanel: ({ onProblem, problemOpen }: { onProblem: () => void; problemOpen?: boolean }) => (
    <div><p>Seller delivery panel{problemOpen ? ", problem open" : ""}</p><button type="button" onClick={onProblem}>Report a problem</button></div>
  ),
}));

import { MemoryRouter } from "react-router-dom";
import { PaidOrdersSection } from "./DeclutterHandoverViews";
import { pickupDays } from "@/lib/declutter/pickupSlots";

function show(cart: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><PaidOrdersSection cart={cart as never} /></QueryClientProvider></MemoryRouter>);
}
const line = (over: Record<string, unknown> = {}) => ({
  line_id: "l1", item_id: "i1", item_title: "Oak chair", my_side: "buyer", seller_id: "s1", price_cents: 4000, status: "paid",
  checkout_by: "2026-10-16T00:00:00Z", order_id: "o1", order_status: "paid", handover: "pickup_home", premium_cents: 270, total_cents: 4270, ...over,
});
const slot = (minsAgo: number) => ({
  order_id: "o1", slot_start: new Date(Date.now() - minsAgo * 60_000).toISOString(),
  slot_end: new Date(Date.now() - minsAgo * 60_000 + 30 * 60_000).toISOString(), porch_mode: null, porch_until: null,
});

describe("the seller's order card, I'm on my way (D-NEW11)", () => {
  // Waiting for this line proves the booking has loaded, so the "not shown" checks below are not vacuous.
  const bookingShown = () => screen.findByText(/You can tap "I'm here" from an hour before the meeting time/);
  const said = () => document.querySelector("[data-buyer-on-way]");
  beforeEach(() => {
    state.calls = [];
    state.payouts = [];
    state.handover = null;
    state.meetup = { order_id: "o1", spot_name: "BRPD Safe Exchange Zone", spot_address: "9000 Airline Hwy, Baton Rouge",
      spot_lat: 30.46, spot_lng: -91.14, buyer_here_at: null, seller_here_at: null };
  });

  it("says the buyer is on the way on the seller's card, not on the buyer's own", async () => {
    state.bookings = [{ ...slot(-180), buyer_on_way_at: new Date().toISOString() }];
    const { unmount } = show([line({ handover: "meetup", my_side: "seller" })]);
    await bookingShown();
    expect(said()?.textContent).toBe("Your buyer is on the way.");
    unmount();
    show([line({ handover: "meetup", my_side: "buyer" })]);
    await bookingShown();
    expect(said()).toBeNull();
  });

  it("an I'm on my way from an earlier day says nothing today, and neither does none", async () => {
    state.bookings = [{ ...slot(-180), buyer_on_way_at: new Date(Date.now() - 2 * 24 * 3600e3).toISOString() }];
    const { unmount } = show([line({ handover: "meetup", my_side: "seller" })]);
    await bookingShown();
    expect(said()).toBeNull();
    unmount();
    state.bookings = [slot(-180)];
    show([line({ handover: "meetup", my_side: "seller" })]);
    await bookingShown();
    expect(said()).toBeNull();
  });
});

describe("Q2425: a safe-spot meetup order", () => {
  beforeEach(() => {
    state.calls = [];
    state.payouts = [];
    state.handover = null;
    state.meetup = { order_id: "o1", spot_name: "BRPD Safe Exchange Zone", spot_address: "9000 Airline Hwy, Baton Rouge",
      spot_lat: 30.46, spot_lng: -91.14, buyer_here_at: null, seller_here_at: null };
  });

  it("the buyer sees the public spot and a map link, never the seller's home address; I'm here from an hour before", async () => {
    state.bookings = [slot(-30)]; // the meeting is in 30 minutes
    show([line({ handover: "meetup" })]);
    expect(await screen.findByText("BRPD Safe Exchange Zone")).toBeInTheDocument();
    expect(document.querySelector("[data-order-head] p + p")?.textContent).toBe("Meet at a safe spot");
    expect(screen.getByRole("link", { name: /Open in Maps/ }).getAttribute("href")).toContain("30.46,-91.14");
    // @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.side === "buyer" && order.handover !== "meetup" && <PickupAddresses lines={order.lines} />} |           {order.side === "buyer" && <PickupAddresses lines={order.lines} />}
    // Let every read on the card settle before asserting the address is absent.
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText(/1234 Example St/)).toBeNull();
    expect(screen.getByText("The seller hasn't checked in yet.", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I'm here" }));
    await waitFor(() => expect(state.calls).toContainEqual(["here", "o1"]));
  });

  it("more than an hour before: no I'm here button yet; the seller can mark it Picked up once the time comes", async () => {
    state.bookings = [slot(-180)];
    show([line({ handover: "meetup", my_side: "seller" })]);
    expect(await screen.findByText(/You can tap "I'm here" from an hour before the meeting time/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I'm here" })).toBeNull();
  });

  // Audit 1028 D1-13: before a time is booked, only the buyer is told to book one; the seller waits to be told.
  // @mutate src/components/declutter/DeclutterMeetup.tsx | : side === "buyer" ? "Book a time to meet first." : "The buyer books the time; we'll tell you."} | : "Book a time to meet first."}
  it("no time booked yet: the buyer is told to book one, the seller that the buyer books it (D1-13)", async () => {
    state.bookings = [];
    const { unmount } = show([line({ handover: "meetup", my_side: "seller" })]);
    expect(await screen.findByText("The buyer books the time; we'll tell you.")).toBeInTheDocument();
    expect(screen.queryByText("Book a time to meet first.")).toBeNull();
    unmount();
    show([line({ handover: "meetup" })]);
    expect(await screen.findByText("Book a time to meet first.")).toBeInTheDocument();
  });

  it("at the meeting time the seller gets Picked up, as at the door", async () => {
    state.bookings = [slot(5)];
    show([line({ handover: "meetup", my_side: "seller" })]);
    expect(await screen.findByRole("button", { name: "Picked up" })).toBeInTheDocument();
  });

  // Audit 1030 DB-3 (live run B): the buyer's "I got it" at a meeting spot worked days before the meeting, which
  // handed the order over and started the seller's payout clock. It now opens an hour before, as "I'm here" does
  // (the server refuses it before then: got_it_too_early, src/test/declutterMeetupGotItWaits.test.ts). A door pickup
  // gets the same gate (lead decision 2026-10-30: the same payout-clock risk).
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if ((order.handover === "meetup" \|\| order.handover === "pickup_home") && !gotItOpen(slotStart)) { |   if (false && !gotItOpen(slotStart)) {
  // @mutate src/components/declutter/OrderSteps.tsx |   return Number.isFinite(t) && now >= t - GOT_IT_OPENS_MINUTES_BEFORE * 60_000; |   return Number.isFinite(t) && now >= t - 24 * 60 * 60_000;
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | (order.handover === "meetup" \|\| order.handover === "pickup_home") && !gotItOpen(slotStart) | (order.handover === "meetup") && !gotItOpen(slotStart)
  for (const [handover, words] of [["meetup", "meeting"], ["pickup_home", "pickup"]] as const) {
    it(`DB-3: the buyer's I got it waits until an hour before the ${words} time (${handover})`, async () => {
      for (const [minsAgo, shown] of [[-180, false], [-61, false], [-59, true], [10, true]] as const) {
        state.bookings = [slot(minsAgo)];
        const { unmount } = show([line({ handover })]);
        if (shown) {
          expect(await screen.findByRole("button", { name: "I got it" })).toBeInTheDocument();
        } else {
          expect(await screen.findByText(`You can tap "I got it" from an hour before the ${words} time.`)).toBeInTheDocument();
          expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
        }
        unmount();
      }
    });
  }
});

describe("Declutter slice 4: paid-order cards", () => {
  beforeEach(() => {
    state.bookings = [];
    state.payouts = [];
    state.calls = [];
    state.handover = null;
    state.porchDays = null;
    state.windows = null;
    // Boards 159/160: every handover moment is a sheet; a browser confirm() is a failure.
    vi.spyOn(window, "confirm").mockImplementation(() => { throw new Error("window.confirm used"); });
  });

  it("an unpaid cart shows nothing (inventory: only paid lines become cards)", async () => {
    const { container } = show([line({ status: "in_cart", order_status: null })]);
    await new Promise((r) => setTimeout(r, 10));
    expect(container.textContent).toBe("");
  });

  it("slice 5: a delivery order shows the delivery card, never a booking, the address or a no-show button", async () => {
    show([line({ handover: "delivery", delivery_task_id: "t1", delivery_cents: 2400 })]);
    expect(await screen.findByText("Delivery card t1 for the buyer")).toBeInTheDocument();
    expect(document.querySelector("[data-order-head] p + p")?.textContent).toBe("Helpr delivery");
    expect(screen.queryByLabelText("Pick a pickup time")).toBeNull();
    expect(screen.queryByText("1234 Example St, Baton Rouge")).toBeNull();
    expect(screen.queryByRole("button", { name: "They didn't show" })).toBeNull();
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument();
  });

  // Audit 2026-10-28 A3-1: after "I got it" the order is handed_over; the tip must stay on the card.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {done && order.side === "buyer" && order.handover === "delivery" && order.deliveryTaskId && <Suspense |       {false && <Suspense
  it("a handed-over Helpr delivery keeps the buyer's tip panel; the seller gets none (A3-1)", async () => {
    const done = line({ handover: "delivery", delivery_task_id: "t1", delivery_cents: 2400, order_status: "handed_over" });
    const { unmount } = show([done]);
    expect(await screen.findByText("Tip panel t1 for the buyer")).toBeInTheDocument();
    expect(screen.getByText("Handed over.")).toBeInTheDocument();
    expect(screen.queryByText(/Delivery card/)).toBeNull();
    unmount();
    show([{ ...done, my_side: "seller" }]);
    expect(await screen.findByText("Handed over.")).toBeInTheDocument();
    expect(screen.queryByText(/Tip panel/)).toBeNull();
  });

  it("the buyer sees the address and books the pickup; the seller waits for the buyer (rows 14, 98)", async () => {
    const { unmount } = show([line()]);
    expect(await screen.findByText("1234 Example St, Baton Rouge")).toBeInTheDocument();
    // Q2432: the buyer is told about the 1-hour reminder and the existing no-show rule, in one line, no money words.
    // @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {order.side === "buyer" && ( |       {false && (
    const warn = screen.getByTestId("declutter-no-show-warning");
    expect(warn).toHaveTextContent("We'll remind you 1 hour before.");
    expect(warn).toHaveTextContent("a second miss cancels the sale with a strike");
    expect(warn.textContent).not.toMatch(/\$|fee|refund/i);
    fireEvent.change(screen.getByLabelText("Pick a pickup time"), { target: { value: "2026-10-20T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Book" }));
    await waitFor(() => expect(state.calls[0]?.[0]).toBe("book"));
    unmount();
    show([line({ my_side: "seller" })]);
    expect(await screen.findByText(/Waiting for the buyer to book a pickup time/)).toBeInTheDocument();
    expect(screen.queryByTestId("declutter-no-show-warning")).toBeNull();
  });

  // B48 live check 2026-10-29: a safe-spot meetup's seller card said "book a pickup time".
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | {order.handover === "meetup" ? "a time to meet" : "a pickup time"} | a pickup time
  it("meetup: the seller waits for the buyer to book a time to meet", async () => {
    show([line({ my_side: "seller", handover: "meetup" })]);
    expect(await screen.findByText(/Waiting for the buyer to book a time to meet/)).toBeInTheDocument();
    expect(screen.queryByText(/book a pickup time/)).toBeNull();
  });

  // Deep audit #25: each side moves a booked time once; after that the Move control is gone and the card says so.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const movedAlready = !!booked && | const movedAlready = false &&
  it("after a side has moved the pickup once, it is no longer offered Move", async () => {
    state.bookings = [{ ...slot(-24 * 60), buyer_reschedules: 1, seller_reschedules: 0 }];
    const { unmount } = show([line()]);
    expect(await screen.findByTestId("declutter-move-used")).toHaveTextContent("You've already moved this pickup once.");
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
    unmount();
    state.bookings = [{ ...slot(-24 * 60), buyer_reschedules: 0, seller_reschedules: 0 }];
    show([line()]);
    // Deep audit #32: the move picker is folded behind one button until it is wanted.
    fireEvent.click(await screen.findByRole("button", { name: "Move the pickup" }));
    expect(screen.getByText("Move it (you can do this once)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
  });

  // Night audit sold states #3 (door-card-375.png): past the booked time the seller still had "Move the pickup", the
  // door tips told the seller to "Pick a daytime slot" (the buyer's step), and a porch card said "Put it out <day>" twice.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |         Date.now() >= new Date(booked).getTime() ? null : <FoldedTimePicker |         <FoldedTimePicker
  // @mutate src/components/declutter/DeclutterOrderBits.tsx |         {side === "buyer" && <li>Pick a daytime slot.</li>} |         <li>Pick a daytime slot.</li>
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | data-porch-not-yet="">You can take the porch photo {onDay( | data-porch-not-yet="">Put it out {onDay(
  it("sold states #3: no Move once the seller's time has started, seller door tips are the seller's, the porch day is said once", async () => {
    // Before the time: the seller can still move it once.
    state.bookings = [{ ...slot(-60), buyer_reschedules: 0, seller_reschedules: 0 }];
    let v = show([line({ my_side: "seller" })]);
    expect(await screen.findByRole("button", { name: "Move the pickup" })).toBeInTheDocument();
    v.unmount();
    // The time has started: Picked up is the step; no Move. The buyer keeps theirs (the rule named the seller's card).
    state.bookings = [{ ...slot(5), buyer_reschedules: 0, seller_reschedules: 0 }];
    v = show([line({ my_side: "seller" })]);
    expect(await screen.findByRole("button", { name: "Picked up" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move the pickup" })).toBeNull();
    const tips = screen.getByText("Pickup at the door").parentElement!;
    expect(tips.textContent).not.toMatch(/Pick a daytime slot/);
    expect(tips.textContent).toMatch(/Have someone home with you\./);
    v.unmount();
    v = show([line()]);
    expect(await screen.findByRole("button", { name: "I got it" })).toBeInTheDocument();
    const buyerTips = screen.getByText("Pickup at the door").parentElement!;
    expect(buyerTips.textContent).toMatch(/Pick a daytime slot\./);
    expect(buyerTips.textContent).toMatch(/Bring someone with you\./);
    v.unmount();
    // Porch, booked for tomorrow: "Put it out tomorrow" is said once (the status line), not again under it.
    const today = new Date();
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const tomorrow = key(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
    state.porchDays = [tomorrow];
    state.bookings = [{ ...slot(-60 * 24), pickup_day: tomorrow }];
    state.handover = { side: "seller" };
    show([line({ my_side: "seller", handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("You can take the porch photo tomorrow.")).toBeInTheDocument();
    expect(document.body.textContent!.match(/Put it out tomorrow/g)).toHaveLength(1);
  });

  // Deep audit #32 (44-seller-sold-p2/p3-390): a booked porch card stacked two full date-and-time pickers and 5 buttons (audit 2026-10-28).
  // @mutate src/components/declutter/DeclutterFoldedTime.tsx |   const [open, setOpen] = useState(false); |   const [open, setOpen] = useState(true);
  it("#32: a booked porch card shows no picker until one is asked for; Out until a time opens one and sends it", async () => {
    state.bookings = [{ ...slot(-24 * 60), buyer_reschedules: 0, seller_reschedules: 0 }];
    const { container } = show([line({ handover: "porch", my_side: "seller" })]);
    const move = await screen.findByRole("button", { name: "Move the pickup" });
    const outUntil = screen.getByRole("button", { name: "Out until a time…" });
    expect(screen.getByRole("button", { name: "Out all day" })).toBeInTheDocument();
    // The DateTimeField stand-in is a plain input with the picker's id: none is on the card yet.
    expect(container.querySelectorAll('input[id^="dcl-slot-"], input[id^="dcl-out-"]')).toHaveLength(0);
    expect(move).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(outUntil);
    expect(container.querySelectorAll('input[id^="dcl-out-"]')).toHaveLength(1);
    expect(container.querySelectorAll('input[id^="dcl-slot-"]')).toHaveLength(0);
    const send = screen.getByRole("button", { name: "Out until then" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Out until"), { target: { value: "2026-10-31T18:00" } });
    fireEvent.click(send);
    await waitFor(() => expect(state.calls).toContainEqual(["porch_time", "o1", "until", new Date("2026-10-31T18:00").toISOString()]));
    // Sent: it folds again.
    expect(container.querySelectorAll('input[id^="dcl-out-"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Out until a time…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Out until a time…" })).toBeInTheDocument();
  });

  it("a multi-item order lists every item's pickup address, not only the first item's (authz review 2.7)", async () => {
    show([line(), line({ line_id: "l2", item_id: "i2", item_title: "Rug" }), line({ line_id: "l3", item_id: "i3", item_title: "Lamp" })]);
    expect(await screen.findByText("9 Far Rd, Baton Rouge")).toBeInTheDocument();
    expect(screen.getByText("1234 Example St, Baton Rouge")).toBeInTheDocument();
    expect(screen.getByText(/Oak chair, Lamp/)).toBeInTheDocument();
  });

  it("no code anywhere (owner 2026-10-18): the buyer gets \"I got it\", the seller is told how they're paid (rows 25, 93)", async () => {
    state.bookings = [slot(-60)];
    const { unmount } = show([line()]);
    fireEvent.click(await screen.findByRole("button", { name: "I got it" }));
    const gotIt = await screen.findByRole("dialog");
    expect(within(gotIt).getByText(/you still have 24 hours to ask Dana for a refund/)).toBeInTheDocument();
    expect(state.calls).toEqual([]);
    fireEvent.click(within(gotIt).getByRole("button", { name: "I got it" }));
    await waitFor(() => expect(state.calls).toContainEqual(["confirm", "o1"]));
    expect(screen.queryByText(/4-digit|handover code/i)).toBeNull();
    unmount();
    state.calls = [];
    state.bookings = [slot(10)];
    show([line({ my_side: "seller" })]);
    // LEAD-DOOR-PAYLINE: said once, in the money note, with the owner's 10-30 rule; never "24 hours after you tap Picked up".
    expect((await screen.findByText(/^You get/)).textContent).toBe('You get $40. You\'re paid 24 hours after the buyer taps "I got it", unless they ask for a refund. If you tap "Picked up" and the buyer says nothing, you\'re paid about 48 hours later. If neither of you says anything, the money stays held.');
    expect(document.body.textContent).not.toMatch(/24 hours after you tap|paid 24 hours after the handover/);
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
    expect(screen.queryByLabelText(/code/i)).toBeNull();
    expect(screen.getByText("Pickup at the door")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Picked up" }));
    const picked = await screen.findByRole("dialog");
    expect(within(picked).getByText("Did Dana take it?")).toBeInTheDocument();
    fireEvent.click(within(picked).getByRole("button", { name: "Picked up" }));
    // No photo: no position asked for (the photo is optional; its place is checked only when there is one).
    await waitFor(() => expect(state.calls).toContainEqual(["seller_picked_up", "o1", null, null]));
  });

  it("door pickup (owner 2026-10-18): both sides get the safety tips; the buyer is pointed to Add a Helpr; porch has no tips and no seller \"Picked up\"", async () => {
    state.bookings = [slot(-60)];
    const { unmount } = show([line()]);
    expect(await screen.findByText("Pickup at the door")).toBeInTheDocument();
    expect(screen.getByText(/Add a Helpr below/)).toBeInTheDocument();
    unmount();
    show([line({ handover: "porch", my_side: "seller" })]);
    expect(await screen.findByText(/the later of the pickup time and your porch photo/)).toBeInTheDocument();
    expect(screen.queryByText("Pickup at the door")).toBeNull();
    expect(screen.queryByRole("button", { name: "Picked up" })).toBeNull();
  });

  it("door pickup: the seller's \"Picked up\" appears only from the booked time (lh-money-escrow review #1)", async () => {
    state.bookings = [slot(-60)];
    show([line({ my_side: "seller" })]);
    expect(await screen.findByText(/^You can tap "Picked up" from the pickup time\.$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Picked up" })).toBeNull();
  });

  it("porch: the buyer is told the \"Picked up\" photo pays the seller (row 99), and can tap \"I got it\" instead", async () => {
    // A1-C2: the buyer's "I got it" on a porch pickup waits for the pickup time (or the porch photo); this one has passed.
    state.bookings = [slot(60)];
    show([line({ handover: "porch" })]);
    expect(await screen.findByLabelText(/this pays the seller/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "I got it" })).toBeInTheDocument();
  });

  // LEAD-PORCH-SR (l41 at 375, seller porch card with an open buyer problem): the photo input's screen-reader label
  // still promised "needed before you can be paid automatically" while the money was held. Both sides, label and hint.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const payWords = !free && !held; |   const payWords = !free;
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | who={who} held={!!problem} /> | who={who} held={false} />
  it("LEAD-PORCH-SR: with a problem open, the porch photo's label and hint promise no pay, on either side", async () => {
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    state.porchDays = [day];
    state.bookings = [{ ...slot(-60), pickup_day: day }];
    state.handover = { side: "seller" };
    let checked = 0;
    try {
      for (const held of [false, true]) {
        state.problems = held ? [{ id: "p9", order_id: "o1", reporter_side: "buyer", reason: "no_show" }] : [];
        const v = show([line({ my_side: "seller", handover: "porch", porch_ok: true })]);
        await screen.findByLabelText(/^Photo of the item on your porch/);
        await waitFor(() => expect(!!screen.queryByLabelText(/paid automatically/)).toBe(!held));
        expect(!!screen.queryByText(/You need it before you can be paid automatically/)).toBe(!held);
        checked++;
        v.unmount();
      }
      state.bookings = [slot(60)];
      state.handover = null;
      for (const held of [false, true]) {
        state.problems = held ? [{ id: "p9", order_id: "o1", reporter_side: "seller", reason: "no_show" }] : [];
        const v = show([line({ handover: "porch" })]);
        await screen.findByLabelText(/^Photo when you pick it up/);
        await waitFor(() => expect(!!screen.queryByLabelText(/this pays the seller/)).toBe(!held));
        expect(!!screen.queryByText(/they're paid 24 hours later/)).toBe(!held);
        checked++;
        v.unmount();
      }
    } finally {
      state.problems = [];
      state.porchDays = null;
    }
    expect(checked).toBeGreaterThan(3);
  });

  // BUY-5 (buying audit 10-30 #5): the buyer's pickup photo was offered days early and finished the sale the
  // moment a photo was chosen. It now waits like "I got it" and shows a preview with Retake before sending.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |      {buyerWaits ? null : notYet ? ( |      {notYet ? (
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | if (order.side === "seller") setPreview(f); else setShot(f); } | if (order.side === "seller") setPreview(f); else photo.mutate({ file: f }); }
  it("BUY-5: before the pickup day and the porch photo, no pickup photo is offered", async () => {
    state.bookings = [slot(-60 * 72)];
    show([line({ handover: "porch" })]);
    expect(await screen.findByText(/You can tap "I got it" once the seller puts it out, or on your pickup day/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take your pickup photo" })).toBeNull();
    expect(screen.queryByLabelText(/this pays the seller/)).toBeNull();
  });

  it("BUY-5: the pickup photo shows first, Retake or Send; only Send uploads it", async () => {
    state.bookings = [slot(60)];
    show([line({ handover: "porch" })]);
    const input = (await screen.findByLabelText(/this pays the seller/)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "pick.jpg", { type: "image/jpeg" })] } });
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Picked up?");
    expect(sheet).toHaveTextContent("They're paid 24 hours later, unless you report a problem.");
    expect(state.calls.filter((c) => c[0] === "porch_photo")).toEqual([]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Send photo · I have it" }));
    await waitFor(() => expect(state.calls.filter((c) => c[0] === "porch_photo").length).toBe(1));
  });

  it("\"They didn't show\" appears only 15 minutes after the booked time (row 94)", async () => {
    state.bookings = [slot(10)];
    const { unmount } = show([line()]);
    await screen.findByRole("button", { name: "I got it" });
    expect(screen.queryByRole("button", { name: "They didn't show" })).toBeNull();
    unmount();
    state.bookings = [slot(16)];
    show([line()]);
    fireEvent.click(await screen.findByRole("button", { name: "They didn't show" }));
    const noShow = await screen.findByRole("dialog");
    // Board 160, the live rule: the buyer reporting the seller gets everything back.
    expect(within(noShow).getByText(/you get everything back\./)).toBeInTheDocument();
    fireEvent.click(within(noShow).getByRole("button", { name: "Report it" }));
    await waitFor(() => expect(state.calls).toContainEqual(["no_show", "o1"]));
  });

  // Audit 1028 D1-12 (1a-b-pday-booked-p1-375): "I got it" and "Report a problem" sat edge to edge. Two inline buttons
  // that are neighbours in the card's stacked body share one line with no gap, so each action sits in its own block.
  // A wrapper with no box of its own (display: contents, or a fragment) counts as its children.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |   return (\n    <div>\n      <button type="button" className={primary} disabled={confirm.isPending} |   return (\n    <div style={{ display: "contents" }}>\n      <button type="button" className={primary} disabled={confirm.isPending}
  // @mutate src/components/declutter/DeclutterNoShowAnswer.tsx |     <div>\n      <button type="button" className={btn} disabled={report.isPending} |     <div style={{ display: "contents" }}>\n      <button type="button" className={btn} disabled={report.isPending}
  it("no two action buttons sit edge to edge in the card body, either side (D1-12)", async () => {
    const boxes = (el: Element): Element[] => (getComputedStyle(el).display === "contents" ? [...el.children].flatMap(boxes) : [el]);
    let checked = 0;
    // 5 minutes in: "I got it" / "Picked up" then "Report a problem"; 16 minutes in, "They didn't show" joins them.
    // LEAD-VACUOUS2: once the seller has said "Picked up" the buyer has no "They didn't show", so "I got it" sits right
    // above "Report a problem": the one state where "I got it"'s own block is what keeps them apart.
    const sellerSaid = { seller_confirmed_at: new Date().toISOString() };
    for (const [side, minsIn, handover] of [["buyer", 5, null], ["buyer", 16, null], ["buyer", 16, sellerSaid], ["seller", 5, null], ["seller", 16, null]] as const) {
      state.bookings = [slot(minsIn)];
      state.handover = handover;
      const { unmount } = show([line({ my_side: side })]);
      await screen.findByRole("button", { name: side === "buyer" ? "I got it" : "Picked up" });
      if (minsIn > 15) await screen.findByRole("button", { name: handover ? "Report a problem" : "They didn't show" });
      if (handover) expect(screen.queryByRole("button", { name: "They didn't show" })).toBeNull();
      const body = document.querySelector("[data-order-body]")!;
      const kids = [...body.children].flatMap(boxes);
      kids.forEach((el, i) => {
        if (i > 0 && el.tagName === "BUTTON") expect(`${kids[i - 1].tagName} then ${el.textContent}`).not.toMatch(/^BUTTON then/);
      });
      checked += body.querySelectorAll("button").length;
      unmount();
    }
    expect(checked).toBeGreaterThan(9);
  });

  it("Report a problem needs a note and sends the reason (rows 15, 67)", async () => {
    // D2-9: offered once the booked time is over.
    state.bookings = [slot(20)];
    show([line()]);
    fireEvent.click(await screen.findByRole("button", { name: "Report a problem" }));
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    // BUY-35: the shared pick-one list, and one letter isn't a report.
    // @mutate src/components/declutter/DeclutterProblemForm.tsx | disabled={send.isPending \|\| note.trim().length < DISPUTE_DETAILS_MIN} onClick={() => send.mutate()}>Send | disabled={send.isPending \|\| !note.trim()} onClick={() => send.mutate()}>Send
    fireEvent.click(screen.getByRole("radio", { name: "I didn't get it" }));
    fireEvent.change(screen.getByLabelText("Tell us what happened"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(document.querySelector("[data-problem-note-short]")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Tell us what happened"), { target: { value: "Nobody was there" } });
    expect(document.querySelector("[data-problem-note-short]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.calls).toContainEqual(["problem", "o1", "not_received", "Nobody was there", []]));
  });

  // Audit 1b D2-7: up to 3 photos on the problem form, uploaded on Send into the problem folder and sent with the
  // report; hidden until the server takes them after the handover (problemPhotosWaitForServer.test.ts).
  // @mutate src/components/declutter/DeclutterProblemForm.tsx | PROBLEM_FORM_PHOTOS_READY && photos.length ? await uploadProblemPhotos(orderId, photos) : [] | []
  it("D2-7: the problem form's photos are uploaded and sent with the report once the server takes them; hidden before", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:p", revokeObjectURL: () => undefined }));
    state.features = ["declutter_refund_requests"];
    state.handover = { status: "handed_over", confirmed_at: "2026-10-20T15:00:00Z" };
    state.problemPhotos = false;
    const off = show([line({ order_status: "handed_over" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Report a problem" }));
    expect(screen.queryByRole("group", { name: "Photos" })).toBeNull();
    off.unmount();
    state.problemPhotos = true;
    const { container } = show([line({ order_status: "handed_over" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Report a problem" }));
    const input = container.querySelector('[data-problem-photos] input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "crack.jpg", { type: "image/jpeg" })] } });
    expect(within(screen.getByRole("group", { name: "Photos" })).getAllByRole("img")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Tell us what happened"), { target: { value: "Leg is cracked" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.calls).toContainEqual(["problem", "o1", "not_as_described", "Leg is cracked", ["me/declutter/problem/o1/crack.jpg"]]));
    expect(state.calls).toContainEqual(["problem_photo", "o1", "crack.jpg"]);
    state.problemPhotos = false;
    state.features = [];
  });

  // Audit 1030 DB-12: after Louisiana Helpr paid the seller, the card said only "Handed over."; it now says what was
  // decided (declutter_order_problem's decision, 20261030080104), on the card itself, not only in a notice.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {done && !problem && <Suspense fallback={null}><DeclutterProblemDecided orderId={order.orderId} side={order.side} /></Suspense>}\n |
  it("DB-12: a sale Louisiana Helpr decided says what it decided on the card, for each side", async () => {
    state.handover = { status: "handed_over", confirmed_at: "2026-10-20T15:00:00Z" };
    state.problems = [];
    state.orderProblem = { id: "p1", reporter_side: "buyer", reason: "damaged", note: "Cracked.", photo_paths: [], status: "decided",
      created_at: "2026-10-20T14:00:00Z", decision: "pay_seller", decided_at: "2026-10-20T15:00:00Z" };
    const buyer = show([line({ order_status: "handed_over", handover: "seller_delivery" })]);
    expect((await buyer.findByText("Louisiana Helpr decided:")).closest("p")?.textContent)
      .toBe("Louisiana Helpr decided: The seller keeps the payment, and the sale is final.");
    buyer.unmount();
    const seller = show([line({ order_status: "handed_over", handover: "seller_delivery", my_side: "seller" })]);
    expect((await seller.findByText("Louisiana Helpr decided:")).closest("p")?.textContent).toBe("Louisiana Helpr decided: You keep the payment.");
    seller.unmount();
    state.orderProblem = null;
    state.handover = null;
  });

  it("after handover: the seller sees the payout (minus a fee debt) and both can review (rows 45, 93)", async () => {
    state.payouts = [{ order_id: "o1", items_cents: 4000, delivery_cents: 0, refunded_cents: 0, debt_cents: 150, amount_cents: 3850, status: "succeeded", executed_at: null }];
    show([line({ my_side: "seller", order_status: "handed_over" })]);
    expect(await screen.findByText(/\$38\.50 \(\$40 minus \$1\.50 you owed\)/)).toBeInTheDocument();
    expect(screen.getByText("Review o1 as the seller (me)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Check your payouts" })).toBeNull();
  });

  // NIGHT-SELL-soldstates-4: a failed payout said "check that your payout account is set up" with no way there.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | {payout.status === "failed" && <FailedPayoutLink />} | {false && <FailedPayoutLink />}
  // While payout setup is paused (payout_setup off) the payout settings offer nothing to fix: no link (payoutSetupPausedEntryPoints).
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (paused) return null; |   if (false) return null;
  it("soldstates-4: a failed payout links to the payout settings, not while payout setup is paused", async () => {
    state.payouts = [{ order_id: "o1", items_cents: 4000, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, amount_cents: 4000, status: "failed", executed_at: null }];
    state.features = ["payout_setup"];
    const { unmount } = show([line({ my_side: "seller", order_status: "handed_over" })]);
    expect(await screen.findByText(/Your payout didn't go through yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check your payouts" })).toHaveAttribute("href", "/profile?tab=payment");
    unmount();
    state.features = [];
    show([line({ my_side: "seller", order_status: "handed_over" })]);
    expect(await screen.findByText(/Your payout didn't go through yet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Check your payouts" })).toBeNull();
  });

  // Boards 71/72: the one tracker, where it stands, and the money note, from the real handover row.
  // A1-B2: "what the buyer paid" is the card charge (declutter_my_paid_cents): here a first purchase, $42.70 sale + the
  // $2 setup fee = $44.70, never the line's total_cents.
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx | no figure.\n  const totalCents = useMyPaidCents([orderId], side === "buyer" && !free)?.get(orderId) ?? null; | no figure.\n  const totalCents = itemsCents + 270;
  it("board 71: porch, the buyer: On the porch once the seller's photo is in, the photo shown, what the buyer paid", async () => {
    state.paid = { o1: 4470 };
    state.bookings = [slot(-120)];
    state.handover = { set_out_at: "2026-10-20T15:00:00Z", set_out_photo_path: "s1/declutter/handover/o1/out.jpg" };
    show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByRole("list", { name: "Step 3 of 4: On the porch" })).toBeInTheDocument();
    expect(screen.getByText("It's out. Pick it up at your pickup time.")).toBeInTheDocument();
    expect((await screen.findByText(/You paid/)).textContent).toMatch(/You paid \$44\.70\. The seller is paid after you pick it up\./);
    expect(await screen.findByAltText("Where the item was left")).toHaveAttribute("src", "https://signed.test/s1/declutter/handover/o1/out.jpg");
  });

  it("board 72: porch, the seller: booked until the photo, told to put it out, and paid the whole item price by the real rule", async () => {
    // Booked but no porch photo yet: still Paid (a porch pickup is Ready only once the photo is in).
    state.bookings = [slot(-120)];
    state.handover = { side: "seller" };
    show([line({ my_side: "seller", handover: "porch", porch_ok: true })]);
    expect((await screen.findAllByText(/^Pickup:/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Step 2 of 4: Time booked" })).toBeInTheDocument();
    expect(screen.getByText("Paid. Put it out and take one photo where the buyer will find it.")).toBeInTheDocument();
    // Deep audit #31: one payout rule, the live one, never "when the buyer marks it". LEAD-DOOR-PAYLINE: the porch rule.
    // @mutate src/components/declutter/DeclutterPorchHandover.tsx | {sellerPayoutRule(kind)} | You're paid when the buyer marks it picked up.
    expect(screen.getByText(/You get/).textContent).toBe('You get $40. You\'re paid 24 hours after the buyer taps "I got it" or takes their pickup photo, unless they ask for a refund. If the buyer says nothing, you\'re paid about 48 hours after the later of the pickup time and your porch photo. With no porch photo, the money stays held until the buyer confirms.');
  });

  // Audit 1028 D1-5 (1a-s-porch-after-375): after the porch photo the seller's card still asked for it ("Take the porch
  // photo", "needed before you can be paid automatically", "Pick another day (once)"). D1-4: before the booked day
  // the server refuses the photo, so the card says the day instead of offering the button.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const posted = seller && !!handoverRow.data?.set_out_at; |   const posted = false;
  // @mutate src/components/declutter/DeclutterPorchDay.tsx |   const putOut = side === "seller" && !!out.data?.set_out_at; |   const putOut = false;
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const notYet = seller && !posted && !!booking.pickup_day && !porchDayIsNow(booking.pickup_day); |   const notYet = false;
  it("the seller's porch card: the day before it's due, then the photo, then no more asking (D1-5)", async () => {
    const today = new Date();
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const tomorrow = key(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
    state.porchDays = [tomorrow];
    const seller = () => show([line({ my_side: "seller", handover: "porch", porch_ok: true })]);
    // 1. Booked for tomorrow: a line with the day, no photo button yet.
    state.bookings = [{ ...slot(-60 * 24), pickup_day: tomorrow }];
    state.handover = { side: "seller" };
    let v = seller();
    expect(await screen.findByText("You can take the porch photo tomorrow.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take the porch photo" })).toBeNull();
    v.unmount();
    // 2. On the day, not out yet: the photo is asked for.
    state.bookings = [{ ...slot(-60), pickup_day: key(today) }];
    v = seller();
    expect(await screen.findByRole("button", { name: "Take the porch photo" })).toBeInTheDocument();
    expect(screen.getByText(/You need it before you can be paid automatically/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Pick another day (once)" })).toBeInTheDocument();
    v.unmount();
    // 3. The photo is in: no more asking; a retake stays possible.
    state.handover = { side: "seller", set_out_at: new Date().toISOString(), set_out_photo_path: "s1/declutter/handover/o1/out.jpg" };
    v = seller();
    expect(await screen.findByRole("button", { name: "Retake the porch photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take the porch photo" })).toBeNull();
    expect(screen.queryByText(/You need it before you can be paid automatically/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Pick another day (once)" })).toBeNull();
    v.unmount();
  });

  // Lead 2026-10-28 (Buying, calmer): where a pickup stands is said in plain sentences, never dot-joined fragments
  // ("Paid · book a pickup…"), and a buyer's card no longer repeats "You're buying". The class: every step of every
  // pickup kind, for both sides, read from the rendered card.
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx |     if (at === 0) return side === "buyer" ? "Paid. Book a pickup time." : "Paid. The buyer books a pickup time."; |     if (at === 0) return side === "buyer" ? "Paid · book a pickup time." : "Paid. The buyer books a pickup time.";
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | (items === 0 ? " · You're giving" : " · You're selling") : ""} | (items === 0 ? " · You're giving" : " · You're selling") : " · You're buying"}
  // DA-3 (Declutter audit 2026-10-30, shot da-seller-booked-mid-wk375): a giver's free order said "You're selling".
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | (items === 0 ? " · You're giving" : " · You're selling") | " · You're selling"
  it("DA-3: the giver's card for a free item says \"You're giving\"; a paid one still says \"You're selling\"", async () => {
    let read = 0;
    for (const [price, words, not] of [[0, "You're giving", /selling/], [4000, "You're selling", /giving/]] as const) {
      state.handover = null; state.bookings = [];
      const { container, unmount } = show([line({ my_side: "seller", price_cents: price, handover: "porch", porch_ok: true })]);
      await waitFor(() => expect(container.querySelector("[data-order-head]")).not.toBeNull());
      const head = container.querySelector("[data-order-head]")?.textContent ?? "";
      expect(head, `price ${price}`).toContain(words);
      expect(head, `price ${price}`).not.toMatch(not);
      read++;
      unmount();
    }
    expect(read).toBeGreaterThan(1);
  });

  // @mutate src/components/declutter/DeclutterPorchHandover.tsx | {done ? "." : `. The seller is paid after you ${after}.`} | {done ? "." : ` · the seller is paid after you ${after}.`}
  it("lead 10-28: every pickup step reads as plain sentences, and the buyer's card does not say \"You're buying\"", async () => {
    const STEPS: Record<"porch" | "pickup_home", Record<number, () => void>> = {
      porch: {
        0: () => { state.handover = null; state.bookings = []; },
        1: () => { state.handover = null; state.bookings = [{ ...slot(-120), pickup_day: "2026-10-20" }]; },
        2: () => { state.handover = { set_out_at: "2026-10-20T15:00:00Z", set_out_photo_path: null }; state.bookings = [{ ...slot(-120), pickup_day: "2026-10-20" }]; },
        3: () => { state.handover = { set_out_at: "2026-10-20T15:00:00Z", picked_up_at: "2026-10-20T16:00:00Z" }; state.bookings = [slot(30)]; },
      },
      pickup_home: {
        0: () => { state.handover = null; state.bookings = []; },
        1: () => { state.handover = null; state.bookings = [slot(-120)]; },
        2: () => { state.handover = { picked_up_at: "2026-10-20T15:00:00Z" }; state.bookings = [slot(30)]; },
        3: () => { state.handover = { status: "handed_over", confirmed_at: "2026-10-20T15:00:00Z" }; state.bookings = [slot(30)]; },
      },
    };
    let read = 0;
    for (const handover of ["porch", "pickup_home"] as const) {
      for (const side of ["buyer", "seller"] as const) {
        for (const at of [0, 1, 2, 3]) {
          STEPS[handover][at]();
          if (state.handover) state.handover.side = side;
          const { container, unmount } = show([line({ my_side: side, handover, porch_ok: true, order_status: at === 3 ? "handed_over" : "paid" })]);
          await waitFor(() => expect(container.querySelector(`[data-pickup-status="${at}"]`)).not.toBeNull());
          const lines = [...container.querySelectorAll("[data-pickup-status] p")].map((p) => p.textContent ?? "");
          expect(lines.length).toBeGreaterThan(0);
          for (const t of lines) {
            expect(t, `${handover}/${side}/step ${at}`).not.toMatch(/ · /);
            expect(t, `${handover}/${side}/step ${at}`).toMatch(/[.!?]$/);
          }
          const head = container.querySelector("[data-order-head]")?.textContent ?? "";
          if (side === "buyer") expect(head).not.toMatch(/You're buying/);
          read += lines.length;
          unmount();
        }
      }
    }
    // 2 kinds x 2 sides x 4 steps, each with its standing line (and a money note on most).
    expect(read).toBeGreaterThan(16);
  });

  // Owner 2026-10-28: "make porch just pick a day but they also need to know once it's on the porch so they don't show
  // up and it's not there". The buyer picks one of the seller's days; until the porch photo the card says not to go.
  // LEAD-PLACE-TIMES (owner 2026-10-31, lead's decision 1): a NEW porch booking is a time inside the pickup place's hours;
  // a day booked under the 10-28 design keeps its day card (steps 2-4 below).
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | order.handover === "porch" && booking?.pickup_day\n            ? <PorchDayPanel | order.handover === "porch"\n            ? <PorchDayPanel
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | order.handover === "porch" && booking?.pickup_day\n            ? <PorchDayPanel | false\n            ? <PorchDayPanel
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx |       return "Not out yet. We'll tell you when it's on the porch. Don't go before then."; |       return "Booked. Pick it up on your day.";
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx |       return porchDayIsNow(day) ? "It's out. Pick it up today." | return porchDayIsNow(day) ? "It's out. Pick it up at your pickup time."
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {order.side === "seller" && !booking.pickup_day && ( |       {order.side === "seller" && (
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | slotStart={noShowFrom(booking) ?? booking.slot_start} | slotStart={booking.slot_start}
  it("owner 10-28 / 10-31: a new porch pickup books a time; a day already booked: told not to go until it's out, then 'Pick it up today'", async () => {
    const today = new Date();
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const tomorrow = key(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
    const later = key(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3));
    state.porchDays = [tomorrow, later];
    // 1. Not booked (LEAD-PLACE-TIMES): the buyer picks a time inside the place's hours, never a bare day.
    const first = show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("Paid. Pick a time to collect it from the porch.")).toBeInTheDocument();
    expect(await screen.findByLabelText("Pick a pickup time")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book this day" })).toBeNull();
    expect(screen.getByRole("list", { name: "Step 1 of 4: Paid" })).toBeInTheDocument();
    first.unmount();

    // 2. Booked, not out yet: don't go; no "They didn't show" while the day is not over.
    state.bookings = [{ ...slot(-60), pickup_day: key(today) }];
    const second = show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("Not out yet. We'll tell you when it's on the porch. Don't go before then.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Step 2 of 4: Time booked" })).toBeInTheDocument();
    expect(screen.getByText(/Pickup day:/).textContent).toMatch(/Today/);
    expect(screen.queryByRole("button", { name: "They didn't show" })).toBeNull();
    second.unmount();

    // 2b. A1-C2: booked for TOMORROW and not out: no "I got it" yet, and it says when it comes.
    // @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (!porchReady) { |   if (false) {
    // @mutate src/components/declutter/DeclutterHandoverViews.tsx | (pickupDay ? porchDayIsNow(pickupDay) : | (pickupDay ? true :
    state.bookings = [{ ...slot(-60), pickup_day: tomorrow }];
    const early = show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByText('You can tap "I got it" once the seller puts it out, or on your pickup day.')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
    early.unmount();

    // 3. The porch photo is in on the pickup day: pick it up today.
    state.handover = { set_out_at: new Date().toISOString(), set_out_photo_path: "s1/declutter/handover/o1/out.jpg" };
    state.bookings = [{ ...slot(-60), pickup_day: key(today) }];
    const third = show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("It's out. Pick it up today.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Step 3 of 4: On the porch" })).toBeInTheDocument();
    third.unmount();

    // 3b. A1-C2: the porch photo is in while it is booked for TOMORROW: the card says the day, and "I got it" is there.
    // @mutate src/components/declutter/DeclutterHandoverViews.tsx | !porchBuyer \|\| !!handoverRow.data?.set_out_at \|\| | !porchBuyer \|\|
    state.bookings = [{ ...slot(-60), pickup_day: tomorrow }];
    const early3 = show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("It's out. Pick it up tomorrow.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "I got it" })).toBeInTheDocument();
    early3.unmount();

    // 4. The seller: put it out that day; no "Out all day" / "Out until" for a day.
    state.handover = { side: "seller" };
    state.bookings = [{ ...slot(-60), pickup_day: tomorrow }];
    show([line({ my_side: "seller", handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("Put it out tomorrow and post the porch photo.")).toBeInTheDocument();
    // A1-C3: the seller is never told "once the seller posts the porch photo".
    // @mutate src/components/declutter/DeclutterPorchDay.tsx | {side === "seller" ? "The buyer can come any time that day once you post the porch photo." : | {false ? "" :
    expect((await screen.findByText(/Pickup day:/)).textContent).toMatch(/The buyer can come any time that day once you post the porch photo\./);
    expect(document.body.textContent).not.toMatch(/once the seller posts/);
    expect(screen.queryByRole("button", { name: "Out all day" })).toBeNull();
    expect(screen.queryByLabelText("Out until")).toBeNull();
    expect(screen.getByText(/the later of the pickup time and your porch photo/)).toBeInTheDocument();
  });

  it("owner 10-28: before the porch-day migration is live (no days read), the porch card keeps the time picker", async () => {
    state.porchDays = null;
    show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByLabelText("Pick a pickup time")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book this day" })).toBeNull();
  });

  it("a handed-over pickup reads Done on the tracker", async () => {
    state.handover = { status: "handed_over", confirmed_at: "2026-10-20T15:00:00Z" };
    show([line({ order_status: "handed_over" })]);
    expect(await screen.findByRole("list", { name: "Step 4 of 4: Done" })).toBeInTheDocument();
    expect(screen.getByText("Handed over.")).toBeInTheDocument();
  });

  // Lead review (71/72): the app's own day + time pickers and a real photo button, never the bare browser controls.
  it("pickup times use the shared DateTimeField and the porch photo is a button, not a bare file box", () => {
    for (const f of ["src/components/declutter/DeclutterHandoverViews.tsx", "src/components/declutter/DeclutterPickupWindows.tsx", "src/components/declutter/DeclutterFoldedTime.tsx"]) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, f).not.toMatch(/type="datetime-local"/);
      expect(src, f).toMatch(/<DateTimeField\b/);
    }
    // The Helpr's Accept picker moved its fallback DateTimeField into DeclutterPickupWindows (TaskPickupTime, 2026-10-28);
    // DeclutterDeliveryViews still never draws a bare datetime box.
    expect(blankComments(readFileSync("src/components/declutter/DeclutterDeliveryViews.tsx", "utf8"))).not.toMatch(/type="datetime-local"/);
    const hv = blankComments(readFileSync("src/components/declutter/DeclutterHandoverViews.tsx", "utf8"));
    expect(hv).toMatch(/Take the porch photo/);
  });
});

/**
 * Boards 159 + 160 (Builder 3c): the handover moments are sheets.
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | if (f) { if (order.side === "seller") setPreview(f); else setShot(f); } | if (f) photo.mutate({ file: f });
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |         onProblem={() => { setAsking(false); onProblem(); }} |         onProblem={() => setAsking(false)}
 * @mutate src/components/declutter/DeclutterHandoverSheets.tsx | <li>The first missed pickup: {who} can book one new time before the 7-day pickup deadline.</li> | <li>{who} gets one more day.</li>
 * @mutate src/components/declutter/DeclutterHandoverSheets.tsx | : "If they don't, the sale is cancelled and you get everything back."}</li> | : "The sale is cancelled."}</li>
 * @mutate src/components/declutter/DeclutterHandoverSheets.tsx | onClick={() => file && onSend(file, note.trim())} | onClick={() => file && onSend(file, "")}
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx | {h.data.set_out_note && <p | {false && <p
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       const where = await currentPosition();\n      const path | const where = order.side === "buyer" ? await currentPosition() : null;\n      const path
 */
describe("boards 159 + 160: handover sheets", () => {
  beforeEach(() => {
    state.bookings = [];
    state.calls = [];
    state.handover = null;
    vi.spyOn(window, "confirm").mockImplementation(() => { throw new Error("window.confirm used"); });
    Object.assign(URL, { createObjectURL: () => "blob:porch", revokeObjectURL: () => {} });
  });

  it("159 seller, porch: the photo is checked in 'Put it out' and only sent on 'Send photo · it's out'", async () => {
    state.bookings = [slot(-60)];
    show([line({ handover: "porch", my_side: "seller" })]);
    const input = await screen.findByLabelText(/Photo of the item on your porch/);
    fireEvent.change(input, { target: { files: [new File(["x"], "porch.jpg", { type: "image/jpeg" })] } });
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Take one photo of it where Dana will find it. That photo is the handover.")).toBeInTheDocument();
    expect(within(sheet).getByRole("img", { name: "Your porch photo" })).toBeInTheDocument();
    expect(state.calls).toEqual([]);
    // Q2266: the optional "Where exactly?" note goes with the photo.
    fireEvent.change(within(sheet).getByLabelText(/Where exactly\?/), { target: { value: "  Left side, by the swing " } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Send photo · it's out" }));
    await waitFor(() => expect(state.calls).toContainEqual(["porch_note", "o1", "Left side, by the swing"]));
    expect(state.calls.findIndex((c) => c[0] === "porch_photo")).toBeLessThan(state.calls.findIndex((c) => c[0] === "porch_note"));
    // Anti-lying #1: the seller's "Left on porch" photo is sent with where it was taken, as the buyer's is.
    expect(state.calls.find((c) => c[0] === "porch_photo")?.[3]).toEqual({ lat: 30.45, lng: -91.15 });
  });

  it("Q2266 retake: a photo sent with no note still clears the old note (lh-authz-rls review #1)", async () => {
    // @mutate src/components/declutter/DeclutterHandoverViews.tsx | if (r.result === "set_out" && order.side === "seller") { | if (r.result === "set_out" && note) {
    state.bookings = [slot(-60)];
    show([line({ handover: "porch", my_side: "seller" })]);
    fireEvent.change(await screen.findByLabelText(/Photo of the item on your porch/), { target: { files: [new File(["x"], "porch.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Send photo · it's out" }));
    await waitFor(() => expect(state.calls).toContainEqual(["porch_note", "o1", ""]));
  });

  it("Q2266 buyer: the seller's note shows under the porch photo", async () => {
    state.bookings = [slot(-60)];
    state.handover = { set_out_at: "2026-10-20T17:12:00Z", set_out_photo_path: "s1/declutter/handover/o1/p.jpg", set_out_note: "Left side, by the swing" };
    show([line({ handover: "porch" })]);
    expect(await screen.findByText('"Left side, by the swing"')).toBeInTheDocument();
  });

  it("159 buyer: 'Something's not right' closes the sheet and opens the problem form, nothing confirmed", async () => {
    // A1-C2: a porch "I got it" waits for the pickup time; this one has passed.
    state.bookings = [slot(60)];
    show([line({ handover: "porch" })]);
    fireEvent.click(await screen.findByRole("button", { name: "I got it" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Something's not right" }));
    expect(await screen.findByLabelText("What went wrong?")).toBeInTheDocument();
    expect(state.calls).toEqual([]);
  });

  it("160 seller: the live no-show rule (one new booking; a second miss refunds the item price, not the fee; item back on sale)", async () => {
    state.bookings = [slot(16)];
    show([line({ my_side: "seller" })]);
    fireEvent.click(await screen.findByRole("button", { name: "They didn't show" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Dana didn't pick up?")).toBeInTheDocument();
    expect(within(sheet).getByText(/Dana can book one new time before the 7-day pickup deadline/)).toBeInTheDocument();
    expect(within(sheet).getByText(/item price back, and your item goes back on sale/)).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/\b(he|she|him|her)\b/);
    fireEvent.click(within(sheet).getByRole("button", { name: "Not now" }));
    expect(state.calls).toEqual([]);
  });

  // Deep audit part 2 (B2-2): a free item's no-show sheet promised "the item price back" on $0.
  // @mutate src/components/declutter/DeclutterNoShowAnswer.tsx | who={who} free={order.lines.every((l) => l.price_cents === 0)} pending={report.isPending} | who={who} free={false} pending={report.isPending}
  it("a free item's no-show sheet has no money words", async () => {
    state.bookings = [slot(16)];
    show([line({ my_side: "seller", price_cents: 0, premium_cents: 0, total_cents: 0 })]);
    fireEvent.click(await screen.findByRole("button", { name: "They didn't show" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("A second miss cancels the claim, and your item goes back on sale.")).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/price back|everything back|\$/);
  });
});

// Deep audit #6 (B-6): a free claim read like a paid order ("Paid · $0 · You paid $0 · the seller is paid after you
// pick it up"), and the handover words promised a refund window and a payout on $0.
// @mutate src/components/declutter/DeclutterPorchHandover.tsx |   const money = free ? null |   const money = false ? null
// @mutate src/components/declutter/DeclutterPorchHandover.tsx |     handover, side, free, booked: !!slot, |     handover, side, free: false, booked: !!slot,
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | free ? <p className="text-sm text-muted-foreground">The handover is when {how}.</p> : null; | <p className="text-sm text-muted-foreground">{"You're paid 24 hours after the handover. "}The handover is when {how}.</p>;
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |         porch={order.handover === "porch"} free={free} |         porch={order.handover === "porch"}
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | who={who} free={free} pending={pickedUp.isPending} | who={who} pending={pickedUp.isPending}
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {refundRequests && items > 0 && ( |           {refundRequests && (
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.side === "seller" && payout && items > 0 && <p | {order.side === "seller" && payout && <p
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | you have it${payWords ? "; they're paid 24 hours later." : "."} | you have it${"; they're paid 24 hours later."}
// @mutate src/components/declutter/DeclutterPorchHandover.tsx |   if (free && at === 0) return |   if (false && at === 0) return
describe("#6: a free claim never reads like a paid order", () => {
  // No leading \b: textContent runs the step labels together ("DonePaid").
  const MONEY = /paid\b|refund|payout|order total|\$\d/i;
  const free = (over: Record<string, unknown> = {}) => line({ price_cents: 0, premium_cents: 0, total_cents: 0, ...over });
  beforeEach(() => {
    state.bookings = [];
    state.payouts = [];
    state.calls = [];
    state.handover = null;
    state.features = ["declutter_refund_requests"];
  });

  it("each side, each pickup kind and step: the card and its sheets have no money words, and the first step says Claimed", async () => {
    let read = 0;
    for (const handover of ["porch", "pickup_home"] as const) {
      for (const side of ["buyer", "seller"] as const) {
        // slot(m) is m minutes AGO: none, 30 minutes ago (pickup time passed), in an hour.
        for (const at of [null, 30, -60] as const) {
          state.bookings = at === null ? [] : [{ ...slot(at), porch_mode: handover === "porch" ? "all_day" : null }];
          const { container, unmount } = show([free({ handover, my_side: side })]);
          const card = (await screen.findByText("Claimed")).closest("article")!;
          // Wait for the booking read: a booked door pickup moves to its second step.
          if (at !== null && handover === "pickup_home") await within(card).findByText("Booked. The pickup time is below.");
          const name = side === "buyer" ? "I got it" : "Picked up";
          // A1-C2: a porch buyer's "I got it" waits for the pickup time (or the porch photo), so not for one in an hour.
          const acts = side === "buyer" ? at !== null && (handover !== "porch" || at === 30) : handover === "pickup_home" && at === 30;
          const action = acts ? await within(card).findByRole("button", { name }) : null;
          expect(card.textContent, `${handover} ${side} ${at}`).not.toMatch(MONEY);
          expect(within(card).getAllByText(/Claimed/).length).toBeGreaterThan(0);
          expect(container.querySelector("article")).toBe(card);
          if (action) {
            fireEvent.click(action);
            const sheet = await screen.findByRole("dialog");
            expect(sheet.textContent, `${handover} ${side} ${at} sheet`).not.toMatch(MONEY);
            read++;
          }
          read++;
          unmount();
        }
      }
    }
    // 2 kinds x 2 sides x 3 steps, plus the sheets that open (buyer I got it, seller door Picked up).
    expect(read).toBeGreaterThan(13);
  });

  it("handed over: no refund panel and no payout line on a free claim; a paid order keeps both", async () => {
    state.handover = { status: "handed_over", confirmed_at: "2026-10-20T15:00:00Z" };
    state.payouts = [{ order_id: "o1", amount_cents: 0, items_cents: 0, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, status: "nothing_due" }];
    const a = show([free({ order_status: "handed_over" })]);
    expect(await screen.findByText("Handed over.")).toBeInTheDocument();
    expect(screen.queryByText("Refund panel")).toBeNull();
    a.unmount();
    const b = show([free({ order_status: "handed_over", my_side: "seller" })]);
    expect(await screen.findByText("Handed over.")).toBeInTheDocument();
    expect(b.container.querySelector("article")?.textContent).not.toMatch(MONEY);
    b.unmount();
    state.payouts = [{ order_id: "o1", amount_cents: 4000, items_cents: 4000, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, status: "pending" }];
    show([line({ order_status: "handed_over", my_side: "seller" })]);
    expect(await screen.findByText("Refund panel")).toBeInTheDocument();
    // Awaited: the payout read and the refund panel's lazy chunk settle in either order.
    expect(await screen.findByText(/We send it once the sale is final/)).toBeInTheDocument();
  });
});

// #51 (audit 2026-10-28): a seller-delivery card showed "Report a problem" twice, the panel's own button and the
// problem form's. One button; it opens the one form.
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | onOpenChange={setProblemOpen} trigger={false} /> | onOpenChange={setProblemOpen} />
describe("#51: one Report a problem on a seller-delivery card", () => {
  it("the card has one Report a problem button, and it opens the form", async () => {
    for (const side of ["buyer", "seller"] as const) {
      const { unmount } = show([line({ handover: "seller_delivery", my_side: side, delivery_cents: 1500 })]);
      await screen.findByText("Seller delivery panel");
      expect(screen.getAllByRole("button", { name: "Report a problem" })).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
      expect(await screen.findByLabelText("What went wrong?")).toBeInTheDocument();
      unmount();
    }
  });

  it("other cards keep the form's own button", async () => {
    show([line({ handover: "delivery", delivery_task_id: "t1", delivery_cents: 2400 })]);
    expect(await screen.findAllByRole("button", { name: "Report a problem" })).toHaveLength(1);
  });
});

// Deep audit #2: the buyer booked with a free date and a 12-hour wheel, and the server refused any time outside the
// seller's pickup times, which were never shown. The buyer now picks a day chip, then a time chip, every one inside
// the seller's windows and before the deadline (pickupSlots.ts, tested on its own in declutterPickupSlots.test.ts).
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | <PickupSlotPicker orderId={order.orderId} value={slot} onPick={setSlot} | <PickupSlotPicker orderId={order.orderId} value={slot} onPick={() => {}}
describe("#2: the buyer books from the seller's pickup times", () => {
  const windows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "09:00:00", ends: "11:00:00" }));
  beforeEach(() => {
    state.bookings = [];
    state.calls = [];
    state.handover = null;
  });

  it("day chips, then that day's time chips; Book sends the chosen slot", async () => {
    const latestPickupAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    state.windows = { windows, latestPickupAt };
    show([line()]);
    const picker = await screen.findByTestId("declutter-slot-picker");
    expect(picker).toHaveTextContent("The seller's pickup times: Sun–Sat 9–11 AM");
    expect(screen.queryByLabelText("Pickup time")).toBeNull();
    const days = pickupDays(windows, Date.now(), Date.parse(latestPickupAt));
    const dayChips = within(screen.getByRole("group", { name: "Pickup day" })).getAllByRole("button");
    expect(dayChips.map((b) => b.textContent)).toEqual(days.map((d) => d.label));
    const book = screen.getByRole("button", { name: "Book" });
    expect(book).toBeDisabled();
    fireEvent.click(dayChips[1]);
    const times = within(screen.getByRole("group", { name: `Pickup time on ${days[1].label}` })).getAllByRole("button");
    expect(times.map((b) => b.textContent)).toEqual(["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM"]);
    fireEvent.click(times[2]);
    expect(times[2]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(book);
    await waitFor(() => expect(state.calls).toContainEqual(["book", "o1", days[1].slots[2].iso]));
  });

  it("no open slot before the deadline: says so, and nothing can be booked", async () => {
    state.windows = { windows, latestPickupAt: new Date(Date.now() + 60_000).toISOString() };
    show([line()]);
    expect(await screen.findByTestId("declutter-no-pickup-slots")).toHaveTextContent("Message the seller to agree a time.");
    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled();
  });

  it("the seller's one move keeps the folded free picker (the server checks only the deadline for the seller)", async () => {
    state.windows = { windows, latestPickupAt: new Date(Date.now() + 7 * 86_400_000).toISOString() };
    state.bookings = [slot(-120)];
    show([line({ my_side: "seller" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Move the pickup" }));
    expect(await screen.findByLabelText("Move it (you can do this once)")).toBeInTheDocument();
    expect(screen.queryByTestId("declutter-slot-picker")).toBeNull();
  });

  it("the buyer's one move is folded too (#32) and opens the seller's times (#2)", async () => {
    const latestPickupAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    state.windows = { windows, latestPickupAt };
    state.bookings = [slot(-120)];
    show([line()]);
    expect(screen.queryByTestId("declutter-slot-picker")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Move the pickup" }));
    await screen.findByTestId("declutter-slot-picker");
    const days = pickupDays(windows, Date.now(), Date.parse(latestPickupAt));
    const times = within(screen.getByRole("group", { name: `Pickup time on ${days[0].label}` })).getAllByRole("button");
    fireEvent.click(times[0]);
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(state.calls).toContainEqual(["book", "o1", days[0].slots[0].iso]));
  });
});

// Owner 2026-10-29 (audit 1028 D2-9): nobody cancels a paid order, and "Report a problem" is not offered while the
// order waits for pickup. Its button shows once the booked pickup is over (the "They didn't show" moment: 15 minutes
// after a booked time, the end of a porch day). The one exception: the place has no pickup times left (LEAD-PLACE-TIMES; was: no pickup days
// left), so the buyer cannot book at all. The "I got it" sheet's "Something's not right" (the handover itself) still opens the form (159).
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |  if (!o) setAtHandover(false); }} trigger={pickupTimeOver(booking)} /> |  if (!o) setAtHandover(false); }} />
// @mutate src/components/declutter/DeclutterPorchDay.tsx |   return !!from && now >= new Date(from).getTime() + 15 * 60_000; |   return !!from && now >= new Date(from).getTime();
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | noTimes={order.handover === "porch" && order.side === "buyer" ? <ProblemForm | noTimes={false ? <ProblemForm
describe("D2-9: no Report a problem while the order waits for pickup", () => {
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  const today = key(now);
  const yesterday = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const tomorrow = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  beforeEach(() => {
    state.calls = [];
    state.payouts = [];
    state.handover = null;
    state.meetup = null;
    state.porchDays = [tomorrow];
  });

  it("each pickup kind and side: hidden before booking and during the booked time, shown once it is over", async () => {
    const cases: { name: string; handover: string; booking: unknown; offered: boolean }[] = [];
    for (const handover of ["pickup_home", "porch"]) {
      cases.push({ name: `${handover}, not booked`, handover, booking: null, offered: false });
      cases.push({ name: `${handover}, booked time 5 min in`, handover, booking: slot(5), offered: false });
      cases.push({ name: `${handover}, booked time in an hour`, handover, booking: slot(-60), offered: false });
      cases.push({ name: `${handover}, booked time 16 min in`, handover, booking: slot(16), offered: true });
    }
    cases.push({ name: "porch day today", handover: "porch", booking: { ...slot(60), pickup_day: today }, offered: false });
    cases.push({ name: "porch day tomorrow", handover: "porch", booking: { ...slot(-600), pickup_day: tomorrow }, offered: false });
    cases.push({ name: "porch day yesterday", handover: "porch", booking: { ...slot(60 * 30), pickup_day: yesterday }, offered: true });
    let hidden = 0;
    for (const c of cases) {
      for (const side of ["buyer", "seller"] as const) {
        state.bookings = c.booking ? [c.booking] : [];
        const { unmount } = show([line({ handover: c.handover, my_side: side, porch_ok: true })]);
        await screen.findByText(/Oak chair/);
        // Wait for the reads the answer depends on: the booking, and on a porch-day card the seller's days.
        if (c.booking) await screen.findByText(/Pickup( day)?:/);
        // LEAD-PLACE-TIMES: only a day already booked keeps the day card (a new porch booking is a time).
        const dayCard = c.handover === "porch" && !!c.booking && "pickup_day" in (c.booking as object);
        if (dayCard) expect((await screen.findAllByText(/pick a pickup day|Pickup day:/i)).length).toBeGreaterThan(0);
        const offered = !!screen.queryByRole("button", { name: "Report a problem" });
        expect(`${c.name} (${side}): ${offered}`).toBe(`${c.name} (${side}): ${c.offered}`);
        if (!offered) hidden++;
        unmount();
      }
    }
    expect(hidden).toBeGreaterThan(9);
  });

  // LEAD-PLACE-TIMES: a new porch order books a TIME, so "none left" is the time picker's "No pickup times are open"
  // (the place has no hours before the deadline); the buyer, who cannot book, can still report it there.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | noTimes={booked ? null : noTimes} | noTimes={null}
  // @mutate src/components/declutter/DeclutterPickupWindows.tsx | : "No pickup times are open before the pickup deadline. Message the seller to agree a time."}</p>{noTimes}</div>; | : "No pickup times are open before the pickup deadline. Message the seller to agree a time."}</p></div>;
  it("no pickup times left at the place: the porch buyer, who cannot book, can still report it", async () => {
    state.windows = { windows: [], latestPickupAt: new Date(Date.now() + 60_000).toISOString() };
    state.bookings = [];
    show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByText(/No pickup times are open before the pickup deadline/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    expect(await screen.findByLabelText("What went wrong?")).toBeInTheDocument();
  });

  // Night audit sold states #8: the seller moving a porch day with none left read the buyer's line ("The seller has no
  // pickup days left before your 7-day pickup deadline"). Only the booked day left counts as none (it was an empty row).
  // @mutate src/components/declutter/DeclutterPorchDay.tsx |                 {side === "seller"\n | {false\n
  // @mutate src/components/declutter/DeclutterPorchDay.tsx |   const otherDays = (days.data ?? []).filter((d) => d !== booked); |   const otherDays = days.data ?? [];
  it("sold states #8: a seller with no other day left reads their own line", async () => {
    const today = new Date();
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const tomorrow = key(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
    state.porchDays = [tomorrow];
    state.bookings = [{ ...slot(-60 * 24), pickup_day: tomorrow }];
    state.handover = { side: "seller" };
    show([line({ my_side: "seller", handover: "porch", porch_ok: true })]);
    fireEvent.click(await screen.findByRole("button", { name: "Pick another day (once)" }));
    expect(await screen.findByText("You have no pickup days left before the buyer's 7-day pickup deadline.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/The seller has no pickup days left/);
    expect(screen.queryByRole("group", { name: "Pickup days" })).toBeNull();
  });
});

// Audit 1028 part 2, D2-11 and D2-8: the problem reasons fit who reports and when (problemReasons.ts). After the booked
// time with nothing handed over, the buyer can say they didn't get it, never "damaged"; from the "I got it" sheet (the
// item in front of them) never "I didn't get it"; the seller never gets the buyer's reasons.
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | stage={atHandover ? "handover" : "waiting"} | stage="waiting"
// @mutate src/components/declutter/DeclutterProblemForm.tsx |   const reasons = PROBLEM_REASONS[side][stage]; |   const reasons = PROBLEM_REASONS.buyer.delivery;
// @mutate src/components/declutter/problemReasons.ts |     waiting: [["not_received", "I didn't get it"], ["safety", "I felt unsafe"], ["other", "Something else"]], |     waiting: [["not_received", "I didn't get it"], ["damaged", "It's damaged"], ["safety", "I felt unsafe"], ["other", "Something else"]],
describe("D2-11 / D2-8: problem reasons fit the side and the stage", () => {
  beforeEach(() => {
    state.calls = [];
    state.handover = null;
    state.porchDays = null;
  });
  const options = () => within(screen.getByRole("radiogroup", { name: "What went wrong?" })).getAllByRole("radio").map((o) => o.textContent);

  it("after the booked time, nothing handed over: the buyer's reasons start with I didn't get it, no damage words", async () => {
    state.bookings = [slot(20)];
    show([line()]);
    fireEvent.click(await screen.findByRole("button", { name: "Report a problem" }));
    expect(options()).toEqual(["I didn't get it", "I felt unsafe", "Something else"]);
  });

  it("the seller gets their own reasons, never the buyer's", async () => {
    state.bookings = [slot(20)];
    show([line({ my_side: "seller" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Report a problem" }));
    const o = options();
    expect(o[0]).toBe("The buyer didn't come");
    for (const buyerReason of ["I didn't get it", "It's damaged", "It isn't as described"]) expect(o).not.toContain(buyerReason);
    expect(o.length).toBeGreaterThan(1);
  });

  it("from the I got it sheet (the item in front of the buyer): damage reasons, never I didn't get it", async () => {
    state.bookings = [slot(60)];
    show([line({ handover: "porch" })]);
    fireEvent.click(await screen.findByRole("button", { name: "I got it" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Something's not right" }));
    await screen.findByLabelText("What went wrong?");
    expect(options()).toEqual(["It isn't as described", "It's damaged", "I felt unsafe", "Something else"]);
  });
});

// Audit 1b D2-2 (1b-problem-after-375, 1b-s-order-afterprob-p1-1440): after "Report a problem" neither card said a
// problem was open. The buyer was still asked to pick a day, offered "Book" and a second "Report a problem"; the
// seller was still told "You get $12 once the sale is final" while the money was held.
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {problem && <ProblemOpenNote problem={problem} side={order.side} answered={!!handoverRow.data?.no_show_reported_at} delivery={order.handover === "seller_delivery"} />} |
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {problem ? null : noShowWaiting ? <BookingPanel order={order} booking={booking} frozen /> : order.handover === "porch" |           {false ? null : noShowWaiting ? <BookingPanel order={order} booking={booking} frozen /> : order.handover === "porch"
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | problemForm={problem ? null : <ProblemForm | problemForm={false ? null : <ProblemForm
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {!problem && <ProblemForm orderId={order.orderId} side={order.side} stage={atHandover ? "handover" : "waiting"} open={problemOpen} |           {<ProblemForm orderId={order.orderId} side={order.side} stage={atHandover ? "handover" : "waiting"} open={problemOpen}
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | {booking?.slot_start && !problem && <NoShowButton | {booking?.slot_start && <NoShowButton
// @mutate src/components/declutter/declutterPayoutWords.ts | problemOpen && payout.status === "pending" ? PAYOUT_HELD | false ? PAYOUT_HELD
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | {payoutLine(payout, !!problem)} | {payoutLine(payout, false)}
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const problems = useOpenProblems(ids); |   const problems = new Map<string, OpenProblem>();
// @mutate src/components/declutter/DeclutterPorchHandover.tsx |         : problemOpen\n | : false\n
// @mutate src/components/declutter/DeclutterPorchHandover.tsx | : problemOpen && !done ? PROBLEM_ON_HOLD : standing( | : false ? PROBLEM_ON_HOLD : standing(
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | problemOpen={!!problem}\n          refunded={fullRefund}\n          part= | refunded={fullRefund}\n          part=
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | (problem_open).\n    if (anyProblem) return null;\n | (problem_open).\n

describe("D2-2: an open problem shows on both cards", () => {
  const damaged = { id: "p1", order_id: "o1", reporter_side: "buyer", reason: "damaged" };
  beforeEach(() => {
    state.bookings = [];
    state.payouts = [];
    state.calls = [];
    state.handover = null;
    state.porchDays = null;
    state.windows = null;
    state.problems = [];
    state.features = ["declutter_refund_requests"];
  });

  it("the buyer: told a problem is open with its reason, and offered no booking and no second report", async () => {
    // Before: the same card books and reports.
    const before = show([line({ handover: "pickup_home" })]);
    expect(await screen.findByRole("button", { name: "Book" })).toBeInTheDocument();
    expect(screen.queryByText("Problem reported: Louisiana Helpr is looking.")).toBeNull();
    before.unmount();
    state.problems = [damaged];
    show([line({ handover: "pickup_home" })]);
    expect(await screen.findByText("Problem reported: Louisiana Helpr is looking.")).toBeInTheDocument();
    expect(screen.getByText(/Damaged, reported by you\. Nobody is paid until they decide\./)).toBeInTheDocument();
    expect(screen.getByText("On hold while Louisiana Helpr looks at the problem.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
    expect(screen.queryByLabelText("Pick a pickup time")).toBeNull();
    expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
  });

  // NIGHT-BUYINGopenpr-6: a held order said nothing of what happens next. Both sides, any reporter, are told the next
  // step inside the note; no time is promised (nothing on the server sets one).
  // @mutate src/components/declutter/DeclutterProblemOpen.tsx |       <p className="text-muted-foreground" data-problem-next="">{PROBLEM_NEXT}</p> |
  it("openpr-6: a held order says what happens next, on both sides, with no time promised", async () => {
    state.problems = [damaged];
    for (const my_side of ["buyer", "seller"] as const) {
      const r = show([line({ my_side })]);
      const note = (await screen.findByText("Problem reported: Louisiana Helpr is looking.")).closest("[data-problem-open]") as HTMLElement;
      expect(within(note).getByText("Next: they read both sides, then send you both a notice with what they decide.")).toBeInTheDocument();
      expect(note.textContent).not.toMatch(/\d+ (hours?|days?)|within|by tomorrow/i);
      r.unmount();
    }
  });

  it("the seller: the reason and who reported it, and the money is held, not 'once the sale is final'", async () => {
    state.problems = [damaged];
    state.bookings = [slot(-120)];
    state.handover = { side: "seller" };
    show([line({ my_side: "seller", handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("Problem reported: Louisiana Helpr is looking.")).toBeInTheDocument();
    expect(screen.getByText(/Damaged, reported by the buyer\. Your money is held until they decide\./)).toBeInTheDocument();
    expect((await screen.findByText(/is held while Louisiana Helpr looks at the problem/)).textContent)
      .toBe("Your $40 is held while Louisiana Helpr looks at the problem.");
    expect(screen.queryByText(/once the sale is final/)).toBeNull();
    // NIGHT-BUYINGopenpr-4: nor "You're paid 24 hours after the handover" under it, while the money is held.
    expect(screen.queryByText(/You're paid 24 hours after the handover/)).toBeNull();
    expect(screen.queryByText(/the later of the pickup time and your porch photo/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
  });

  it("a booked pickup: no They didn't show while a problem is open (the server refuses it: problem_open)", async () => {
    state.bookings = [slot(20)];
    const before = show([line()]);
    expect(await screen.findByRole("button", { name: "They didn't show" })).toBeInTheDocument();
    before.unmount();
    state.problems = [damaged];
    show([line()]);
    await screen.findByText("Problem reported: Louisiana Helpr is looking.");
    expect(screen.queryByRole("button", { name: "They didn't show" })).toBeNull();
  });

  it("the booked pickup is over (D2-9 offers Report a problem): no second report while one is open", async () => {
    state.bookings = [slot(120)];
    const before = show([line()]);
    expect(await screen.findByRole("button", { name: "Report a problem" })).toBeInTheDocument();
    before.unmount();
    state.problems = [damaged];
    show([line()]);
    await screen.findByText("Problem reported: Louisiana Helpr is looking.");
    expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
  });

  it("handed over: the payout says it is held, and the refund panel gets no second report", async () => {
    state.handover = { status: "handed_over", confirmed_at: "2026-10-20T15:00:00Z" };
    state.payouts = [{ order_id: "o1", amount_cents: 4000, items_cents: 4000, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, status: "pending" }];
    const before = show([line({ order_status: "handed_over" })]);
    await screen.findByText("Refund panel");
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument();
    before.unmount();
    state.problems = [damaged];
    const buyer = show([line({ order_status: "handed_over" })]);
    expect(await screen.findByText("Problem reported: Louisiana Helpr is looking.")).toBeInTheDocument();
    expect(screen.getByText("Refund panel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
    buyer.unmount();
    show([line({ order_status: "handed_over", my_side: "seller" })]);
    expect(await screen.findByText(/It's held while Louisiana Helpr looks at the problem\./)).toBeInTheDocument();
    expect(screen.queryByText(/We send it once the sale is final/)).toBeNull();
  });
});

// Audit 1030 DB-2 (live run A): with a problem report open, Details still offered the buyer "I got it", which then
// failed (the server refuses it: problem_open). The card now offers no "I got it" while a problem is open, on a
// pickup, a meetup, a porch pickup or a seller delivery (the panel is told). T9: nor the seller's "Picked up": the server
// refuses that too on any open problem, the 60-day one included.
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (problemOpen) return null; |
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | who={who} problemOpen={!!problem && problem.reporter_side !== "system"} onProblem={() => { setAtHandover(true); | who={who} problemOpen={false} onProblem={() => { setAtHandover(true);
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | onProblem={() => setProblemOpen(true)} problemOpen={!!problem && problem.reporter_side !== "system"} /> | onProblem={() => setProblemOpen(true)} />
describe("DB-2: no I got it while a problem is open", () => {
  const damaged = { id: "p1", order_id: "o1", reporter_side: "buyer", reason: "damaged" };
  beforeEach(() => {
    state.bookings = [];
    state.payouts = [];
    state.calls = [];
    state.handover = null;
    state.porchDays = null;
    state.windows = null;
    state.problems = [];
    state.meetup = null;
    state.features = [];
  });

  for (const handover of ["pickup_home", "meetup"] as const) {
    it(`${handover}, the pickup time has come: the buyer's I got it is gone while a problem is open`, async () => {
      state.bookings = [slot(5)];
      const before = show([line({ handover })]);
      expect(await screen.findByRole("button", { name: "I got it" })).toBeInTheDocument();
      before.unmount();
      state.problems = [damaged];
      show([line({ handover })]);
      await screen.findByText("Problem reported: Louisiana Helpr is looking.");
      expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
    });
  }

  it("T9: the seller's Picked up is gone while any problem is open, the 60-day one too", async () => {
    state.bookings = [slot(5)];
    const before = show([line({ my_side: "seller" })]);
    expect(await screen.findByRole("button", { name: "Picked up" })).toBeInTheDocument();
    before.unmount();
    for (const p of [damaged, { id: "p2", order_id: "o1", reporter_side: "system", reason: "other" }]) {
      state.problems = [p];
      const r = show([line({ my_side: "seller" })]);
      await screen.findByText("Problem reported: Louisiana Helpr is looking.");
      expect(screen.queryByRole("button", { name: "Picked up" })).toBeNull();
      r.unmount();
    }
  });

  it("T9: a no-show report the seller answered says the buyer reported and the seller answered, on both cards", async () => {
    state.bookings = [slot(30)];
    state.problems = [{ id: "p3", order_id: "o1", reporter_side: "buyer", reason: "no_show" }];
    state.handover = { no_show_reported_at: "2026-10-30T12:00:00Z", no_show_answer_by: "2026-10-31T12:00:00Z" };
    const seller = show([line({ my_side: "seller" })]);
    expect(await screen.findByText(/The buyer reported you didn't show, and you answered\./)).toBeInTheDocument();
    expect(screen.queryByText(/reported by you/)).toBeNull();
    seller.unmount();
    show([line({ my_side: "buyer" })]);
    expect(await screen.findByText(/You reported the seller didn't show, and the seller answered\./)).toBeInTheDocument();
  });

  it("T9: during the seller's 24 hours the pickup time stands: no move, and no 'if you miss it'", async () => {
    state.bookings = [slot(30)];
    const before = show([line({ my_side: "buyer" })]);
    expect(await screen.findByRole("button", { name: "Move the pickup" })).toBeInTheDocument();
    expect(screen.getByTestId("declutter-no-show-warning")).toBeInTheDocument();
    before.unmount();
    state.handover = { no_show_reported_at: "2026-10-30T12:00:00Z", no_show_answer_by: "2026-10-31T12:00:00Z" };
    for (const my_side of ["buyer", "seller"] as const) {
      const r = show([line({ my_side })]);
      await screen.findByText(/has until|^Answer by/);
      expect(screen.getByText(/^Pickup:/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Move the pickup" })).toBeNull();
      expect(screen.queryByTestId("declutter-no-show-warning")).toBeNull();
      r.unmount();
    }
  });

  // NIGHT-BUYINGopenpr-7: "Pick a daytime slot. Bring someone with you" showed under a held no-show order, both sides.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | {order.handover === "pickup_home" && !problem && !noShowWaiting && <DoorPickupTips | {order.handover === "pickup_home" && !problem && <DoorPickupTips
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | {order.handover === "pickup_home" && !problem && !noShowWaiting && <DoorPickupTips | {order.handover === "pickup_home" && !noShowWaiting && <DoorPickupTips
  it("openpr-7: a held door-pickup order shows no pickup tips, on either side", async () => {
    state.bookings = [slot(30)];
    const before = show([line({ my_side: "buyer" })]);
    expect(await screen.findByText("Pickup at the door")).toBeInTheDocument();
    before.unmount();
    // The seller's 24 hours after a no-show report (no problem row read yet).
    state.handover = { no_show_reported_at: "2026-10-30T12:00:00Z", no_show_answer_by: "2026-10-31T12:00:00Z" };
    for (const my_side of ["buyer", "seller"] as const) {
      const r = show([line({ my_side })]);
      await screen.findByText(/has until|^Answer by/);
      expect(screen.queryByText("Pickup at the door")).toBeNull();
      expect(screen.queryByText(/Bring someone with you|Have someone home with you/)).toBeNull();
      r.unmount();
    }
    // A problem open, no no-show report.
    state.handover = null;
    state.problems = [damaged];
    for (const my_side of ["buyer", "seller"] as const) {
      const r = show([line({ my_side })]);
      await screen.findByText("Problem reported: Louisiana Helpr is looking.");
      expect(screen.queryByText("Pickup at the door")).toBeNull();
      r.unmount();
    }
  });

  it("porch, not out yet: no 'You can tap I got it' promise while a problem is open", async () => {
    state.bookings = [slot(-120)];
    const before = show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByText(/You can tap "I got it" once the seller puts it out/)).toBeInTheDocument();
    before.unmount();
    state.problems = [damaged];
    show([line({ handover: "porch", porch_ok: true })]);
    await screen.findByText("Problem reported: Louisiana Helpr is looking.");
    expect(screen.queryByText(/You can tap "I got it"/)).toBeNull();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
  });

  it("a seller delivery: the card tells the delivery panel a problem is open", async () => {
    const before = show([line({ handover: "seller_delivery", delivery_cents: 1500 })]);
    expect(await screen.findByText("Seller delivery panel")).toBeInTheDocument();
    before.unmount();
    state.problems = [damaged];
    show([line({ handover: "seller_delivery", delivery_cents: 1500 })]);
    expect(await screen.findByText("Seller delivery panel, problem open")).toBeInTheDocument();
  });
});

// DC-16 (Declutter selling audit 2026-10-30, ~/.lh-shots/declutter-audit-1030/selling/dc-sold-handover-p1/p2-375wk.png):
// a porch sale card showed the tracker, where it stands and "You get $10 once the sale is final"; the seller-delivers
// card under it showed none of the three, and the porch tracker's third step read "On the po..." at 375. ONE sale card:
// every handover kind on the seller's side draws the same three parts, and a step name wraps instead of being cut.
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | {!view && order.handover === "seller_delivery" && <SellerDeliveryStatus | {false && order.handover === "seller_delivery" && <SellerDeliveryStatus
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | order.handover === "pickup_home" \|\| order.handover === "meetup") && ( | order.handover === "pickup_home") && (
// @mutate src/components/tracker/StepTracker.tsx | mt-1.5 block break-words text-ds-12 leading-tight | mt-1.5 block truncate text-ds-12
describe("DC-16: one sale card on the seller's side, every handover kind", () => {
  beforeEach(() => {
    state.bookings = [];
    state.payouts = [];
    state.problems = [];
    state.handover = null;
    state.meetup = null;
    state.sd = null;
  });

  const parts = async (handover: string) => {
    const steps = await waitFor(() => {
      const el = document.querySelector(`[data-order-steps="${handover}"]`);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(await screen.findByText(/^You get .*You're paid 24 hours after the buyer taps "I got it"/)).toBeInTheDocument();
    return steps;
  };

  it("a seller-delivers sale shows the tracker, where it stands and the money note, from its booking", async () => {
    state.sd = { order_id: "o1", side: "seller", order_status: "paid", status: "booked", slot_start: "2026-10-31T14:00:00Z", slot_end: "2026-10-31T15:00:00Z", delivered_at: null };
    show([line({ handover: "seller_delivery", my_side: "seller", price_cents: 2800, delivery_cents: 800 })]);
    const steps = await parts("seller_delivery");
    expect(steps.getAttribute("data-order-step")).toBe("1");
    expect(within(steps).getByText("Time booked")).toBeInTheDocument();
    expect(screen.getByText("Booked. The delivery time is below.")).toBeInTheDocument();
    // The panel below still draws the booking itself.
    expect(screen.getByText("Seller delivery panel")).toBeInTheDocument();
  });

  // AUD31-1: the seller who delivers is paid the items AND the delivery; the note says both, once.
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx |   const sellerCents = itemsCents + Math.max(0, deliveryCents); |   const sellerCents = itemsCents;
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx |         deliveryCents={b.data.delivery_cents ?? 0} /> |         />
  it("AUD31-1: a seller-delivers sale's money note names the item price plus the delivery", async () => {
    state.sd = { order_id: "o1", side: "seller", order_status: "paid", status: "booked", slot_start: "2026-10-31T14:00:00Z", slot_end: "2026-10-31T15:00:00Z", delivered_at: null, delivery_cents: 1000 };
    show([line({ handover: "seller_delivery", my_side: "seller", price_cents: 4500, delivery_cents: 1000 })]);
    const note = await screen.findByText(/^You get/);
    expect(note.textContent).toMatch(/^You get \$55 \(\$45 for the sale and \$10 for delivering it\)\. You're paid 24 hours after the buyer taps "I got it"/);
  });

  // AUD31-3, the seller's side: a move the buyer asked for waits on the seller's answer, and the sentence said "Booked".
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx | p.proposed_by && p.proposed_by !== side | p.proposed_by && p.proposed_by === side
  it("AUD31-3: a move the buyer asked for is named on the seller's card, not 'Booked'", async () => {
    state.sd = { order_id: "o1", side: "seller", order_status: "paid", status: "booked", slot_start: "2026-10-31T14:00:00Z", slot_end: "2026-10-31T15:00:00Z", delivered_at: null,
      proposed_start: "2026-11-01T15:00:00Z", proposed_by: "buyer" };
    show([line({ handover: "seller_delivery", my_side: "seller", price_cents: 2800, delivery_cents: 800 })]);
    const said = await screen.findByText(/^The buyer asked to move it to .+\. Accept the new time or keep it, below\.$/);
    expect(said.textContent!.length).toBeGreaterThan(40);
    expect(screen.queryByText("Booked. The delivery time is below.")).toBeNull();
    // Its own request is not something to answer: the sentence stays as it was.
    cleanup();
    state.sd = { ...state.sd, proposed_by: "seller" };
    show([line({ handover: "seller_delivery", my_side: "seller", price_cents: 2800, delivery_cents: 800 })]);
    expect(await screen.findByText("Booked. The delivery time is below.")).toBeInTheDocument();
  });

  it("delivered: step 3, and the seller is told the buyer confirms", async () => {
    state.sd = { order_id: "o1", side: "seller", order_status: "paid", status: "booked", slot_start: "2026-10-31T14:00:00Z", slot_end: null, delivered_at: "2026-10-31T14:20:00Z" };
    show([line({ handover: "seller_delivery", my_side: "seller", price_cents: 2800, delivery_cents: 800 })]);
    const steps = await parts("seller_delivery");
    expect(steps.getAttribute("data-order-step")).toBe("2");
    expect(screen.getByText("Delivered. The buyer says when they have it.")).toBeInTheDocument();
  });

  it("a meetup sale shows the same three parts, in meetup words", async () => {
    show([line({ handover: "meetup", my_side: "seller" })]);
    const steps = await parts("meetup");
    expect(within(steps).getByText("Met")).toBeInTheDocument();
    expect(screen.getByText("Paid. The buyer books a time to meet.")).toBeInTheDocument();
  });

  it("porch and door pickup keep theirs (the kinds that had it)", async () => {
    for (const handover of ["porch", "pickup_home"]) {
      const { unmount } = show([line({ handover, my_side: "seller" })]);
      await parts(handover);
      unmount();
    }
  });

  it("a step name wraps, never cut with an ellipsis", async () => {
    show([line({ handover: "porch", my_side: "seller" })]);
    const steps = await parts("porch");
    const label = within(steps).getByText("On the porch");
    expect(label.className).not.toMatch(/\btruncate\b/);
    expect(label.className).toMatch(/\bbreak-words\b/);
  });
});

// NIGHT-SELL-soldstates-2 (night audit 10-30, seller sold states #2): Selling's "Hand over" listed paid-out, refunded
// and still-to-hand-over sales mixed, in cart order. The sales still to hand over come first, then handed over, then
// refunded; cart order inside each.
// @mutate src/components/declutter/paidOrders.ts | const SALE_RANK: Readonly<Record<string, number>> = { handed_over: 1, refunded: 2 }; | const SALE_RANK: Readonly<Record<string, number>> = {};
// @mutate src/components/declutter/paidOrders.ts | sort((a, b) => a.r - b.r \|\| a.i - b.i) | sort((a, b) => a.i - b.i)
describe("Selling's sale cards: still to hand over first, refunded last (soldstates-2)", () => {
  it("live sales come before handed-over ones, and refunded ones last, whatever the cart order", async () => {
    const sale = (n: number, order_status: string) => line({ line_id: `l${n}`, item_id: `i${n}`, item_title: `Sale ${n}`, my_side: "seller", order_id: `o${n}`, order_status });
    state.bookings = [];
    show([sale(1, "refunded"), sale(2, "handed_over"), sale(3, "paid"), sale(4, "handed_over"), sale(5, "paid")]);
    const order = () => Array.from(document.querySelectorAll("article")).map((a) => /Sale (\d)/.exec(a.textContent ?? "")?.[1]);
    await waitFor(() => expect(order().length).toBe(5));
    expect(order()).toEqual(["3", "5", "2", "4", "1"]);
  });
});

// BUY-30: a notice about one order links ?tab=...&order=<id> (migration 20261031111949); the card opens there.
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | show(o.orderId) \|\| o.orderId === linked | show(o.orderId)
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |   useScrollToLinkedOrder(cardRef, linked, () => setOpen(true)); |
// @mutate src/components/declutter/useLinkedOrder.ts |     ref.current.focus({ preventScroll: true }); |
describe("BUY-30: a notice's ?order= opens that order's card", () => {
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  const at = (url: string, chip?: (id: string) => boolean) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={qc}><PaidOrdersSection cart={[
      line({ line_id: "la", item_id: "ia", item_title: "Sale A", my_side: "seller", order_id: A }),
      line({ line_id: "lb", item_id: "ib", item_title: "Sale B", my_side: "seller", order_id: B }),
    ] as never} show={chip} /></QueryClientProvider></MemoryRouter>);
  };
  const card = (title: string) => screen.getByText(title).closest("article") as HTMLElement;

  it("the linked card shows even outside the chosen chip, is scrolled to and takes focus", async () => {
    state.bookings = [];
    const scrolled: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function (this: HTMLElement) { scrolled.push(this.textContent ?? ""); });
    at(`/declutter?tab=selling&order=${B}`, (id) => id === A);
    expect(await screen.findByText("Sale B")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(card("Sale B")));
    expect(card("Sale B").hasAttribute("data-linked-order")).toBe(true);
    expect(card("Sale A").hasAttribute("data-linked-order")).toBe(false);
    expect(scrolled.some((t) => t.includes("Sale B"))).toBe(true);
    spy.mockRestore();
  });

  it("a just-paid return (?paid=1&order=) is not a notice's order: the chip decides and nothing is linked", async () => {
    state.bookings = [];
    at(`/declutter?tab=selling&paid=1&order=${B}`, (id) => id === A);
    expect(await screen.findByText("Sale A")).toBeInTheDocument();
    expect(screen.queryByText("Sale B")).toBeNull();
    expect(document.querySelector("[data-linked-order]")).toBeNull();
  });
});
