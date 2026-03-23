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
    // Find cancelled jobs still showing escrow payment status
    const { data: jobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, title, stripe_session_id, stripe_payment_intent_id, budget, cancellation_fee")
      .eq("status", "cancelled")
      .eq("payment_status", "escrow");

    if (error) throw error;

    let voided = 0;
    let refunded = 0;
    const results: any[] = [];

    for (const job of (jobs || [])) {
      let paymentIntentId = job.stripe_payment_intent_id;

      // Resolve payment intent from session if not stored
      if (!paymentIntentId && job.stripe_session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, {
            expand: ["payment_intent"],
          });
          const pi = session.payment_intent;
          paymentIntentId = typeof pi === "string" ? pi : pi?.id;
          if (paymentIntentId) {
            await supabaseAdmin.from("jobs").update({ stripe_payment_intent_id: paymentIntentId }).eq("id", job.id);
          }
        } catch (e) {
          results.push({ job_id: job.id, title: job.title, status: "session_not_found", error: e.message });
          continue;
        }
      }

      if (!paymentIntentId) {
        // No payment was ever made — just update status
        await supabaseAdmin.from("jobs").update({ payment_status: "voided" }).eq("id", job.id);
        results.push({ job_id: job.id, title: job.title, status: "no_payment_found", updated: true });
        continue;
      }

      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (pi.status === "requires_capture") {
          // Cancel the uncaptured hold — releases the funds back to the customer
          await stripe.paymentIntents.cancel(paymentIntentId);
          await supabaseAdmin.from("jobs").update({ payment_status: "voided" }).eq("id", job.id);
          voided++;
          results.push({ job_id: job.id, title: job.title, status: "voided", amount: pi.amount / 100 });
        } else if (pi.status === "succeeded") {
          // Already captured — issue a refund (minus cancellation fee if applicable)
          const cancellationFee = job.cancellation_fee || 0;
          const refundAmount = Math.round((job.budget - cancellationFee) * 100);
          if (refundAmount > 0) {
            await stripe.refunds.create({
              payment_intent: paymentIntentId,
              amount: refundAmount,
            });
          }
          await supabaseAdmin.from("jobs").update({ payment_status: "refunded" }).eq("id", job.id);
          refunded++;
          results.push({ job_id: job.id, title: job.title, status: "refunded", amount: refundAmount / 100 });
        } else {
          results.push({ job_id: job.id, title: job.title, status: `pi_status_${pi.status}`, skipped: true });
        }
      } catch (e) {
        results.push({ job_id: job.id, title: job.title, status: "error", error: e.message });
      }
    }

    return new Response(JSON.stringify({ success: true, voided, refunded, total: jobs?.length || 0, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
