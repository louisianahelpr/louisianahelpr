/**
 * The seller's own payout rows, read without the rest of handover.ts (its RPC words pull lifecycleErrors.ts, about
 * 30 KB gz). Money > Earned (salePayouts.ts) reads them on /profile?tab=earnings, and the critical-path budget (Q178)
 * keeps that route light. handover.ts re-exports both names, so its callers are unchanged.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

export interface MyPayout {
  order_id: string;
  items_cents: number;
  /** A seller delivery's rate, paid with the items (20261027153244); 0 otherwise or when free. */
  delivery_cents: number;
  /** Board 141d: what a refund after the handover took back from this payout. */
  refunded_cents: number;
  debt_cents: number;
  amount_cents: number;
  status: "pending" | "succeeded" | "failed" | "nothing_due";
  executed_at: string | null;
  /** soldstates-4: the payout run's tries so far (20261031184338); absent until that grant is live. */
  attempts?: number;
}

/** The seller's payout rows (row 93): what was paid, minus any card-fee debt. */
export async function fetchMyPayouts(userId: string): Promise<MyPayout[]> {
  const cols = "order_id, items_cents, delivery_cents, refunded_cents, debt_cents, amount_cents, status, executed_at";
  const res = await supabase.from("declutter_payouts").select(`${cols}, attempts`).eq("seller_id", userId);
  // soldstates-4: attempts is readable once 20261031184338 is live; before that the column read is refused (42501,
  // permission denied for the column), so the payouts are read as before, without the try count.
  if (res.error && res.error.code === "42501" && /attempts|permission denied/i.test(res.error.message ?? "")) {
    // Not silent: the card loses only the try count; said here, as fetchMyQuestionIds does for its refusal.
    console.warn("[declutter] payout try count not readable yet; reading payouts without it", res.error);
    const rows = unwrap(await supabase.from("declutter_payouts").select(cols).eq("seller_id", userId));
    return (rows ?? []) as MyPayout[];
  }
  return (unwrap(res) ?? []) as MyPayout[];
}
