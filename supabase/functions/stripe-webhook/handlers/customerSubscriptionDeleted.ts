import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

export async function handleCustomerSubscriptionDeleted(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
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
