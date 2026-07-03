import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

export function handleTaxSettingsUpdated(
  _event: Stripe.Event,
  { logStep }: WebhookContext,
): void {
  logStep("Stripe Tax settings updated — sync parish rates if needed");
  // This is informational; tax rates are managed via Stripe Tax automatically
  // Log it for audit purposes so admin can review if rates changed
}
