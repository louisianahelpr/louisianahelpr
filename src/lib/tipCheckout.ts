/**
 * The ONE way the app starts a tip checkout (every tip prompt calls this:
 * TipDialog, CompletionPrompts). It picks the processor from the server's
 * switch answer, so no prompt can be left on a closed processor:
 *   - paypal_payments ON for the poster: paypal-tip "create" (PayPal Checkout);
 *   - otherwise: create-payment action "tip" (Stripe), unchanged.
 * The quote the poster saw (TipCostBreakdown with the same `paypal` flag) and
 * the charge come from one function each (tipChargeBreakdown /
 * paypalTipChargeBreakdown, supabase/functions/_shared/tipFees.ts).
 *
 * Guard: src/test/tipEntryPointsOfferPayPal.test.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { isNativePlatform } from "@/lib/nativeInit";

export interface TipCheckoutRequest {
  jobId: string;
  /** Dollars, already rounded to whole cents by the prompt. */
  amount: number;
  /** One id per opening of the prompt: a retry collapses onto one checkout. */
  tipAttemptId: string;
  /** On a crew job, the member being tipped. */
  helperId?: string;
  /** useFeature("paypal_payments") for the poster. */
  paypal: boolean;
}

/** Starts the checkout and returns the URL to send the poster to. Throws a sentence fit to show. */
export async function startTipCheckout(req: TipCheckoutRequest, fallback: string): Promise<string> {
  const { data, error } = req.paypal
    ? await supabase.functions.invoke("paypal-tip", {
        body: { action: "create", jobId: req.jobId, amount: req.amount, tipAttemptId: req.tipAttemptId, native: isNativePlatform, helperId: req.helperId },
      })
    : await supabase.functions.invoke("create-payment", {
        // helperId: undefined on a single-helper job, dropped by JSON.
        body: { action: "tip", jobId: req.jobId, amount: req.amount, tipAttemptId: req.tipAttemptId, native: isNativePlatform, helperId: req.helperId },
      });
  // A non-2xx makes the SDK throw a FunctionsHttpError whose message is the useless "Edge
  // Function returned a non-2xx status code"; the real reason is in the body.
  if (error) throw new Error(await functionErrorMessage(error, fallback));
  if (data?.error) throw new Error(String(data.error));
  if (typeof data?.url !== "string" || !data.url) throw new Error("Couldn't start checkout. Please try again.");
  return data.url;
}

export interface PayPalTipReturn {
  state: "paid" | "processing" | "not_approved" | "declined" | string;
  tipStatus: string | null;
  message?: string;
}

/** The poster is back from PayPal (`?tip=paypal&token=<order id>`): capture it. Idempotent server-side. */
export async function finishPayPalTip(orderId: string): Promise<PayPalTipReturn> {
  const { data, error } = await supabase.functions.invoke("paypal-tip", { body: { action: "capture", orderId } });
  if (error) throw new Error(await functionErrorMessage(error, "We couldn't confirm your tip yet. Refresh in a moment to check."));
  if (data?.error) throw new Error(String(data.error));
  return data as PayPalTipReturn;
}
