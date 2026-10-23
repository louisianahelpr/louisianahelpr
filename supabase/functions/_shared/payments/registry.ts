/**
 * Picks the provider for a payment by the id STAMPED on its row, never by a
 * fresh decision: a job paid through PayPal Checkout is refunded through PayPal
 * Checkout even after another provider is added (design §5.1).
 *
 * Stripe is retired (the platform account was closed 2026-10-23): asking for
 * it is an error, so no new code path can start a Stripe money call through
 * this layer.
 */
import { PayPalClient, type PayPalClientConfig } from "./paypalClient.ts";
import { createPayPalCheckoutProvider } from "./paypalCheckout.ts";
import { createPayPalPayoutsProvider } from "./paypalPayouts.ts";
import type { PaymentProvider, PayoutProvider, ProviderEnv } from "./types.ts";


export interface ProviderConfig {
  paypal: PayPalClientConfig;
}

export function paymentProviderFor(id: string, cfg: ProviderConfig): PaymentProvider {
  if (id === "paypal_checkout") return createPayPalCheckoutProvider(new PayPalClient(cfg.paypal));
  if (id === "stripe") throw new Error("provider_retired: stripe");
  throw new Error(`unknown_payment_provider: ${id}`);
}

export function payoutProviderFor(id: string, cfg: ProviderConfig): PayoutProvider {
  if (id === "paypal_payouts") return createPayPalPayoutsProvider(new PayPalClient(cfg.paypal));
  // The launch path (owner 2026-10-23): an admin pays the Helpr by hand with PayPal Send Money from
  // the "Pay this Helpr" queue and marks it paid. There is no API to call, so nothing may try.
  if (id === "manual_paypal") throw new Error("manual_payout: paid by an admin from the pay queue, not through an API");
  if (id === "stripe") throw new Error("provider_retired: stripe");
  throw new Error(`unknown_payout_provider: ${id}`);
}

/**
 * PAYPAL_ENV must say exactly "sandbox" or "live". Anything else (unset,
 * "Sandbox ", "prod") is refused rather than guessed.
 */
export function parseProviderEnv(raw: string | undefined | null): ProviderEnv {
  if (raw === "sandbox" || raw === "live") return raw;
  throw new Error(`paypal_env_invalid: ${JSON.stringify(raw ?? null)}`);
}
