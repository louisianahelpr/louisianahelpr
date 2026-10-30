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
 * @mutate src/components/declutter/BuyingOrders.tsx |       return { ...base, booked: !!t?.accepted_at, pickedUp: !!t?.picked_up_at, delivered: !!t?.delivered_at }; |       return { ...base, booked: !!t, pickedUp: !!t?.picked_up_at, delivered: !!t?.delivered_at };
 * @mutate src/components/declutter/BuyingOrders.tsx |   if (!orderWaitsOnYou(f)) return null; |   if (f.done) return null;
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
vi.mock("@/lib/declutter/paidCents", () => ({
  fetchMyPaidCents: async (ids: string[]) => new Map(ids.filter((id) => id in state.paid).map((id) => [id, state.paid[id]])),
}));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyBookings: async () => state.bookings,
  fetchMyPayouts: async () => [],
  fetchOpenProblems: async () => state.problems,
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

  // A1-C2: a porch pickup is a DAY; its booking's slot_start is only that day's start, so the card never shows a time.
  // @mutate src/components/declutter/BuyingOrders.tsx |     const when = o.handover === "porch" && bookingRow?.pickup_day ? porchDayLower(bookingRow.pickup_day) |     const when = false ? "" 
  it("a porch pickup day reads as the day ('for tomorrow'), never a clock time", async () => {
    load([{ id: "pd1", line: { handover: "porch" }, slot: iso(24), step: 1, bucket: "upcoming", action: null }]);
    const t = new Date(NOW + 24 * 3_600_000);
    const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
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
  // you'll come for it" with "Pick a pickup day" as its next action. Now it says the problem is open and asks nothing.
  // @mutate src/components/declutter/BuyingOrders.tsx |       problem: problems.has(o.orderId), |       problem: false,
  // @mutate src/components/declutter/BuyingOrders.tsx |   if (f.problem) return PROBLEM_ON_HOLD; |
  it("an open problem: the collapsed card says so, with no next action and no booking (D2-2)", async () => {
    load(CASES.filter((c) => c.id === "porch0" || c.id === "home0"));
    state.problems = [{ id: "p1", order_id: "porch0", reporter_side: "buyer", reason: "not_as_described" }];
    show();
    await waitFor(() => expect(within(card("porch0")).getByText("Problem reported: Louisiana Helpr is looking.")).toBeInTheDocument());
    const el = card("porch0");
    expect(within(el).getByText("On hold while Louisiana Helpr looks at the problem.")).toBeInTheDocument();
    expect(within(el).getByText(/Not as described, reported by you\./)).toBeInTheDocument();
    expect(within(el).queryByRole("button", { name: "Pick a pickup day" })).toBeNull();
    expect(el.textContent).not.toContain("Pick the day you'll come for it");
    // The other order is untouched.
    expect(within(card("home0")).getByRole("button", { name: "Book a pickup time" })).toBeInTheDocument();
    state.problems = [];
  });

  // Audit 1c D3-3 (1c-b3-buying-p1-375): two days before the booked pickup the buyer's card said "A Helpr is on the way
  // to pick it up". It now names the Helpr and the booked pickup time, as the seller's card already did.
  // @mutate src/components/declutter/BuyingOrders.tsx |         : at === 1 ? `${helprName ?? "Your Helpr"} picks it up from the seller${when ? ` ${when}` : ""}.` |         : at === 1 ? "A Helpr is on the way to pick it up."
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
