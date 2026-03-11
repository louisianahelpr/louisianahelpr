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

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : user.email,
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Helpr Task: ${job.title}`, description: `Escrow payment. Platform fee: ${feePercent}%` },
            unit_amount: Math.round(job.budget * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        payment_intent_data: {
          capture_method: "automatic",
          metadata: { job_id: jobId, customer_id: user.id, platform_fee_percent: String(feePercent) },
        },
        success_url: `${req.headers.get("origin")}/payment-success?job_id=${jobId}`,
        cancel_url: `${req.headers.get("origin")}/post-job`,
        metadata: { job_id: jobId, customer_id: user.id },
      });

      const feeAmount = (job.budget * feePercent) / 100;
      await supabaseAdmin.from("jobs").update({
        stripe_session_id: session.id, payment_status: "escrow",
        platform_fee_percent: feePercent, platform_fee_amount: feeAmount,
      }).eq("id", jobId);

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    if (action === "release") {
      const { jobId } = body;
      if (!jobId) throw new Error("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");
      if (job.customer_id !== user.id) throw new Error("Not authorized");
      if (job.status !== "in_progress" && job.status !== "revision_requested") throw new Error("Job is not in progress");

      await supabaseAdmin.from("jobs").update({ status: "completed", payment_status: "released" }).eq("id", jobId);

      const helperPayout = job.budget - (job.platform_fee_amount || 0);

      // Notify helper
      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Job completed & paid!",
          message: `"${job.title}" is complete. You earned $${helperPayout.toFixed(2)}.`,
          type: "payment",
          link: "/activity",
        });
      }

      return new Response(JSON.stringify({ success: true, helperPayout, platformFee: job.platform_fee_amount }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

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

      // Notify helper
      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Revision requested",
          message: `The poster has requested revisions on "${job.title}": ${note || "Please check the details."}`,
          type: "warning",
          link: "/activity",
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    if (action === "resolve_revision") {
      // Helper marks revision as done, job goes back to in_progress
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

      // Notify poster
      await supabaseAdmin.from("notifications").insert({
        user_id: job.customer_id,
        title: "Revision completed",
        message: `The helper has addressed your revision request for "${job.title}".`,
        type: "success",
        link: "/activity",
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    if (action === "tip") {
      const { jobId, amount } = body;
      if (!jobId || !amount || amount <= 0) throw new Error("Missing jobId or invalid tip amount");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");
      if (job.status !== "completed") throw new Error("Job must be completed to tip");

      // Determine who is tipping whom
      let helperId: string;
      if (user.id === job.customer_id) {
        // Poster tipping helper
        if (!job.helper_id) throw new Error("No helper assigned");
        helperId = job.helper_id;
      } else if (user.id === job.helper_id) {
        // Helper tipping poster (poster is the "helper_id" in the tip record conceptually)
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

    throw new Error("Invalid action");
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
