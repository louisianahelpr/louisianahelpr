/**
 * The buyer's return label for a shipped order an admin asked to come back (damaged or not as described;
 * declutter_admin_request_return_label / declutter_my_return_label, 20261103212046). The buyer's notice says
 * "Print it from your order", so the order card reads it here.
 *
 * The server answers order_not_found (PT404) when no return was asked for this order, or the order is not the
 * caller's: that is the normal case for almost every shipped order, so it reads as "no return label" (null),
 * never as an error. The label link appears only once the label is bought (state 'bought').
 * Guard: src/components/declutter/returnLabelPanel.test.tsx.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { rpcData } from "@/lib/declutter/api";

export type MyReturnLabel = {
  state: "requested" | "bought" | "failed";
  label_url: string | null;
  tracking_code: string | null;
};

export const returnLabelKey = (orderId: string) => ["declutter", "return-label", orderId] as const;

export async function fetchMyReturnLabel(orderId: string): Promise<MyReturnLabel | null> {
  const res = await supabase.rpc("declutter_my_return_label", { p_order_id: orderId });
  if (res.error && (await rpcErrorCode("declutter_my_return_label", res.error)) === "order_not_found") return null;
  return rpcData(res, (e) => rpcErrorMessage("declutter_my_return_label", e)) as unknown as MyReturnLabel;
}
