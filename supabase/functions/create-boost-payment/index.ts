import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BOOST_FEE_CENTS = 300; // $3.00 — match the dialog
const BOOST_DURATION_HOURS = 24;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Throttle: 5 boost-payment attempts per IP per minute. Same Stripe-cost
  // and abuse logic as create-payment.
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 5,
    keyPrefix: "create-boost-payment",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
  );

  try {
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated");

    const { job_id } = await req.json();
    if (!job_id) throw new Error("Missing job_id");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );

    // Verify the caller owns this job and it's still open (no point boosting closed work)
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("jobs")
      .select("id, customer_id, status, title, boost_expires_at")
      .eq("id", job_id)
      .single();
    if (jobErr || !job) throw new Error("Job not found");
    if (job.customer_id !== user.id) throw new Error("Not authorized to boost this job");
    if (job.status !== "open") throw new Error("Only open jobs can be boosted");
    if (job.boost_expires_at && new Date(job.boost_expires_at) > new Date()) {
      throw new Error("Job is already boosted");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: "Job Boost — 24-hour featured placement",
            description: `Boosts "${job.title}" to the top of Browse Tasks for 24 hours.`,
            // Promotional / advertising service — not subject to LA sales tax.
            // (LA does not currently tax advertising services for state purposes.)
            tax_code: "txcd_00000000",
          },
          unit_amount: BOOST_FEE_CENTS,
        },
        quantity: 1,
      }],
      mode: "payment",
      automatic_tax: { enabled: true },
      payment_intent_data: {
        metadata: {
          kind: "job_boost",
          job_id,
          customer_id: user.id,
          duration_hours: String(BOOST_DURATION_HOURS),
        },
      },
      success_url: `${req.headers.get("origin")}/dashboard?boosted=${job_id}`,
      cancel_url: `${req.headers.get("origin")}/dashboard?boost_cancelled=${job_id}`,
      metadata: {
        kind: "job_boost",
        job_id,
        customer_id: user.id,
        duration_hours: String(BOOST_DURATION_HOURS),
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
