/**
 * B112 (B110 leftover 1, lead 11-01): the pickup window the buyer chose at checkout, frozen on the order
 * (declutter_orders.pickup_slot_start / pickup_slot_end, 20261101191500; members read them from 20261101200035).
 * A porch order's card shows this window ("Sun, Nov 2, 3–5 PM"), never the 30-minute booking made from its start.
 * Before 20261101200035 is on prod the read is refused (42501): that reads as "no window", and the card shows what it
 * always showed. Guard: src/components/declutter/buyingOrders.test.tsx "porch window".
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

export type PickupWindow = { start: string; end: string };

export async function fetchPickupWindows(orderIds: readonly string[]): Promise<Map<string, PickupWindow>> {
  if (orderIds.length === 0) return new Map();
  const res = await supabase.from("declutter_orders").select("id, pickup_slot_start, pickup_slot_end").in("id", [...orderIds]);
  // 42501: the column grant is not on the server yet; no window, the old words stay.
  if (res.error && res.error.code === "42501") return new Map();
  const rows = (unwrap(res) ?? []) as { id: string; pickup_slot_start: string | null; pickup_slot_end: string | null }[];
  const out = new Map<string, PickupWindow>();
  for (const r of rows) if (r.pickup_slot_start && r.pickup_slot_end) out.set(r.id, { start: r.pickup_slot_start, end: r.pickup_slot_end });
  return out;
}
