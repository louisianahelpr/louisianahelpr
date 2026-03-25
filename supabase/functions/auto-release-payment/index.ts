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
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, urgent_fee, poster_completed_at, helper_completed_at, stripe_session_id, stripe_payment_intent_id, status")
      .in("status", ["in_progress", "revision_requested", "accepted"])
      .not("status", "eq", "disputed")
      .eq("payment_status", "escrow")
      .or(`poster_completed_at.lte.${cutoff},helper_completed_at.lte.${cutoff}`);

    if (error) throw error;

    let released = 0;
    const results: any[] = [];

    for (const job of (jobs || [])) {
      // ── Step 1: Resolve payment intent ID ──
      let paymentIntentId = job.stripe_payment_intent_id;

      if (!paymentIntentId && job.stripe_session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
          paymentIntentId = typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
          if (paymentIntentId) {
            await supabaseAdmin.from("jobs").update({
              stripe_payment_intent_id: paymentIntentId,
            }).eq("id", job.id);
          }
        } catch (e) {
          console.error(`Failed to retrieve session for job ${job.id}:`, e);
        }
      }

      if (!paymentIntentId) {
        console.error(`No payment intent for job ${job.id} — cannot auto-release`);
        results.push({ job_id: job.id, status: "skipped_no_pi" });
        continue;
      }

      // ── Step 2: Verify charge is captured (immediate capture — should be succeeded) ──
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (pi.status !== "succeeded") {
          console.error(`Payment ${paymentIntentId} for job ${job.id} has status "${pi.status}" — cannot auto-release`);
          results.push({ job_id: job.id, status: `pi_status_${pi.status}`, skipped: true });
          continue;
        }
      } catch (e: any) {
        console.error(`Failed to verify payment for job ${job.id}:`, e);
        results.push({ job_id: job.id, status: "verify_failed", error: e.message });
        continue;
      }

      // ── Step 3: Schedule the payout ──
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
          type: "payment", link: "/activity?tab=applied&filter=completed",
        });
      }
      if (job.customer_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Job auto-completed",
          message: `"${job.title}" was automatically marked complete after 72 hours. The helpr will be paid in 24 hours.`,
          type: "info", link: "/activity?tab=posted&filter=completed",
        });
      }
      released++;
      results.push({ job_id: job.id, status: "released", paymentIntentId });
    }

    return new Response(
      JSON.stringify({ success: true, released, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
