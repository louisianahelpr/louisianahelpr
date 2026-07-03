import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { PRODUCT_TO_TIER } from "../constants.ts";

export async function handleCustomerSubscriptionUpdated(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = subscription.customer as string;
  const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
  const email = customer.email;
  if (!email) { logStep("No email on customer"); return; }

  if (subscription.status === "active") {
    const productId = subscription.items.data[0]?.price.product as string;
    const tier = PRODUCT_TO_TIER[productId] || null;
    const expiresAt = new Date(subscription.current_period_end * 1000).toISOString();
    logStep("Subscription updated to active", { email, tier });

    const { error } = await supabase
      .from("profiles")
      .update({ subscription_tier: tier, subscription_expires_at: expiresAt })
      .eq("email", email);

    if (error) logStep("ERROR updating profile", { error: error.message });
  } else if (["canceled", "unpaid", "past_due"].includes(subscription.status)) {
    logStep("Subscription inactive", { email, status: subscription.status });

    const { error } = await supabase
      .from("profiles")
      .update({ subscription_tier: null, subscription_expires_at: null })
      .eq("email", email);

    if (error) logStep("ERROR clearing tier", { error: error.message });
  }
}
