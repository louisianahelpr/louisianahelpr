/**
 * The deadline a buyer has to book the pickup of a paid Declutter order (owner 2026-11-01: "people aren't told what to
 * do next", the next-step line's "by <time>"). A porch, door or meetup pickup that has no booked time 7 days after it
 * was paid is closed by the server and the item price refunded (declutter_handover_sweep, newest definition in
 * 20261031181404: `o2.paid_at + interval '7 days' <= now()` with no booking slot_start). The booking itself must also
 * end inside those 7 days (declutter_book_pickup, 20261031145652). So the buyer's line reads
 * "Next: book a pickup time · by Sat, Nov 7, 3:00 PM".
 *
 * paid_at is readable by the order's two sides ("declutter orders: the two sides read"; Receipts reads it the same way).
 * Guard: src/components/declutter/buyingOrders.test.tsx "book-by deadline".
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/** The server's window to book a pickup after paying (declutter_handover_sweep's interval '7 days'). */
const PICKUP_BOOK_DAYS = 7;

/** paid_at + 7 days, as ISO; null when the order was never paid. Pure. */
function bookByIso(paidAt: string | null | undefined): string | null {
  if (!paidAt) return null;
  const t = Date.parse(paidAt);
  return Number.isNaN(t) ? null : new Date(t + PICKUP_BOOK_DAYS * 86_400_000).toISOString();
}

/** Each order's book-by deadline (orderId -> ISO). Only the caller's own orders come back (RLS). */
export async function fetchBookBy(orderIds: readonly string[]): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  const rows = (unwrap(await supabase.from("declutter_orders").select("id, paid_at").in("id", [...orderIds])) ?? []) as
    { id: string; paid_at: string | null }[];
  const out = new Map<string, string>();
  for (const r of rows) {
    const by = bookByIso(r.paid_at);
    if (by) out.set(r.id, by);
  }
  return out;
}
