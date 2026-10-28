/**
 * Tips on Declutter deliveries (Q2453; migration 20261028014848_helpr_task_tips). Once a delivery
 * is done, its buyer may tip the delivery Helpr. The money is the job tip's exactly
 * (supabase/functions/_shared/tipFees.ts): the Helpr receives the whole tip and the card cost is
 * added on top, shown only inside the one "You pay" total. Every rule is in SQL and in
 * declutter-checkout (action delivery_tip); this file reads the buyer's tips and opens the page.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { invokeDeclutter } from "@/lib/declutter/api";

export interface DeliveryTip {
  id: string;
  tip_cents: number;
  payment_status: "pending" | "paid";
  paid_at: string | null;
}

/** The caller's PAID tips on one delivery (RLS: the tipper and the Helpr read their own rows). */
export async function fetchMyPaidDeliveryTips(taskId: string, userId: string): Promise<DeliveryTip[]> {
  const rows = unwrap(
    await supabase.from("helpr_task_tips").select("id, tip_cents, payment_status, paid_at")
      .eq("task_id", taskId).eq("tipper_id", userId).eq("payment_status", "paid").order("paid_at", { ascending: true }),
  );
  return (rows ?? []) as DeliveryTip[];
}

/** The Helpr's PAID tips on their deliveries, summed per delivery (task id -> cents): shown on Your deliveries. */
export async function fetchTipsOnMyDeliveries(userId: string): Promise<Map<string, number>> {
  const rows = unwrap(
    await supabase.from("helpr_task_tips").select("task_id, tip_cents").eq("helpr_id", userId).eq("payment_status", "paid"),
  ) as { task_id: string; tip_cents: number }[] | null;
  const out = new Map<string, number>();
  for (const r of rows ?? []) out.set(r.task_id, (out.get(r.task_id) ?? 0) + r.tip_cents);
  return out;
}

/** Open the tip's Stripe page; returns its URL. `attemptId` is one per opening of the prompt. */
export async function startDeliveryTip(taskId: string, tipCents: number, attemptId: string): Promise<string> {
  const data = await invokeDeclutter("declutter-checkout", { action: "delivery_tip", task_id: taskId, tip_cents: tipCents, tip_attempt_id: attemptId });
  if (typeof data.url !== "string" || !data.url) throw new Error("payment_unavailable");
  return data.url;
}
