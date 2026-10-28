/**
 * Buying as an order tracker (owner 2026-10-28: "buyers and sellers need a very organized way to keep track of all
 * their purchases"; BuyingOrders.tsx). The chips and their counts are declutterTabs.test.tsx's; this file checks the
 * order CARD for every handover kind x state the rows can show:
 *   - its facts come from the real rows (booking, handover row, seller-delivery booking, Helpr task), never guessed;
 *   - it shows the shared tracker (<OrderSteps>) at the step those rows say;
 *   - collapsed, it shows at most ONE primary button, and that button is the buyer's next action (none when the order
 *     waits on someone else or the clock); pressing it opens the card at that action;
 *   - a free order never reads like a paid one ("You paid $0", #6).
 *
 * @mutate src/components/declutter/BuyingOrders.tsx |       return { ...base, booked: !!rows.slotStart, out: !!h?.set_out_at, pickedUp: tookIt }; |       return { ...base, booked: !!rows.slotStart, out: !!rows.slotStart, pickedUp: tookIt };
 * @mutate src/components/declutter/BuyingOrders.tsx |       return { ...base, booked: !!t?.accepted_at, pickedUp: !!t?.picked_up_at, delivered: !!t?.delivered_at }; |       return { ...base, booked: !!t, pickedUp: !!t?.picked_up_at, delivered: !!t?.delivered_at };
 * @mutate src/components/declutter/BuyingOrders.tsx |   if (!orderWaitsOnYou(f)) return null; |   if (f.done) return null;
 * @mutate src/components/declutter/BuyingOrders.tsx |       money: facts.free ? "Free." : total != null |       money: total != null
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const body = !view \|\| open; |   const body = true;
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {!view && (order.handover === "porch" \|\| order.handover === "pickup_home") && ( |       {(order.handover === "porch" \|\| order.handover === "pickup_home") && (
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

const NOW = Date.now();
const iso = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

const state = {
  cart: [] as Record<string, unknown>[],
  bookings: [] as Record<string, unknown>[],
  handovers: {} as Record<string, Record<string, unknown>>,
  sd: {} as Record<string, Record<string, unknown>>,
  tasks: {} as Record<string, Record<string, unknown>>,
  raiseReads: [] as string[],
};

vi.mock("@/components/DateTimeField", () => ({
  DateTimeField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me" } }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/declutter/api", () => ({ fetchMyCart: async () => state.cart }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyBookings: async () => state.bookings,
  fetchMyPayouts: async () => [],
  fetchMyHandover: async (orderId: string) => ({ order_id: orderId, status: "paid", side: "buyer", confirmed_at: null, set_out_at: null,
    set_out_photo_path: null, picked_up_at: null, ...state.handovers[orderId] }),
  handoverPhotoUrl: async (path: string) => `https://signed.test/${path}`,
  fetchItemAddress: async () => ({ pickup_address: "1234 Example St, Baton Rouge", pickup_lat: 30.45, pickup_lng: -91.15 }),
  bookPickup: async () => ({ result: "booked" }),
  confirmHandover: async () => ({ result: "handed_over" }),
  sellerPickedUp: async () => ({ result: "handed_over" }),
  setPorchTime: async () => undefined,
  porchPhoto: async () => ({ result: "set_out" }),
  porchNote: async () => null,
  uploadHandoverPhoto: async () => "x.jpg",
  reportNoShow: async () => ({ result: "rebook_offered" }),
  reportProblem: async () => "p1",
}));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchSellerDeliveryBooking: async (orderId: string) => ({ order_id: orderId, side: "buyer", order_status: "paid", status: "held", slot_start: null,
    slot_end: null, delivered_at: null, ...state.sd[orderId] }),
}));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchTaskView: async (taskId: string) => ({ task_id: taskId, accepted_at: null, picked_up_at: null, delivered_at: null, ...state.tasks[taskId] }),
}));
// A2-7: the list starts each Helpr delivery's raise read (the panel itself is OrderDeliveryPanel's, stubbed here).
vi.mock("@/lib/declutter/deliveryRaise", () => ({
  fetchDeliveryRaiseStatus: async (orderId: string) => { state.raiseReads.push(orderId); return null; },
  startDeliveryRaise: vi.fn(),
}));
vi.mock("@/lib/declutter/meetup", () => ({ fetchOrderMeetup: async () => null, meetupHere: async () => "here", meetupMapUrl: () => "", chooseMeetupSpot: async () => undefined }));
vi.mock("./useOrderOtherPerson", () => ({ useOrderOtherPerson: () => ({ otherId: "u2", name: "Dana R", avatarUrl: null, first: "Dana", who: "Dana" }) }));
vi.mock("./DeclutterReviewForm", () => ({ DeclutterReviewForm: () => <p>Review form</p> }));
vi.mock("./DeclutterDeliveryViews", () => ({
  OrderDeliveryPanel: ({ taskId, tipOnly }: { taskId: string; tipOnly?: boolean }) => <p>{tipOnly ? "Tip panel" : "Delivery card"} {taskId}</p>,
}));
vi.mock("./SellerDeliveryOrder", () => ({ SellerDeliveryOrderPanel: ({ orderId }: { orderId: string }) => <p>Seller delivery {orderId}</p> }));
vi.mock("./DeclutterAddHelpr", () => ({ AddHelprPanel: () => null }));
vi.mock("./DeclutterRefundRequest", () => ({ DeclutterRefundPanel: () => null }));

import { fetchMyCart, type CartLine } from "@/lib/declutter/api";
import { PaidOrdersSection } from "./DeclutterHandoverViews";
import { buyerNextAction, buyerOrderFacts, useBuyingTracker } from "./BuyingOrders";
import { orderBucket, orderStepAt } from "./OrderSteps";

/** BuyingDash's own wiring: the tracker's views on the buyer's paid orders. */
function Harness() {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const t = useBuyingTracker();
  if (!cart.data) return null;
  return <PaidOrdersSection cart={cart.data.filter((l) => l.my_side === "buyer")} views={t.views} />;
}
function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>);
}

const line = (id: string, over: Record<string, unknown> = {}) => ({
  line_id: `l-${id}`, item_id: `i-${id}`, item_title: `Item ${id}`, my_side: "buyer", seller_id: "s1", price_cents: 4000, status: "paid",
  checkout_by: iso(-30), order_id: id, order_status: "paid", handover: "pickup_home", premium_cents: 230, total_cents: 4230, porch_ok: true, ...over,
});

type Case = { id: string; line: Record<string, unknown>; slot?: string; handover?: Record<string, unknown>; sd?: Record<string, unknown>; task?: Record<string, unknown>;
  step: number; bucket: string; action: string | null };

/** Every handover kind through its states, as the rows fill in. */
const CASES: Case[] = [
  { id: "porch0", line: { handover: "porch" }, step: 0, bucket: "needs_you", action: "Pick a pickup day" },
  { id: "porch1", line: { handover: "porch" }, slot: iso(24), step: 1, bucket: "upcoming", action: null },
  { id: "porch2", line: { handover: "porch" }, slot: iso(2), handover: { set_out_at: iso(-1) }, step: 2, bucket: "needs_you", action: "I got it" },
  { id: "porch3", line: { handover: "porch" }, slot: iso(-1), handover: { set_out_at: iso(-3), picked_up_at: iso(-1) }, step: 3, bucket: "waiting", action: null },
  { id: "home0", line: {}, step: 0, bucket: "needs_you", action: "Book a pickup time" },
  { id: "home1", line: {}, slot: iso(5), step: 1, bucket: "upcoming", action: null },
  { id: "home2", line: {}, slot: iso(-1), handover: { confirmed_at: iso(-0.5) }, step: 2, bucket: "waiting", action: null },
  { id: "meet0", line: { handover: "meetup" }, step: 0, bucket: "needs_you", action: "Book a time to meet" },
  { id: "meet1", line: { handover: "meetup" }, slot: iso(5), step: 1, bucket: "upcoming", action: null },
  { id: "sd0", line: { handover: "seller_delivery" }, sd: { status: "needs_time" }, step: 0, bucket: "waiting", action: null },
  { id: "sd1", line: { handover: "seller_delivery" }, sd: { status: "booked", slot_start: iso(26) }, step: 1, bucket: "upcoming", action: null },
  { id: "sd2", line: { handover: "seller_delivery" }, sd: { status: "booked", slot_start: iso(-2), delivered_at: iso(-1) }, step: 2, bucket: "needs_you", action: "I got it" },
  { id: "hd0", line: { handover: "delivery", delivery_task_id: "t-hd0" }, step: 0, bucket: "waiting", action: null },
  { id: "hd1", line: { handover: "delivery", delivery_task_id: "t-hd1" }, task: { accepted_at: iso(-2) }, step: 1, bucket: "upcoming", action: null },
  { id: "hd2", line: { handover: "delivery", delivery_task_id: "t-hd2" }, task: { accepted_at: iso(-2), picked_up_at: iso(-1) }, step: 2, bucket: "waiting", action: null },
  { id: "hd3", line: { handover: "delivery", delivery_task_id: "t-hd3" }, task: { accepted_at: iso(-3), picked_up_at: iso(-2), delivered_at: iso(-1) }, step: 3, bucket: "needs_you", action: "I got it" },
  { id: "done", line: { order_status: "handed_over", handover: "porch" }, step: 3, bucket: "done", action: null },
  { id: "refunded", line: { order_status: "refunded" }, step: 0, bucket: "cancelled", action: null },
  { id: "free", line: { handover: "porch", price_cents: 0, premium_cents: 0, total_cents: 0 }, step: 0, bucket: "needs_you", action: "Pick a pickup day" },
];

function load(cases: Case[]) {
  state.cart = cases.map((c) => line(c.id, c.line));
  state.bookings = cases.filter((c) => c.slot).map((c) => ({ order_id: c.id, slot_start: c.slot, slot_end: c.slot, porch_mode: null, porch_until: null }));
  state.handovers = Object.fromEntries(cases.filter((c) => c.handover).map((c) => [c.id, c.handover!]));
  state.sd = Object.fromEntries(cases.filter((c) => c.sd).map((c) => [c.id, c.sd!]));
  state.tasks = Object.fromEntries(cases.filter((c) => c.task).map((c) => [`t-${c.id}`, c.task!]));
}

const card = (id: string) => screen.getByText(`Item ${id}`).closest("article") as HTMLElement;

describe("Buying tracker: every order card shows its steps and its ONE next action", () => {
  beforeEach(() => load([]));

  it("the facts come from the rows, so every handover x state lands on its step, its chip and its action", () => {
    let n = 0;
    for (const c of CASES) {
      const l = line(c.id, c.line) as unknown as CartLine;
      const f = buyerOrderFacts({ handover: l.handover, status: l.order_status, lines: [l] }, {
        slotStart: c.slot ?? null,
        handover: c.handover ? { set_out_at: null, picked_up_at: null, confirmed_at: null, ...c.handover } as never : null,
        sellerDelivery: c.sd ? { slot_start: null, delivered_at: null, ...c.sd } as never : null,
        task: c.task ? { accepted_at: null, picked_up_at: null, delivered_at: null, ...c.task } as never : null,
      });
      expect([c.id, orderStepAt(f), orderBucket(f), buyerNextAction(f)]).toEqual([c.id, c.step, c.bucket, c.action]);
      n++;
    }
    expect(n).toBeGreaterThan(15);
  });

  it("collapsed, each card has the tracker at its step and at most one primary button: its next action", async () => {
    load(CASES);
    show();
    // Wait until every row has answered: the last fact-bearing card reaches its step.
    await waitFor(() => expect(card("hd3").querySelector("[data-order-step]")?.getAttribute("data-order-step")).toBe("3"), { timeout: 8000 });
    await waitFor(() => expect(card("porch2").querySelector("[data-order-step]")?.getAttribute("data-order-step")).toBe("2"), { timeout: 8000 });
    await waitFor(() => expect(card("sd2").querySelector("[data-order-step]")?.getAttribute("data-order-step")).toBe("2"), { timeout: 8000 });
    let checked = 0;
    for (const c of CASES) {
      const el = card(c.id);
      expect(el.querySelector("[data-order-step]")?.getAttribute("data-order-step"), c.id).toBe(String(c.step));
      expect(el.querySelector("[data-buyer-order]")?.getAttribute("data-buyer-order"), c.id).toBe(c.bucket);
      const primaries = Array.from(el.querySelectorAll(".btn-grad-primary")).map((b) => b.textContent);
      expect(primaries, c.id).toEqual(c.action ? [c.action] : []);
      // The rest of the card waits under Details.
      expect(el.querySelector("[data-order-body]"), c.id).toBeNull();
      expect(within(el).getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
      checked++;
    }
    expect(checked).toBe(CASES.length);
  });

  // @mutate src/components/declutter/BuyingOrders.tsx |   useQueries({ queries: helpr.map((o) => deliveryRaiseQuery(o.orderId)) });\n |
  it("A2-7: with the list (Details still closed), each Helpr delivery's raise read is already out; no other order's", async () => {
    state.raiseReads = [];
    load(CASES);
    show();
    await waitFor(() => expect([...state.raiseReads].sort()).toEqual(CASES.filter((c) => c.line.handover === "delivery").map((c) => c.id).sort()));
    expect(card("hd0").querySelector("[data-order-body]")).toBeNull();
  });

  it("#6: a free order says Free, never You paid $0; a paid one says what was paid", async () => {
    load(CASES.filter((c) => c.id === "free" || c.id === "home0"));
    show();
    await screen.findByText("Item free");
    expect(card("free")).toHaveTextContent("Free.");
    expect(card("free").textContent).not.toMatch(/You paid|\$0/);
    expect(card("free").querySelector('[aria-label^="Step 1 of 4: Claimed"]')).not.toBeNull();
    expect(card("home0")).toHaveTextContent("You paid $42.30.");
  });

  // Audit 2026-10-28 A3-1: after "I got it" the Helpr can still be tipped, without opening Details.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {done && order.side === "buyer" && order.handover === "delivery" |       {body && done && order.side === "buyer" && order.handover === "delivery"
  it("a handed-over Helpr delivery shows the tip on the collapsed card (A3-1)", async () => {
    load([{ id: "hd4", line: { handover: "delivery", delivery_task_id: "t-hd4", order_status: "handed_over" }, step: 3, bucket: "done", action: null }]);
    show();
    expect(await screen.findByText("Tip panel t-hd4")).toBeInTheDocument();
    const el = card("hd4");
    expect(el.querySelector("[data-order-body]")).toBeNull();
    expect(within(el).queryByText(/Delivery card/)).toBeNull();
  });

  it("the next action opens the card at that action, and the head button gives way to the real control", async () => {
    load(CASES.filter((c) => c.id === "home0"));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Book a pickup time" }));
    const el = card("home0");
    expect(el.querySelector("[data-order-body]")).not.toBeNull();
    expect(within(el).queryByRole("button", { name: "Book a pickup time" })).toBeNull();
    expect(within(el).getByRole("button", { name: "Book" })).toBeInTheDocument();
    expect(within(el).getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");
    // One tracker on the card: the head's, never the old pickup bar beside it.
    expect(el.querySelectorAll('ol[aria-label^="Step "]').length).toBe(1);
  });
});
