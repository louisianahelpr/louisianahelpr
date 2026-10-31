/**
 * LEAD-DELIVER-OFF-ALL (owner 2026-10-31): unticking "I'll deliver" in Declutter settings also stops delivery on the
 * seller's live listings (declutter_stop_my_seller_delivery, 20261031180550). Open orders keep the way they chose.
 * The same call takes it off the saved default too (one transaction, 20261031183416), so the card calls it before saving the rest.
 * Returns how many listings changed, or null while the function is not deployed yet.
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { rpcData } from "@/lib/declutter/api";

export async function stopMySellerDelivery(): Promise<number | null> {
  const r = await supabase.rpc("declutter_stop_my_seller_delivery");
  if (r.error && isMissingRpcNamed(r.error, "declutter_stop_my_seller_delivery")) return null;
  return Number(rpcData(r, (e) => rpcErrorMessage("declutter_stop_my_seller_delivery", e)) ?? 0);
}
