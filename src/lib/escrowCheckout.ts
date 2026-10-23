/**
 * THE one door to an escrow checkout: create-payment { action: 'escrow' }.
 * Post a Job (useJobSubmit.startPayment) and a booked quote
 * (src/pages/quotes/QuoteRequestPage.tsx) both call this, so a job is only
 * ever funded one way: create-payment charges jobs.budget for the job id it
 * is given and the webhook flips payment_status to 'escrow'. Nothing here
 * decides a price.
 */
import { supabase } from "@/integrations/supabase/client";
import { isNativePlatform } from "@/lib/nativeInit";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { functionErrorMessage } from "@/lib/supabaseResult";
import type { JobFeeQuote } from "@/lib/jobCheckout";

export interface EscrowCheckoutOptions {
  /** Ask Stripe to save the card (forced for a recurring series by the caller). */
  saveCardForFuture?: boolean;
  /** Gift card redemption: create-payment settles the gift instead of the full charge. */
  giftCardId?: string | null;
  /**
   * What this screen showed (owner 2026-10-18): the fee model and the job
   * price. create-payment refuses a request whose quote mismatches it, so a
   * stale screen is never charged a total it did not show.
   * Build it with buildFeeQuote (src/lib/jobCheckout.ts).
   */
  feeQuote?: JobFeeQuote;
  /**
   * Where a cancelled checkout comes back to (Q1862). create-payment accepts
   * only a quote request page (/quotes/request/<uuid>) and refuses any
   * other; omitted, it is Post a Job.
   */
  returnPath?: string;
}

/** create-payment's answer: a Checkout URL, or a refusal sentence in `error`. */
interface EscrowCheckoutResponse {
  data: { url?: string; error?: string } | null;
  error: Error | null;
}

export function requestEscrowCheckout(jobId: string, opts: EscrowCheckoutOptions = {}): Promise<EscrowCheckoutResponse> {
  return supabase.functions.invoke<{ url?: string; error?: string }>("create-payment", {
    body: {
      action: "escrow",
      jobId,
      native: isNativePlatform,
      saveCardForFuture: !!opts.saveCardForFuture,
      ...(opts.giftCardId ? { giftCardId: opts.giftCardId } : {}),
      ...(opts.feeQuote ? { feeQuote: opts.feeQuote } : {}),
      ...(opts.returnPath ? { returnPath: opts.returnPath } : {}),
    },
  });
}

/**
 * Open the escrow checkout for `jobId` and hand the member to Stripe. Throws
 * an EscrowCheckoutError carrying the server's own sentence on a refusal, so the caller can
 * show it. Used by the quote screens; Post a Job keeps its own retry handling
 * around requestEscrowCheckout (useJobSubmit.startPayment).
 */
/** A refusal from create-payment, carrying the server's own sentence. */
export class EscrowCheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EscrowCheckoutError";
  }
}

export async function openEscrowCheckout(jobId: string, opts: EscrowCheckoutOptions = {}): Promise<void> {
  const { data, error } = await requestEscrowCheckout(jobId, opts);
  const url = data?.url;
  const refusal = data?.error;
  if (error || typeof refusal === "string" || typeof url !== "string" || !url) {
    const msg =
      typeof refusal === "string" && refusal.trim()
        ? refusal
        : error
          ? await functionErrorMessage(error, "Payment setup failed.")
          : "Payment setup failed.";
    throw new EscrowCheckoutError(msg);
  }
  await openExternalUrl(url);
}
