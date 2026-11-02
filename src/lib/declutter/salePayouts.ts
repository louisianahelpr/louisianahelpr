/**
 * A3-56 (audit 11-01): Money > Earned left out Declutter sales entirely (it read only payout_transfers, the job
 * payouts). A seller's sale payouts are declutter_payouts rows (fetchMyPayouts, the sold card's read; RLS: the
 * seller's own), named by the paid cart line's item_title (the seller reads their own lines). Not declutter_my_cart:
 * it stops at 30 days.
 *   - Earned counts a sale once its payout SUCCEEDED, on the day it was sent (executed_at), like a job payout.
 *   - The rows say each payout's state in plain words.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { fetchMyPayouts, type MyPayout } from "@/lib/declutter/handover";

export type SalePayout = MyPayout & { title: string };

export async function fetchMySalePayouts(userId: string): Promise<SalePayout[]> {
  const payouts = await fetchMyPayouts(userId);
  if (payouts.length === 0) return [];
  const lines = unwrap(
    await supabase.from("declutter_cart_items").select("order_id, item_title, created_at")
      .eq("seller_id", userId).in("order_id", payouts.map((p) => p.order_id)).order("created_at", { ascending: true }),
  ) as { order_id: string | null; item_title: string | null }[] | null;
  const titles = new Map<string, string[]>();
  for (const l of lines ?? []) {
    if (!l.order_id) continue;
    const t = (l.item_title ?? "").trim();
    titles.set(l.order_id, [...(titles.get(l.order_id) ?? []), t || "Declutter item"]);
  }
  return payouts
    .filter((p) => p.status !== "nothing_due")
    .map((p) => {
      const t = titles.get(p.order_id) ?? [];
      const title = t.length === 0 ? "Declutter sale" : t.length === 1 ? t[0] : `${t[0]} and ${t.length - 1} more`;
      return { ...p, title };
    })
    .sort((a, b) => Date.parse(b.executed_at ?? "9999") - Date.parse(a.executed_at ?? "9999"));
}

export const salePayoutsKey = (userId: string) => ["declutter", "sale-payouts", userId] as const;

/** The sales Earned counts for a range: payouts sent on or after `sinceMs` (null = all time). */
export function salesEarnedIn(rows: SalePayout[], sinceMs: number | null): { cents: number; count: number } {
  const sent = rows.filter((r) => r.status === "succeeded" && r.executed_at && (sinceMs === null || Date.parse(r.executed_at) >= sinceMs));
  return { cents: sent.reduce((s, r) => s + r.amount_cents, 0), count: sent.length };
}

/** "Paid Oct 29" / "Not sent yet" / "Didn't go through". */
export function salePayoutWords(r: SalePayout): string {
  if (r.status === "succeeded") {
    return r.executed_at ? `Paid ${new Date(r.executed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Paid";
  }
  if (r.status === "failed") return "Didn't go through";
  return "Not sent yet";
}
