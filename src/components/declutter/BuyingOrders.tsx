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
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchMyCart, type CartLine } from "@/lib/declutter/api";
import { fetchMyBookings, fetchMyHandover, fetchOrderProblem, type MyBooking, type MyHandover, type OrderProblem } from "@/lib/declutter/handover";
import { fetchSellerDeliveryBooking, slotLabel, type SellerDeliveryBooking } from "@/lib/declutter/sellerDelivery";
import { fetchTaskView, type TaskView } from "@/lib/helprTasks/api";
import { heldPastADay, stillInHandLine } from "@/lib/declutter/stillInHand";
import { deliveryRaiseQuery } from "@/lib/declutter/deliveryRaiseQuery";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { refundTookItBack, type RefundTookItBack } from "@/lib/declutter/refundRequests";
import { endedOnPrefix } from "./DeclutterEndedSales";
import { porchDayWords } from "./DeclutterPorchDay";
import { useMyPaidCents } from "./useMyPaidCents";
import { REFUNDED_IN_FULL } from "@/lib/declutter/refundRequests";
import { useOpenProblems } from "./useOpenProblems";
import { PROBLEM_ON_HOLD } from "./DeclutterProblemOpen";
import { ORDER_BUCKETS, OrderSteps, gotItOpen, orderBucket, orderStepAt, orderWaitsOnYou, type OrderBucket, type OrderFacts, type OrderHandover } from "./OrderSteps";

/** One paid order on the buyer's side, as the tracker files it. */
export type BuyerOrderView = {
  orderId: string;
  facts: OrderFacts;
  bucket: OrderBucket;
  /** The one next move, when it is the buyer's ("Pick a pickup day", "I got it"); null when nothing is asked. */
  action: string | null;
  /** Where it stands, one plain sentence. */
  standing: string;
  /** "You paid $34.30." / "Free." */
  money: string | null;
};

const KINDS: readonly OrderHandover[] = ["porch", "pickup_home", "meetup", "delivery", "seller_delivery"];
const kindOf = (h: string | null): OrderHandover => (KINDS as readonly string[]).includes(h ?? "") ? (h as OrderHandover) : "pickup_home";

/** What the order's rows say, per handover kind. Pure: the rule is tested apart from the screen. */
export function buyerOrderFacts(
  order: { handover: string | null; status: string | null; lines: Pick<CartLine, "price_cents">[] },
  rows: { slotStart?: string | null; handover?: Pick<MyHandover, "set_out_at" | "picked_up_at" | "confirmed_at"> | null;
    sellerDelivery?: Pick<SellerDeliveryBooking, "status" | "slot_start" | "delivered_at">
      & Partial<Pick<SellerDeliveryBooking, "proposed_start" | "proposed_by" | "not_delivered_from">> | null;
    task?: Pick<TaskView, "accepted_at" | "picked_up_at" | "delivered_at"> | null },
  now: number = Date.now(),
): OrderFacts {
  const handover = kindOf(order.handover);
  const base: OrderFacts = {
    handover,
    side: "buyer",
    free: order.lines.length > 0 && order.lines.every((l) => l.price_cents === 0),
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

/** Where it stands, for the buyer, in one sentence. `when` is the booked time in words, when there is one. */
function buyerStanding(f: OrderFacts, when: string | null, helprName: string | null = null, taskPickedUpAt: string | null = null,
  taskStatus: string | null = null): string {
  if (f.cancelled) return "Cancelled and refunded to your card.";
  if (f.problem) return PROBLEM_ON_HOLD;
  if (f.done) return "Handed over. It's yours.";
  const at = orderStepAt(f);
  switch (f.handover) {
    case "porch":
      return at === 0 ? "Pick the day you'll come for it."
        : at === 1 ? `The seller puts it out ${when ? `for ${when}` : "on your day"} and posts a photo.`
          : at === 2 ? "It's out on the porch. Pick it up, then tap I got it."
            : "Picked up.";
    case "pickup_home":
      return at === 0 ? "Book a time to pick it up." : at === 1 ? `Pickup booked${when ? ` for ${when}` : ""}.` : "Picked up.";
    case "meetup":
      return at === 0 ? "Book a time to meet at the safe spot." : at === 1 ? `Meeting booked${when ? ` for ${when}` : ""}.` : "Met.";
    case "seller_delivery":
      // AUD31-2: past its time and not marked delivered, it says it is late, never "booked".
      if (at === 1 && f.late) return `Late: it was due ${when ?? "earlier"} and the seller hasn't marked it delivered.`;
      return at === 0 ? "The delivery time isn't set yet." : at === 1 ? `Delivery booked${when ? ` for ${when}` : ""}.` : "Delivered. Tap I got it once you have it.";
    case "delivery":
      // AUD31-7: a delivery nobody took, or one that was closed, is never still "Finding a Helpr" (the task says so
      // under Details: DeclutterDeliveryViews' own lines).
      if (taskStatus === "unfilled") return "No Helpr took this delivery. What you paid for delivery was refunded.";
      if (taskStatus && !LIVE_TASK.has(taskStatus)) return "This delivery was closed.";
      // Audit 1c D3-3: "<First> picks it up from the seller <day, time>" from the booked pickup (pickup_slot_start),
      // never "on the way" days before it.
      return at === 0 ? "Finding a Helpr to bring it."
        : at === 1 ? `${helprName ?? "Your Helpr"} picks it up from the seller${when ? ` ${when}` : ""}.`
          : at === 2 ? stillInHandLine(helprName ?? "Your Helpr", taskPickedUpAt) ?? "Picked up. On its way to you." : "Delivered. Tap I got it once you have it.";
  }
}

/** The Helpr task statuses of a delivery still under way or done (helpr_tasks.status); any other one is closed. */
const LIVE_TASK = new Set(["open", "accepted", "picked_up", "delivered", "confirmed"]);

/**
 * Audit BUY-31: a handed-over order with a refund still being worked out. The card said "Handed over. It's yours." over
 * a return, or with Louisiana Helpr deciding. Null when no refund is open (the standing above is right).
 */
export function refundStanding(status: string | null | undefined, inFull = false, request?: RefundTookItBack | null): string | null {
  // AUD31-36, checked before soldstates-7's inFull (merged by Lander 9): a full refund with the item given back ends
  // "agreed" with returned_at set (20261030071818); the order stays handed_over, so without this line the card read
  // "Handed over. It's yours." over a returned item.
  if (refundTookItBack(request)) {
    const back = request!.refund_cents ? formatPrice(request!.refund_cents) : null;
    if (!back) return "Returned for a refund.";
    return request!.refund_status === "succeeded" ? `Returned. You got ${back} back.` : `Returned. ${back} is on its way back to your card.`;
  }
  switch (status) {
    // NIGHT-SELL-soldstates-7: a full refund undid the sale (refundedInFull); a part refund leaves it handed over.
    case "agreed": return inFull ? REFUNDED_IN_FULL.buyer : null;
    case "open": return "Handed over. You asked for a refund.";
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

/** A checkout still waiting in the cart (one per seller, CartView's own rule: inside its 48 hours). */
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
  // Audit 1b D2-2: an open problem puts the order on hold (the same key the order card reads).
  const problems = useOpenProblems(ids);
  // NIGHT-BUYINGopenpr-2: whether this buyer still owes their side of each open problem (the card reads the same key).
  const problemIds = ids.filter((id) => problems.has(id));
  const problemRows = useQueries({ queries: problemIds.map((id) => ({ queryKey: ["declutter", "problem", id], queryFn: () => fetchOrderProblem(id) })) });
  const pickups = live.filter((o) => o.handover !== "delivery" && o.handover !== "seller_delivery");
  const handovers = useQueries({ queries: pickups.map((o) => ({ queryKey: ["declutter", "handover", o.orderId], queryFn: () => fetchMyHandover(o.orderId) })) });
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
      }),
      problem: problems.has(o.orderId),
      problemAwaitsYou: problemAwaitsBuyer(problemRows[problemIds.indexOf(o.orderId)]?.data ?? null),
    };
    const bucket = orderBucket(facts);
    counts[bucket]++;
    const whenIso = o.handover === "seller_delivery" ? sdRow?.slot_start ?? null
      : o.handover === "delivery" ? task?.pickup_slot_start ?? null : slot;
    // A1-C2: a porch pickup is a DAY (pickup_day); its slot_start is only the day's start, so never show it as a time.
    const when = o.handover === "porch" && bookingRow?.pickup_day ? porchDayLower(bookingRow.pickup_day)
      : whenIso ? (o.handover === "seller_delivery" ? slotLabel(whenIso) : whenWords(whenIso)) : null;
    const total = paidCents?.get(o.orderId) ?? null;
    views.set(o.orderId, {
      orderId: o.orderId,
      facts,
      bucket,
      action: buyerNextAction(facts),
      standing: buyerStanding(facts, when, o.handover === "delivery" ? task?.helpr_first_name ?? null : null, o.handover === "delivery" ? task?.picked_up_at ?? null : null,
        o.handover === "delivery" ? task?.status ?? null : null),
      // #6: a free item never reads like a paid order ("You paid $0").
      money: facts.free ? "Free." : total != null && !facts.cancelled ? `You paid ${formatPrice(total)}.` : null,
    });
  }
  const checkouts = openCheckouts(lines, Date.now());
  counts.needs_you += checkouts;
  const ended = endedLines(lines);
  counts.cancelled += ended.length;
  return { ready: !!cart.data, views, checkouts, ended, counts, live, bookings: bookings.data };
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
export function BuyerOrderHead({ view, standing, open, onOpen, onClose, onAction = onOpen }: {
  view: BuyerOrderView; open: boolean; onOpen: () => void; onClose: () => void;
  /** Says more than the tracker's sentence: a refund being worked out (refundStanding). */
  standing?: string | null;
  /** The next-action button; defaults to opening Details (D3-7: a Helpr delivery's "I got it" also asks at once). */
  onAction?: () => void;
}) {
  return (
    <div className="space-y-2" data-buyer-order={view.bucket}>
      <OrderSteps facts={view.facts} />
      <p className="text-ds-14">{standing ?? view.standing}</p>
      {view.money && <p className="text-ds-13 text-muted-foreground">{view.money}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {view.action && !open && (
          <button type="button" className="btn-grad-primary !text-[hsl(var(--parchment))] min-h-11 rounded-full px-5 text-sm font-semibold" onClick={onAction} data-next-action="">
            {view.action}
          </button>
        )}
        <button type="button" className="min-h-11 text-sm font-semibold underline underline-offset-2" aria-expanded={open} onClick={open ? onClose : onOpen}>
          {open ? "Hide details" : "Details"}
        </button>
      </div>
    </div>
  );
}

/** A checkout that ended unpaid: nothing was charged (offers and checkouts charge only when paid). */
/**
 * What an ended line says. Audit 2 A2-4 (B2-1, 2026-10-28, a2-42-buyer-noshow-done-p1-390): after a no-show closed a
 * free order its card left Buying with no record; the record now kept here must not read like an unpaid checkout
 * ("The 48 hours to check out ran out. Nothing was charged." on a paid sale that is being refunded would be false).
 */
function endedWords(line: Pick<CartLine, "status" | "order_id" | "order_status" | "total_cents">): string {
  const closedAfterPaying = !!line.order_id && line.order_status === "refunded";
  if (!closedAfterPaying) {
    return line.status === "missed" ? "The 48 hours to check out ran out. Nothing was charged." : "The seller called off the sale. Nothing was charged.";
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
        <span className="shrink-0 text-ds-15 font-bold tabular-nums text-muted-foreground">{itemPriceLabel(line.price_cents)}</span>
      </div>
      <p className="text-ds-13 text-muted-foreground">{endedOnPrefix(line.closed_at)}{endedWords(line)}</p>
    </li>
  );
}
