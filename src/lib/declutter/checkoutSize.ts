/**
 * A3-53 (audit 11-01): checkout's delivery price list marks this checkout's size BEFORE any quote, the way the item
 * page does (owner 11-01 11:49 AM, "the item's size highlighted"). The size is the one the server prices the cart
 * at: the largest of its items (declutter_delivery_quote, 20261101175628: xl, else large, else small). A read of the
 * items' public delivery_size; no money, no write. Guard: src/test/checkoutPickupTime.test.tsx "A3-53".
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import type { DeliverySize } from "@/lib/declutter/api";

/** xl, else large, else small (null when no size is known). Pure. */
export function largestDeliverySize(sizes: readonly (string | null | undefined)[]): DeliverySize | null {
  if (sizes.includes("xl")) return "xl";
  if (sizes.includes("large")) return "large";
  return sizes.some((s) => s) ? "small" : null;
}

export async function fetchCheckoutSize(itemIds: readonly string[]): Promise<DeliverySize | null> {
  if (itemIds.length === 0) return null;
  const rows = (unwrap(await supabase.from("declutter_items").select("id, delivery_size").in("id", [...itemIds])) ?? []) as
    { id: string; delivery_size: string | null }[];
  return largestDeliverySize(rows.map((r) => r.delivery_size));
}
