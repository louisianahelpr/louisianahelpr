/**
 * The screens of Declutter slice 4 (docs/specs/declutter-auctions.md rows 25-28, 45,
 * 93-99; B49-B58): what each paid-order STATE renders, in plain words, and
 * which call each button makes. The API module is stubbed; the backend proof
 * is src/test/pglite/declutterSlice4.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (Date.now() < new Date(slotStart).getTime() + 15 * 60_000) return null; |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {booking?.slot_start && <HandoverPanel order={order} userId={userId} slotStart={booking.slot_start} who={who} onProblem={() => setProblemOpen(true)} />} |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     if (order.handover !== "pickup_home" && order.handover !== "meetup") { |     if (true) {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     if (Date.now() < new Date(slotStart).getTime()) { |     if (false) {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.handover === "pickup_home" && <DoorPickupTips side={order.side} />} |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (!booked && order.side === "seller") { |   if (false) {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     if (l.status !== "paid" \|\| !l.order_id) continue; |     if (!l.order_id) continue;
 * @mutate src/components/declutter/DeclutterOrderBits.tsx |     queries: lines.map((l) => ({ |     queries: lines.slice(0, 1).map((l) => ({
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       ) : order.handover === "delivery" ? ( |       ) : false ? (
 */
// @mutate src/components/declutter/DeclutterFoldedTime.tsx |       <DateTimeField id={id} label={fieldLabel} value={value} onChange={setValue} /> |       <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
// @mutate src/components/declutter/DeclutterPorchHandover.tsx |     out: !!h.data?.set_out_at, |     out: false,
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |           itemsCents={items} |           itemsCents={order.lines[0]?.total_cents ?? 0}
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
};

vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => state.features.includes(key) }));
// Board 141's refund panel has its own test; here a stub says whether the card offers it.
vi.mock("./DeclutterRefundRequest", () => ({ DeclutterRefundPanel: () => <p>Refund panel</p> }));

// The shared day + time pickers are exercised in their own tests; here a plain input stands in, same value shape.
vi.mock("@/components/DateTimeField", () => ({
  DateTimeField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyBookings: async () => state.bookings,
  fetchMyPayouts: async () => state.payouts,
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
  OrderDeliveryPanel: ({ taskId, side, tipOnly }: { taskId: string; side: string; tipOnly?: boolean }) =>
    <p>{tipOnly ? `Tip panel ${taskId}` : `Delivery card ${taskId}`} for the {side}</p>,
}));

// Seller delivery's own panel has its own test (sellerDeliveryOrder.test.tsx); this stub keeps its one
// "Report a problem" button, which opens the card's problem form (#51).
vi.mock("./SellerDeliveryOrder", () => ({
  SellerDeliveryOrderPanel: ({ onProblem }: { onProblem: () => void }) => (
    <div><p>Seller delivery panel</p><button type="button" onClick={onProblem}>Report a problem</button></div>
  ),
}));

import { PaidOrdersSection } from "./DeclutterHandoverViews";
import { pickupDays } from "@/lib/declutter/pickupSlots";

function show(cart: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PaidOrdersSection cart={cart as never} /></QueryClientProvider>);
}
const line = (over: Record<string, unknown> = {}) => ({
  line_id: "l1", item_id: "i1", item_title: "Oak chair", my_side: "buyer", seller_id: "s1", price_cents: 4000, status: "paid",
  checkout_by: "2026-10-16T00:00:00Z", order_id: "o1", order_status: "paid", handover: "pickup_home", premium_cents: 270, total_cents: 4270, ...over,
});
const slot = (minsAgo: number) => ({
  order_id: "o1", slot_start: new Date(Date.now() - minsAgo * 60_000).toISOString(),
  slot_end: new Date(Date.now() - minsAgo * 60_000 + 30 * 60_000).toISOString(), porch_mode: null, porch_until: null,
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

  it("at the meeting time the seller gets Picked up, as at the door", async () => {
    state.bookings = [slot(5)];
    show([line({ handover: "meetup", my_side: "seller" })]);
    expect(await screen.findByRole("button", { name: "Picked up" })).toBeInTheDocument();
  });
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
    expect(await screen.findByText(/You're paid 24 hours after the handover, unless the buyer asks for a refund. The handover is when the buyer taps "I got it" or you tap "Picked up"/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
    expect(screen.queryByLabelText(/code/i)).toBeNull();
    expect(screen.getByText("Pickup at the door")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Picked up" }));
    const picked = await screen.findByRole("dialog");
    expect(within(picked).getByText("Did Dana take it?")).toBeInTheDocument();
    fireEvent.click(within(picked).getByRole("button", { name: "Picked up" }));
    await waitFor(() => expect(state.calls).toContainEqual(["seller_picked_up", "o1", null]));
  });

  it("door pickup (owner 2026-10-18): both sides get the safety tips; the buyer is pointed to Add a Helpr; porch has no tips and no seller \"Picked up\"", async () => {
    state.bookings = [slot(-60)];
    const { unmount } = show([line()]);
    expect(await screen.findByText("Pickup at the door")).toBeInTheDocument();
    expect(screen.getByText(/Add a Helpr below/)).toBeInTheDocument();
    unmount();
    show([line({ handover: "porch", my_side: "seller" })]);
    expect(await screen.findByText(/if you posted the porch photo/)).toBeInTheDocument();
    expect(screen.queryByText("Pickup at the door")).toBeNull();
    expect(screen.queryByRole("button", { name: "Picked up" })).toBeNull();
  });

  it("door pickup: the seller's \"Picked up\" appears only from the booked time (lh-money-escrow review #1)", async () => {
    state.bookings = [slot(-60)];
    show([line({ my_side: "seller" })]);
    expect(await screen.findByText(/you tap "Picked up" from the pickup time/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Picked up" })).toBeNull();
  });

  it("porch: the buyer is told the \"Picked up\" photo pays the seller (row 99), and can tap \"I got it\" instead", async () => {
    state.bookings = [slot(-60)];
    show([line({ handover: "porch" })]);
    expect(await screen.findByLabelText(/this pays the seller/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I got it" })).toBeInTheDocument();
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

  it("Report a problem needs a note and sends the reason (rows 15, 67)", async () => {
    show([line()]);
    fireEvent.click(await screen.findByRole("button", { name: "Report a problem" }));
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("What went wrong?"), { target: { value: "damaged" } });
    fireEvent.change(screen.getByLabelText("Tell us what happened"), { target: { value: "Leg is cracked" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.calls).toContainEqual(["problem", "o1", "damaged", "Leg is cracked", []]));
  });

  it("after handover: the seller sees the payout (minus a fee debt) and both can review (rows 45, 93)", async () => {
    state.payouts = [{ order_id: "o1", items_cents: 4000, delivery_cents: 0, refunded_cents: 0, debt_cents: 150, amount_cents: 3850, status: "succeeded", executed_at: null }];
    show([line({ my_side: "seller", order_status: "handed_over" })]);
    expect(await screen.findByText(/\$38\.50 \(\$40 minus \$1\.50 you owed\)/)).toBeInTheDocument();
    expect(screen.getByText("Review o1 as the seller (me)")).toBeInTheDocument();
  });

  // Boards 71/72: the one tracker, where it stands, and the money note, from the real handover row.
  it("board 71: porch, the buyer: On the porch once the seller's photo is in, the photo shown, what the buyer paid", async () => {
    state.bookings = [slot(-120)];
    state.handover = { set_out_at: "2026-10-20T15:00:00Z", set_out_photo_path: "s1/declutter/handover/o1/out.jpg" };
    show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByRole("list", { name: "Step 3 of 4: On the porch" })).toBeInTheDocument();
    expect(screen.getByText("It's out. Pick it up at your pickup time.")).toBeInTheDocument();
    expect(screen.getByText(/You paid/).textContent).toMatch(/You paid \$42\.70\. The seller is paid after you pick it up\./);
    expect(await screen.findByAltText("Where the item was left")).toHaveAttribute("src", "https://signed.test/s1/declutter/handover/o1/out.jpg");
  });

  it("board 72: porch, the seller: booked until the photo, told to put it out, and paid the whole item price by the real rule", async () => {
    // Booked but no porch photo yet: still Paid (a porch pickup is Ready only once the photo is in).
    state.bookings = [slot(-120)];
    state.handover = { side: "seller" };
    show([line({ my_side: "seller", handover: "porch", porch_ok: true })]);
    expect((await screen.findAllByText(/^Pickup:/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Step 2 of 4: Day picked" })).toBeInTheDocument();
    expect(screen.getByText("Paid. Put it out and take one photo where the buyer will find it.")).toBeInTheDocument();
    // Deep audit #31: one payout rule, the live one (24 hours after the handover), never "when the buyer marks it".
    // @mutate src/components/declutter/DeclutterPorchHandover.tsx | once the sale is final: 24 hours after the handover, unless the buyer asks for a refund. | when the buyer marks it picked up.
    expect(screen.getByText(/You get/).textContent).toBe("You get $40 once the sale is final: 24 hours after the handover, unless the buyer asks for a refund.");
  });

  // Lead 2026-10-28 (Buying, calmer): where a pickup stands is said in plain sentences, never dot-joined fragments
  // ("Paid · book a pickup…"), and a buyer's card no longer repeats "You're buying". The class: every step of every
  // pickup kind, for both sides, read from the rendered card.
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx |     if (at === 0) return side === "buyer" ? "Paid. Book a pickup time." : "Paid. The buyer books a pickup time."; |     if (at === 0) return side === "buyer" ? "Paid · book a pickup time." : "Paid. The buyer books a pickup time.";
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx | {done ? "." : ". The seller is paid after you pick it up."} | {done ? "." : " · the seller is paid after you pick it up."}
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | {order.side === "seller" ? " · You're selling" : ""} | {order.side === "seller" ? " · You're selling" : " · You're buying"}
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
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.handover === "porch"\n            ? <PorchDayPanel | {false\n            ? <PorchDayPanel
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx |       return "Not out yet. We'll tell you when it's on the porch. Don't go before then."; |       return "Booked. Pick it up on your day.";
  // @mutate src/components/declutter/DeclutterPorchHandover.tsx |       return porchDayIsNow(day) ? "It's out. Pick it up today." | return porchDayIsNow(day) ? "It's out. Pick it up at your pickup time."
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {order.side === "seller" && !booking.pickup_day && ( |       {order.side === "seller" && (
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | slotStart={noShowFrom(booking) ?? booking.slot_start} | slotStart={booking.slot_start}
  it("owner 10-28: a porch pickup is a DAY: pick one of the seller's days, told not to go until it's out, then 'Pick it up today'", async () => {
    const today = new Date();
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const tomorrow = key(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
    const later = key(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3));
    state.porchDays = [tomorrow, later];
    // 1. Not booked: the buyer picks a day (never a time), then books it.
    const first = show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("Paid. Pick a day to collect it from the porch.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pick a pickup time")).toBeNull();
    const bookIt = await screen.findByRole("button", { name: "Book this day" });
    expect(bookIt).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(bookIt);
    await waitFor(() => expect(state.calls).toContainEqual(["book_day", "o1", tomorrow]));
    first.unmount();

    // 2. Booked, not out yet: don't go; no "They didn't show" while the day is not over.
    state.bookings = [{ ...slot(-60), pickup_day: key(today) }];
    const second = show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("Not out yet. We'll tell you when it's on the porch. Don't go before then.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Step 2 of 4: Day picked" })).toBeInTheDocument();
    expect(screen.getByText(/Pickup day:/).textContent).toMatch(/Today/);
    expect(screen.queryByRole("button", { name: "They didn't show" })).toBeNull();
    second.unmount();

    // 3. The porch photo is in: pick it up today.
    state.handover = { set_out_at: new Date().toISOString(), set_out_photo_path: "s1/declutter/handover/o1/out.jpg" };
    const third = show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("It's out. Pick it up today.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Step 3 of 4: On the porch" })).toBeInTheDocument();
    third.unmount();

    // 4. The seller: put it out that day; no "Out all day" / "Out until" for a day.
    state.handover = { side: "seller" };
    state.bookings = [{ ...slot(-60), pickup_day: tomorrow }];
    show([line({ my_side: "seller", handover: "porch", porch_ok: true })]);
    expect(await screen.findByText("Put it out tomorrow and post the porch photo.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Out all day" })).toBeNull();
    expect(screen.queryByLabelText("Out until")).toBeNull();
    expect(screen.getByText(/once the sale is final: 24 hours after the handover/)).toBeInTheDocument();
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
    for (const f of ["src/components/declutter/DeclutterHandoverViews.tsx", "src/components/declutter/DeclutterDeliveryViews.tsx", "src/components/declutter/DeclutterFoldedTime.tsx"]) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, f).not.toMatch(/type="datetime-local"/);
      expect(src, f).toMatch(/<DateTimeField\b/);
    }
    const hv = blankComments(readFileSync("src/components/declutter/DeclutterHandoverViews.tsx", "utf8"));
    expect(hv).toMatch(/Take the porch photo/);
  });
});

/**
 * Boards 159 + 160 (Builder 3c): the handover moments are sheets.
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | if (f) { if (order.side === "seller") setPreview(f); else photo.mutate({ file: f }); } | if (f) photo.mutate({ file: f });
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |         onProblem={() => { setAsking(false); onProblem(); }} |         onProblem={() => setAsking(false)}
 * @mutate src/components/declutter/DeclutterHandoverSheets.tsx | <li>The first missed pickup: {who} can book one new time before the 7-day pickup deadline.</li> | <li>{who} gets one more day.</li>
 * @mutate src/components/declutter/DeclutterHandoverSheets.tsx | : "The sale is cancelled and you get everything back."}</li> | : "The sale is cancelled."}</li>
 * @mutate src/components/declutter/DeclutterHandoverSheets.tsx | onClick={() => file && onSend(file, note.trim())} | onClick={() => file && onSend(file, "")}
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx | {h.data.set_out_note && <p | {false && <p
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
    state.bookings = [slot(-60)];
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
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx | free={order.lines.every((l) => l.price_cents === 0)} | free={false}
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
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | {free ? "" : "You're paid 24 hours after the handover, unless the buyer asks for a refund. "} | {"You're paid 24 hours after the handover, unless the buyer asks for a refund. "}
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |         porch={order.handover === "porch"} free={free} |         porch={order.handover === "porch"}
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | who={who} free={free} pending | who={who} pending
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {refundRequests && items > 0 && ( |           {refundRequests && (
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.side === "seller" && payout && items > 0 && ( |           {order.side === "seller" && payout && (
// @mutate src/components/declutter/DeclutterHandoverViews.tsx | you have it${free ? "." : "; they're paid 24 hours later."} | you have it${"; they're paid 24 hours later."}
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
          const acts = side === "buyer" ? at !== null : handover === "pickup_home" && at === 30;
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
    expect(screen.getByText(/We send it once the sale is final/)).toBeInTheDocument();
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
