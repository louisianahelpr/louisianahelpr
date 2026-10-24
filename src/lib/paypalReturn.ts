/**
 * The return from PayPal (PayPal Plan A, phase 3). create-payment's PayPal
 * checkout sends the poster back to `/payment-success?job_id=<id>&provider=paypal`
 * once they approve. Approving moves no money: OUR capture does. So the page
 * asks create-payment `paypal_capture` to capture the order now (the
 * CHECKOUT.ORDER.APPROVED webhook does the same; both make one capture), then
 * reads jobs.payment_status as for any checkout.
 *
 * The answer only steers the page: the money claim is still EARNED from
 * payment_status (PaymentSuccess's truthfulness contract). A failed call is not
 * a failed payment: the webhook may still capture, so the page keeps polling.
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

export type PayPalReturnStatus = "funded" | "processing" | "not_approved" | "declined" | "replaced" | "none" | "unreachable";

const RETURN_STATUSES = new Set<PayPalReturnStatus>(["funded", "processing", "not_approved", "declined", "replaced", "none"]);

/** True when this return came from a PayPal checkout (our own return URL marks it). */
export function isPayPalReturn(params: URLSearchParams): boolean {
  return params.get("provider") === "paypal";
}

export async function capturePayPalReturn(jobId: string): Promise<PayPalReturnStatus> {
  try {
    const { data, error } = await supabase.functions.invoke<{ status?: string; error?: string }>("create-payment", {
      body: { action: "paypal_capture", jobId },
    });
    const status = data?.status as PayPalReturnStatus | undefined;
    if (error || !status || !RETURN_STATUSES.has(status)) {
      report(error ?? new Error(`paypal_capture answered ${JSON.stringify(data)}`), { tags: { source: "PaymentSuccess.paypalCapture" } });
      return "unreachable";
    }
    return status;
  } catch (e) {
    report(e, { tags: { source: "PaymentSuccess.paypalCapture" } });
    return "unreachable";
  }
}
