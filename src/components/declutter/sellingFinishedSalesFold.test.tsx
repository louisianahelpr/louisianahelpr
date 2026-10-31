/**
 * NIGHT-SELL-soldstates-2 (rest): Selling's "Hand over" listed finished sales (handed over, refunded) with the live
 * ones. b75 put the live ones first; the finished ones now fold under "Show N finished sales", as Buying folds Done.
 * A chip's own `show` (To answer's reported sales) is never folded.
 *
 * @mutate src/components/declutter/DeclutterTabParts.tsx |       show={done.size > 0 && !showDone ? (id) => !done.has(id) : show} |       show={show}
 * @mutate src/components/declutter/DeclutterTabParts.tsx | l.order_status === "handed_over" \|\| l.order_status === "refunded" | l.order_status === "refunded"
 * @mutate src/components/declutter/DeclutterTabParts.tsx |   if (allDone && !showDone) { |   if (false) {
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ cart: [] as Record<string, unknown>[] }));
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
  status: "paid", order_id: `o${n}`, order_status, handover: "pickup_home",
});

function show(onlyShow?: (id: string) => boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><PaidOrders side="seller" show={onlyShow} /></QueryClientProvider>);
}

describe("soldstates-2: Selling folds finished sales", () => {
  beforeEach(() => { state.cart = []; });

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

  it("a chip's own list (To answer's reports) is never folded", async () => {
    state.cart = [line(1, "paid"), line(2, "handed_over")];
    show((id) => id === "o2");
    expect(await screen.findByText("Sale 2 handed_over")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finished sale/ })).toBeNull();
  });
});
