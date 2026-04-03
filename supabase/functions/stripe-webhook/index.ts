import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const PRODUCT_TO_TIER: Record<string, string> = {
  // Monthly recurring
  "prod_U8rS2fR6KvQoRk": "basic",
  "prod_U8rTRJZSUyzaha": "pro",
  "prod_U8rTUX4EhN5wG3": "elite",
  // Annual recurring
  "prod_U8rTux09RGNWWd": "basic",
  "prod_U8rTiOIcITvnIT": "pro",
  "prod_U8rT5zWKWe29By": "elite",
  // One-time month pass
  "prod_U8rTPMHf6IQnGE": "basic",
  "prod_U8rThLQr2jThoM": "pro",
  "prod_U8rT0f4UtNPrrs": "elite",
};

// One-time pass product IDs (to set 30-day expiry)
const ONE_TIME_PRODUCTS = new Set([
  "prod_U8rTPMHf6IQnGE",
  "prod_U8rThLQr2jThoM",
  "prod_U8rT0f4UtNPrrs",
]);

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
    logStep("ERROR: STRIPE_WEBHOOK_SECRET not configured — rejecting request");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  logStep("Event received", { type: event.type, id: event.id });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerEmail = session.customer_email || session.customer_details?.email;
        if (!customerEmail) { logStep("No email on checkout session"); break; }

        let tier: string | null = null;
        let isOneTimePass = false;
        let subscriptionEnd: string | null = null;

        if (session.mode === "subscription") {
          const subscriptionId = session.subscription as string;
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const productId = subscription.items.data[0]?.price.product as string;
          tier = PRODUCT_TO_TIER[productId] || null;
          subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
        } else if (session.mode === "payment") {
          // One-time payment — check session metadata first, then line items
          tier = (session.metadata as any)?.tier || null;
          let matchedProductId: string | null = null;

          if (!tier) {
            try {
              const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
              const productId = lineItems.data[0]?.price?.product as string;
              if (productId) {
                tier = PRODUCT_TO_TIER[productId] || null;
                matchedProductId = productId;
              }
            } catch (e) {
              logStep("Could not retrieve line items", { error: String(e) });
            }
          }

          // Check if this is a one-time pass product
          if (!matchedProductId && tier) {
            // Try to find the product from line items
            try {
              const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
              matchedProductId = lineItems.data[0]?.price?.product as string || null;
            } catch (_) {}
          }

          if (matchedProductId && ONE_TIME_PRODUCTS.has(matchedProductId)) {
            isOneTimePass = true;
          }

          // Also check billing_cycle metadata from create-pro-checkout
          if ((session.metadata as any)?.billing_cycle === "one_time") {
            isOneTimePass = true;
          }

          if (isOneTimePass) {
            // Set 30-day expiry for one-time passes
            subscriptionEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          }
        }

        logStep("Checkout completed", { email: customerEmail, tier, mode: session.mode, isOneTimePass });

        if (tier) {
          const updateData: any = { subscription_tier: tier };
          if (subscriptionEnd) {
            updateData.subscription_expires_at = subscriptionEnd;
          }

          const { error } = await supabase
            .from("profiles")
            .update(updateData)
            .eq("email", customerEmail);

          if (error) logStep("ERROR updating profile", { error: error.message });
          else logStep("Profile updated with tier", { email: customerEmail, tier, expires: subscriptionEnd });
        }

        // Handle tip checkout completion
        const sessionType = (session.metadata as any)?.type;
        if (sessionType === "tip") {
          const tipJobId = (session.metadata as any)?.job_id;
          const tipperId = (session.metadata as any)?.tipper_id;
          const tipHelperId = (session.metadata as any)?.helper_id;
          if (tipJobId && tipperId) {
            const { error: tipError } = await supabase
              .from("tips")
              .update({ payment_status: "paid" })
              .eq("job_id", tipJobId)
              .eq("tipper_id", tipperId)
              .eq("payment_status", "pending");
            if (tipError) logStep("ERROR updating tip status", { error: tipError.message });
            else logStep("Tip marked as paid", { jobId: tipJobId, tipper: tipperId });

            // Notify the helper about the tip
            if (tipHelperId) {
              await supabase.from("notifications").insert({
                user_id: tipHelperId,
                title: "💰 You received a tip!",
                message: `Someone tipped you for a completed job. Thanks for the great work!`,
                type: "payment",
                link: "/earnings",
              });
            }
          }
        }

        // Store payment intent ID on the job
        const jobId = (session.metadata as any)?.job_id;
        const piId = typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent as any)?.id;

        if (jobId && piId) {
          const isRepay = (session.metadata as any)?.repay === "true";
          const updateData: any = {
            stripe_payment_intent_id: piId,
            payment_status: "escrow", // Mark as escrow only after confirmed checkout
          };

          if (isRepay) {
            updateData.payment_status = "payout_pending";
            updateData.payout_scheduled_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            logStep("Re-payment completed, scheduling payout", { jobId, pi: piId });
          }

          const { error: jobError } = await supabase.from("jobs").update(updateData).eq("id", jobId);
          if (jobError) logStep("ERROR storing PI on job", { error: jobError.message });
          else logStep("Stored payment_intent and escrow status on job", { jobId, pi: piId, repay: isRepay });
        } else if (jobId) {
          logStep("WARNING: checkout completed for job but no payment_intent on session", { jobId });
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
          .update({ subscription_tier: null, subscription_expires_at: null })
          .eq("email", email);

        if (error) logStep("ERROR clearing tier", { error: error.message });
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const failedEmail = pi.receipt_email || (pi as any).last_payment_error?.charge?.billing_details?.email;
        logStep("Payment intent failed", { id: pi.id, email: failedEmail });

        // Find the job linked to this PI and notify the poster
        const { data: failedJob } = await supabase
          .from("jobs")
          .select("id, customer_id, title")
          .eq("stripe_payment_intent_id", pi.id)
          .maybeSingle();

        if (failedJob) {
          await supabase.from("notifications").insert({
            user_id: failedJob.customer_id,
            title: "⚠️ Payment failed",
            message: `Your payment for "${failedJob.title}" could not be processed. Please update your payment method and try again.`,
            type: "warning",
            link: "/activity?tab=posted",
          });
          await supabase.from("jobs").update({ payment_status: "failed" }).eq("id", failedJob.id);
          logStep("Notified poster of payment failure", { jobId: failedJob.id });
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const refundPiId = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : (charge.payment_intent as any)?.id;
        logStep("Charge refunded", { chargeId: charge.id, pi: refundPiId });

        if (refundPiId) {
          const { data: refundedJob } = await supabase
            .from("jobs")
            .select("id, customer_id, title")
            .eq("stripe_payment_intent_id", refundPiId)
            .maybeSingle();

          if (refundedJob) {
            await supabase.from("jobs").update({ payment_status: "refunded" }).eq("id", refundedJob.id);
            await supabase.from("notifications").insert({
              user_id: refundedJob.customer_id,
              title: "💸 Refund processed",
              message: `Your payment for "${refundedJob.title}" has been refunded.`,
              type: "payment",
              link: "/activity?tab=posted",
            });
            logStep("Job marked as refunded", { jobId: refundedJob.id });
          }
        }
        break;
      }

      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        logStep("Connect account updated", { accountId: account.id, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled });

        // Find the helper with this Stripe account
        const { data: helperProfile } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .eq("stripe_account_id", account.id)
          .maybeSingle();

        if (helperProfile) {
          if (account.charges_enabled && account.payouts_enabled) {
            await supabase.from("notifications").insert({
              user_id: helperProfile.user_id,
              title: "✅ Payout account verified",
              message: "Your payout account is fully set up! You can now receive payments for completed jobs.",
              type: "success",
              link: "/profile",
            });
            logStep("Helper payout account verified", { userId: helperProfile.user_id });
          } else if (account.requirements?.currently_due && account.requirements.currently_due.length > 0) {
            await supabase.from("notifications").insert({
              user_id: helperProfile.user_id,
              title: "⚠️ Payout account needs attention",
              message: "Your payout account requires additional information. Please update your details to continue receiving payments.",
              type: "warning",
              link: "/profile",
            });
            logStep("Helper account needs attention", { userId: helperProfile.user_id, due: account.requirements.currently_due });
          }
        }
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
