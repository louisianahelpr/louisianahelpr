/**
 * NIGHT-SELL-soldstates-3 (Seller after posting): "The action is at the bottom of a long card, under the same words
 * twice." Measured b24 10-31 (375x812, own harness): the seller's porch card put Message the buyer, the tracker, its
 * line and a long money box above the pickup, and "Take the porch photo" sat 578px down the card. B18's order: the
 * tracker and its line, the pickup and Move, When will it be out, Take the porch photo, THEN the money note and Message
 * the buyer (photo now 335px down). A finished sale keeps its order.
 *
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {!sellerNextFirst && !problem && <OrderTalkButton orderId={order.orderId} side={order.side} />} |       {!problem && <OrderTalkButton orderId={order.orderId} side={order.side} />}
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           part={sellerNextFirst ? "status" : "all"} |           part="all"
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |       {part === "all" && money} |       {money}
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const sellerNextFirst = !view && order.side === "seller" && !done | const sellerNextFirst = false && !done
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  cart: [] as Record<string, unknown>[],
  refund: null as Record<string, unknown> | null,
  bookings: [] as Record<string, unknown>[],
  handover: (orderId: string): Record<string, unknown> => ({ order_id: orderId, status: "pending", side: "seller" }),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me" } }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => key === "declutter_refund_requests" }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupBlock: () => null }));
vi.mock("@/lib/declutter/api", () => ({ fetchMyCart: async () => state.cart }));
vi.mock("@/lib/declutter/paidCents", () => ({ fetchMyPaidCents: async () => new Map() }));
vi.mock("@/lib/declutter/refundRequests", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/refundRequests")>()),
  fetchRefundRequestView: async (orderId: string) => ({ order_id: orderId, side: "buyer", handed_over: true, full_refund_cents: 4084, request: state.refund }),
}));
// A3-18/19: the order row's pickup times (book_by, the checkout time); none here, so the old words stand.
vi.mock("@/lib/declutter/orderPickupTimes", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/orderPickupTimes")>()), fetchOrderPickupTimes: async () => [] }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyBookings: async () => state.bookings,
  fetchMyPayouts: async () => [],
  fetchOpenProblems: async () => [],
  fetchMyHandover: async (orderId: string) => state.handover(orderId),
  handoverPhotoUrl: async () => "",
  fetchItemAddress: async () => null,
}));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchSellerDeliveryBooking: async (orderId: string) => ({ order_id: orderId, side: "seller", order_status: "handed_over", status: "booked", delivered_at: "2026-10-20T15:00:00Z" }),
}));
vi.mock("@/lib/helprTasks/api", () => ({ fetchTaskView: async (taskId: string) => ({ task_id: taskId, delivered_at: "2026-10-20T15:00:00Z" }) }));
vi.mock("@/lib/declutter/deliveryRaise", () => ({ fetchDeliveryRaiseStatus: async () => null, startDeliveryRaise: vi.fn() }));
vi.mock("./useOrderOtherPerson", () => ({ useOrderOtherPerson: () => ({ otherId: "u2", name: "Dana R", avatarUrl: null, first: "Dana", who: "Dana" }) }));
vi.mock("./DeclutterReviewForm", () => ({ DeclutterReviewForm: () => null }));
vi.mock("./DeclutterDeliveryViews", () => ({ OrderDeliveryPanel: () => null }));
vi.mock("./SellerDeliveryOrder", () => ({ SellerDeliveryOrderPanel: () => null }));
vi.mock("./DeclutterAddHelpr", () => ({ AddHelprPanel: () => null }));
vi.mock("./DeclutterRefundRequest", () => ({ DeclutterRefundPanel: () => null }));
vi.mock("./DeclutterOrderTalk", () => ({ OrderTalkButton: () => <button type="button" data-talk="">Message the buyer</button> }));
vi.mock("./DeclutterPorchPlaces", () => ({ OrderPorchPlace: () => null }));

import { fetchMyCart } from "@/lib/declutter/api";
import { PaidOrdersSection } from "./DeclutterHandoverViews";

function Harness() {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  if (!cart.data) return null;
  return <PaidOrdersSection cart={cart.data.filter((l) => l.my_side === "seller")} />;
}
function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><Harness /></QueryClientProvider></MemoryRouter>);
}
const SLOT = new Date(Date.now() + 26 * 3600_000).toISOString();
const line = (over: Record<string, unknown> = {}) => ({
  line_id: "l1", item_id: "i1", item_title: "Oak chair", my_side: "seller", seller_id: "me", price_cents: 4000, status: "paid",
  checkout_by: "2026-10-16T00:00:00Z", order_id: "o1", order_status: "paid", handover: "porch", premium_cents: 0, total_cents: 4000, ...over,
});
/** Non-zero when a comes before b in the document. */
const before = (a: Element, b: Element) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;

beforeEach(() => {
  state.cart = [line()];
  state.bookings = [{ order_id: "o1", slot_start: SLOT, status: "booked", pickup_day: null }];
  state.handover = (orderId) => ({ order_id: orderId, status: "pending", side: "seller" });
});

describe("NIGHT-SELL-soldstates-3: the seller's open sale leads with the next action", () => {
  it("porch: tracker, pickup + Move, When will it be out, Take the porch photo, then the money note, then Message the buyer", async () => {
    show();
    const photo = await screen.findByRole("button", { name: "Take the porch photo" });
    const card = photo.closest("article")!;
    const steps = card.querySelector("[data-pickup-status]")!;
    const move = within(card).getByRole("button", { name: /Move the pickup/ });
    const when = within(card).getByText("When will it be out?");
    const money = await waitFor(() => { const m = card.querySelector("[data-money-note]"); expect(m).not.toBeNull(); return m!; });
    const talk = card.querySelector("[data-talk]")!;
    expect(card.querySelectorAll("[data-talk]")).toHaveLength(1);
    expect(card.querySelectorAll("[data-money-note]")).toHaveLength(1);
    expect(steps.contains(money)).toBe(false);
    const order = [steps, move, when, photo, money, talk];
    for (let i = 0; i < order.length - 1; i++) expect(before(order[i], order[i + 1]), `step ${i}`).toBeTruthy();
  });

  it("a door pickup too: the money note and Message the buyer come after the pickup", async () => {
    state.cart = [line({ handover: "pickup_home" })];
    show();
    const move = await screen.findByRole("button", { name: /Move the pickup/ });
    const card = move.closest("article")!;
    const money = await waitFor(() => { const m = card.querySelector("[data-money-note]"); expect(m).not.toBeNull(); return m!; });
    expect(before(move, money)).toBeTruthy();
    expect(before(money, card.querySelector("[data-talk]")!)).toBeTruthy();
  });

  it("a finished sale keeps Message the buyer above the tracker", async () => {
    state.cart = [line({ order_status: "handed_over" })];
    state.handover = (orderId) => ({ order_id: orderId, status: "handed_over", side: "seller", confirmed_at: "2026-10-20T15:00:00Z" });
    show();
    const talk = await screen.findByText("Message the buyer");
    const card = talk.closest("article")!;
    await waitFor(() => expect(card.querySelector("[data-pickup-status]")).not.toBeNull());
    expect(before(talk, card.querySelector("[data-pickup-status]")!)).toBeTruthy();
  });
});
