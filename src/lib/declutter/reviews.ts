/**
 * Board 163: who a Declutter review is about. Both sides of an order may read
 * its row (policy "declutter orders: the two sides read"), so the other
 * person's id comes from the order itself; their name then comes from the
 * public profile read the seller card uses (fetchSellerCard). Never the
 * address: that read is only the two ids.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/** The other person on the order, or null when the order is not readable (or their account is gone). */
export async function fetchOrderOtherPerson(orderId: string, myId: string): Promise<string | null> {
  const row = unwrap(
    await supabase.from("declutter_orders").select("buyer_id, seller_id").eq("id", orderId).maybeSingle(),
  ) as { buyer_id: string | null; seller_id: string | null } | null;
  if (!row) return null;
  if (row.buyer_id === myId) return row.seller_id ?? null;
  if (row.seller_id === myId) return row.buyer_id ?? null;
  return null;
}
