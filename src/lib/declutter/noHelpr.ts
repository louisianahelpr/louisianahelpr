/**
 * BUY-2 and soldstates-5 client calls (owner 10-31). Every rule is in SQL: 20261031133938 (the buyer's cancel after no
 * Helpr took the delivery; the buyer bears the card fee) and 20261031134217 (the seller's "The Helpr didn't come"; the
 * Helpr's answer). Until a read is deployed (PGRST202) it answers null, so the screens show nothing new.
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

function withWords<T>(result: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null): T {
  if (!result.error) return result.data;
  try {
    unwrap(result);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    const msg = words(thrown);
    if (msg && Object.isExtensible(e)) e.userMessage = msg;
    throw e;
  }
  return result.data;
}

/** What cancelling gives back: everything except the card fee (the buyer bears it); the delivery fee already came back. */
interface NoHelprChoice {
  refund_cents: number;
  card_fee_cents: number;
  delivery_refunded_cents: number;
  pickup_by: string;
}

export async function fetchNoHelprChoice(orderId: string): Promise<NoHelprChoice | null> {
  const res = await supabase.rpc("declutter_no_helpr_choice", { p_order_id: orderId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_no_helpr_choice")) return null;
  return (withWords(res, () => null) as unknown as NoHelprChoice | null) ?? null;
}

export async function cancelAfterNoHelpr(orderId: string): Promise<{ result: string }> {
  return withWords(await supabase.rpc("declutter_cancel_after_no_helpr", { p_order_id: orderId }), (e) => rpcErrorMessage("declutter_cancel_after_no_helpr", e)) as unknown as { result: string };
}

/** The seller's "The Helpr didn't come" (15 minutes after the booked pickup time; the server checks). */
export async function reportHelprNoShow(orderId: string): Promise<{ result: string; answer_by: string }> {
  return withWords(await supabase.rpc("declutter_report_helpr_no_show", { p_order_id: orderId }), (e) => rpcErrorMessage("declutter_report_helpr_no_show", e)) as unknown as { result: string; answer_by: string };
}

interface HelprNoShowReport {
  reported_at: string;
  answer_by: string;
  answered_at: string | null;
  settled_at: string | null;
}

export async function fetchHelprNoShowReport(taskId: string): Promise<HelprNoShowReport | null> {
  const res = await supabase.rpc("helpr_task_no_show_report", { p_task_id: taskId });
  if (res.error && isMissingRpcNamed(res.error, "helpr_task_no_show_report")) return null;
  return (withWords(res, () => null) as unknown as HelprNoShowReport | null) ?? null;
}

/** The Helpr's answer, within 24 hours: their words (and a photo from their task folder, when they have one). */
export async function answerHelprNoShow(taskId: string, note: string): Promise<string> {
  return withWords(await supabase.rpc("declutter_helpr_answer_no_show", { p_task_id: taskId, p_note: note }), (e) => rpcErrorMessage("declutter_helpr_answer_no_show", e)) as string;
}
