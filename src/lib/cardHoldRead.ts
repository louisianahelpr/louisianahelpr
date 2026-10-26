/**
 * Q2399: the poster's own card hold on a job, for the "Your card is on hold"
 * line (get_my_job_card_hold, behind card_hold_at_post; READ only). Null
 * when there is none or it cannot be read; the read error is returned so the
 * caller reports it.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

export type MyCardHold = { state: string; amount_cents: number } | null;

export async function fetchMyCardHold(jobId: string): Promise<{ hold: MyCardHold; error: unknown; message?: string }> {
  const { data, error } = await supabase.rpc("get_my_job_card_hold", { p_job_id: jobId });
  if (error) return { hold: null, error, message: rpcErrorMessage("get_my_job_card_hold", error) ?? undefined };
  const row = Array.isArray(data) ? (data[0] as { state?: string; amount_cents?: number } | undefined) : undefined;
  return { hold: row && typeof row.state === "string" ? { state: row.state, amount_cents: Number(row.amount_cents) } : null, error: null };
}
