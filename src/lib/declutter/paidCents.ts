/**
 * What the buyer's card was charged for each of their own Declutter orders, to the cent (A1-B2, Declutter audit on
 * prod 2026-10-29: Stripe charged $34.20 and the app said "You paid $32.20").
 *
 * The cart line's total_cents is the SALE; a first purchase also carries the one-time account setup fee outside it
 * (20261026154738), and the fee's columns are not granted to members. declutter_my_paid_cents (20261029161237)
 * answers total_cents + setup_fee_cents, minus the fee when it never stayed charged (not_charged, refund_due,
 * refunded), for the caller's own orders as buyer only.
 *
 * Null before the RPC is on the server (PGRST202): a "You paid" line then shows no figure rather than one $2 low.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

export async function fetchMyPaidCents(orderIds: string[]): Promise<Map<string, number> | null> {
  if (orderIds.length === 0) return new Map();
  const res = await supabase.rpc("declutter_my_paid_cents", { p_order_ids: orderIds });
  if (res.error && isMissingRpcNamed(res.error, "declutter_my_paid_cents")) return null;
  let rows: { order_id: string; paid_cents: number }[];
  try {
    rows = (unwrap(res) ?? []) as { order_id: string; paid_cents: number }[];
  } catch (thrown) {
    // The words ride on the error (userMessage), so any screen that shows the failure says the code's own sentence.
    const e = thrown as Error & { userMessage?: string };
    const words = rpcErrorMessage("declutter_my_paid_cents", thrown);
    if (words && Object.isExtensible(e)) e.userMessage = words;
    throw e;
  }
  return new Map(rows.map((r) => [r.order_id, Number(r.paid_cents)]));
}
