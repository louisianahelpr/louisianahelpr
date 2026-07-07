import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { PRODUCT_TO_TIER } from "../constants.ts";

export async function handleCustomerSubscriptionUpdated(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;

  // Business seat subscriptions share the same Stripe customer as personal
  // subscriptions (both look up customer by email). Guard before any DB write:
  // if this product isn't a personal tier, skip — updating subscription_tier
  // for a business event would wipe or null-out the user's personal Pro/Elite
  // tier on every renewal or status change of their business seats.
  const productId = subscription.items.data[0]?.price.product as string | undefined;
  if (!productId || !PRODUCT_TO_TIER[productId]) {
    logStep("Non-personal subscription updated — skipping profile tier update", { productId, status: subscription.status });
    return;
  }

  const customerId = subscription.customer as string;
  const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
  const email = customer.email;
  if (!email) { logStep("No email on customer"); return; }

  if (subscription.status === "active") {
    const tier = PRODUCT_TO_TIER[productId];
    const expiresAt = new Date(subscription.current_period_end * 1000).toISOString();
    logStep("Subscription updated to active", { email, tier });

    const { error } = await supabase
      .from("profiles")
      .update({ subscription_tier: tier, subscription_expires_at: expiresAt })
      .eq("email", email);

    if (error) logStep("ERROR updating profile", { error: error.message });
  } else if (["canceled", "unpaid", "past_due", "paused"].includes(subscription.status)) {
    logStep("Subscription inactive", { email, status: subscription.status });

    const { error } = await supabase
      .from("profiles")
      .update({ subscription_tier: null, subscription_expires_at: null })
      .eq("email", email);

    if (error) logStep("ERROR clearing tier", { error: error.message });
  }
}
