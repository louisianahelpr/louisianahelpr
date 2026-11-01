/**
 * The seller's porch weekdays (migration 20261029161347; owner 2026-10-29, the sell form's porch
 * weekday chips). Per SELLER, like the pickup times. None picked (null) = the weekdays of their
 * pickup times, the rule buyers already see. The server keeps every rule (declutter_set_porch_days;
 * declutter_porch_days and declutter_book_porch_day share declutter_is_porch_day).
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { rpcData } from "@/lib/declutter/api";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { unwrap } from "@/lib/supabaseResult";

/** Not on the server yet (PGRST202): the chips stay hidden and the old rule applies, as before. */
export const PORCH_DAYS_NOT_DEPLOYED = "not_deployed" as const;

/** The caller's picked porch weekdays (0 = Sunday), null when none are picked, or not_deployed. */
export async function fetchMyPorchDays(): Promise<number[] | null | typeof PORCH_DAYS_NOT_DEPLOYED> {
  const r = await supabase.rpc("declutter_my_porch_days");
  if (r.error && isMissingRpcNamed(r.error, "declutter_my_porch_days")) return PORCH_DAYS_NOT_DEPLOYED;
  return (rpcData(r, (e) => rpcErrorMessage("declutter_my_porch_days", e)) ?? null) as number[] | null;
}

/** Saves the caller's porch weekdays; an empty list goes back to the pickup-time days. Returns what was stored. */
export async function saveMyPorchDays(weekdays: number[]): Promise<number[]> {
  return (rpcData(await supabase.rpc("declutter_set_porch_days", { p_weekdays: weekdays }),
    (e) => rpcErrorMessage("declutter_set_porch_days", e)) ?? []) as number[];
}

/**
 * B112 (B110 leftover 2): the seller's porch weekdays for THIS buyer's checkout (declutter_checkout_porch_days,
 * 20261101200349: the server's own rule, asked only with a line from that seller in the cart). Checkout's porch
 * window chips keep to them when no porch place is chosen, so a day the server would refuse at Pay is never offered.
 * Null before it is on the server (PGRST202): the chips stay as they were.
 */
export async function fetchCheckoutPorchDays(sellerId: string): Promise<number[] | null> {
  const r = await supabase.rpc("declutter_checkout_porch_days", { p_seller_id: sellerId });
  if (r.error && isMissingRpcNamed(r.error, "declutter_checkout_porch_days")) return null;
  return ((unwrap(r) ?? []) as number[]).map(Number);
}

/** The pickup windows kept to the porch days; null days (not known): unchanged. Pure. */
export function onPorchDays<T extends { weekday: number }>(windows: readonly T[], days: readonly number[] | null | undefined): T[] {
  return days ? windows.filter((w) => days.includes(w.weekday)) : [...windows];
}
