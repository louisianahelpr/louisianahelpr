/**
 * ONE Declutter order tracker (owner 2026-10-28: "buyers and sellers need a very organized way to keep
 * track of all their purchases and sells"), the Declutter twin of Jobs > Posted's tracker. Buying and
 * Selling both draw an order's progress through `orderSteps` (the words and the current step, from the
 * real order facts) and `<OrderSteps>` (the shared StepTracker bar), and file each order under one chip
 * with `orderBucket`: Needs you · Waiting · Upcoming · Done · Cancelled.
 *
 * Steps per handover (the same words on both sides; a free item's first step is "Claimed", never "Paid"):
 *   porch           Paid -> Time booked -> On the porch -> Picked up (LEAD-PLACE-TIMES, 2026-10-31; was Day picked)
 *   pickup_home     Paid -> Time booked -> Picked up -> Done
 *   meetup          Paid -> Time booked -> Met -> Done
 *   seller_delivery Paid -> Time booked -> Delivered -> Done
 *   delivery        Paid -> Helpr found -> Picked up -> Delivered
 * Every fact is read by the caller from the real rows (order status, booking, handover row, delivery
 * task); nothing here guesses a step the data does not show.
 */
import { StepTracker } from "@/components/tracker/StepTracker";

export type OrderHandover = "porch" | "pickup_home" | "meetup" | "delivery" | "seller_delivery";
export type OrderSide = "buyer" | "seller";

export type OrderFacts = {
  handover: OrderHandover;
  side: OrderSide;
  /** Every item in the order was free: the first step reads "Claimed". */
  free?: boolean;
  /** A pickup day (porch) or time is booked; for Helpr delivery, a Helpr has taken it. */
  booked: boolean;
  /** Porch: the seller's "on the porch" photo is in. */
  out?: boolean;
  /** Door pickup or meetup: "I got it" is open (from an hour before the booked time: gotItOpen). */
  gotItOpen?: boolean;
  /** The item has left the seller: the buyer picked it up, met, or the Helpr picked it up. */
  pickedUp?: boolean;
  /** Helpr delivery: picked up 24 hours ago and not marked delivered (heldPastADay); the buyer may say they got it. */
  inHandLong?: boolean;
  /** Delivery kinds: dropped off at the buyer's. */
  delivered?: boolean;
  /** AUD31-3, seller delivery: no time is set, and only the buyer can pick one (status needs_time). */
  needsTime?: boolean;
  /** AUD31-3, seller delivery: the other side asked to move the time, and only this viewer can accept it. */
  moveAsked?: boolean;
  /** AUD31-2, seller delivery: the booked time is over and it is not marked delivered (the booking's not_delivered_from). */
  late?: boolean;
  /** The order is handed over (final). */
  done: boolean;
  cancelled?: boolean;
  /** Audit 1b D2-2: a problem is open; nothing is asked of either side until Louisiana Helpr decides. */
  problem?: boolean;
  /**
   * NIGHT-BUYINGopenpr-2: the other side (or Louisiana Helpr) reported the problem and this viewer has not added their
   * side yet ("Add your side" waits on them).
   */
  problemAwaitsYou?: boolean;
};

export type OrderBucket = "needs_you" | "waiting" | "upcoming" | "done" | "cancelled";

/** The chips, in order, with their words (a chip shows only when it has orders). */
export const ORDER_BUCKETS: readonly { key: OrderBucket; label: string }[] = [
  { key: "needs_you", label: "Needs you" },
  { key: "waiting", label: "Waiting" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
];

const STEPS: Record<OrderHandover, readonly [string, string, string, string]> = {
  porch: ["Paid", "Time booked", "On the porch", "Picked up"],
  pickup_home: ["Paid", "Time booked", "Picked up", "Done"],
  meetup: ["Paid", "Time booked", "Met", "Done"],
  seller_delivery: ["Paid", "Time booked", "Delivered", "Done"],
  delivery: ["Paid", "Helpr found", "Picked up", "Delivered"],
};

/**
 * BUY-7 / audit 1030 DB-3: at a door pickup or a safe meeting spot "I got it" opens an hour before the booked
 * time, as "I'm here" does (the server refuses it before then: got_it_too_early, 20261030061753). One rule for
 * the card's action and the button under Details.
 */
const GOT_IT_OPENS_MINUTES_BEFORE = 60;
export function gotItOpen(slotStart: string | null | undefined, now: number = Date.now()): boolean {
  if (!slotStart) return false;
  const t = new Date(slotStart).getTime();
  return Number.isFinite(t) && now >= t - GOT_IT_OPENS_MINUTES_BEFORE * 60_000;
}

/** The step words for this order (free: "Claimed" first). */
export function orderStepWords(f: Pick<OrderFacts, "handover" | "free">): readonly string[] {
  const s = STEPS[f.handover];
  return f.free ? ["Claimed", ...s.slice(1)] : s;
}

/** The current step (0-based; the ones before it are done). */
export function orderStepAt(f: OrderFacts): number {
  if (f.done) return 3;
  switch (f.handover) {
    case "porch":
      return f.pickedUp ? 3 : f.out ? 2 : f.booked ? 1 : 0;
    case "delivery":
      return f.delivered ? 3 : f.pickedUp ? 2 : f.booked ? 1 : 0;
    case "seller_delivery":
      return f.delivered ? 2 : f.booked ? 1 : 0;
    default:
      return f.pickedUp ? 2 : f.booked ? 1 : 0;
  }
}

/** Whether the next move is the viewer's own. */
export function orderWaitsOnYou(f: OrderFacts): boolean {
  if (f.done || f.cancelled || f.problem) return false;
  const buyer = f.side === "buyer";
  switch (f.handover) {
    case "porch":
      // The buyer picks the day, then picks it up once it is out; the seller puts it out on that day.
      return buyer ? !f.booked || (!!f.out && !f.pickedUp) : f.booked && !f.out;
    case "pickup_home":
    case "meetup":
      // BUY-7: at the handover time "I got it" is the buyer's move, on the card, not under Details.
      return buyer && (!f.booked || (!!f.gotItOpen && !f.pickedUp));
    case "seller_delivery":
      // AUD31-3: before the drop-off, a time to pick or a move to answer is the buyer's move too.
      return buyer && (!!f.delivered || (!f.delivered && (!!f.needsTime || !!f.moveAsked || !!f.late)));
    case "delivery":
      // Dropped off: the buyer says they have it. LEAD-GOTIT30H: so too once a Helpr has held it 24 hours undelivered.
      return buyer && (!!f.delivered || !!f.inHandLong);
  }
}

/** Which chip the order sits under. */
export function orderBucket(f: OrderFacts): OrderBucket {
  if (f.cancelled) return "cancelled";
  // NIGHT-BUYINGopenpr-2: an open problem holds the money, so a handed-over order with one is never Done; when the
  // other side reported it and this viewer's side is still missing, the move is theirs.
  if (f.problem) return f.problemAwaitsYou ? "needs_you" : "waiting";
  if (f.done) return "done";
  if (orderWaitsOnYou(f)) return "needs_you";
  // A day or time is set, the handover has not happened and nothing is asked of the viewer before it: coming up.
  // Otherwise it is on the other person or the clock (a buyer's day to pick, a Helpr to take it, the sale to settle).
  return f.booked && !f.pickedUp && !f.delivered ? "upcoming" : "waiting";
}

/** The order's tracker bar: the shared StepTracker with this order's words and step. */
export function OrderSteps({ facts }: { facts: OrderFacts }) {
  const at = orderStepAt(facts);
  return (
    <div data-order-steps={facts.handover} data-order-step={at}>
      <StepTracker steps={orderStepWords(facts)} at={at} />
    </div>
  );
}
