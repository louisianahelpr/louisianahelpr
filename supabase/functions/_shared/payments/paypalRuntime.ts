/**
 * The PayPal pieces a cron needs, built from the edge function's environment (phase 6:
 * void-cancelled-payments, auto-tip-charge, charge-recurring-visits). Deno only; the modules it
 * wires are Deno-free and unit tested on their own.
 *
 * Unset or invalid PAYPAL_* config answers { ok: false } with the reason: the caller moves NO
 * PayPal money and records a defect (a PayPal job is never handed to the Stripe path instead).
 * Live keys are refused by PayPalClient itself (PAYPAL_LIVE_ALLOWED = false).
 */
import { PayPalClient } from "./paypalClient.ts";
import { createCaptureFeeReader, createPayPalCheckoutProvider } from "./paypalCheckout.ts";
import { parseProviderEnv } from "./registry.ts";
import type { PaymentProvider, ProviderEnv } from "./types.ts";

export type PayPalRuntime =
  | { ok: true; env: ProviderEnv; client: PayPalClient; provider: PaymentProvider; readCaptureFeeCents: (captureId: string) => Promise<number | null> }
  | { ok: false; reason: string };

export function paypalRuntimeFromEnv(): PayPalRuntime {
  try {
    const env = parseProviderEnv(Deno.env.get("PAYPAL_ENV"));
    const client = new PayPalClient({
      env,
      clientId: Deno.env.get("PAYPAL_CLIENT_ID") ?? "",
      clientSecret: Deno.env.get("PAYPAL_CLIENT_SECRET") ?? "",
    });
    const readFee = createCaptureFeeReader(client);
    const readCaptureFeeCents = async (captureId: string): Promise<number | null> => {
      try {
        return await readFee(captureId);
      } catch (e) {
        // Unreadable is null: the cancel sweep moves nothing for that job and retries next run.
        console.warn(`[paypalRuntime] capture fee read failed for ${captureId}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    };
    return { ok: true, env, client, provider: createPayPalCheckoutProvider(client), readCaptureFeeCents };
  } catch (e) {
    // The message never carries the secret (PayPalClient builds none from it).
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
