/**
 * The screens of Declutter slice 4 (docs/specs/declutter-auctions.md rows 25-28, 45,
 * 93-99; B49-B58): what each paid-order STATE renders, in plain words, and
 * which call each button makes. The API module is stubbed; the backend proof
 * is src/test/pglite/declutterSlice4.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (Date.now() < new Date(slotStart).getTime() + 15 * 60_000) return null; |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {booking?.slot_start && <HandoverPanel order={order} userId={userId} slotStart={booking.slot_start} />} |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     if (order.handover !== "pickup_home") { |     if (true) {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     if (Date.now() < new Date(slotStart).getTime()) { |     if (false) {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.handover === "pickup_home" && <DoorPickupTips side={order.side} />} |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (!booked && order.side === "seller") { |   if (false) {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     if (l.status !== "paid" \|\| !l.order_id) continue; |     if (!l.order_id) continue;
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     queries: lines.map((l) => ({ |     queries: lines.slice(0, 1).map((l) => ({
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       ) : order.handover === "delivery" ? ( |       ) : false ? (
 */
// @mutate src/components/declutter/DeclutterPorchHandover.tsx |   if (handover === "porch" ? !!h?.set_out_at : booked) return 1; |   if (booked) return 1;
// @mutate src/components/declutter/DeclutterHandoverViews.tsx |           itemsCents={items} |           itemsCents={order.lines[0]?.total_cents ?? 0}
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  bookings: [] as unknown[],
  payouts: [] as unknown[],
  calls: [] as unknown[][],
  handover: null as Record<string, unknown> | null,
};

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
  uploadHandoverPhoto: async () => "me/declutter/handover/o1/x.jpg",
  reportNoShow: async (...a: unknown[]) => { state.calls.push(["no_show", ...a]); return { result: "rebook_offered" }; },
  reportProblem: async (...a: unknown[]) => { state.calls.push(["problem", ...a]); return "p1"; },
  leaveReview: async (...a: unknown[]) => { state.calls.push(["review", ...a]); return "r1"; },
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

describe("Declutter slice 4: paid-order cards", () => {
  beforeEach(() => {
    state.bookings = [];
    state.payouts = [];
    state.calls = [];
    state.handover = null;
    vi.spyOn(window, "confirm").mockReturnValue(true);
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
    await waitFor(() => expect(state.calls).toContainEqual(["confirm", "o1"]));
    expect(screen.queryByText(/4-digit|handover code/i)).toBeNull();
    unmount();
    state.calls = [];
    state.bookings = [slot(10)];
    show([line({ my_side: "seller" })]);
    expect(await screen.findByText(/You're paid when the buyer taps "I got it" or you tap "Picked up"/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
    expect(screen.queryByLabelText(/code/i)).toBeNull();
    expect(screen.getByText("Pickup at the door")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Picked up" }));
    await waitFor(() => expect(state.calls).toContainEqual(["seller_picked_up", "o1", null]));
  });

  it("door pickup (owner 2026-10-18): both sides get the safety tips; the buyer is pointed to Add a Helpr; porch has no tips and no seller \"Picked up\"", async () => {
    state.bookings = [slot(-60)];
    const { unmount } = show([line()]);
    expect(await screen.findByText("Pickup at the door")).toBeInTheDocument();
    expect(screen.getByText(/Add a Helpr below/)).toBeInTheDocument();
    unmount();
    show([line({ handover: "porch", my_side: "seller" })]);
    expect(await screen.findByText(/if you posted the "Left on porch" photo/)).toBeInTheDocument();
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
    state.payouts = [{ order_id: "o1", items_cents: 4000, debt_cents: 150, amount_cents: 3850, status: "succeeded", executed_at: null }];
    show([line({ my_side: "seller", order_status: "handed_over" })]);
    expect(await screen.findByText(/\$38\.50 \(\$40 minus \$1\.50 you owed\)/)).toBeInTheDocument();
    expect(screen.getByText("Review the buyer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Send review" }));
    await waitFor(() => expect(state.calls).toContainEqual(["review", "o1", 5, null]));
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
    expect(screen.getByText("Handed over. The sale is final.")).toBeInTheDocument();
  });
});
