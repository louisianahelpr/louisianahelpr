/**
 * Buying as an order tracker (owner 2026-10-28: "buyers and sellers need a very organized way to keep track of all
 * their purchases"; BuyingOrders.tsx). The chips and their counts are declutterTabs.test.tsx's; this file checks the
 * order CARD for every handover kind x state the rows can show:
 *   - its facts come from the real rows (booking, handover row, seller-delivery booking, Helpr task), never guessed;
 *   - it shows the shared tracker (<OrderSteps>) at the step those rows say;
 *   - collapsed, it shows at most ONE primary button, and that button is the buyer's next action (none when the order
 *     waits on someone else or the clock); pressing it opens the card at that action;
 *   - a free order never reads like a paid one ("You paid $0", #6).
 *   - A1-B2: "You paid" is the card charge (declutter_my_paid_cents), never the line's total_cents.
 * @mutate src/components/declutter/BuyingOrders.tsx |     const total = paidCents?.get(o.orderId) ?? null; |     const total = o.lines[0]?.total_cents ?? null;
 *
 * @mutate src/components/declutter/BuyingOrders.tsx |       return { ...base, booked: !!rows.slotStart, out: !!h?.set_out_at, pickedUp: tookIt }; |       return { ...base, booked: !!rows.slotStart, out: !!rows.slotStart, pickedUp: tookIt };
 * @mutate src/components/declutter/BuyingOrders.tsx |       return { ...base, booked: !!t?.accepted_at, pickedUp: !!t?.picked_up_at, delivered: !!t?.delivered_at, |       return { ...base, booked: !!t, pickedUp: !!t?.picked_up_at, delivered: !!t?.delivered_at,
 * LEAD-GOTIT30H: a Helpr delivery held 24 hours undelivered puts "I got it" on the card (Needs you), as its line says.
 * @mutate src/components/declutter/OrderSteps.tsx |      return buyer && (!!f.delivered \|\| !!f.inHandLong); |      return buyer && !!f.delivered;
 * @mutate src/components/declutter/BuyingOrders.tsx |         inHandLong: !t?.delivered_at && heldPastADay(t?.picked_up_at, now) }; |         inHandLong: false };
 * @mutate src/lib/declutter/stillInHand.ts |   return !!pickedUpAt && now - new Date(pickedUpAt).getTime() >= STILL_IN_HAND_MS; |   return !!pickedUpAt && now - new Date(pickedUpAt).getTime() >= 0;
 * @mutate src/components/declutter/BuyingOrders.tsx |   if (!orderWaitsOnYou(f)) return null; |   if (f.done) return null;
 * AUD31-3: a seller delivery with no time set, or a move the seller asked, is the buyer's move (Needs you).
 * @mutate src/components/declutter/OrderSteps.tsx |      return buyer && (!!f.delivered \|\| (!f.delivered && (!!f.needsTime \|\| !!f.moveAsked \|\| !!f.late))); |      return buyer && (!!f.delivered \|\| (!f.delivered && !!f.late));
 * @mutate src/components/declutter/BuyingOrders.tsx |         needsTime: sd?.status === "needs_time", moveAsked: | needsTime: false, moveAsked:
 * @mutate src/components/declutter/BuyingOrders.tsx | moveAsked: !!sd?.proposed_start && sd.proposed_by === "seller", | moveAsked: !!sd?.proposed_start,
 * AUD31-2: a seller delivery past its time and never marked delivered is late, under Needs you.
 * @mutate src/components/declutter/OrderSteps.tsx | !!f.needsTime \|\| !!f.moveAsked \|\| !!f.late))); | !!f.needsTime \|\| !!f.moveAsked)));
 * @mutate src/components/declutter/BuyingOrders.tsx |       if (at === 1 && f.late) return | if (at === 1 && false) return
 * BUY-7 (buying audit 10-30 #7): from an hour before a door pickup or meetup, "I got it" is the card's action (Needs you).
 * @mutate src/components/declutter/OrderSteps.tsx |      return buyer && (!f.booked \|\| (!!f.gotItOpen && !f.pickedUp)); |      return buyer && !f.booked;
 * @mutate src/components/declutter/BuyingOrders.tsx |   if (f.handover === "meetup") return f.booked ? "I got it" : "Book a time to meet"; |   if (f.handover === "meetup") return "Book a time to meet";
 * @mutate src/components/declutter/OrderSteps.tsx |   return Number.isFinite(t) && now >= t - GOT_IT_OPENS_MINUTES_BEFORE * 60_000; |   return Number.isFinite(t) && now >= t;
 * @mutate src/components/declutter/BuyingOrders.tsx |       money: facts.free ? "Free." : total != null |       money: total != null
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const body = !view \|\| open; |   const body = true;
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {!view && (order.handover === "porch" \|\| order.handover === "pickup_home" \|\| order.handover === "meetup") && ( |       {(order.handover === "porch" \|\| order.handover === "pickup_home" \|\| order.handover === "meetup") && (
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

const NOW = Date.now();
const iso = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

const state = {
  cart: [] as Record<string, unknown>[],
  /** A1-B2: declutter_my_paid_cents, the card charge per order (sale + a setup fee that stood); absent = no answer. */
  paid: {} as Record<string, number>,
  bookings: [] as Record<string, unknown>[],
  handovers: {} as Record<string, Record<string, unknown>>,
  sd: {} as Record<string, Record<string, unknown>>,
  tasks: {} as Record<string, Record<string, unknown>>,
  raiseReads: [] as string[],
  /** Audit 1b D2-2: open problems (declutter_problems, status open). */
  problems: [] as Record<string, unknown>[],
  /** NIGHT-BUYINGopenpr-2: declutter_order_problem per order (the other side's words included). */
  problem: {} as Record<string, Record<string, unknown>>,
};

vi.mock("@/components/DateTimeField", () => ({
  DateTimeField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me" } }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/declutter/api", () => ({ fetchMyCart: async () => state.cart }));
vi.mock("@/lib/declutter/paidCents", () => ({
  fetchMyPaidCents: async (ids: string[]) => new Map(ids.filter((id) => id in state.paid).map((id) => [id, state.paid[id]])),
}));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyBookings: async () => state.bookings,
  fetchMyPayouts: async () => [],
  fetchOpenProblems: async () => state.problems,
  fetchOrderProblem: async (orderId: string) => state.problem[orderId] ?? null,
  fetchOrderPickupWindows: async () => null,
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
  OrderDeliveryPanel: ({ taskId, tipOnly, askGot }: { taskId: string; tipOnly?: boolean; askGot?: boolean }) =>
    <p>{tipOnly ? "Tip panel" : "Delivery card"} {taskId}{askGot ? " (asking: Do you have it?)" : ""}</p>,
}));
vi.mock("./SellerDeliveryOrder", () => ({ SellerDeliveryOrderPanel: ({ orderId }: { orderId: string }) => <p>Seller delivery {orderId}</p> }));
vi.mock("./DeclutterAddHelpr", () => ({ AddHelprPanel: () => null }));
vi.mock("./DeclutterRefundRequest", () => ({ DeclutterRefundPanel: () => null }));

import { fetchMyCart, type CartLine } from "@/lib/declutter/api";
import { MemoryRouter } from "react-router-dom";
import { PaidOrdersSection } from "./DeclutterHandoverViews";
import { buyerNextAction, buyerOrderFacts, useBuyingTracker } from "./BuyingOrders";
import { orderBucket, orderStepAt } from "./OrderSteps";
import { deviceLocalDateISO } from "@/test/helpers/deviceLocalDay";

/** BuyingDash's own wiring: the tracker's views on the buyer's paid orders. */
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

const line = (id: string, over: Record<string, unknown> = {}) => ({
  line_id: `l-${id}`, item_id: `i-${id}`, item_title: `Item ${id}`, my_side: "buyer", seller_id: "s1", price_cents: 4000, status: "paid",
  checkout_by: iso(-30), order_id: id, order_status: "paid", handover: "pickup_home", premium_cents: 230, total_cents: 4230, porch_ok: true, ...over,
});

type Case = { id: string; line: Record<string, unknown>; slot?: string; handover?: Record<string, unknown>; sd?: Record<string, unknown>; task?: Record<string, unknown>;
  step: number; bucket: string; action: string | null };

/** Every handover kind through its states, as the rows fill in. */
const CASES: Case[] = [
  { id: "porch0", line: { handover: "porch" }, step: 0, bucket: "needs_you", action: "Pick a pickup time" },
  { id: "porch1", line: { handover: "porch" }, slot: iso(24), step: 1, bucket: "upcoming", action: null },
  { id: "porch2", line: { handover: "porch" }, slot: iso(2), handover: { set_out_at: iso(-1) }, step: 2, bucket: "needs_you", action: "I got it" },
  { id: "porch3", line: { handover: "porch" }, slot: iso(-1), handover: { set_out_at: iso(-3), picked_up_at: iso(-1) }, step: 3, bucket: "waiting", action: null },
  { id: "home0", line: {}, step: 0, bucket: "needs_you", action: "Book a pickup time" },
  { id: "home1", line: {}, slot: iso(5), step: 1, bucket: "upcoming", action: null },
  { id: "home2", line: {}, slot: iso(-1), handover: { confirmed_at: iso(-0.5) }, step: 2, bucket: "waiting", action: null },
  { id: "meet0", line: { handover: "meetup" }, step: 0, bucket: "needs_you", action: "Book a time to meet" },
  { id: "meet1", line: { handover: "meetup" }, slot: iso(5), step: 1, bucket: "upcoming", action: null },
  // BUY-7: within the hour before (and after) the booked time, "I got it" is on the card.
  { id: "home1near", line: {}, slot: iso(0.5), step: 1, bucket: "needs_you", action: "I got it" },
  { id: "meet1near", line: { handover: "meetup" }, slot: iso(0.75), step: 1, bucket: "needs_you", action: "I got it" },
  { id: "meet1late", line: { handover: "meetup" }, slot: iso(-0.5), step: 1, bucket: "needs_you", action: "I got it" },
  { id: "home1early", line: {}, slot: iso(1.25), step: 1, bucket: "upcoming", action: null },
  // AUD31-3: no time set yet: only the buyer can pick one (Needs you); a move the seller asked: only the buyer accepts.
  { id: "sd0", line: { handover: "seller_delivery" }, sd: { status: "needs_time" }, step: 0, bucket: "needs_you", action: "Pick a time" },
  { id: "sd1move", line: { handover: "seller_delivery" }, sd: { status: "booked", slot_start: iso(26), proposed_start: iso(30), proposed_by: "seller" }, step: 1, bucket: "needs_you", action: "Accept the new time" },
  // AUD31-2: past the window and never marked delivered: late, Needs you, "It wasn't delivered" first.
  { id: "sd1late", line: { handover: "seller_delivery" }, sd: { status: "booked", slot_start: iso(-3), not_delivered_from: iso(-1) }, step: 1, bucket: "needs_you", action: "It wasn't delivered" },
  { id: "sd1soon", line: { handover: "seller_delivery" }, sd: { status: "booked", slot_start: iso(-0.5), not_delivered_from: iso(1) }, step: 1, bucket: "upcoming", action: null },
  { id: "sd1mine", line: { handover: "seller_delivery" }, sd: { status: "booked", slot_start: iso(26), proposed_start: iso(30), proposed_by: "buyer" }, step: 1, bucket: "upcoming", action: null },
  { id: "sd1", line: { handover: "seller_delivery" }, sd: { status: "booked", slot_start: iso(26) }, step: 1, bucket: "upcoming", action: null },
  { id: "sd2", line: { handover: "seller_delivery" }, sd: { status: "booked", slot_start: iso(-2), delivered_at: iso(-1) }, step: 2, bucket: "needs_you", action: "I got it" },
  { id: "hd0", line: { handover: "delivery", delivery_task_id: "t-hd0" }, step: 0, bucket: "waiting", action: null },
  { id: "hd1", line: { handover: "delivery", delivery_task_id: "t-hd1" }, task: { accepted_at: iso(-2) }, step: 1, bucket: "upcoming", action: null },
  { id: "hd2", line: { handover: "delivery", delivery_task_id: "t-hd2" }, task: { accepted_at: iso(-2), picked_up_at: iso(-1) }, step: 2, bucket: "waiting", action: null },
  // LEAD-GOTIT30H: 24 hours after pickup with no drop-off, the card's line says tap "I got it"; the button is on the card.
  { id: "hd2held", line: { handover: "delivery", delivery_task_id: "t-hd2held" }, task: { accepted_at: iso(-26), picked_up_at: iso(-25) }, step: 2, bucket: "needs_you", action: "I got it" },
  { id: "hd2day", line: { handover: "delivery", delivery_task_id: "t-hd2day" }, task: { accepted_at: iso(-24), picked_up_at: iso(-23.5) }, step: 2, bucket: "waiting", action: null },
  { id: "hd3", line: { handover: "delivery", delivery_task_id: "t-hd3" }, task: { accepted_at: iso(-3), picked_up_at: iso(-2), delivered_at: iso(-1) }, step: 3, bucket: "needs_you", action: "I got it" },
  { id: "done", line: { order_status: "handed_over", handover: "porch" }, step: 3, bucket: "done", action: null },
  { id: "refunded", line: { order_status: "refunded" }, step: 0, bucket: "cancelled", action: null },
  { id: "free", line: { handover: "porch", price_cents: 0, premium_cents: 0, total_cents: 0 }, step: 0, bucket: "needs_you", action: "Pick a pickup time" },
];

function load(cases: Case[]) {
  state.cart = cases.map((c) => line(c.id, c.line));
  state.paid = Object.fromEntries(state.cart.map((l) => [l.order_id as string, l.total_cents as number]));
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

  // Audit DB-6 (2026-10-30): Buying showed history above action (cart order). Needs you first, Done and Cancelled last.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const shown = views ? byBucket(chosen, views) : liveSalesFirst(chosen); |   const shown = liveSalesFirst(chosen);
  // @mutate src/components/declutter/BuyingOrders.tsx |   return orders.map((o, i) => ({ o, i, r: rank(o) })).sort((a, b) => a.r - b.r \|\| a.i - b.i).map((x) => x.o); |   return orders.map((o, i) => ({ o, i, r: rank(o) })).sort((a, b) => a.i - b.i).map((x) => x.o);
  it("DB-6: orders run Needs you, Waiting, Upcoming, Done, Cancelled, whatever the cart order", async () => {
    const pick = (ids: string[]) => ids.map((id) => CASES.find((c) => c.id === id)!);
    load(pick(["refunded", "done", "home1", "porch3", "porch0"]));
    show();
    const order = () => Array.from(document.querySelectorAll("article")).map((a) => /Item ([a-z0-9]+)/.exec(a.textContent ?? "")?.[1]);
    await waitFor(() => expect(order()).toEqual(["porch0", "porch3", "home1", "done", "refunded"]));
    expect(order().length).toBeGreaterThan(4);
  });

  // T13, BUY-37: past 24 hours the closed card's head stopped being true; the new line was only inside Details.
  it("BUY-37: the closed card says on its way until 24 hours after pickup, then the still-in-hand line", async () => {
    const hd = (id: string, hours: number): Case => ({ id, line: { handover: "delivery", delivery_task_id: `t-${id}` }, task: { accepted_at: iso(-hours - 1), picked_up_at: iso(-hours), helpr_first_name: "Hank" }, step: 2, bucket: "waiting", action: null });
    load([hd("fresh", 23), hd("late", 25)]);
    show();
    await waitFor(() => expect(card("fresh")).toHaveTextContent("Picked up. On its way to you."));
    await waitFor(() => expect(card("late")).toHaveTextContent(/Hank picked it up .* and hasn't marked it delivered\./));
    expect(card("late")).not.toHaveTextContent("On its way");
  });

  // AUD31-7: the headline comes from the task once it ended without a delivery; a live one keeps its step line.
  // @mutate src/components/declutter/BuyingOrders.tsx |       if (taskStatus === "unfilled") return info("No Helpr took this delivery. What you paid for delivery was refunded."); |
  // @mutate src/components/declutter/BuyingOrders.tsx |       if (taskStatus && !LIVE_TASK.has(taskStatus)) return info("This delivery was closed."); |
  // @mutate src/components/declutter/BuyingOrders.tsx |         o.handover === "delivery" ? task?.status ?? null : null), |         null),
  it("AUD31-2: a seller delivery past its time says it is late, not booked", async () => {
    load([CASES.find((c) => c.id === "sd1late")!]);
    show();
    await waitFor(() => expect(card("sd1late")).toHaveTextContent(/Late: it was due .* and the seller hasn't marked it delivered\./));
    expect(card("sd1late")).not.toHaveTextContent("Delivery booked");
  });

  it("AUD31-7: a delivery nobody took, or one closed, never says Finding a Helpr; an open one still does", async () => {
    const hd = (id: string, status: string): Case => ({ id, line: { handover: "delivery", delivery_task_id: `t-${id}` }, task: { status }, step: 0, bucket: "waiting", action: null });
    load([hd("unfilled", "unfilled"), hd("closed", "cancelled"), hd("open", "open")]);
    show();
    await waitFor(() => expect(card("unfilled")).toHaveTextContent("No Helpr took this delivery. What you paid for delivery was refunded."));
    await waitFor(() => expect(card("closed")).toHaveTextContent("This delivery was closed."));
    await waitFor(() => expect(card("open")).toHaveTextContent("Finding a Helpr to bring it."));
    expect(card("unfilled")).not.toHaveTextContent("Finding a Helpr");
    expect(card("closed")).not.toHaveTextContent("Finding a Helpr");
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
    expect(await within(card("home0")).findByText(/You paid \$42\.30\./)).toBeInTheDocument();
  });

  // A1-B2 (Declutter audit, prod 2026-10-29): Stripe charged $34.20 (sale + the $2 setup fee) and the card said
  // "You paid $32.20", the line's total_cents. The figure is the card charge, declutter_my_paid_cents.
  it("A1-B2: You paid is the card charge, setup fee included, never the sale total; no answer, no figure", async () => {
    load(CASES.filter((c) => c.id === "home0" || c.id === "home1"));
    state.paid = { home0: 4430 };
    show();
    await screen.findByText("Item home0");
    expect(await within(card("home0")).findByText(/You paid \$44\.30\./)).toBeInTheDocument();
    expect(card("home0").textContent).not.toContain("$42.30");
    expect(card("home1").textContent).not.toMatch(/You paid/);
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

  // Next-step line (owner 11-01 12:02 PM: "there isn't clear instructions for them on what next"). Every buyer card
  // whose order waits on the buyer says "Next: <step>" in the shared NextStep line, above its one button; every
  // other card says who it waits on or where it stands, never "Next:". The late seller delivery is the one Needs-you
  // card whose line says why (its button, "It wasn't delivered", is the step).
  // @mutate src/components/declutter/BuyingOrders.tsx |       return at === 0 ? you("Pick a pickup time") |       return at === 0 ? info("Pick a pickup time")
  // @mutate src/components/declutter/BuyingOrders.tsx |       if (at === 0) return you("Book a pickup time"); |       if (at === 0) return info("Book a pickup time.");
  // @mutate src/components/declutter/BuyingOrders.tsx |       return you("Tap I got it once you have it");\n  } |       return info("Delivered.");\n  }
  // @mutate src/components/declutter/BuyingOrders.tsx | value={standing ? { who: "info", text: standing } : view.next} | value={{ who: "info", text: view.next.text }}
  it("Next-step line: every card that waits on the buyer says 'Next: …'; the rest never do", async () => {
    load(CASES);
    show();
    await waitFor(() => expect(card("hd3").querySelector("[data-next-step]")).not.toBeNull());
    await waitFor(() => expect(card("hd2held").querySelector("[data-next-step]")?.getAttribute("data-next-step")).toBe("you"));
    let yours = 0;
    for (const c of CASES) {
      const line = card(c.id).querySelector("[data-next-step]");
      expect(line, c.id).not.toBeNull();
      const mine = c.bucket === "needs_you" && c.id !== "sd1late";
      if (mine) expect(line!.getAttribute("data-next-step"), c.id).toBe("you");
      else expect(line!.getAttribute("data-next-step"), c.id).not.toBe("you");
      if (mine) { yours++; expect(line!.textContent, c.id).toMatch(/^Next: [a-z]/); }
      else expect(line!.textContent, c.id).not.toMatch(/^Next:/);
    }
    expect(yours).toBeGreaterThan(10);
    expect(card("home0").querySelector("[data-next-step]")!.textContent).toBe("Next: book a pickup time");
    expect(card("porch0").querySelector("[data-next-step]")!.textContent).toBe("Next: pick a pickup time");
    expect(card("hd3").querySelector("[data-next-step]")!.textContent).toBe("Next: tap I got it once you have it");
    expect(card("hd0").querySelector("[data-next-step]")!.textContent).toBe("Finding a Helpr to bring it.");
  });

  // A1-C2: a porch pickup is a DAY; its booking's slot_start is only that day's start, so the card never shows a time.
  // @mutate src/components/declutter/BuyingOrders.tsx |     const when = o.handover === "porch" && bookingRow?.pickup_day ? porchDayLower(bookingRow.pickup_day) |     const when = false ? "" 
  it("a porch pickup day reads as the day ('for tomorrow'), never a clock time", async () => {
    load([{ id: "pd1", line: { handover: "porch" }, slot: iso(24), step: 1, bucket: "upcoming", action: null }]);
    const tomorrow = deviceLocalDateISO(1, new Date(NOW));
    state.bookings = state.bookings.map((b) => ({ ...b, pickup_day: tomorrow }));
    show();
    expect(await screen.findByText("The seller puts it out for tomorrow and posts a photo.")).toBeInTheDocument();
    expect(card("pd1").textContent).not.toMatch(/\d:\d\d/);
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

  // Audit 1b D2-2 (1b-problem-after-375): after "Report a problem" the collapsed porch card still said "Pick the day
  // you'll come for it" with "Pick a pickup time" as its next action. Now it says the problem is open and asks nothing.
  // @mutate src/components/declutter/BuyingOrders.tsx |       problem: problems.has(o.orderId), |       problem: false,
  // @mutate src/components/declutter/BuyingOrders.tsx |   if (f.problem) return f.problemAwaitsYou ? you("Add your side to the problem") : info(PROBLEM_ON_HOLD); |
  it("an open problem: the collapsed card says so, with no next action and no booking (D2-2)", async () => {
    load(CASES.filter((c) => c.id === "porch0" || c.id === "home0"));
    state.problems = [{ id: "p1", order_id: "porch0", reporter_side: "buyer", reason: "not_as_described" }];
    show();
    await waitFor(() => expect(within(card("porch0")).getByText("Problem reported: Louisiana Helpr is looking.")).toBeInTheDocument());
    const el = card("porch0");
    expect(within(el).getByText("On hold until the problem is decided.")).toBeInTheDocument();
    expect(within(el).getByText(/Not as described, reported by you\./)).toBeInTheDocument();
    expect(within(el).queryByRole("button", { name: "Pick a pickup time" })).toBeNull();
    expect(el.textContent).not.toContain("Pick the day you'll come for it");
    // The other order is untouched.
    expect(within(card("home0")).getByRole("button", { name: "Book a pickup time" })).toBeInTheDocument();
    state.problems = [];
  });

  // NIGHT-BUYINGopenpr-2: a handed-over order the seller reported was filed under Done with nothing asked; the
  // buyer's "Add your side" waited unseen under Details. Answered, it waits on Louisiana Helpr.
  // @mutate src/components/declutter/BuyingOrders.tsx |       problemAwaitsYou: problemAwaitsBuyer( |       problemAwaitsYou: false && problemAwaitsBuyer(
  // @mutate src/components/declutter/BuyingOrders.tsx |   return !!p && p.status === "open" && p.reporter_side !== "buyer" && !p.other_side_note; |   return !!p && p.status === "open" && !p.other_side_note;
  // @mutate src/components/declutter/BuyingOrders.tsx |   if (f.problem && f.problemAwaitsYou && !f.cancelled) return "Add your side"; |
  it("openpr-2: a handed-over order with the seller's open report is Needs you with Add your side, then Waiting once answered", async () => {
    load([
      { id: "rep", line: { order_status: "handed_over", handover: "porch" }, step: 3, bucket: "needs_you", action: "Add your side" },
      { id: "mine", line: { order_status: "handed_over", handover: "porch" }, step: 3, bucket: "waiting", action: null },
      { id: "ans", line: { order_status: "handed_over" }, step: 3, bucket: "waiting", action: null },
    ]);
    state.problems = ["rep", "mine", "ans"].map((id) => ({ id: `p-${id}`, order_id: id, reporter_side: id === "mine" ? "buyer" : "seller", reason: "no_show" }));
    const base = { reason: "no_show", note: "They never came.", photo_paths: [], status: "open", created_at: iso(-1) };
    state.problem = {
      rep: { ...base, id: "p-rep", reporter_side: "seller", other_side_note: null },
      mine: { ...base, id: "p-mine", reporter_side: "buyer", other_side_note: null },
      ans: { ...base, id: "p-ans", reporter_side: "seller", other_side_note: "I was there at 3." },
    };
    show();
    await waitFor(() => expect(card("rep").querySelector("[data-buyer-order]")?.getAttribute("data-buyer-order")).toBe("needs_you"));
    expect(within(card("rep")).getByRole("button", { name: "Add your side" })).toBeInTheDocument();
    for (const id of ["mine", "ans"]) {
      expect(card(id).querySelector("[data-buyer-order]")?.getAttribute("data-buyer-order")).toBe("waiting");
      expect(within(card(id)).queryByRole("button", { name: "Add your side" })).toBeNull();
    }
    state.problems = [];
    state.problem = {};
  });

  // Audit 1c D3-3 (1c-b3-buying-p1-375): two days before the booked pickup the buyer's card said "A Helpr is on the way
  // to pick it up". It now names the Helpr and the booked pickup time, as the seller's card already did.
  // @mutate src/components/declutter/BuyingOrders.tsx |       if (at === 1) return them(`${helprName ?? "Your Helpr"} picks it up from the seller${when ? ` ${when}` : ""}.`); |       if (at === 1) return them("A Helpr is on the way to pick it up.");
  // @mutate src/components/declutter/BuyingOrders.tsx |       : o.handover === "delivery" ? task?.pickup_slot_start ?? null : slot; |       : slot;
  it("D3-3: a taken Helpr delivery names the Helpr and the booked pickup time, never 'on the way'", async () => {
    const pickup = iso(48);
    load([{ id: "hd1", line: { handover: "delivery", delivery_task_id: "t-hd1" }, task: { accepted_at: iso(-2), pickup_slot_start: pickup, helpr_first_name: "Hallie" }, step: 1, bucket: "upcoming", action: null }]);
    show();
    const words = new Date(pickup).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    expect(await screen.findByText(`Hallie picks it up from the seller ${words}.`)).toBeInTheDocument();
    expect(card("hd1").textContent).not.toMatch(/on the way/i);
  });

  // Audit 1c D3-7 (1c-b4-gotit-press1-1440): the first tap on a delivered card's "I got it" only opened Details; a
  // second "I got it" inside opened "Do you have it?". One tap now opens Details AND the confirm sheet.
  // @mutate src/components/declutter/DeclutterHandoverViews.tsx |         onAction={() => { setOpen(true); setAskGot(order.handover === "delivery" && view.action === "I got it"); }} /> |         onAction={() => { setOpen(true); }} />
  // @mutate src/components/declutter/BuyingOrders.tsx | onClick={onAction} data-next-action=""> | onClick={onOpen} data-next-action="">
  it("D3-7: one tap on a delivered Helpr order's 'I got it' asks 'Do you have it?' at once; Details alone does not", async () => {
    load(CASES.filter((c) => c.id === "hd3" || c.id === "hd1"));
    show();
    await waitFor(() => expect(card("hd3").querySelector("[data-order-step]")?.getAttribute("data-order-step")).toBe("3"));
    fireEvent.click(within(card("hd3")).getByRole("button", { name: "I got it" }));
    expect(await within(card("hd3")).findByText("Delivery card t-hd3 (asking: Do you have it?)")).toBeInTheDocument();
    fireEvent.click(within(card("hd1")).getByRole("button", { name: "Details" }));
    expect(await within(card("hd1")).findByText("Delivery card t-hd1")).toBeInTheDocument();
  });
});
