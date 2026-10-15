/**
 * The screens of Declutter slice 4 (docs/specs/declutter-auctions.md rows 25-28, 45,
 * 93-99; B49-B58): what each paid-order STATE renders, in plain words, and
 * which call each button makes. The API module is stubbed; the backend proof
 * is src/test/pglite/declutterSlice4.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (Date.now() < new Date(slotStart).getTime() + 15 * 60_000) return null; |
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |         {card.data?.code && ( |         {false && (
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |             onClick={() => confirm.mutate({ method: "code", code })}> |             onClick={() => confirm.mutate({ method: "buyer", code: null })}>
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   if (!booked && order.side === "seller") { |   if (false) {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     if (l.status !== "paid" \|\| !l.order_id) continue; |     if (!l.order_id) continue;
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     queries: lines.map((l) => ({ |     queries: lines.slice(0, 1).map((l) => ({
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  bookings: [] as unknown[],
  payouts: [] as unknown[],
  handover: { code: "4821", code_locked: false } as Record<string, unknown>,
  calls: [] as unknown[][],
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyBookings: async () => state.bookings,
  fetchMyPayouts: async () => state.payouts,
  fetchMyHandover: async () => state.handover,
  fetchItemAddress: async (itemId: string) => ({
    pickup_address: itemId === "i2" ? "9 Far Rd, Baton Rouge" : "1234 Example St, Baton Rouge", pickup_lat: 30.45, pickup_lng: -91.15,
  }),
  bookPickup: async (...a: unknown[]) => { state.calls.push(["book", ...a]); return { result: "booked" }; },
  confirmHandover: async (...a: unknown[]) => { state.calls.push(["confirm", ...a]); return { result: "handed_over" }; },
  setPorchTime: async (...a: unknown[]) => { state.calls.push(["porch_time", ...a]); },
  porchPhoto: async (...a: unknown[]) => { state.calls.push(["porch_photo", ...a]); return { result: "set_out" }; },
  uploadHandoverPhoto: async () => "me/declutter/handover/o1/x.jpg",
  reportNoShow: async (...a: unknown[]) => { state.calls.push(["no_show", ...a]); return { result: "rebook_offered" }; },
  reportProblem: async (...a: unknown[]) => { state.calls.push(["problem", ...a]); return "p1"; },
  leaveReview: async (...a: unknown[]) => { state.calls.push(["review", ...a]); return "r1"; },
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
    state.handover = { code: "4821", code_locked: false };
    state.calls = [];
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("an unpaid cart shows nothing (inventory: only paid lines become cards)", async () => {
    const { container } = show([line({ status: "in_cart", order_id: null, order_status: null })]);
    await new Promise((r) => setTimeout(r, 10));
    expect(container.textContent).toBe("");
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

  it("pickup at home: the buyer gets the 4-digit code and \"I got it\"; the seller types the code (rows 25, 93)", async () => {
    state.bookings = [slot(-60)];
    const { unmount } = show([line()]);
    expect(await screen.findByText("4821")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I got it" }));
    await waitFor(() => expect(state.calls).toContainEqual(["confirm", "o1", "buyer", null]));
    unmount();
    state.calls = [];
    state.handover = { code: null, code_locked: false };
    show([line({ my_side: "seller" })]);
    fireEvent.change(await screen.findByLabelText(/The buyer's 4-digit code/), { target: { value: "48a21" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(state.calls).toContainEqual(["confirm", "o1", "code", "4821"]));
    expect(screen.queryByText("4821")).toBeNull();
  });

  it("porch: the buyer is told the \"Picked up\" photo pays the seller (row 99)", async () => {
    state.bookings = [slot(-60)];
    show([line({ handover: "porch" })]);
    expect(await screen.findByLabelText(/this pays the seller/)).toBeInTheDocument();
  });

  it("\"They didn't show\" appears only 15 minutes after the booked time (row 94)", async () => {
    state.bookings = [slot(10)];
    const { unmount } = show([line()]);
    await screen.findByText("4821");
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
});
