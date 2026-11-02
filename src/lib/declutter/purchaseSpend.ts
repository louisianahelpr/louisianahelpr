/**
 * A3-112 (audit 8, 11-01): Money > Spent read jobs, refunds, gift cards, tips and crew fees only, so what a member paid
 * for Declutter items showed only under Receipts. This is the buyer-side twin of A3-56 (salePayouts.ts for Earned).
 * The rows follow Receipts' rule for a paid order (orderReceipts in src/pages/profile/Receipts.tsx; parity guard in
 * src/test/declutterPurchasesSpent.test.tsx): a paid / handed-over / refunded order with paid_at; what the card was
 * charged (declutter_my_paid_cents, else total_cents); a refunded order counts $0 and says "Refunded".
 * Reads, all the buyer's own rows (RLS): declutter_orders, the order's cart lines (item_title; not declutter_my_cart,
 * which stops at 30 days), and declutter_my_paid_cents. No writes.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { fetchMyPaidCents } from "@/lib/declutter/paidCents";

export interface PurchaseOrder { id: string; status: string; total_cents: number; paid_at: string | null }
export interface PurchaseRow { id: string; title: string; ms: number; cents: number; refunded: boolean }

const COUNTED = ["paid", "handed_over", "refunded"];

export function purchaseRows(orders: readonly PurchaseOrder[], titles: ReadonlyMap<string, string[]>, paid: ReadonlyMap<string, number> | null): PurchaseRow[] {
  return orders
    .filter((o) => o.paid_at && COUNTED.includes(o.status))
    .map((o) => {
      const t = titles.get(o.id) ?? [];
      const title = t.length === 0 ? "Declutter purchase" : t.length === 1 ? t[0] : `${t[0]} and ${t.length - 1} more`;
      const refunded = o.status === "refunded";
      return { id: o.id, title, ms: Date.parse(o.paid_at!), cents: refunded ? 0 : paid?.get(o.id) ?? o.total_cents, refunded };
    });
}

export async function fetchMyPurchases(userId: string): Promise<PurchaseRow[]> {
  const orders = (unwrap(
    await supabase.from("declutter_orders").select("id, status, total_cents, paid_at").eq("buyer_id", userId).not("paid_at", "is", null),
  ) ?? []) as PurchaseOrder[];
  const ids = orders.filter((o) => o.paid_at && COUNTED.includes(o.status)).map((o) => o.id);
  if (ids.length === 0) return [];
  const lines = (unwrap(
    await supabase.from("declutter_cart_items").select("order_id, item_title, created_at")
      .eq("buyer_id", userId).in("order_id", ids).order("created_at", { ascending: true }),
  ) ?? []) as { order_id: string | null; item_title: string | null }[];
  const titles = new Map<string, string[]>();
  for (const l of lines) {
    if (!l.order_id) continue;
    titles.set(l.order_id, [...(titles.get(l.order_id) ?? []), (l.item_title ?? "").trim() || "Declutter item"]);
  }
  // A failed charge read throws (a failed load), never a row $2 under what Stripe charged; null = not deployed.
  const paid = await fetchMyPaidCents([...ids].sort());
  return purchaseRows(orders, titles, paid);
}

export const purchasesKey = (userId: string) => ["declutter", "my-purchases", userId] as const;
