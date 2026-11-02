/**
 * NIGHT-SELL-soldstates-7 (Low, Seller after posting): refunded and finished sale cards.
 *  - A sale refunded in full after the handover still read "Picked up." / "Handed over. It's yours." and asked for a
 *    review. Each side's card now says it was refunded in full (the review is hidden: declutterReviewWhileRefundOpen).
 *  - A finished Helpr delivery on the seller's card showed only "Handed over.", with no tracker.
 *  - A Helpr delivery's seller card said nothing of the money before the drop-off.
 *
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const fullRefund = refundedInFull(refund.data); |   const fullRefund = false;
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx | {refunded && done ? { who: "info", text: REFUNDED_IN_FULL[side] } : problemOpen && !done ? { who: "info", text: PROBLEM_ON_HOLD }\n        : side === "seller" | {problemOpen && !done ? { who: "info", text: PROBLEM_ON_HOLD }\n        : side === "seller"
 * @mutate src/components/declutter/BuyingOrders.tsx |     case "agreed": return inFull ? REFUNDED_IN_FULL.buyer : null; |     case "agreed": return null;
 * @mutate src/lib/declutter/refundRequests.ts | r.refund_cents >= v.full_refund_cents; | r.refund_cents > 0;
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |       <OrderSteps facts={facts} />\n      <p className="text-ds-14">{refunded ? REFUNDED_IN_FULL.seller | <p className="text-ds-14">{refunded ? REFUNDED_IN_FULL.seller
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {order.side === "seller" && <SellerDeliveryMoney itemsCents={items} problemOpen={!!problem} />} |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  cart: [] as Record<string, unknown>[],
  refund: null as Record<string, unknown> | null,
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
  fetchMyBookings: async () => [],
  fetchMyPayouts: async () => [],
  fetchOpenProblems: async () => [],
  fetchMyHandover: async (orderId: string) => ({ order_id: orderId, status: "handed_over", side: "buyer", confirmed_at: "2026-10-20T15:00:00Z" }),
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
vi.mock("./DeclutterOrderTalk", () => ({ OrderTalkButton: () => null }));
vi.mock("./DeclutterPorchPlaces", () => ({ OrderPorchPlace: () => null }));

import { fetchMyCart } from "@/lib/declutter/api";
import { PaidOrdersSection } from "./DeclutterHandoverViews";
import { useBuyingTracker } from "./BuyingOrders";
import { REFUNDED_IN_FULL, refundedInFull } from "@/lib/declutter/refundRequests";

function Harness({ side }: { side: "buyer" | "seller" }) {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const t = useBuyingTracker();
  if (!cart.data) return null;
  const mine = cart.data.filter((l) => l.my_side === side);
  return <PaidOrdersSection cart={mine} views={side === "buyer" ? t.views : undefined} />;
}
function show(side: "buyer" | "seller") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><Harness side={side} /></QueryClientProvider></MemoryRouter>);
}
const line = (over: Record<string, unknown> = {}) => ({
  line_id: "l1", item_id: "i1", item_title: "Oak chair", my_side: "seller", seller_id: "me", price_cents: 4000, status: "paid",
  checkout_by: "2026-10-16T00:00:00Z", order_id: "o1", order_status: "handed_over", handover: "pickup_home", premium_cents: 230, total_cents: 4230, ...over,
});
const FULL = { id: "r1", status: "agreed", refund_cents: 4084 };
const PART = { id: "r1", status: "agreed", refund_cents: 1500 };

beforeEach(() => {
  state.cart = [line()];
  state.refund = null;
});

describe("refundedInFull", () => {
  it("is a settled request with at least the full refund back", () => {
    expect(refundedInFull({ full_refund_cents: 4084, request: FULL } as never)).toBe(true);
    expect(refundedInFull({ full_refund_cents: 4084, request: { ...FULL, refund_cents: 4230 } } as never)).toBe(true);
    expect(refundedInFull({ full_refund_cents: 4084, request: PART } as never)).toBe(false);
    expect(refundedInFull({ full_refund_cents: 4084, request: { ...FULL, status: "returning" } } as never)).toBe(false);
    expect(refundedInFull({ full_refund_cents: 4084, request: { ...FULL, refund_cents: null } } as never)).toBe(false);
    expect(refundedInFull({ full_refund_cents: 4084, request: null } as never)).toBe(false);
    expect(refundedInFull(undefined)).toBe(false);
  });
});

describe("NIGHT-SELL-soldstates-7: refunded and finished cards", () => {
  it.each(["pickup_home", "porch", "meetup", "seller_delivery"])("%s, refunded in full: the seller's card says so", async (handover) => {
    state.cart = [line({ handover })];
    state.refund = FULL;
    const { container } = show("seller");
    expect(await screen.findByText(REFUNDED_IN_FULL.seller)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Picked up\.|Handed over\.|Met\./);
  });

  it("refunded in part: the seller's card still says it was handed over", async () => {
    state.refund = PART;
    const { container } = show("seller");
    await waitFor(() => expect(container.querySelector("[data-pickup-status]")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).not.toContain(REFUNDED_IN_FULL.seller);
  });

  it("refunded in full: the buyer's card says so, never that it's theirs", async () => {
    state.cart = [line({ my_side: "buyer", seller_id: "s1" })];
    state.refund = FULL;
    const { container } = show("buyer");
    expect(await screen.findByText(REFUNDED_IN_FULL.buyer)).toBeInTheDocument();
    expect(container.textContent).not.toContain("It's yours");
  });

  it("refunded in part: the buyer's card stays handed over", async () => {
    state.cart = [line({ my_side: "buyer", seller_id: "s1" })];
    state.refund = PART;
    show("buyer");
    expect(await screen.findByText("Handed over. It's yours.")).toBeInTheDocument();
  });

  it("a finished Helpr delivery: the seller's card shows the tracker at its end", async () => {
    state.cart = [line({ handover: "delivery", delivery_task_id: "t1" })];
    const { container } = show("seller");
    await waitFor(() => expect(container.querySelector("[data-delivery-done] [data-order-steps]")).not.toBeNull());
    expect(container.querySelector("[data-delivery-done] [data-order-step]")?.getAttribute("data-order-step")).toBe("3");
    expect(container.textContent?.match(/Handed over\./g)).toHaveLength(1);
  });

  it("a finished Helpr delivery refunded in full: the seller's card says so", async () => {
    state.cart = [line({ handover: "delivery", delivery_task_id: "t1" })];
    state.refund = FULL;
    const { container } = show("seller");
    expect(await screen.findByText(REFUNDED_IN_FULL.seller)).toBeInTheDocument();
    expect(container.textContent).not.toContain("Handed over.");
  });

  it("a Helpr delivery before the end: the seller's card shows what they get", async () => {
    state.cart = [line({ handover: "delivery", delivery_task_id: "t1", order_status: "paid" })];
    const { container } = show("seller");
    const note = await waitFor(() => {
      const n = container.querySelector("[data-money-note]");
      expect(n).not.toBeNull();
      return n!;
    });
    expect(note.textContent).toBe("You get $40 once the buyer has it.");
  });

  it("a free Helpr delivery: no money line", async () => {
    state.cart = [line({ handover: "delivery", delivery_task_id: "t1", order_status: "paid", price_cents: 0, premium_cents: 0, total_cents: 0 })];
    const { container } = show("seller");
    await waitFor(() => expect(container.textContent).toContain("Helpr delivery"));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-money-note]")).toBeNull();
  });
});
