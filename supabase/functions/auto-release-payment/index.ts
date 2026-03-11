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
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

    const { data: jobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, poster_completed_at, helper_completed_at, stripe_session_id, stripe_payment_intent_id, status")
      .in("status", ["in_progress", "revision_requested", "accepted"])
      .not("status", "eq", "disputed")
      .eq("payment_status", "escrow")
      .or(`poster_completed_at.lte.${cutoff},helper_completed_at.lte.${cutoff}`);

    if (error) throw error;

    let released = 0;
    for (const job of (jobs || [])) {
      // Capture the held payment
      let paymentIntentId = job.stripe_payment_intent_id;

      if (!paymentIntentId && job.stripe_session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id);
          paymentIntentId = session.payment_intent;
          if (paymentIntentId) {
            await supabaseAdmin.from("jobs").update({
              stripe_payment_intent_id: paymentIntentId,
            }).eq("id", job.id);
          }
        } catch (e) {
          console.error(`Failed to retrieve session for job ${job.id}:`, e);
        }
      }

      if (paymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          if (pi.status === "requires_capture") {
            await stripe.paymentIntents.capture(paymentIntentId);
            console.log(`Auto-captured payment ${paymentIntentId} for job ${job.id}`);
          }
        } catch (e) {
          console.error(`Failed to capture payment for job ${job.id}:`, e);
        }
      }

      // Schedule payout for 24 hours later instead of immediate transfer
      const payoutTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await supabaseAdmin
        .from("jobs")
        .update({ status: "completed", payment_status: "payout_pending", payout_scheduled_at: payoutTime })
        .eq("id", job.id);

      const helperPayout = job.budget - (job.platform_fee_amount || 0);
      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Job auto-completed!",
          message: `"${job.title}" was auto-completed after 72 hours. $${helperPayout.toFixed(2)} will be transferred to your account in 24 hours.`,
          type: "payment", link: "/activity",
        });
      }
      if (job.customer_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Job auto-completed",
          message: `"${job.title}" was automatically marked complete after 72 hours. Payment has been captured and the helpr will be paid in 24 hours.`,
          type: "info", link: "/activity",
        });
      }
      released++;
    }

    return new Response(
      JSON.stringify({ success: true, released }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});