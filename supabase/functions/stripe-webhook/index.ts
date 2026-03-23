import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const PRODUCT_TO_TIER: Record<string, string> = {
  // Monthly recurring
  "prod_U8D5po9hjUJCGc": "basic",
  "prod_U8BlHeIMjMcSgA": "pro",
  "prod_U8D6oVie3pcjAC": "elite",
  // Annual recurring
  "prod_U8DiEHun3sWONY": "basic",
  "prod_U8DiMCIrfVpxn1": "pro",
  "prod_U8DjLmcSKObhf8": "elite",
  // One-time month pass
  "prod_U8DjfNrMFrnq3c": "basic",
  "prod_U8DkzXC6dpB6VT": "pro",
  "prod_U8Dk2wt6Jd6fnb": "elite",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!stripeKey) {
    logStep("ERROR: STRIPE_SECRET_KEY not set");
    return new Response("Server error", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const body = await req.text();
  let event: Stripe.Event;

  // Verify webhook signature if secret is configured
  if (webhookSecret) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      logStep("ERROR: No stripe-signature header");
      return new Response("No signature", { status: 400 });
    }
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
    } catch (err) {
      logStep("ERROR: Signature verification failed", { error: String(err) });
      return new Response("Invalid signature", { status: 400 });
    }
  } else {
    // No webhook secret configured - parse body directly (dev mode)
    event = JSON.parse(body) as Stripe.Event;
    logStep("WARNING: No STRIPE_WEBHOOK_SECRET set, skipping signature verification");
  }

  logStep("Event received", { type: event.type, id: event.id });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerEmail = session.customer_email || session.customer_details?.email;
        if (!customerEmail) { logStep("No email on checkout session"); break; }

        let tier: string | null = null;

        if (session.mode === "subscription") {
          // Get subscription details to determine tier
          const subscriptionId = session.subscription as string;
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const productId = subscription.items.data[0]?.price.product as string;
          tier = PRODUCT_TO_TIER[productId] || null;
        } else if (session.mode === "payment") {
          // One-time payment — get tier from session metadata
          tier = (session.metadata as any)?.tier || null;
        }

        logStep("Checkout completed", { email: customerEmail, tier, mode: session.mode });

        if (tier) {
          const { error } = await supabase
            .from("profiles")
            .update({ subscription_tier: tier })
            .eq("email", customerEmail);

          if (error) logStep("ERROR updating profile", { error: error.message });
          else logStep("Profile updated with tier", { email: customerEmail, tier });
        }

        // Store payment intent for escrow jobs
        const jobId = (session.metadata as any)?.job_id;
        if (jobId && session.payment_intent) {
          const { error: jobError } = await supabase.from("jobs").update({
            stripe_payment_intent_id: session.payment_intent as string,
          }).eq("id", jobId);
          if (jobError) logStep("ERROR storing PI on job", { error: jobError.message });
          else logStep("Stored payment_intent on job", { jobId, pi: session.payment_intent });
        }

        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        const email = customer.email;
        if (!email) { logStep("No email on customer"); break; }

        if (subscription.status === "active") {
          const productId = subscription.items.data[0]?.price.product as string;
          const tier = PRODUCT_TO_TIER[productId] || null;
          logStep("Subscription updated to active", { email, tier });

          const { error } = await supabase
            .from("profiles")
            .update({ subscription_tier: tier })
            .eq("email", email);

          if (error) logStep("ERROR updating profile", { error: error.message });
        } else if (["canceled", "unpaid", "past_due"].includes(subscription.status)) {
          logStep("Subscription inactive", { email, status: subscription.status });

          const { error } = await supabase
            .from("profiles")
            .update({ subscription_tier: null })
            .eq("email", email);

          if (error) logStep("ERROR clearing tier", { error: error.message });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        const email = customer.email;
        if (!email) { logStep("No email on customer"); break; }

        logStep("Subscription deleted", { email });

        const { error } = await supabase
          .from("profiles")
          .update({ subscription_tier: null })
          .eq("email", email);

        if (error) logStep("ERROR clearing tier", { error: error.message });
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }
  } catch (err) {
    logStep("ERROR processing event", { error: String(err) });
    return new Response("Processing error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});
