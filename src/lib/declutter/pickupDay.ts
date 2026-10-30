/**
 * D-NEW11: which of the buyer's paid orders are picked up today, in time order. Pure, so the rule is tested without a
 * screen. "Today" is the device's calendar day, the same day the booked time reads as on the order card; the server
 * re-checks the Louisiana day on "I'm on my way".
 */
import type { MyBooking } from "./handover";

export interface PickupOrderLike {
  orderId: string;
  handover: string | null;
  status: string | null;
  lines: { item_id: string | null; item_title: string }[];
}

export interface PickupToday<O extends PickupOrderLike = PickupOrderLike> {
  order: O;
  booking: MyBooking;
  /** The buyer already said "I'm on my way" today. */
  onWay: boolean;
}

const PICKUP_KINDS = new Set(["pickup_home", "porch", "meetup"]);
const ymd = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;

export function pickupsToday<O extends PickupOrderLike>(orders: O[], bookings: MyBooking[], now = new Date()): PickupToday<O>[] {
  const today = ymd(now);
  const byOrder = new Map(bookings.map((b) => [b.order_id, b]));
  const out: PickupToday<O>[] = [];
  for (const order of orders) {
    const booking = byOrder.get(order.orderId);
    if (!booking || order.status !== "paid" || !PICKUP_KINDS.has(order.handover ?? "")) continue;
    const day = booking.pickup_day ?? (booking.slot_start ? ymd(new Date(booking.slot_start)) : null);
    if (day !== today) continue;
    const said = booking.buyer_on_way_at ? ymd(new Date(booking.buyer_on_way_at)) === today : false;
    out.push({ order, booking, onWay: said });
  }
  // A porch pickup is a whole day (its slot_start is only the day's start): it goes last.
  const at = (p: PickupToday<O>) => (p.order.handover === "porch" || !p.booking.slot_start ? Number.MAX_SAFE_INTEGER : Date.parse(p.booking.slot_start));
  return out.sort((a, b) => at(a) - at(b));
}
