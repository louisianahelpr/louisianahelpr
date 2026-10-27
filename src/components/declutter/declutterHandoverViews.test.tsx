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
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     queries: lines.map((l) => ({ |     queries: lines.slice(0, 1).map((l) => ({
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       ) : order.handover === "delivery" ? ( |       ) : false ? (
 */
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |             <DateTimeField id={`dcl-out-${order.orderId}`} label="Out until" value={until} onChange={setUntil} /> |             <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
// @mutate src/components/declutter/DeclutterPorchHandover.tsx |   if (handover === "porch" ? !!h?.set_out_at : booked) return 1; |   if (booked) return 1;
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
  /** Q2425: the spot frozen on a meetup order (declutter_order_meetups). */
  meetup: null as Record<string, unknown> | null,
};

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
  fetchItemAddress: async (itemId: string) => ({
    pickup_address: itemId === "i2" ? "9 Far Rd, Baton Rouge" : "1234 Example St, Baton Rouge", pickup_lat: 30.45, pickup_lng: -91.15,
  }),
  bookPickup: async (...a: unknown[]) => { state.calls.push(["book", ...a]); return { result: "booked" }; },
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
  OrderDeliveryPanel: ({ taskId, side }: { taskId: string; side: string }) => <p>Delivery card {taskId} for the {side}</p>,
}));

import { PaidOrdersSection } from "./DeclutterHandoverViews";

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
    expect(screen.getByText(/Meet at a safe spot · You're buying/)).toBeInTheDocument();
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
    expect(screen.getByText(/Helpr delivery · You're buying/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Pick a pickup time")).toBeNull();
    expect(screen.queryByText("1234 Example St, Baton Rouge")).toBeNull();
    expect(screen.queryByRole("button", { name: "They didn't show" })).toBeNull();
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument();
  });

  it("the buyer sees the address and books the pickup; the seller waits for the buyer (rows 14, 98)", async () => {
    const { unmount } = show([line()]);
    expect(await screen.findByText("1234 Example St, Baton Rouge")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pick a pickup time"), { target: { value: "2026-10-20T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Book" }));
    await waitFor(() => expect(state.calls[0]?.[0]).toBe("book"));
    unmount();
    show([line({ my_side: "seller" })]);
    expect(await screen.findByText(/Waiting for the buyer to book a pickup time/)).toBeInTheDocument();
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
    expect(within(noShow).getByText(/you get everything back, including the buyer's fee/)).toBeInTheDocument();
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
  it("board 71: porch, the buyer: Ready once the seller's photo is in, the photo shown, what the buyer paid", async () => {
    state.bookings = [slot(-120)];
    state.handover = { set_out_at: "2026-10-20T15:00:00Z", set_out_photo_path: "s1/declutter/handover/o1/out.jpg" };
    show([line({ handover: "porch", porch_ok: true })]);
    expect(await screen.findByRole("list", { name: "Step 2 of 4: Ready" })).toBeInTheDocument();
    expect(screen.getByText("Ready · it's out. Pick it up at your pickup time.")).toBeInTheDocument();
    expect(screen.getByText(/You paid/).textContent).toMatch(/You paid \$42\.70 · the seller is paid after you pick it up/);
    expect(await screen.findByAltText("Where the item was left")).toHaveAttribute("src", "https://signed.test/s1/declutter/handover/o1/out.jpg");
  });

  it("board 72: porch, the seller: Paid until the photo, told to put it out, and paid the whole item price by the real rule", async () => {
    // Booked but no porch photo yet: still Paid (a porch pickup is Ready only once the photo is in).
    state.bookings = [slot(-120)];
    state.handover = { side: "seller" };
    show([line({ my_side: "seller", handover: "porch", porch_ok: true })]);
    expect((await screen.findAllByText(/^Pickup:/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Step 1 of 4: Paid" })).toBeInTheDocument();
    expect(screen.getByText("Paid · put it out and take one photo where the buyer will find it.")).toBeInTheDocument();
    expect(screen.getByText(/You get/).textContent).toMatch(/You get \$40 when the buyer marks it picked up, or 24 hours after the pickup time once your porch photo is in/);
  });

  it("a handed-over pickup reads Done on the tracker", async () => {
    state.handover = { status: "handed_over", confirmed_at: "2026-10-20T15:00:00Z" };
    show([line({ order_status: "handed_over" })]);
    expect(await screen.findByRole("list", { name: "Step 4 of 4: Done" })).toBeInTheDocument();
    expect(screen.getByText("Handed over.")).toBeInTheDocument();
  });

  // Lead review (71/72): the app's own day + time pickers and a real photo button, never the bare browser controls.
  it("pickup times use the shared DateTimeField and the porch photo is a button, not a bare file box", () => {
    for (const f of ["src/components/declutter/DeclutterHandoverViews.tsx", "src/components/declutter/DeclutterDeliveryViews.tsx"]) {
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
 * @mutate src/components/declutter/DeclutterHandoverSheets.tsx | <li>The sale is cancelled and you get everything back, including the buyer's fee.</li> | <li>The sale is cancelled.</li>
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
    expect(within(sheet).getByText(/item price back \(not the buyer's fee\), and your item goes back on sale/)).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/\b(he|she|him|her)\b/);
    fireEvent.click(within(sheet).getByRole("button", { name: "Not now" }));
    expect(state.calls).toEqual([]);
  });
});
