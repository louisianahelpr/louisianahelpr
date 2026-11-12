/**
 * The Buying tab as an order tracker (owner 2026-10-28: "buyers and sellers need a very organized way to keep track
 * of all their purchases"), mirroring Jobs > Posted: one chip row from ORDER_BUCKETS (Needs you · Waiting · Upcoming ·
 * Done · Cancelled, only the chips that hold orders, each with its count), and each order card shows <OrderSteps> and
 * its ONE next action as the button. Offers are their own group under the orders, never mixed into the chips.
 *
 * Every fact comes from the real rows the order's own panels read (and with their query keys, so nothing is read
 * twice): the order status and handover kind (declutter_my_cart), the booked time (declutter_bookings), the handover row
 * (declutter_my_handover: the porch photo, the pickup, the "I got it"), the seller-delivery booking and the Helpr task.
 * A checkout still in the cart is the buyer's to pay, so it counts under Needs you. A read that has not answered yet
 * leaves its fact unknown (false): an order is never filed further along than its rows show.
 */
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchMyCart, fetchMyOffers, type CartLine } from "@/lib/declutter/api";
import { fetchMyRefundTodos } from "@/lib/declutter/refundRequests";
import { useFeatureStatus } from "@/hooks/useFeature";
import { declutterBuyingTodos } from "@/lib/declutter/declutterTodos";
import { fetchMyBookings, fetchMyHandover, fetchOrderProblem, type MyBooking, type MyHandover, type OrderProblem } from "@/lib/declutter/handover";
import { fetchSellerDeliveryBooking, slotLabel, type SellerDeliveryBooking } from "@/lib/declutter/sellerDelivery";
import { fetchTaskView, type TaskView } from "@/lib/helprTasks/api";
import { fetchMyShipTracking, shipByWords, shipTrackingKey, trackingStatusWords, type ShipTracking } from "@/lib/declutter/shipOrder";
import { heldPastADay, stillInHandLine } from "@/lib/declutter/stillInHand";
import { checkWindowEnds, orderWhen } from "@/lib/declutter/timeLeft";
import { deliveryRaiseQuery } from "@/lib/declutter/deliveryRaiseQuery";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { refundTookItBack, type RefundTookItBack } from "@/lib/declutter/refundRequests";
import { endedOnPrefix } from "./DeclutterEndedSales";
import { porchDayWords } from "./DeclutterPorchDay";
import { useMyPaidCents } from "./useMyPaidCents";
import { fetchMyRefundedCents } from "@/lib/declutter/refundedCents";
import { REFUNDED_IN_FULL } from "@/lib/declutter/refundRequests";
import { useOpenProblemsRead } from "./useOpenProblems";
import { PROBLEM_ON_HOLD } from "./DeclutterProblemOpen";
import { NextStep, type NextStepValue } from "@/components/ui/NextStep";
import { fetchOrderPickupTimes, orderPickupTimesKey, orderTimeWords } from "@/lib/declutter/orderPickupTimes";
import { ORDER_BUCKETS, OrderSteps, gotItOpen, orderBucket, orderStepAt, orderWaitsOnYou, type OrderBucket, type OrderFacts, type OrderHandover } from "./OrderSteps";

/** One paid order on the buyer's side, as the tracker files it. */
export type BuyerOrderView = {
  orderId: string;
  facts: OrderFacts;
  bucket: OrderBucket;
  /** The one next move, when it is the buyer's ("Pick a pickup day", "I got it"); null when nothing is asked. */
  action: string | null;
  /** Where it stands, as the shared next-step line (buyerNextStep). */
  next: NextStepValue;
  /** "You paid $34.30." / "Free." */
  money: string | null;
};

// B134: a shipped order is its own kind; before it was here it fell back to "pickup_home" and read as a pickup.
const KINDS: readonly OrderHandover[] = ["porch", "pickup_home", "meetup", "delivery", "seller_delivery", "ship"];
const kindOf = (h: string | null): OrderHandover => (KINDS as readonly string[]).includes(h ?? "") ? (h as OrderHandover) : "pickup_home";

/** What the order's rows say, per handover kind. Pure: the rule is tested apart from the screen. */
export function buyerOrderFacts(
  order: { handover: string | null; status: string | null; lines: Pick<CartLine, "price_cents" | "source">[] },
  rows: { slotStart?: string | null; handover?: Pick<MyHandover, "set_out_at" | "picked_up_at" | "confirmed_at"> | null;
    sellerDelivery?: Pick<SellerDeliveryBooking, "status" | "slot_start" | "delivered_at">
      & Partial<Pick<SellerDeliveryBooking, "proposed_start" | "proposed_by" | "not_delivered_from">> | null;
    task?: Pick<TaskView, "accepted_at" | "picked_up_at" | "delivered_at"> | null;
    ship?: Pick<ShipTracking, "packed_at" | "accepted_at" | "delivered_at"> | null },
  now: number = Date.now(),
): OrderFacts {
  const handover = kindOf(order.handover);
  const base: OrderFacts = {
    handover,
    side: "buyer",
    free: order.lines.length > 0 && order.lines.every((l) => l.price_cents === 0),
    trade: order.lines.some((l) => l.source === "swap"),
    booked: false,
    done: order.status === "handed_over",
    // A paid order that was refunded in full (declutter_orders.status 'refunded') did not go ahead.
    cancelled: order.status === "refunded",
  };
  const h = rows.handover;
  const tookIt = !!(h?.picked_up_at || h?.confirmed_at);
  switch (handover) {
    case "porch":
      return { ...base, booked: !!rows.slotStart, out: !!h?.set_out_at, pickedUp: tookIt };
    case "seller_delivery": {
      const sd = rows.sellerDelivery;
      return { ...base, booked: sd?.status === "booked" && !!sd.slot_start, delivered: !!sd?.delivered_at,
        needsTime: sd?.status === "needs_time", moveAsked: !!sd?.proposed_start && sd.proposed_by === "seller",
        // AUD31-2: the panel's own "It wasn't delivered" rule (SellerDeliveryOrder can.notDelivered).
        late: sd?.status === "booked" && !sd.delivered_at && !!sd.not_delivered_from && now >= Date.parse(sd.not_delivered_from) };
    }
    case "delivery": {
      const t = rows.task;
      return { ...base, booked: !!t?.accepted_at, pickedUp: !!t?.picked_up_at, delivered: !!t?.delivered_at,
        inHandLong: !t?.delivered_at && heldPastADay(t?.picked_up_at, now) };
    }
    case "ship": {
      // B134: packed (the seller's tap), shipped (the carrier's acceptance scan), delivered (the delivered scan).
      const sh = rows.ship;
      return { ...base, packed: !!sh?.packed_at, pickedUp: !!sh?.accepted_at, delivered: !!sh?.delivered_at };
    }
    default:
      return { ...base, booked: !!rows.slotStart, pickedUp: tookIt, gotItOpen: gotItOpen(rows.slotStart, now) };
  }
}

/**
 * NIGHT-BUYINGopenpr-2: an open problem the buyer did not report and has not answered yet. The order card's "Add your
 * side" (DeclutterProblemSides) is then the buyer's move. Null (still loading or no problem): not theirs.
 */
function problemAwaitsBuyer(p: Pick<OrderProblem, "status" | "reporter_side" | "other_side_note"> | null): boolean {
  return !!p && p.status === "open" && p.reporter_side !== "buyer" && !p.other_side_note;
}

/** The buyer's one next move, named as the control that does it. Null when the order does not wait on the buyer. */
export function buyerNextAction(f: OrderFacts): string | null {
  if (f.problem && f.problemAwaitsYou && !f.cancelled) return "Add your side";
  if (!orderWaitsOnYou(f)) return null;
  if (f.handover === "porch") return f.booked ? "I got it" : "Pick a pickup time";
  if (f.handover === "pickup_home") return f.booked ? "I got it" : "Book a pickup time";
  if (f.handover === "meetup") return f.booked ? "I got it" : "Book a time to meet";
  // AUD31-3: the seller-delivery panel's own button words.
  if (f.handover === "seller_delivery" && !f.delivered) {
    return f.needsTime ? "Pick a time" : f.moveAsked ? "Accept the new time" : f.late ? "It wasn't delivered" : "I got it";
  }
  return "I got it";
}

/**
 * Where it stands, for the buyer, as the shared next-step line (owner 11-01 12:02 PM: "how are they supposed to know"
 * what to do next): the buyer's own move reads "Next: <step>" (the card's one button does it), someone else's reads
 * "Waiting on <who> to <step>", and a state that asks nothing of anyone is said plainly. `when` is the booked time in
 * words, when there is one. A "you" step has no full stop (NextStep adds "Next: "); the others are whole sentences.
 */
export function buyerNextStep(f: OrderFacts, when: string | null, helprName: string | null = null, taskPickedUpAt: string | null = null,
  taskStatus: string | null = null, times: { chosen: string | null; by: string | null } = { chosen: null, by: null },
  ship: Pick<ShipTracking, "ship_by" | "tracking_status"> | null = null, checkUntil: string | null = null): NextStepValue {
  const you = (text: string, by?: string | null): NextStepValue => ({ who: "you", text, by: by ?? null });
  const them = (text: string): NextStepValue => ({ who: "them", text });
  const info = (text: string): NextStepValue => ({ who: "info", text });
  // Audit 11-10 F370: the tracker passes the refund figure and day through cancelledStep; this is the words-only fallback.
  if (f.cancelled) return cancelledStep(null, null);
  if (f.problem) return f.problemAwaitsYou ? you("Add your side to the problem") : info(PROBLEM_ON_HOLD);
  // Audit 11-10 F365: inside the buyer's 24 hours the row says until when they can report a problem.
  if (f.done && checkUntil) return info(`You have it. Check it over: you can report a problem until ${orderWhen(checkUntil)}, then the sale is final.`);
  if (f.done) return info("Handed over. It's yours.");
  const at = orderStepAt(f);
  // A3-19 (lead 11-01 5:01 PM): nothing booked says "by <book_by>"; a checkout time once booked is named, no "by".
  const { chosen, by } = times;
  switch (f.handover) {
    case "porch":
      return at === 0 ? you("Pick a pickup time", by)
        : at === 1 && chosen ? info(`Pickup ${chosen} · porch`)
        : at === 1 ? them(`The seller puts it out ${when ? `for ${when}` : "on your day"} and posts a photo.`)
          : at === 2 ? you("Pick it up from the porch, then tap I got it")
            : info("Picked up.");
    case "pickup_home":
      if (at === 0) return you("Book a pickup time", by);
      if (at === 1 && chosen && !f.gotItOpen) return info(`Pickup ${chosen} · at the door`);
      if (at === 1) return f.gotItOpen ? you("Pick it up, then tap I got it", when ? `booked for ${when}` : null) : info(`Pickup booked${when ? ` for ${when}` : ""}.`);
      return info("Picked up.");
    case "meetup":
      if (at === 0) return you("Book a time to meet at the safe spot", by);
      if (at === 1 && chosen && !f.gotItOpen) return info(`Meet ${chosen}`);
      if (at === 1) return f.gotItOpen ? you("Meet the seller, then tap I got it", when ? `booked for ${when}` : null) : info(`Meeting booked${when ? ` for ${when}` : ""}.`);
      return info("Met.");
    case "seller_delivery":
      if (at === 0) return f.needsTime ? you("Pick a delivery time") : them("Waiting on the seller to set the delivery time.");
      // AUD31-2: past its time and not marked delivered, it says it is late, never "booked".
      // The card's button ("It wasn't delivered") is the step; the line says why.
      if (at === 1 && f.late) return info(`Late: it was due ${when ?? "earlier"} and the seller hasn't marked it delivered.`);
      if (at === 1 && f.moveAsked) return you("Accept the new delivery time, or keep yours");
      return at === 1 ? info(`Delivery booked${when ? ` for ${when}` : ""}.`) : you("Tap I got it once you have it");
    case "delivery":
      // AUD31-7: a delivery nobody took, or one that was closed, is never still "Finding a Helpr" (the task says so
      // under Details: DeclutterDeliveryViews' own lines).
      if (taskStatus === "unfilled") return info("No Helpr took this delivery. What you paid for delivery was refunded.");
      if (taskStatus && !LIVE_TASK.has(taskStatus)) return info("This delivery was closed.");
      if (at === 0) return them("Finding a Helpr to bring it.");
      // Audit 1c D3-3: "<First> picks it up from the seller <day, time>" from the booked pickup (pickup_slot_start),
      // never "on the way" days before it.
      if (at === 1) return them(`${helprName ?? "Your Helpr"} picks it up from the seller${when ? ` ${when}` : ""}.`);
      if (at === 2) {
        // LEAD-GOTIT30H: held 24 hours undelivered, the buyer may say they have it.
        const held = stillInHandLine(helprName ?? "Your Helpr", taskPickedUpAt);
        if (f.inHandLong) return you(`Tap I got it if you have it${held ? `. ${held}` : ""}`);
        return held ? info(held) : them("Picked up. On its way to you.");
      }
      return you("Tap I got it once you have it");
    case "ship": {
      // B134: the seller packs it and drops it off by the Ship-by day; then the carrier's scans say where it is.
      const by = shipByWords(ship?.ship_by);
      if (at === 0) return them(by ? `The seller packs it and ships it by ${by}.` : "The seller packs it and ships it.");
      if (at === 1) return them(by ? `Packed. The seller drops it off by ${by}.` : "Packed. The seller drops it off next.");
      if (at === 2) return info(`Shipped. ${trackingStatusWords(ship?.tracking_status) ?? "On its way"}.`);
      return info("Delivered.");
    }
  }
}

/** The Helpr task statuses of a delivery still under way or done (helpr_tasks.status); any other one is closed. */
const LIVE_TASK = new Set(["open", "accepted", "picked_up", "delivered", "confirmed"]);

/**
 * Audit BUY-31: a handed-over order with a refund still being worked out. The card said "Handed over. It's yours." over
 * a return, or with Louisiana Helpr deciding. Null when no refund is open (the standing above is right).
 */
export function refundStanding(status: string | null | undefined, inFull = false, request?: (RefundTookItBack & { answer_by?: string | null }) | null): string | null {
  // AUD31-36, checked before soldstates-7's inFull (merged by Lander 9): a full refund with the item given back ends
  // "agreed" with returned_at set (20261030071818); the order stays handed_over, so without this line the card read
  // "Handed over. It's yours." over a returned item.
  if (refundTookItBack(request)) {
    const back = request!.refund_cents ? formatPrice(request!.refund_cents) : null;
    if (!back) return "Returned for a refund.";
    return request!.refund_status === "succeeded" ? `Returned. You got ${back} back.` : `Returned. ${back} is on its way back to your card.`;
  }
  // Audit 11-10 F364: a part refund names the money back; the row read "Handed over. It's yours." over it.
  if (status === "agreed" && !inFull && request?.refund_cents) {
    const back = formatPrice(request.refund_cents);
    return request.refund_status === "succeeded" ? `Partly refunded: ${back} back to your card.` : `Partly refunded: ${back} is on its way back to your card.`;
  }
  switch (status) {
    // NIGHT-SELL-soldstates-7: a full refund undid the sale (refundedInFull); a part refund leaves it handed over.
    case "agreed": return inFull ? REFUNDED_IN_FULL.buyer : null;
    // F364: who is waiting and until when (declutter_refund_requests.answer_by).
    case "open": return request?.answer_by
      ? `Handed over. You asked for a refund; the seller has until ${new Date(request.answer_by).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} to answer.`
      : "Handed over. You asked for a refund.";
    case "declined": return "Handed over. The seller said no to your refund.";
    case "offered": return "Handed over. You have a refund offer to answer.";
    case "returning": return "Going back for a refund.";
    case "to_admin": return "On hold while Louisiana Helpr decides the refund.";
    default: return null;
  }
}

/** "today", "tomorrow" or "Thu, Oct 30", to sit after "for". */
const porchDayLower = (day: string) => porchDayWords(day).replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase());
const whenWords = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The buyer's paid orders in cart order (the same order, and so the same bookings key, as PaidOrdersSection). */
function buyerPaidOrders(cart: CartLine[]) {
  const by = new Map<string, { orderId: string; handover: string | null; status: string | null; lines: CartLine[]; taskId: string | null }>();
  for (const l of cart) {
    if (l.my_side !== "buyer" || l.status !== "paid" || !l.order_id) continue;
    const o = by.get(l.order_id) ?? { orderId: l.order_id, handover: l.handover, status: l.order_status, lines: [], taskId: l.delivery_task_id ?? null };
    o.lines.push(l);
    by.set(l.order_id, o);
  }
  return [...by.values()];
}

/** A checkout still waiting in the cart (one per seller, CartView's own rule: inside its hold). */
function openCheckouts(cart: CartLine[], now: number): number {
  return new Set(cart.filter((l) => l.my_side === "buyer" && l.status === "in_cart" && new Date(l.checkout_by).getTime() > now).map((l) => l.seller_id)).size;
}

/**
 * Cart lines that ended in the last 30 days (the cart's own window): the checkout ran out or the seller called it off
 * before paying, OR an order closed after it was paid or claimed (declutter_close_paid_order: a no-show, a problem
 * decided, a seller backing out sets its lines to missed / cancelled_by_seller and the order to refunded).
 */
function endedLines(cart: CartLine[]): CartLine[] {
  return cart.filter((l) => l.my_side === "buyer" && (l.status === "missed" || l.status === "cancelled_by_seller"));
}

export type BuyingTracker = {
  /** Null until the cart has answered. */
  ready: boolean;
  views: Map<string, BuyerOrderView>;
  checkouts: number;
  ended: CartLine[];
  counts: Record<OrderBucket, number>;
  /** D-NEW11: the orders and booked times the pickup-day card reads (the same read as above). */
  live: { orderId: string; handover: string | null; status: string | null; lines: CartLine[] }[];
  bookings: MyBooking[] | undefined;
  /** F409: the bookings and open-problem reads behind the pickup-day card have answered (or failed). */
  pickupsSettled: boolean;
};

export function useBuyingTracker(): BuyingTracker {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const lines = cart.data ?? [];
  const orders = buyerPaidOrders(lines);
  const live = orders.filter((o) => o.status === "paid");
  const ids = orders.map((o) => o.orderId);
  // The same keys as the order card's panels, so a card that opens reads nothing again.
  const bookings = useQuery({ queryKey: ["declutter", "bookings", ids.join(",")], queryFn: () => fetchMyBookings(ids), enabled: ids.length > 0 });
  // A1-B2: "You paid" is the card charge (the sale plus a first purchase's setup fee), never the line's total_cents.
  const paidCents = useMyPaidCents(ids);
  // Q2630 (audit 1102c R5): a refunded order says what came back (declutter_my_refunded_cents), never a bare "refunded".
  const refundedIds = orders.filter((o) => o.status === "refunded").map((o) => o.orderId).sort();
  const refundedCents = useQuery({ queryKey: ["declutter", "my-refunded-cents", refundedIds.join(",")], queryFn: () => fetchMyRefundedCents(refundedIds), enabled: refundedIds.length > 0 });
  // Audit 1b D2-2: an open problem puts the order on hold (the same key the order card reads).
  const problemsRead = useOpenProblemsRead(ids);
  const problems = problemsRead.problems;
  // NIGHT-BUYINGopenpr-2: whether this buyer still owes their side of each open problem (the card reads the same key).
  const problemIds = ids.filter((id) => problems.has(id));
  const problemRows = useQueries({ queries: problemIds.map((id) => ({ queryKey: ["declutter", "problem", id], queryFn: () => fetchOrderProblem(id) })) });
  const pickups = live.filter((o) => o.handover !== "delivery" && o.handover !== "seller_delivery" && o.handover !== "ship");
  // ONE read of the order's times (lead 11-01): book_by (the server's 7-day mark, pinned to the handover sweep) and
  // the window chosen at checkout (pickup_slot_start / pickup_slot_end; a porch booking holds only its first 30 min).
  const pickupIds = pickups.map((o) => o.orderId);
  const times = useQuery({ queryKey: orderPickupTimesKey(pickupIds), queryFn: () => fetchOrderPickupTimes(pickupIds), enabled: pickupIds.length > 0 });
  // B134: a shipped order's tracking (the same key the order card's ShipOrderPanel reads).
  const shipOrders = live.filter((o) => o.handover === "ship");
  const shipRows = useQueries({ queries: shipOrders.map((o) => ({ queryKey: shipTrackingKey(o.orderId), queryFn: () => fetchMyShipTracking(o.orderId) })) });
  const handovers = useQueries({ queries: pickups.map((o) => ({ queryKey: ["declutter", "handover", o.orderId], queryFn: () => fetchMyHandover(o.orderId) })) });
  // F365/F375: a handed-over order's handover row says when the buyer's 24 hours to check it end (the same key).
  const handedOver = orders.filter((o) => o.status === "handed_over");
  const doneRows = useQueries({ queries: handedOver.map((o) => ({ queryKey: ["declutter", "handover", o.orderId], queryFn: () => fetchMyHandover(o.orderId) })) });
  const sd = live.filter((o) => o.handover === "seller_delivery");
  const sdRows = useQueries({ queries: sd.map((o) => ({ queryKey: ["declutter", "seller-delivery-booking", o.orderId], queryFn: () => fetchSellerDeliveryBooking(o.orderId) })) });
  const helpr = live.filter((o) => o.handover === "delivery" && o.taskId);
  const tasks = useQueries({
    queries: helpr.map((o) => ({ queryKey: ["helpr-tasks", "view", o.taskId], queryFn: () => fetchTaskView(o.taskId as string), meta: { persist: false } })),
  });
  // A2-7: "Raise the pay" waited for Details, then for the delivery card's code, then for its own read. Both start
  // here, with the list, so opening Details finds them ready.
  useQueries({ queries: helpr.map((o) => deliveryRaiseQuery(o.orderId)) });
  const hasHelpr = helpr.length > 0;
  useEffect(() => {
    if (hasHelpr) void import("./DeclutterDeliveryViews");
  }, [hasHelpr]);
  // Owner 11-11 (F363, option b): Needs you is exactly the Home To-do list's Buying rows (declutterBuyingTodos, the
  // badges' rule), from the same reads and keys Home uses: an order is under Needs you when it has such a row (a paid
  // order waiting on its handover, a refund offer to answer), and the chip counts those rows. Anything else the old
  // rule called Needs you goes to Done (handed over, the 24 hours to check still open) or Waiting.
  const myOffers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: fetchMyOffers });
  const refundsOn = useFeatureStatus("declutter_refund_requests").on;
  const myRefunds = useQuery({ queryKey: ["declutter", "my-refund-todos"], queryFn: fetchMyRefundTodos, enabled: refundsOn });
  const refundRows = refundsOn ? myRefunds.data ?? [] : [];
  // F363 side effect (b) (owner 11-11): a seller's problem report still waiting on the buyer's side is a Home To-do
  // Buying row (dp-<order>), so the order moves into Needs you here too. Home reads the same problem rows
  // (declutter_order_problem under the same key) and the same rule (declutterTodos).
  const homeProblems = [...problems.values()].map((p) => ({
    order_id: p.order_id,
    reporter_side: p.reporter_side,
    awaits_buyer: problemAwaitsBuyer(problemRows[problemIds.indexOf(p.order_id)]?.data ?? null),
  }));
  const homeRows = declutterBuyingTodos(lines, myOffers.data ?? [], refundRows, Date.now(), homeProblems);
  const refundOrder = new Map(refundRows.map((r) => [`dr-${r.request_id}`, r.order_id]));
  const needsYouOrders = new Set(homeRows.map((r) => (r.id.startsWith("dh-") || r.id.startsWith("dp-") ? r.id.slice(3) : refundOrder.get(r.id))).filter((x): x is string => !!x));
  const views = new Map<string, BuyerOrderView>();
  const counts: Record<OrderBucket, number> = { needs_you: 0, waiting: 0, upcoming: 0, done: 0, cancelled: 0 };
  for (const o of orders) {
    const bookingRow = (bookings.data ?? []).find((b) => b.order_id === o.orderId);
    const slot = bookingRow?.slot_start ?? null;
    const sdRow = sdRows[sd.indexOf(o)]?.data ?? null;
    const task = tasks[helpr.indexOf(o)]?.data ?? null;
    const facts: OrderFacts = {
      ...buyerOrderFacts(o, {
        slotStart: slot,
        handover: handovers[pickups.indexOf(o)]?.data ?? null,
        sellerDelivery: sdRow,
        task,
        ship: shipRows[shipOrders.indexOf(o)]?.data ?? null,
      }),
      problem: problems.has(o.orderId),
      problemAwaitsYou: problemAwaitsBuyer(problemRows[problemIds.indexOf(o.orderId)]?.data ?? null),
    };
    const checkUntil = facts.done ? checkWindowEnds(doneRows[handedOver.indexOf(o)]?.data?.confirmed_at) : null;
    facts.checkOpen = !!checkUntil;
    const ruled = orderBucket(facts);
    const bucket: OrderBucket = needsYouOrders.has(o.orderId) ? "needs_you" : ruled !== "needs_you" ? ruled : facts.done && !facts.problem ? "done" : "waiting";
    if (bucket !== "needs_you") counts[bucket]++;
    const whenIso = o.handover === "seller_delivery" ? sdRow?.slot_start ?? null
      : o.handover === "delivery" ? task?.pickup_slot_start ?? null : slot;
    // A1-C2: a porch pickup is a DAY (pickup_day); its slot_start is only the day's start, so never show it as a time.
    // B112 / A3-19: the window chosen at checkout is named by buyerNextStep's `chosen` ("Pickup Sun 11/2, 3–5 PM · porch").
    const orderTimes = (times.data ?? []).find((t) => t.id === o.orderId);
    const when = o.handover === "porch" && bookingRow?.pickup_day ? porchDayLower(bookingRow.pickup_day)
      : whenIso ? (o.handover === "seller_delivery" ? slotLabel(whenIso) : whenWords(whenIso)) : null;
    const total = paidCents?.get(o.orderId) ?? null;
    const back = facts.cancelled ? refundedCents.data?.get(o.orderId) ?? null : null;
    views.set(o.orderId, {
      orderId: o.orderId,
      facts,
      bucket,
      action: buyerNextAction(facts),
      next: facts.cancelled ? cancelledStep(back, o.lines[0]?.closed_at ?? null) : buyerNextStep(facts, when, o.handover === "delivery" ? task?.helpr_first_name ?? null : null, o.handover === "delivery" ? task?.picked_up_at ?? null : null,
        o.handover === "delivery" ? task?.status ?? null : null,
        orderTimeWords(orderTimes, o.handover, slot), shipRows[shipOrders.indexOf(o)]?.data ?? null, checkUntil),
      // #6: a free item never reads like a paid order ("You paid $0").
      money: facts.free ? "Free." : total != null && !facts.cancelled ? `You paid ${formatPrice(total)}.` : null,
    });
  }
  const checkouts = openCheckouts(lines, Date.now());
  counts.needs_you = homeRows.length;
  const ended = endedLines(lines);
  counts.cancelled += ended.length;
  return { ready: !!cart.data, views, checkouts, ended, counts, live, bookings: bookings.data, pickupsSettled: !bookings.isLoading && problemsRead.answered };
}

/**
 * Q2630: "Cancelled. $42.70 was refunded to your card on Nov 2." (the day only when the server sends closed_at).
 * Audit 11-10 F370: with no figure yet the row still gives the day and says when the money shows up, instead of a bare
 * "Cancelled and refunded to your card." (no amount, no date). Card refunds take 5-10 business days to show on a statement.
 */
function cancelledStep(cents: number | null, closedAt: string | null): NextStepValue {
  const day = closedAt && !Number.isNaN(Date.parse(closedAt)) ? new Date(closedAt).toLocaleDateString([], { month: "short", day: "numeric" }) : null;
  const when = " It shows on your statement in 5-10 business days.";
  if (cents != null && cents > 0) return { who: "info", text: `Cancelled. ${formatPrice(cents)} was refunded to your card${day ? ` on ${day}` : ""}.${when}` };
  return { who: "info", text: `Cancelled${day ? ` on ${day}` : ""}. Your payment is refunded to your card.${when}` };
}

/**
 * Audit DB-6 (2026-10-30): Buying listed orders in cart order, so a Done order could sit above one that Needs you.
 * Orders now follow ORDER_BUCKETS (Needs you, Waiting, Upcoming, Done, Cancelled), keeping cart order inside a group;
 * an order with no view yet goes last.
 */
export function byBucket<T extends { orderId: string }>(orders: readonly T[], views: ReadonlyMap<string, BuyerOrderView>): T[] {
  const rank = (o: T) => {
    const b = views.get(o.orderId)?.bucket;
    const i = ORDER_BUCKETS.findIndex((x) => x.key === b);
    return i < 0 ? ORDER_BUCKETS.length : i;
  };
  return orders.map((o, i) => ({ o, i, r: rank(o) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.o);
}

/** The chips that hold orders, in ORDER_BUCKETS order. */
export function bucketChips(counts: Record<OrderBucket, number>) {
  return ORDER_BUCKETS.filter((b) => counts[b.key] > 0).map((b) => ({ key: b.key, label: b.label, count: counts[b.key] }));
}

/**
 * The top of a buyer's order card: the tracker, where it stands, what was paid, and the ONE next action. The rest of
 * the card (the pickup panel, the address, reporting a problem, the review) opens under "Details", and the next
 * action opens it at that control.
 */
export function BuyerOrderHead({ view, standing, refundOpen = false, open, onOpen, onClose, onAction = onOpen }: {
  view: BuyerOrderView; open: boolean; onOpen: () => void; onClose: () => void;
  /** F366 (rest): a refund still being worked out; the step bar ends on "Refund asked", never "Done". */
  refundOpen?: boolean;
  /** Says more than the tracker's sentence: a refund being worked out (refundStanding). */
  standing?: string | null;
  /** The next-action button; defaults to opening Details (D3-7: a Helpr delivery's "I got it" also asks at once). */
  onAction?: () => void;
}) {
  return (
    <div className="space-y-2" data-buyer-order={view.bucket}>
      {/* Q2630: a refunded order did not go ahead, so no step bar stopped at "Paid" as if it were still in progress. */}
      {!view.facts.cancelled && <OrderSteps facts={view.facts} refundOpen={refundOpen} />}
      <NextStep value={standing ? { who: "info", text: standing } : view.next} className="!text-ds-14" />
      {view.money && <p className="text-ds-13 text-muted-foreground">{view.money}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {view.action && !open && (
          <Button type="button" variant="primary" size="sm" className="px-5 text-sm font-semibold" onClick={onAction} data-next-action="">
            {view.action}
          </Button>
        )}
        <Button type="button" variant="link" size="sm" className="px-0 text-sm font-semibold underline decoration-current underline-offset-2 text-[color:inherit]" aria-expanded={open} onClick={open ? onClose : onOpen}>
          {open ? "Hide details" : "Details"}
        </Button>
      </div>
    </div>
  );
}

/** A checkout that ended unpaid: nothing was charged (offers and checkouts charge only when paid). */
/**
 * What an ended line says. Audit 2 A2-4 (B2-1, 2026-10-28, a2-42-buyer-noshow-done-p1-390): after a no-show closed a
 * free order its card left Buying with no record; the record now kept here must not read like an unpaid checkout
 * ("The time to check out ran out. Nothing was charged." on a paid sale that is being refunded would be false).
 */
function endedWords(line: Pick<CartLine, "status" | "order_id" | "order_status" | "total_cents">): string {
  const closedAfterPaying = !!line.order_id && line.order_status === "refunded";
  if (!closedAfterPaying) {
    return line.status === "missed" ? "The time to check out ran out. Nothing was charged." : "The seller called off the sale. Nothing was charged.";
  }
  const sellerFault = line.status === "cancelled_by_seller";
  if ((line.total_cents ?? 0) === 0) {
    return sellerFault ? "The seller cancelled this free pickup. Nothing was charged." : "This free pickup was cancelled. Nothing was charged.";
  }
  return sellerFault ? "The seller cancelled this sale. Your refund is on its way to your card." : "This sale was cancelled. Your refund is on its way to your card.";
}

export function EndedLine({ line }: { line: CartLine }) {
  return (
    <li className="rounded-[20px] border border-border bg-card p-4" data-ended-line="">
      {/* DB-19: the price and the day it ended, as on the seller's ended rows. */}
      <div className="flex items-baseline gap-3">
        <p className="min-w-0 flex-1 truncate text-ds-15 font-semibold" title={line.item_title}>{line.item_title}</p>
        <span className="shrink-0 text-ds-15 font-bold tabular-nums text-muted-foreground">{line.source === "swap" ? "Trade" : itemPriceLabel(line.price_cents)}</span>
      </div>
      <p className="text-ds-13 text-muted-foreground">{endedOnPrefix(line.closed_at)}{endedWords(line)}</p>
    </li>
  );
}
