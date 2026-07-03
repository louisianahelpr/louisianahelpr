import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { PRODUCT_TO_TIER } from "../constants.ts";

export async function handleCustomerSubscriptionDeleted(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;

  // Business seat subscriptions share the same Stripe customer object as
  // personal subscriptions (create-business-seat-checkout reuses the customer
  // by email). Guard before any DB write: if this product isn't a personal
  // tier product, clearing subscription_tier would wipe the user's separate
  // personal Pro/Elite access when their business seats are cancelled.
  const productId = subscription.items.data[0]?.price.product as string | undefined;
  if (!productId || !PRODUCT_TO_TIER[productId]) {
    logStep("Non-personal subscription deleted — skipping profile tier clear", { productId });
    return;
  }

  const customerId = subscription.customer as string;
  const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
  const email = customer.email;
  if (!email) { logStep("No email on customer"); return; }

  logStep("Subscription deleted", { email });

  const { error } = await supabase
    .from("profiles")
    .update({ subscription_tier: null, subscription_expires_at: null })
    .eq("email", email);

  if (error) logStep("ERROR clearing tier", { error: error.message });
}
