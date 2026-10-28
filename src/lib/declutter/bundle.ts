/**
 * Declutter bundle discounts (Q2427, owner 2026-10-27; migration 20261027211754): a seller sets "Buy 2+, get N% off"
 * (N 5-50). At checkout every PAID line from that seller is N% off its own price when there are 2 or more, never
 * below the item's lowest price. The cart previews the real discount from the server (the same computation checkout
 * uses); members see "Bundle discount -$X" and the total, never fee math. Every rule is the server's.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { rpcErrorMessage } from "./bundleErrors";

/** The percents a seller can pick (the server takes any whole 5-50; the screen offers these). */
export const BUNDLE_PERCENTS = [5, 10, 15, 20, 25, 30, 40, 50] as const;

function rpcData<T>(result: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null): T {
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

/** A seller's percent, or null (none, or not deployed yet). */
export async function fetchBundleRule(sellerId: string): Promise<number | null> {
  const res = await supabase.rpc("declutter_bundle_rule", { p_seller_id: sellerId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_bundle_rule")) return null;
  const v = rpcData(res, (e) => rpcErrorMessage("declutter_bundle_rule", e)) as unknown as number | null;
  return typeof v === "number" ? v : null;
}

/** Deep audit #36: the ids among `itemIds` the bundle discount can apply to (above their lowest price), or null
 *  before the read is deployed (then the offer shows as before). */
export async function fetchBundleApplies(itemIds: string[]): Promise<Set<string> | null> {
  if (itemIds.length === 0) return new Set();
  const res = await supabase.rpc("declutter_bundle_applies", { p_item_ids: itemIds.slice(0, 200) });
  if (res.error && isMissingRpcNamed(res.error, "declutter_bundle_applies")) return null;
  const ids = rpcData(res, (e) => rpcErrorMessage("declutter_bundle_applies", e)) as unknown as string[] | null;
  return new Set(ids ?? []);
}

/** The seller sets their percent (5-50) or removes it (null). */
export async function setBundleDiscount(percent: number | null): Promise<number | null> {
  return rpcData(
    // nullable-arg: NULL removes the rule.
    await supabase.rpc("declutter_set_bundle_discount", { p_percent: percent as unknown as number }),
    (e) => rpcErrorMessage("declutter_set_bundle_discount", e),
  ) as unknown as number | null;
}

/** The discount (cents) the caller's cart from this seller gets now; 0 when none or not deployed yet. */
export async function fetchBundlePreview(sellerId: string): Promise<number> {
  const res = await supabase.rpc("declutter_bundle_preview", { p_seller_id: sellerId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_bundle_preview")) return 0;
  const v = rpcData(res, (e) => rpcErrorMessage("declutter_bundle_preview", e)) as unknown as number | null;
  return typeof v === "number" && v > 0 ? v : 0;
}

/** "Buy 2+, get 10% off". */
export function bundleLabel(percent: number): string {
  return `Buy 2+, get ${percent}% off`;
}
