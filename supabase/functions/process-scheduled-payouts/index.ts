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

    const { data: jobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, urgent_fee, stripe_session_id, stripe_payment_intent_id, status, is_group_job, helpers_needed")
      .eq("status", "completed")
      .eq("payment_status", "payout_pending")
      .lte("payout_scheduled_at", now);

    if (error) throw error;

    let processed = 0;
    const results: any[] = [];

    for (const job of (jobs || [])) {
      if (!job.helper_id) continue;

      const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
      const perHelperBudget = job.budget / helpersCount;
      const feeAmt = job.platform_fee_amount ? job.platform_fee_amount / helpersCount : 0;
      const feeTax = feeAmt * 0.10; // 10% tax on platform fee
      const helperPayout = perHelperBudget - feeAmt - feeTax + (job.urgent_fee ?? 0);
      if (helperPayout <= 0) continue;

      // ── Step 1: Get helper's connected Stripe account ──
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
        results.push({ job_id: job.id, status: "no_connect_account" });
        continue;
      }

      // ── Step 2: Resolve payment intent ID ──
      let paymentIntentId = job.stripe_payment_intent_id;
      if (!paymentIntentId && job.stripe_session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
          paymentIntentId = typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
          if (paymentIntentId) {
            await supabaseAdmin.from("jobs").update({ stripe_payment_intent_id: paymentIntentId }).eq("id", job.id);
          }
        } catch (e) {
          console.warn("Could not retrieve session:", e);
        }
      }

      if (!paymentIntentId) {
        console.error(`No payment intent for job ${job.id}, cannot process payout`);
        results.push({ job_id: job.id, status: "no_pi" });
        continue;
      }

      // ── Step 3: Verify charge is captured (immediate capture — should be succeeded) ──
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (pi.status !== "succeeded") {
          console.error(`Payment ${paymentIntentId} for job ${job.id} has status "${pi.status}" — CANNOT transfer funds.`);
          results.push({ job_id: job.id, status: `pi_not_succeeded_${pi.status}`, skipped: true });
          const { data: adminRoles } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
          if (adminRoles) {
            for (const admin of adminRoles) {
              await supabaseAdmin.from("notifications").insert({
                user_id: admin.user_id,
                title: "⚠️ Payout blocked — charge not captured",
                message: `Job ${job.id} ("${job.title}") payout cannot proceed. PI status: ${pi.status}.`,
                type: "warning", link: "/admin",
              });
            }
          }
          continue;
        }
      } catch (e: any) {
        console.error(`Failed to verify payment for job ${job.id}:`, e);
        results.push({ job_id: job.id, status: "verify_error", error: e.message });
        continue;
      }

      // ── Step 4: Transfer to helper (charge is confirmed captured) ──
      // Re-use the PI object from Step 3 verification above (already retrieved)
      try {
        const transferParams: any = {
          amount: Math.round(helperPayout * 100),
          currency: "usd",
          destination: helperProfile.stripe_account_id,
          metadata: { job_id: job.id, helper_id: job.helper_id, scheduled_payout: "true" },
        };

        // Link to source charge for clean reporting — use PI from Step 3
        try {
          const piForCharge = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
          if (piForCharge.latest_charge) {
            transferParams.source_transaction = typeof piForCharge.latest_charge === "string"
              ? piForCharge.latest_charge
              : piForCharge.latest_charge.id;
          }
        } catch (e) {
          console.warn("Could not link charge:", e);
        }

        await stripe.transfers.create(transferParams);
        console.log(`Payout: $${helperPayout.toFixed(2)} to helper ${job.helper_id} for job ${job.id}`);

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
        results.push({ job_id: job.id, status: "transferred", amount: helperPayout });
      } catch (e) {
        console.error(`Payout failed for job ${job.id}:`, e);
        results.push({ job_id: job.id, status: "transfer_failed", error: e.message });
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
      JSON.stringify({ success: true, processed, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
