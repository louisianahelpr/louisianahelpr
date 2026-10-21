/**
 * Raising a Declutter delivery's pay (spec row 40, Q1929; migration
 * 20261021130506_declutter_delivery_raise_pay). The buyer of a delivery no
 * Helpr has taken yet may add to the pay; it is its own card payment (the
 * raise plus its card fee, src/lib/declutter/raiseFee.ts), made on a Stripe
 * page that declutter-checkout opens. Nothing changes until that payment
 * goes through, and a raise the delivery never uses comes back in full.
 * Every rule is in SQL; this file only reads the panel's state and opens the page.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { rpcErrorMessage } from "@/lib/helprTasks/errorCopy";
import { invokeDeclutter } from "@/lib/declutter/api";

export interface DeliveryRaise {
  raise_cents: number;
  card_fee_cents: number;
  total_cents: number;
  status: "applied" | "refunding" | "refunded";
  refund_reason: string | null;
  paid_at: string | null;
}

/** What the buyer's "Raise the pay" panel shows (declutter_delivery_raise_status). */
export interface DeliveryRaiseStatus {
  order_id: string;
  task_status: string | null;
  open_until: string | null;
  delivery_cents: number;
  raised_cents: number;
  can_raise: boolean;
  room_cents: number;
  raises: DeliveryRaise[];
}

/** The panel's state, or null before the migration is deployed (the panel stays hidden). */
export async function fetchDeliveryRaiseStatus(orderId: string): Promise<DeliveryRaiseStatus | null> {
  const res = await supabase.rpc("declutter_delivery_raise_status", { p_order_id: orderId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_delivery_raise_status")) return null;
  if (res.error) {
    try {
      unwrap(res);
    } catch (thrown) {
      const e = thrown as Error & { userMessage?: string };
      const words = rpcErrorMessage("declutter_delivery_raise_status", thrown);
      if (words && Object.isExtensible(e)) e.userMessage = words;
      throw e;
    }
  }
  return res.data as unknown as DeliveryRaiseStatus;
}

/** Open the raise's Stripe page: its URL, or paid=true when an earlier raise page already went through. */
export async function startDeliveryRaise(orderId: string, raiseCents: number): Promise<{ url: string | null; paid: boolean }> {
  const data = await invokeDeclutter("declutter-checkout", { action: "raise_pay", order_id: orderId, raise_cents: raiseCents });
  return { url: typeof data.url === "string" ? data.url : null, paid: data.paid === true };
}
