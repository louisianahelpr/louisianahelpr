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

  // Log key mode (live vs test) so you can verify the correct key is loaded
  if (stripeKey) {
    const keyMode = stripeKey.startsWith("sk_live_") || stripeKey.startsWith("rk_live_")
      ? "LIVE"
      : stripeKey.startsWith("sk_test_") || stripeKey.startsWith("rk_test_")
      ? "TEST"
      : "UNKNOWN";
    console.log(`[STRIPE-WEBHOOK] 🔑 Stripe key mode: ${keyMode} (prefix: ${stripeKey.slice(0, 8)}...)`);
  }
  if (webhookSecret) {
    console.log(`[STRIPE-WEBHOOK] 🔐 Webhook secret loaded (prefix: ${webhookSecret.slice(0, 8)}..., length: ${webhookSecret.length})`);
  }

  if (!stripeKey) {
    console.error("🚨 [STRIPE-WEBHOOK] ALERT: STRIPE_SECRET_KEY not set — acknowledging to stop retries");
    return new Response(JSON.stringify({ received: true, error: "stripe_key_not_configured" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const body = await req.text();
  let event: Stripe.Event;

  if (!webhookSecret) {
    console.error("🚨 [STRIPE-WEBHOOK] ALERT: STRIPE_WEBHOOK_SECRET is not configured — acknowledging 200 to stop retries");
    return new Response(JSON.stringify({ received: true, error: "webhook_secret_not_configured" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    console.error("🚨 [STRIPE-WEBHOOK] ALERT: No stripe-signature header on request — acknowledging 200 to stop retries");
    return new Response(JSON.stringify({ received: true, error: "missing_signature_header" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    // Loud, easy-to-find log line so you can spot signature mismatches in Supabase logs
    console.error("🚨 [STRIPE-WEBHOOK] SIGNATURE VERIFICATION FAILED 🚨");
    console.error(`[STRIPE-WEBHOOK] Error: ${String(err)}`);
    console.error(`[STRIPE-WEBHOOK] Signature header (first 40 chars): ${sig.slice(0, 40)}...`);
    console.error(`[STRIPE-WEBHOOK] Webhook secret prefix: ${webhookSecret.slice(0, 8)}... (length: ${webhookSecret.length})`);
    console.error(`[STRIPE-WEBHOOK] Body length: ${body.length} bytes`);
    console.error("[STRIPE-WEBHOOK] → Returning 200 OK to stop Stripe retries. Fix the STRIPE_WEBHOOK_SECRET to match the endpoint that sent this event.");
    return new Response(JSON.stringify({ received: true, error: "signature_verification_failed" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  logStep("Event received", { type: event.type, id: event.id });

  // ---- Idempotency guard ----
  // Stripe retries webhooks on any non-2xx or timeout. Without this guard a
  // single checkout could grant a subscription twice or send duplicate emails.
  try {
    const { error: idemErr } = await supabase
      .from("stripe_webhook_events")
      .insert({ event_id: event.id, event_type: event.type });
    if (idemErr) {
      // 23505 = unique_violation → we've seen this event before. Ack and exit.
      if ((idemErr as any).code === "23505") {
        logStep("Duplicate event — already processed, skipping", { id: event.id });
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      // Any other DB error: log but continue. Better to risk a duplicate than drop the event.
      console.error("[STRIPE-WEBHOOK] Idempotency insert failed (non-fatal):", idemErr);
    }
  } catch (e) {
    console.error("[STRIPE-WEBHOOK] Idempotency check threw (non-fatal):", e);
  }

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

          // Mark poster's onboarding fee paid if it was charged on this session
          if ((session.metadata as any)?.onboarding_fee_charged === "true") {
            const posterId = (session.metadata as any)?.customer_id;
            if (posterId) {
              const { error: feeErr } = await supabase
                .from("profiles")
                .update({ onboarding_fee_paid: true, onboarding_fee_charged_at: new Date().toISOString() })
                .eq("user_id", posterId);
              if (feeErr) logStep("ERROR marking onboarding fee paid", { error: feeErr.message });
              else logStep("Onboarding fee marked paid for poster", { posterId });
            }
          }
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
            link: "/my-posts",
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
              link: "/my-posts",
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
          .select("user_id, full_name, approval_status, email_verified")
          .eq("stripe_account_id", account.id)
          .maybeSingle();

        if (helperProfile) {
          if (account.charges_enabled && account.payouts_enabled) {
            // Auto-approve: Stripe verified identity (free database matching: SSN/IRS/credit bureau)
            // Requirement: email verified + Stripe charges + payouts enabled
            const shouldAutoApprove =
              helperProfile.email_verified === true &&
              helperProfile.approval_status === "pending";

            if (shouldAutoApprove) {
              const { error: approvalErr } = await supabase
                .from("profiles")
                .update({ approval_status: "approved" })
                .eq("user_id", helperProfile.user_id);

              if (approvalErr) {
                logStep("ERROR auto-approving helper", { error: approvalErr.message });
              } else {
                logStep("✅ Auto-approved helper via Stripe verification", { userId: helperProfile.user_id });
                await supabase.from("notifications").insert({
                  user_id: helperProfile.user_id,
                  title: "🎉 Welcome to Helpr!",
                  message: "Your identity is verified and your payout account is ready. You're approved to start accepting jobs!",
                  type: "success",
                  link: "/dashboard",
                });
              }
            } else {
              await supabase.from("notifications").insert({
                user_id: helperProfile.user_id,
                title: "✅ Payout account verified",
                message: "Your payout account is fully set up! You can now receive payments for completed jobs.",
                type: "success",
                link: "/profile",
              });
              logStep("Helper payout account verified (no auto-approve needed)", { userId: helperProfile.user_id, email_verified: helperProfile.email_verified, approval_status: helperProfile.approval_status });
            }
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

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        logStep("Payment intent succeeded", { id: pi.id, amount: pi.amount });

        // Record the confirmed sales tax amount on the job
        const { data: taxJob } = await supabase
          .from("jobs")
          .select("id, customer_id, title, sales_tax_amount")
          .eq("stripe_payment_intent_id", pi.id)
          .maybeSingle();

        if (taxJob) {
          // Extract actual tax from Stripe if available via latest_charge
          let confirmedTax = taxJob.sales_tax_amount || 0;
          try {
            const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge as any)?.id;
            if (chargeId) {
              const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
              // If Stripe Tax was used, the tax is embedded in the charge metadata or line items
              const stripeTax = (charge.metadata as any)?.sales_tax_amount;
              if (stripeTax) {
                confirmedTax = parseFloat(stripeTax);
              }
            }
          } catch (e) {
            logStep("Could not retrieve charge tax details", { error: String(e) });
          }

          await supabase.from("jobs").update({
            sales_tax_amount: confirmedTax,
          }).eq("id", taxJob.id);

          logStep("Sales tax recorded on job", { jobId: taxJob.id, tax: confirmedTax });
        }
        break;
      }

      case "transfer.created": {
        const transfer = event.data.object as Stripe.Transfer;
        const destAccount = transfer.destination as string;
        logStep("Transfer created", { id: transfer.id, amount: transfer.amount, destination: destAccount });

        // Find the helper with this Stripe Connect account
        const { data: paidHelper } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .eq("stripe_account_id", destAccount)
          .maybeSingle();

        if (paidHelper) {
          const amountDollars = (transfer.amount / 100).toFixed(2);
          await supabase.from("notifications").insert({
            user_id: paidHelper.user_id,
            title: "💵 Payment sent!",
            message: `$${amountDollars} has been transferred to your payout account. It should arrive in 1-2 business days.`,
            type: "payment",
            link: "/earnings",
          });

          // Also update the job's payment_status to 'released' if we can find it
          const transferJobId = (transfer.metadata as any)?.job_id;
          if (transferJobId) {
            await supabase.from("jobs").update({ payment_status: "released" }).eq("id", transferJobId);
            logStep("Job payment status set to released", { jobId: transferJobId });
          }

          logStep("Helper notified of transfer", { userId: paidHelper.user_id, amount: amountDollars });
        }
        break;
      }

      case "tax.settings.updated": {
        logStep("Stripe Tax settings updated — sync parish rates if needed");
        // This is informational; tax rates are managed via Stripe Tax automatically
        // Log it for audit purposes so admin can review if rates changed
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }
  } catch (err) {
    logStep("ERROR processing event", { error: String(err) });
    // Still return 200 so Stripe doesn't keep retrying — the error is logged for debugging
    return new Response(JSON.stringify({ received: true, error: "processing_error" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});
