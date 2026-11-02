/**
 * NIGHT-SELL-soldstates-2 (rest): Selling's "Hand over" listed finished sales (handed over, refunded) with the live
 * ones. b75 put the live ones first; the finished ones now fold under "Show N finished sales", as Buying folds Done.
 * A chip's own `show` (To answer's reported sales) is never folded.
 *
 * @mutate src/components/declutter/DeclutterTabParts.tsx |       show={done.size > 0 && !showDone ? (id) => !done.has(id) \|\| id === linked : show} |       show={show}
 * @mutate src/components/declutter/DeclutterTabParts.tsx | l.order_status === "handed_over" \|\| l.order_status === "refunded" | l.order_status === "refunded"
 * @mutate src/components/declutter/DeclutterTabParts.tsx |   if (allDone && !showDone && !(linked && done.has(linked))) { |   if (false) {
 * @mutate src/components/declutter/DeclutterTabParts.tsx |  \|\| id === linked : show} |  : show}
 * @mutate src/components/declutter/DeclutterTabParts.tsx |   if (allDone && !showDone && !(linked && done.has(linked))) { |   if (allDone && !showDone) {
 * @mutate src/components/declutter/useLinkedOrder.ts |   if (params.get("paid")) return null; |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  cart: [] as Record<string, unknown>[],
  /** A3-78: each order's refund request view (declutter_refund_request_view); none unless a test sets it. */
  refunds: {} as Record<string, { request: Record<string, unknown> | null }>,
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/lib/declutter/handover", async (orig) => ({
  ...(await orig<object>()),
  fetchOpenProblems: async () => [],
  fetchOrderProblem: async () => null,
  fetchMyHandover: async (orderId: string) => ({ order_id: orderId, status: "paid", side: "seller", confirmed_at: null, set_out_at: null, set_out_photo_path: null, picked_up_at: null }),
}));
vi.mock("@/lib/declutter/refundRequests", async (orig) => ({
  ...(await orig<object>()),
  fetchRefundRequestView: async (orderId: string) => state.refunds[orderId] ?? { request: null },
}));
vi.mock("@/lib/declutter/api", () => ({ fetchMyCart: async () => state.cart, fetchMyOffers: async () => [] }));
vi.mock("./DeclutterHandoverViews", () => ({
  PaidOrdersSection: ({ cart, show, heading }: { cart: { order_id: string; item_title: string }[]; show?: (id: string) => boolean; heading?: React.ReactNode }) => {
    const shown = cart.filter((l) => !show || show(l.order_id));
    if (shown.length === 0) return null;
    return <section>{heading}<ul>{shown.map((l) => <li key={l.order_id}>{l.item_title}</li>)}</ul></section>;
  },
}));

import { PaidOrders } from "./DeclutterTabParts";

const line = (n: number, order_status: string) => ({
  line_id: `l${n}`, item_id: `i${n}`, item_title: `Sale ${n} ${order_status}`, my_side: "seller", seller_id: "s", price_cents: 1000,
  status: "paid", order_id: `00000000-0000-4000-8000-00000000000${n}`, order_status, handover: "pickup_home",
});

function show(onlyShow?: (id: string) => boolean, url = "/declutter?tab=selling") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={qc}><PaidOrders side="seller" show={onlyShow} /></QueryClientProvider></MemoryRouter>);
}

describe("soldstates-2: Selling folds finished sales", () => {
  beforeEach(() => { state.cart = []; state.refunds = {}; });

  // A3-78 (audit 11-01): a finished sale whose refund request waits on the seller (open, or the item dropped back
  // and not confirmed) stays in the list, never under "Show 1 finished sale".
  // @mutate src/components/declutter/DeclutterTabParts.tsx |  && !awaiting.has(l.order_id as string)).map( | ).map(
  // @mutate src/components/declutter/useSellerReportsToAnswer.ts |   return r.status === "open" \|\| (r.status === "returning" && !!r.return_dropped_off_at && !r.returned_at); |   return false;
  it("A3-78: a refund request waiting on the seller keeps its sale out of the fold", async () => {
    state.cart = [line(2, "handed_over"), line(3, "handed_over"), line(4, "handed_over")];
    state.refunds = {
      [line(2, "x").order_id]: { request: { status: "open", answer_by: "2026-11-02T19:46:00Z" } },
      [line(3, "x").order_id]: { request: { status: "returning", return_dropped_off_at: "2026-11-01T18:00:00Z", returned_at: null } },
      [line(4, "x").order_id]: { request: { status: "to_admin" } },
    };
    show();
    expect(await screen.findByText("Sale 2 handed_over")).toBeInTheDocument();
    expect(await screen.findByText("Sale 3 handed_over")).toBeInTheDocument();
    expect(screen.queryByText("Sale 4 handed_over")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 1 finished sale" })).toBeInTheDocument();
  });

  it("live sales show; handed over and refunded fold under one button that opens and closes them", async () => {
    state.cart = [line(1, "paid"), line(2, "handed_over"), line(3, "refunded")];
    show();
    expect(await screen.findByText("Sale 1 paid")).toBeInTheDocument();
    expect(screen.queryByText("Sale 2 handed_over")).toBeNull();
    expect(screen.queryByText("Sale 3 refunded")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 finished sales" }));
    expect(screen.getByText("Sale 2 handed_over")).toBeInTheDocument();
    expect(screen.getByText("Sale 3 refunded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide finished sales" }));
    expect(screen.queryByText("Sale 2 handed_over")).toBeNull();
  });

  it("every sale finished: the heading stays, says nothing to hand over, and the fold opens them", async () => {
    state.cart = [line(2, "handed_over")];
    show();
    expect(await screen.findByText("Nothing to hand over right now.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Sold: pickup and payout/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 finished sale" }));
    expect(screen.getByText("Sale 2 handed_over")).toBeInTheDocument();
  });

  it("BUY-30: a notice's order (?order=) shows even when it is finished, folded or outside the chip", async () => {
    state.cart = [line(1, "paid"), line(2, "handed_over"), line(3, "refunded")];
    show(undefined, "/declutter?tab=selling&order=00000000-0000-4000-8000-000000000003");
    expect(await screen.findByText("Sale 3 refunded")).toBeInTheDocument();
    expect(screen.queryByText("Sale 2 handed_over")).toBeNull();
  });

  it("BUY-30: every sale finished, the notice's order still shows without opening the fold", async () => {
    state.cart = [line(3, "refunded")];
    show(undefined, "/declutter?tab=selling&order=00000000-0000-4000-8000-000000000003");
    expect(await screen.findByText("Sale 3 refunded")).toBeInTheDocument();
  });

  it("BUY-30: a just-paid return (?paid=1&order=) is not a notice's order", async () => {
    state.cart = [line(1, "paid"), line(3, "refunded")];
    show(undefined, "/declutter?tab=selling&paid=1&order=00000000-0000-4000-8000-000000000003");
    expect(await screen.findByText("Sale 1 paid")).toBeInTheDocument();
    expect(screen.queryByText("Sale 3 refunded")).toBeNull();
  });

  it("a chip's own list (To answer's reports) is never folded", async () => {
    state.cart = [line(1, "paid"), line(2, "handed_over")];
    show((id) => id.endsWith("2"));
    expect(await screen.findByText("Sale 2 handed_over")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finished sale/ })).toBeNull();
  });
});
