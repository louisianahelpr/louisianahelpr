/**
 * Board 82, "What next" after buying: opens on the Buying tab when checkout returns
 * (?paid=1), only when exactly one paid order is in its handover (the return names no
 * order, so it never guesses). The amount is what the card was charged (A1-B2, prod 2026-10-29: the sheet said
 * "You paid $32.20" after a $34.20 charge): declutter_my_paid_cents, the sale's total_cents plus a first purchase's
 * one-time setup fee that stood, never total_cents alone.
 *
 * @mutate src/components/declutter/BoughtWhatNext.tsx |   const total = orderId ? paidCents?.get(orderId) ?? null : null; |   const total = first.total_cents;
 * @mutate src/components/declutter/BoughtWhatNext.tsx |   return ids.length === 1 ? mine : null; |   return mine.length ? mine : null;
 * B48 live check 2026-10-29: the sheet stayed shut for a buyer with two paid orders. The return names the order
 * (?order=<id>), and the sheet is about that order.
 * @mutate src/components/declutter/BoughtWhatNext.tsx | justPaidOrder(lines, params.get("order")) | justPaidOrder(lines)
 * @mutate src/components/declutter/BoughtWhatNext.tsx | l.my_side === "buyer" && | true &&
 * @mutate src/components/declutter/BoughtWhatNext.tsx |     return named.length ? named : null; |     return mine.length ? mine : null;
 * @mutate supabase/functions/declutter-checkout/index.ts | `/declutter?view=cart&paid=1&order=${order.order_id}` | "/declutter?view=cart&paid=1"
 * @mutate src/components/declutter/DeclutterHomeView.tsx | <><BoughtWhatNext /><Suspense fallback={<DeclutterTabBones />}><BuyingDash todo={todo} /></Suspense></> | <Suspense fallback={<DeclutterTabBones />}><BuyingDash todo={todo} /></Suspense>
 * Audit 1028 D1-3 (1a-b-pay-after-p1-375, 1a-b-meetpay-after-p1-1440): "Pick it up from the porch · Now" before any day
 * was booked, while the card behind said "Pick the day you'll come for it". The Now step is the buyer's real next move.
 * @mutate src/components/declutter/BoughtWhatNext.tsx |     : !!booking.data?.some((b) => b.order_id === orderId && b.slot_start)); |     : true);
 * DB-7 (audit 1030): a seller delivery booked at checkout says "The seller brings it · Now", not "Pick a delivery time".
 * @mutate src/components/declutter/BoughtWhatNext.tsx |     ? sdBooking.data?.status === "booked" && !!sdBooking.data.slot_start | ? false
 * @mutate src/components/declutter/BoughtWhatNext.tsx |       return booked\n        ? [go("The seller brings it", "At the time you picked", true)] |       return false\n        ? [go("The seller brings it", "At the time you picked", true)]
 * @mutate src/components/declutter/BoughtWhatNext.tsx | : [book("Book a time to meet", "In Buying, from the seller's times"), | : [book("Pick it up", "In Buying, from the seller's times"),
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoughtWhatNext, justPaidOrder } from "@/components/declutter/BoughtWhatNext";
import type { CartLine } from "@/lib/declutter/api";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
let cart: Partial<CartLine>[] = [];
vi.mock("@/lib/declutter/api", () => ({ fetchMyCart: async () => cart }));
let paid: Record<string, number> = {};
let bookings: { order_id: string; slot_start: string | null }[] = [];
vi.mock("@/lib/declutter/handover", () => ({ fetchMyBookings: async () => bookings }));
// Audit 1030 DB-7: a seller delivery's own booking (declutter_seller_deliveries; its time is picked at checkout).
let sdBooking: { status: string; slot_start: string | null } | null = null;
vi.mock("@/lib/declutter/sellerDelivery", () => ({ fetchSellerDeliveryBooking: async () => sdBooking }));
vi.mock("@/lib/declutter/paidCents", () => ({
  fetchMyPaidCents: async (ids: string[]) => new Map(ids.filter((id) => id in paid).map((id) => [id, paid[id]])),
}));
const line = (o: Partial<CartLine>): Partial<CartLine> => ({ my_side: "buyer", status: "paid", order_status: "paid", order_id: "o1", item_title: "Box fan", total_cents: 2527, handover: "porch", ...o });

function at(search: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/declutter${search}`]}><BoughtWhatNext /></MemoryRouter></QueryClientProvider>);
}

describe("board 82: after buying", () => {
  it("one paid order: the item, the real total in rust, and its handover step", async () => {
    cart = [line({})];
    paid = { o1: 2527 };
    at("?paid=1&tab=buying");
    expect(await screen.findByRole("heading", { name: "You bought Box fan" })).toBeTruthy();
    expect(await screen.findByText("$25.27")).toBeTruthy();
    const text = screen.getByTestId("what-next-sheet").textContent ?? "";
    expect(text).toContain("You paid $25.27");
    expect(text).toContain("Pick it up from the porch");
    expect(text).not.toMatch(/ships|tracking/i);
  });

  it("A1-B2: a first purchase says the card charge, setup fee included ($27.27), never the sale's $25.27", async () => {
    cart = [line({})];
    paid = { o1: 2727 };
    at("?paid=1&tab=buying");
    expect(await screen.findByText("$27.27")).toBeTruthy();
    expect(screen.getByTestId("what-next-sheet").textContent).not.toContain("$25.27");
  });

  it("D1-3: the Now step is the real next move for each handover, and the pickup only once it's booked", async () => {
    const nowStep = async () => {
      await screen.findByTestId("what-next-sheet");
      const now = [...document.querySelectorAll('[data-testid="what-next-sheet"] li[data-state="now"]')];
      expect(now).toHaveLength(1);
      return now[0].querySelector("p > span")?.textContent;
    };
    const cases: [string, boolean, string][] = [
      ["porch", false, "Pick a pickup time"],
      ["meetup", false, "Book a time to meet"],
      ["pickup_home", false, "Book a pickup time"],
      ["seller_delivery", false, "Pick a new delivery time"],
      ["seller_delivery", true, "The seller brings it"],
      ["delivery", false, "A local Helpr brings it"],
      ["porch", true, "Pick it up from the porch"],
      ["meetup", true, "Meet at the safe spot"],
    ];
    for (const [handover, booked, want] of cases) {
      cart = [line({ handover })];
      paid = { o1: 2527 };
      bookings = booked && handover !== "seller_delivery" ? [{ order_id: "o1", slot_start: "2026-10-31T05:00:00Z" }] : [];
      // DB-7: a seller delivery reads only its own booking (declutter_bookings holds none for it).
      sdBooking = handover === "seller_delivery" ? (booked ? { status: "booked", slot_start: "2026-10-31T17:00:00Z" } : { status: "needs_time", slot_start: null }) : null;
      const { unmount } = at("?paid=1&tab=buying");
      expect(await nowStep()).toBe(want);
      unmount();
    }
    expect(cases.length).toBeGreaterThan(6);
  });

  it("two paid orders and the return names one: the sheet is about that order", async () => {
    const A = "11111111-1111-4111-8111-111111111111";
    const B = "22222222-2222-4222-8222-222222222222";
    cart = [line({ order_id: A, item_title: "Box fan" }), line({ order_id: B, item_title: "Lamp", line_id: "l2" })];
    paid = { [A]: 2527, [B]: 1800 };
    bookings = [];
    at(`?paid=1&order=${B}&tab=buying`);
    expect(await screen.findByRole("heading", { name: "You bought Lamp" })).toBeTruthy();
    expect(await screen.findByText(/^\$18(\.00)?$/)).toBeTruthy();
    expect(justPaidOrder(cart as CartLine[], A)?.map((l) => l.item_title)).toEqual(["Box fan"]);
    expect(justPaidOrder(cart as CartLine[], "33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(justPaidOrder(cart as CartLine[], "not-an-id")).toBeNull();
    // ?order= names an order only among the viewer's OWN buyer lines: the seller of that order gets no "You bought".
    expect(justPaidOrder([line({ order_id: A, my_side: "seller" })] as CartLine[], A)).toBeNull();
    const edge = readFileSync(resolve(__dirname, "../../supabase/functions/declutter-checkout/index.ts"), "utf8");
    expect(edge).toContain("success_url: buildRedirectUrl(`/declutter?view=cart&paid=1&order=${order.order_id}`, native),");
  });

  it("two paid orders, or no ?paid=1: no sheet (never a guess)", () => {
    expect(justPaidOrder([line({}), line({ order_id: "o2" })] as CartLine[])).toBeNull();
    expect(justPaidOrder([line({}), line({ line_id: "b" })] as CartLine[])?.length).toBe(2);
    cart = [line({})];
    at("?tab=buying");
    expect(screen.queryByTestId("what-next-sheet")).toBeNull();
    expect(readFileSync(resolve(__dirname, "../../src/components/declutter/DeclutterHomeView.tsx"), "utf8")).toMatch(/<><BoughtWhatNext \/><Suspense fallback=\{<DeclutterTabBones \/>\}><BuyingDash todo=\{todo\} \/><\/Suspense><\/>/);
  });
});
