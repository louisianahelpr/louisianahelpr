/**
 * The paid orders DeclutterHandoverViews shows, and the small helpers its panels share (split out of
 * DeclutterHandoverViews.tsx, componentSizeRatchet, batch 1030e). Pure: no React.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { CartLine } from "@/lib/declutter/api";

/** One paid order as the cart lists it (its lines share order_id). */
export interface PaidOrder {
  orderId: string;
  side: "buyer" | "seller";
  handover: string | null;
  status: string | null;
  lines: CartLine[];
  /** Slice 5: the Helpr task of a delivery order. */
  deliveryTaskId: string | null;
}

/** Group the cart's paid lines into orders. */
export function paidOrdersFromCart(cart: CartLine[]): PaidOrder[] {
  const byOrder = new Map<string, PaidOrder>();
  for (const l of cart) {
    if (l.status !== "paid" || !l.order_id) continue;
    const o = byOrder.get(l.order_id) ?? {
      orderId: l.order_id, side: l.my_side, handover: l.handover, status: l.order_status, lines: [], deliveryTaskId: l.delivery_task_id ?? null,
    };
    o.lines.push(l);
    byOrder.set(l.order_id, o);
  }
  return [...byOrder.values()];
}

/** Handed over after the live sales, refunded last; anything else (paid, still to hand over) first. */
const SALE_RANK: Readonly<Record<string, number>> = { handed_over: 1, refunded: 2 };

/**
 * NIGHT-SELL-soldstates-2: Selling's "Hand over" listed paid-out, refunded and still-to-hand-over sales mixed, in cart
 * order. The sales still to hand over come first, then the handed-over ones, then the refunded; cart order inside each.
 */
export function liveSalesFirst<T extends Pick<PaidOrder, "status">>(orders: readonly T[]): T[] {
  return orders.map((o, i) => ({ o, i, r: SALE_RANK[o.status ?? ""] ?? 0 })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.o);
}

export const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** `<input type="datetime-local">` value -> ISO (the device's own time zone). */
export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function invalidate(qc: QueryClient, orderId: string) {
  void qc.invalidateQueries({ queryKey: ["declutter", "my-cart"] });
  void qc.invalidateQueries({ queryKey: ["declutter", "bookings"] });
  void qc.invalidateQueries({ queryKey: ["declutter", "handover", orderId] });
  void qc.invalidateQueries({ queryKey: ["declutter", "payouts"] });
  void qc.invalidateQueries({ queryKey: ["declutter", "problems"] });
  // A booking or move changes the order's chosen time (pickup_slot_start / _end, 20261102005411) the cards read.
  void qc.invalidateQueries({ queryKey: ["declutter", "order-pickup-times"] });
}
