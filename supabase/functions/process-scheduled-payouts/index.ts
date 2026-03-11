import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2025-08-27.basil",
  });

  try {
    const now = new Date().toISOString();

    // Find jobs where payout is scheduled and due
    const { data: jobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, stripe_session_id, stripe_payment_intent_id, status")
      .eq("status", "completed")
      .eq("payment_status", "payout_pending")
      .lte("payout_scheduled_at", now);

    if (error) throw error;

    let processed = 0;
    for (const job of (jobs || [])) {
      if (!job.helper_id) continue;

      const helperPayout = job.budget - (job.platform_fee_amount || 0);
      if (helperPayout <= 0) continue;

      // Get helper's connected Stripe account
      const { data: helperProfile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", job.helper_id)
        .single();

      if (!helperProfile?.stripe_account_id) {
        console.error(`Helper ${job.helper_id} has no Stripe Connect for job ${job.id}`);
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "⚠️ Payout account required",
          message: `Your payout of $${helperPayout.toFixed(2)} for "${job.title}" is waiting. Set up your payout account in your profile.`,
          type: "warning", link: "/profile?tab=payment",
        });
        continue;
      }

      // Transfer to helper
      try {
        const transferParams: any = {
          amount: Math.round(helperPayout * 100),
          currency: "usd",
          destination: helperProfile.stripe_account_id,
          metadata: { job_id: job.id, helper_id: job.helper_id, scheduled_payout: "true" },
        };

        // Link to source charge
        let paymentIntentId = job.stripe_payment_intent_id;
        if (!paymentIntentId && job.stripe_session_id) {
          try {
            const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id);
            paymentIntentId = session.payment_intent;
          } catch (e) {
            console.warn("Could not retrieve session:", e);
          }
        }
        if (paymentIntentId) {
          try {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
            if (pi.latest_charge) {
              transferParams.source_transaction = pi.latest_charge;
            }
          } catch (e) {
            console.warn("Could not link charge:", e);
          }
        }

        await stripe.transfers.create(transferParams);
        console.log(`Scheduled payout: $${helperPayout.toFixed(2)} to helper ${job.helper_id} for job ${job.id}`);

        await supabaseAdmin.from("jobs").update({
          payment_status: "released",
        }).eq("id", job.id);

        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "💰 Payout sent!",
          message: `$${helperPayout.toFixed(2)} for "${job.title}" has been transferred to your account.`,
          type: "payment", link: "/earnings",
        });

        processed++;
      } catch (e) {
        console.error(`Payout failed for job ${job.id}:`, e);
        // Notify admin
        const { data: adminRoles } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
        if (adminRoles) {
          for (const admin of adminRoles) {
            await supabaseAdmin.from("notifications").insert({
              user_id: admin.user_id,
              title: "⚠️ Scheduled payout failed",
              message: `Failed to pay $${helperPayout.toFixed(2)} to helpr for job ${job.id}. Error: ${e.message}`,
              type: "warning", link: "/admin",
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
