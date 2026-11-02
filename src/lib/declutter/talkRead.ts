/**
 * B112 (B110 leftover 4): mark the caller's side of a Declutter chat read (declutter_mark_talk_read, 20261101200929).
 * Before the RPC is on prod (PGRST202) it does nothing; any other failure is logged, never shown (a missed mark only
 * means one extra reminder).
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";

export async function markTalkRead(kind: "order" | "handover", ref: string): Promise<void> {
  const { error } = await supabase.rpc("declutter_mark_talk_read", { p_kind: kind, p_ref: ref });
  if (error && !isMissingRpcNamed(error, "declutter_mark_talk_read")) console.warn(`[declutter] mark ${kind} chat read failed: ${error.message}`);
}
