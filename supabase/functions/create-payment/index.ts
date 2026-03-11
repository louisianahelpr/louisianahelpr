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

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("Not authenticated");

    const body = await req.json();
    const { action } = body;

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Get or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }

    // ─── ESCROW: Create checkout with manual capture ───
    if (action === "escrow") {
      const { jobId } = body;
      if (!jobId) throw new Error("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");
      if (job.customer_id !== user.id) throw new Error("Not authorized");

      const { data: settings } = await supabaseAdmin
        .from("platform_settings").select("platform_fee_percent").limit(1).single();
      const feePercent = settings?.platform_fee_percent ?? 15;

      // Use manual capture so funds are authorized but NOT charged yet
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : user.email,
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: `Helpr Task: ${job.title}`,
              description: `Escrow payment — funds are held until the job is complete. Platform fee: ${feePercent}%`,
            },
            unit_amount: Math.round(job.budget * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        payment_intent_data: {
          capture_method: "manual",
          metadata: {
            job_id: jobId,
            customer_id: user.id,
            platform_fee_percent: String(feePercent),
          },
        },
        success_url: `${req.headers.get("origin")}/payment-success?job_id=${jobId}`,
        cancel_url: `${req.headers.get("origin")}/post-job`,
        metadata: { job_id: jobId, customer_id: user.id },
      });

      const feeAmount = (job.budget * feePercent) / 100;
      await supabaseAdmin.from("jobs").update({
        stripe_session_id: session.id,
        payment_status: "escrow",
        platform_fee_percent: feePercent,
        platform_fee_amount: feeAmount,
      }).eq("id", jobId);

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── RELEASE: Both parties confirm → capture the held payment ───
    if (action === "release") {
      const { jobId } = body;
      if (!jobId) throw new Error("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");

      const isPoster = job.customer_id === user.id;
      const isHelper = job.helper_id === user.id;
      if (!isPoster && !isHelper) throw new Error("Not authorized");
      if (!["in_progress", "revision_requested", "accepted"].includes(job.status)) {
        throw new Error("Job is not in progress");
      }

      // Mark this party as completed
      const updateFields: Record<string, any> = {};
      if (isPoster) updateFields.poster_completed_at = new Date().toISOString();
      if (isHelper) updateFields.helper_completed_at = new Date().toISOString();

      const posterDone = isPoster ? true : !!job.poster_completed_at;
      const helperDone = isHelper ? true : !!job.helper_completed_at;
      const bothDone = posterDone && helperDone;

      if (bothDone) {
        // Capture the held payment on Stripe
        await captureEscrowPayment(stripe, supabaseAdmin, job);
        updateFields.status = "completed";
        updateFields.payment_status = "released";
      }

      await supabaseAdmin.from("jobs").update(updateFields).eq("id", jobId);

      const helperPayout = job.budget - (job.platform_fee_amount || 0);

      // Notify the other party
      if (isPoster && job.helper_id && !helperDone) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Poster marked job complete",
          message: `The poster marked "${job.title}" as complete. Please confirm completion to release payment.`,
          type: "info", link: "/activity",
        });
      }
      if (isHelper && !posterDone) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Helper marked job complete",
          message: `The helper marked "${job.title}" as complete. Please confirm completion to release payment.`,
          type: "info", link: "/activity",
        });
      }

      if (bothDone) {
        if (job.helper_id) {
          await supabaseAdmin.from("notifications").insert({
            user_id: job.helper_id,
            title: "Job completed & paid!",
            message: `"${job.title}" is complete. You earned $${helperPayout.toFixed(2)}.`,
            type: "payment", link: "/activity",
          });
        }
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Job completed!",
          message: `"${job.title}" is complete. Payment has been captured and released.`,
          type: "payment", link: "/activity",
        });
      }

      return new Response(JSON.stringify({
        success: true, bothDone,
        helperPayout: bothDone ? helperPayout : 0,
        platformFee: bothDone ? job.platform_fee_amount : 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── REQUEST REVISION ───
    if (action === "request_revision") {
      const { jobId, note } = body;
      if (!jobId) throw new Error("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");
      if (job.customer_id !== user.id) throw new Error("Not authorized");
      if (job.status !== "in_progress") throw new Error("Job must be in progress to request revision");

      await supabaseAdmin.from("jobs").update({
        status: "revision_requested",
        revision_note: note || "The poster has requested revisions.",
        revision_requested_at: new Date().toISOString(),
      }).eq("id", jobId);

      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Revision requested",
          message: `The poster has requested revisions on "${job.title}": ${note || "Please check the details."}`,
          type: "warning", link: "/activity",
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── RESOLVE REVISION ───
    if (action === "resolve_revision") {
      const { jobId } = body;
      if (!jobId) throw new Error("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");
      if (job.helper_id !== user.id) throw new Error("Not authorized");
      if (job.status !== "revision_requested") throw new Error("No revision pending");

      await supabaseAdmin.from("jobs").update({
        status: "in_progress",
        revision_note: null,
        revision_requested_at: null,
      }).eq("id", jobId);

      await supabaseAdmin.from("notifications").insert({
        user_id: job.customer_id,
        title: "Revision completed",
        message: `The helper has addressed your revision request for "${job.title}".`,
        type: "success", link: "/activity",
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── TIP ───
    if (action === "tip") {
      const { jobId, amount } = body;
      if (!jobId || !amount || amount <= 0) throw new Error("Missing jobId or invalid tip amount");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");
      if (job.status !== "completed") throw new Error("Job must be completed to tip");

      let helperId: string;
      if (user.id === job.customer_id) {
        if (!job.helper_id) throw new Error("No helper assigned");
        helperId = job.helper_id;
      } else if (user.id === job.helper_id) {
        helperId = job.customer_id;
      } else {
        throw new Error("Not authorized to tip on this job");
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : user.email,
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Tip — ${job.title}`, description: "Thank you tip. 100% goes to the recipient." },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${req.headers.get("origin")}/activity?tip=success`,
        cancel_url: `${req.headers.get("origin")}/activity`,
        metadata: { job_id: jobId, tipper_id: user.id, helper_id: helperId, type: "tip" },
      });

      await supabaseAdmin.from("tips").insert({
        job_id: jobId, tipper_id: user.id, helper_id: helperId,
        amount, stripe_session_id: session.id, payment_status: "pending",
      });

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── CANCEL ESCROW: void the held authorization ───
    if (action === "cancel_escrow") {
      const { jobId } = body;
      if (!jobId) throw new Error("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");
      if (job.customer_id !== user.id) throw new Error("Not authorized");

      // Cancel the uncaptured payment intent
      if (job.stripe_payment_intent_id) {
        try {
          await stripe.paymentIntents.cancel(job.stripe_payment_intent_id);
        } catch (e) {
          console.error("Failed to cancel payment intent:", e);
        }
      }

      await supabaseAdmin.from("jobs").update({
        payment_status: "cancelled",
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.id,
      }).eq("id", jobId);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    throw new Error("Invalid action");
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});

/**
 * Capture the held (manual capture) payment for a job.
 * Retrieves the PaymentIntent from the Checkout Session and captures it.
 */
async function captureEscrowPayment(stripe: any, supabaseAdmin: any, job: any) {
  let paymentIntentId = job.stripe_payment_intent_id;

  // If we don't have it stored, retrieve from the checkout session
  if (!paymentIntentId && job.stripe_session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id);
      paymentIntentId = session.payment_intent;
      // Store it for future reference
      if (paymentIntentId) {
        await supabaseAdmin.from("jobs").update({
          stripe_payment_intent_id: paymentIntentId,
        }).eq("id", job.id);
      }
    } catch (e) {
      console.error("Failed to retrieve checkout session:", e);
    }
  }

  if (!paymentIntentId) {
    console.warn(`No payment intent found for job ${job.id}, skipping capture`);
    return;
  }

  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === "requires_capture") {
      await stripe.paymentIntents.capture(paymentIntentId);
      console.log(`Captured payment ${paymentIntentId} for job ${job.id}`);
    } else {
      console.log(`Payment ${paymentIntentId} status is ${pi.status}, no capture needed`);
    }
  } catch (e) {
    console.error(`Failed to capture payment for job ${job.id}:`, e);
    throw new Error("Failed to capture escrow payment. Please contact support.");
  }
}