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
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, poster_completed_at, helper_completed_at, stripe_session_id, stripe_payment_intent_id")
      .in("status", ["in_progress", "revision_requested", "accepted"])
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

      // Transfer to helper's connected account
      const helperPayout = job.budget - (job.platform_fee_amount || 0);
      if (job.helper_id && helperPayout > 0) {
        const { data: helperProfile } = await supabaseAdmin
          .from("profiles")
          .select("stripe_account_id")
          .eq("user_id", job.helper_id)
          .single();

        if (helperProfile?.stripe_account_id) {
          try {
            const transferParams: any = {
              amount: Math.round(helperPayout * 100),
              currency: "usd",
              destination: helperProfile.stripe_account_id,
              metadata: { job_id: job.id, helper_id: job.helper_id, auto_release: "true" },
            };

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
            console.log(`Auto-transferred $${helperPayout.toFixed(2)} to helper ${job.helper_id}`);
          } catch (e) {
            console.error(`Auto-transfer failed for job ${job.id}:`, e);
          }
        } else {
          console.warn(`Helper ${job.helper_id} has no Stripe Connect. Manual payout needed.`);
          const { data: adminRoles } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
          if (adminRoles) {
            for (const admin of adminRoles) {
              await supabaseAdmin.from("notifications").insert({
                user_id: admin.user_id,
                title: "⚠️ Manual payout needed",
                message: `Auto-released job "${job.title}" but helper has no Stripe Connect. $${helperPayout.toFixed(2)} needs manual payout.`,
                type: "warning", link: "/admin",
              });
            }
          }
        }
      }

      await supabaseAdmin
        .from("jobs")
        .update({ status: "completed", payment_status: "released" })
        .eq("id", job.id);

      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Payment auto-released!",
          message: `"${job.title}" was auto-completed after 72 hours. You earned $${helperPayout.toFixed(2)}.`,
          type: "payment", link: "/activity",
        });
      }
      if (job.customer_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Job auto-completed",
          message: `"${job.title}" was automatically marked complete after 72 hours. Payment has been captured.`,
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