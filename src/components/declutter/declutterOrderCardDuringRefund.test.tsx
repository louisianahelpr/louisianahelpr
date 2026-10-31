/**
 * Audit BUY-31 (10-30): a buyer's order card contradicted a return or a dispute. While the item was going back, or with
 * Louisiana Helpr, it still said "Handed over. It's yours.", offered "Need help moving it?" and "Leave a review"; a
 * delivery printed "Handed over." twice.
 *
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | standing={problem ? null : refundStanding(refundStatus, fullRefund)} | standing={null}
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | bookedOnly={!!problem \|\| refundHoldsTheItem(refundStatus)} | bookedOnly={false}
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |     enabled: done && refundRequests && items > 0, |     enabled: false,
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | {order.handover === "delivery" && !view && <DeliveryDoneStatus | {(order.handover === "delivery" \|\| order.handover === "seller_delivery") && <DeliveryDoneStatus
 * @mutate src/components/declutter/BuyingOrders.tsx | {standing ?? view.standing} | {view.standing}
 * @mutate src/lib/declutter/refundRequests.ts |   return status === "returning" \|\| status === "to_admin"; |   return false;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  cart: [] as Record<string, unknown>[],
  refund: null as string | null,
  refundReads: 0,
  problems: [] as Record<string, unknown>[],
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me" } }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => key === "declutter_refund_requests" }));
vi.mock("@/lib/declutter/api", () => ({ fetchMyCart: async () => state.cart }));
vi.mock("@/lib/declutter/paidCents", () => ({ fetchMyPaidCents: async () => new Map() }));
vi.mock("@/lib/declutter/refundRequests", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/refundRequests")>()),
  fetchRefundRequestView: async (orderId: string) => {
    state.refundReads++;
    return { order_id: orderId, side: "buyer", handed_over: true, request: state.refund ? { id: "r1", status: state.refund } : null };
  },
}));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyBookings: async () => [],
  fetchMyPayouts: async () => [],
  fetchOpenProblems: async () => state.problems,
  fetchMyHandover: async (orderId: string) => ({ order_id: orderId, status: "handed_over", side: "buyer", confirmed_at: "2026-10-20T15:00:00Z" }),
  handoverPhotoUrl: async () => "",
  fetchItemAddress: async () => null,
}));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchSellerDeliveryBooking: async (orderId: string) => ({ order_id: orderId, side: "buyer", order_status: "handed_over", status: "booked", delivered_at: "2026-10-20T15:00:00Z" }),
}));
vi.mock("@/lib/helprTasks/api", () => ({ fetchTaskView: async (taskId: string) => ({ task_id: taskId, delivered_at: "2026-10-20T15:00:00Z" }) }));
vi.mock("@/lib/declutter/deliveryRaise", () => ({ fetchDeliveryRaiseStatus: async () => null, startDeliveryRaise: vi.fn() }));
vi.mock("./useOrderOtherPerson", () => ({ useOrderOtherPerson: () => ({ otherId: "u2", name: "Dana R", avatarUrl: null, first: "Dana", who: "Dana" }) }));
vi.mock("./DeclutterReviewForm", () => ({ DeclutterReviewForm: ({ problemOpen }: { problemOpen?: boolean }) => <p>Review form{problemOpen ? " (problem open)" : ""}</p> }));
vi.mock("./DeclutterDeliveryViews", () => ({ OrderDeliveryPanel: () => null }));
vi.mock("./SellerDeliveryOrder", () => ({ SellerDeliveryOrderPanel: () => null }));
vi.mock("./DeclutterAddHelpr", () => ({ AddHelprPanel: ({ bookedOnly }: { bookedOnly?: boolean }) => <p>Help panel{bookedOnly ? " (booked only)" : " (offers)"}</p> }));
vi.mock("./DeclutterRefundRequest", () => ({ DeclutterRefundPanel: () => null }));

import { fetchMyCart } from "@/lib/declutter/api";
import { PaidOrdersSection } from "./DeclutterHandoverViews";
import { useBuyingTracker } from "./BuyingOrders";

function Harness() {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const t = useBuyingTracker();
  if (!cart.data) return null;
  return <PaidOrdersSection cart={cart.data.filter((l) => l.my_side === "buyer")} views={t.views} />;
}
function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><Harness /></QueryClientProvider></MemoryRouter>);
}
const line = (over: Record<string, unknown> = {}) => ({
  line_id: "l1", item_id: "i1", item_title: "Oak chair", my_side: "buyer", seller_id: "s1", price_cents: 4000, status: "paid",
  checkout_by: "2026-10-16T00:00:00Z", order_id: "o1", order_status: "handed_over", handover: "pickup_home", premium_cents: 230, total_cents: 4230, ...over,
});

beforeEach(() => {
  state.cart = [line()];
  state.refund = null;
  state.refundReads = 0;
  state.problems = [];
});

describe("BUY-31: the order card agrees with a refund", () => {
  it("no refund: handed over, and it's yours, with the review and the help offer", async () => {
    show();
    expect(await screen.findByText("Handed over. It's yours.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText("Review form")).toBeInTheDocument();
    expect(await screen.findByText("Help panel (offers)")).toBeInTheDocument();
  });

  it.each([
    ["returning", "Going back for a refund.", "booked only"],
    ["to_admin", "On hold while Louisiana Helpr decides the refund.", "booked only"],
    ["open", "Handed over. You asked for a refund.", "offers"],
    ["offered", "Handed over. You have a refund offer to answer.", "offers"],
  ])("refund %s: it says so, never that it's yours", async (status, words, help) => {
    state.refund = status;
    const { container } = show();
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(container.textContent).not.toContain("It's yours");
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText(`Help panel (${help})`)).toBeInTheDocument();
  });

  it("a problem open: the card's on-hold line stands, no new help offer, and the review form hears of it", async () => {
    state.refund = "open";
    state.problems = [{ id: "p1", order_id: "o1", opener_side: "buyer" }];
    show();
    expect(await screen.findByText("On hold until the problem is decided.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText("Review form (problem open)")).toBeInTheDocument();
    expect(await screen.findByText("Help panel (booked only)")).toBeInTheDocument();
  });

  it("a free order has no refund to read", async () => {
    state.cart = [line({ price_cents: 0, premium_cents: 0, total_cents: 0 })];
    show();
    await screen.findByText("Handed over. It's yours.");
    await new Promise((r) => setTimeout(r, 20));
    expect(state.refundReads).toBe(0);
  });

  it.each(["seller_delivery", "delivery"])("%s: the buyer's card says Handed over once", async (handover) => {
    state.cart = [line({ handover, delivery_task_id: handover === "delivery" ? "t1" : null })];
    const { container } = show();
    await screen.findByText("Handed over. It's yours.");
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    await waitFor(() => expect(container.querySelector("[data-order-body]")).not.toBeNull());
    expect(container.textContent?.match(/Handed over/g)).toHaveLength(1);
  });
});
