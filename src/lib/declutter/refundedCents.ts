/**
 * A3-112 follow-up (audit 2026-11-01): what was sent back to the buyer's card for each of their own Declutter orders,
 * so Money > Spent and Receipts net a PART refund (an agreed $15 back on a $42.70 order read $42.70 spent).
 * declutter_my_refunded_cents (20261102033426) sums the order's own payment's succeeded refund row, live hand
 * refunds and the delivery fee sent back; two of those tables have no member read, so the client cannot add it up.
 *
 * Null before the RPC is on the server (PGRST202): the screens then show the charge, as before. A failed read throws.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";

export async function fetchMyRefundedCents(orderIds: string[]): Promise<Map<string, number> | null> {
  if (orderIds.length === 0) return new Map();
  const res = await supabase.rpc("declutter_my_refunded_cents", { p_order_ids: orderIds });
  if (res.error && isMissingRpcNamed(res.error, "declutter_my_refunded_cents")) return null;
  let rows: { order_id: string; refunded_cents: number }[];
  try {
    rows = (unwrap(res) ?? []) as { order_id: string; refunded_cents: number }[];
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    // lifecycleErrors.ts is loaded only here, on a failure, as in paidCents.ts: Money > Spent reads this on
    // /profile?tab=earnings, and the static import pulled lifecycleErrors and the signed-in-deep chunk (with
    // signed-in-pages, declutter-first-screen and three more behind it) onto that route's first screen: 386 -> 509 KB gz,
    // 6 -> 8 rounds (critical-path budget, Q178; L33 train 11-02).
    const copy = await import("@/lib/lifecycleErrors").catch(
      () => null, // Not silent: the error itself is still thrown below; only its specific sentence is lost.
    );
    const words = copy ? copy.rpcErrorMessage("declutter_my_refunded_cents", thrown) : null;
    if (words && Object.isExtensible(e)) e.userMessage = words;
    throw e;
  }
  return new Map(rows.map((r) => [r.order_id, Number(r.refunded_cents)]));
}

/** The charge less what came back, never below 0; and the words for a part refund ("· $15.00 refunded"). */
export function netOfRefund(charged: number, refunded: number | undefined): { cents: number; note: string } {
  const back = Math.max(0, refunded ?? 0);
  if (back === 0) return { cents: charged, note: "" };
  return { cents: Math.max(0, charged - back), note: ` · $${(back / 100).toFixed(2)} refunded` };
}
