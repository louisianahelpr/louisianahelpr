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

    // ─── RELEASE: Both parties confirm → capture + transfer ───
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
      if (job.status === "disputed") {
        throw new Error("This job is currently under dispute. Payment cannot be released until the dispute is resolved.");
      }

      // Minimum job time enforcement: 30 minutes after helper confirmed/accepted
      const jobStartTime = job.helper_confirmed_at || job.updated_at;
      if (jobStartTime) {
        const elapsed = Date.now() - new Date(jobStartTime).getTime();
        const MIN_JOB_TIME_MS = 30 * 60 * 1000; // 30 minutes
        if (elapsed < MIN_JOB_TIME_MS) {
          const minutesLeft = Math.ceil((MIN_JOB_TIME_MS - elapsed) / 60000);
          throw new Error(`Job must be active for at least 30 minutes before completion. ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""} remaining.`);
        }
      }

      const updateFields: Record<string, any> = {};
      if (isPoster) updateFields.poster_completed_at = new Date().toISOString();
      if (isHelper) updateFields.helper_completed_at = new Date().toISOString();

      const posterDone = isPoster ? true : !!job.poster_completed_at;
      const helperDone = isHelper ? true : !!job.helper_completed_at;
      const bothDone = posterDone && helperDone;

      if (bothDone) {
        // Capture the held payment
        const paymentIntentId = await captureEscrowPayment(stripe, supabaseAdmin, job);

        // Schedule payout for 24 hours later instead of immediate transfer
        const payoutTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        updateFields.payout_scheduled_at = payoutTime;
        updateFields.status = "completed";
        updateFields.payment_status = "payout_pending";
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
        const helperPayout = job.budget - (job.platform_fee_amount || 0);
        if (job.helper_id) {
          await supabaseAdmin.from("notifications").insert({
            user_id: job.helper_id,
            title: "Job completed!",
            message: `"${job.title}" is complete. $${helperPayout.toFixed(2)} will be transferred to your account in 24 hours.`,
            type: "payment", link: "/earnings",
          });
        }
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Job completed!",
          message: `"${job.title}" is complete. Payment has been captured. The helpr will be paid in 24 hours.`,
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

      // Check if helper has a connected Stripe account for direct tip transfer
      const { data: helperProfile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", helperId)
        .single();

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
        payment_intent_data: helperProfile?.stripe_account_id ? {
          transfer_data: {
            destination: helperProfile.stripe_account_id,
          },
        } : undefined,
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

    // ─── CANCEL ESCROW ───
    if (action === "cancel_escrow") {
      const { jobId } = body;
      if (!jobId) throw new Error("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");
      if (job.customer_id !== user.id) throw new Error("Not authorized");

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

    // ─── ADMIN: Release disputed payment to helpr ───
    if (action === "admin_release_dispute") {
      const { jobId } = body;
      if (!jobId) throw new Error("Missing jobId");

      // Verify admin
      const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!isAdmin) throw new Error("Not authorized — admin only");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");

      // Capture payment
      const paymentIntentId = await captureEscrowPayment(stripe, supabaseAdmin, job);

      // Transfer to helpr
      const helperPayout = job.budget - (job.platform_fee_amount || 0);
      if (job.helper_id && helperPayout > 0) {
        await transferToHelper(stripe, supabaseAdmin, job.helper_id, helperPayout, paymentIntentId, job.id);
      }

      await supabaseAdmin.from("jobs").update({
        status: "completed",
        payment_status: "released",
      }).eq("id", jobId);

      // Notify both parties
      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Dispute resolved — payment released!",
          message: `The dispute on "${job.title}" has been resolved in your favor. $${helperPayout.toFixed(2)} has been transferred.`,
          type: "payment", link: "/earnings",
        });
      }
      await supabaseAdmin.from("notifications").insert({
        user_id: job.customer_id,
        title: "Dispute resolved",
        message: `The dispute on "${job.title}" has been resolved. Payment was released to the helpr.`,
        type: "info", link: "/activity",
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── ADMIN: Refund disputed payment to customer ───
    if (action === "admin_refund_dispute") {
      const { jobId } = body;
      if (!jobId) throw new Error("Missing jobId");

      const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!isAdmin) throw new Error("Not authorized — admin only");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");

      // Cancel the payment intent (refund)
      let paymentIntentId = job.stripe_payment_intent_id;
      if (!paymentIntentId && job.stripe_session_id) {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id);
        paymentIntentId = session.payment_intent;
      }
      if (paymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          if (pi.status === "requires_capture") {
            await stripe.paymentIntents.cancel(paymentIntentId);
          } else if (pi.status === "succeeded") {
            await stripe.refunds.create({ payment_intent: paymentIntentId });
          }
        } catch (e) {
          console.error("Refund error:", e);
        }
      }

      await supabaseAdmin.from("jobs").update({
        status: "cancelled",
        payment_status: "refunded",
      }).eq("id", jobId);

      // Notify both parties
      await supabaseAdmin.from("notifications").insert({
        user_id: job.customer_id,
        title: "Dispute resolved — refund issued",
        message: `The dispute on "${job.title}" has been resolved in your favor. A refund has been issued.`,
        type: "payment", link: "/activity",
      });
      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Dispute resolved",
          message: `The dispute on "${job.title}" has been resolved. The customer has been refunded.`,
          type: "info", link: "/activity",
        });
      }

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
 * Returns the payment intent ID.
 * 
 * Note: We use "Separate Charges and Transfers" (not destination charges)
 * because the helper isn't known at checkout time. Transfers are linked
 * via source_transaction for clean Stripe Dashboard reporting.
 * The 24-hour payout delay is enforced by scheduling transfers separately.
 */
async function captureEscrowPayment(stripe: any, supabaseAdmin: any, job: any): Promise<string | null> {
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
      console.error("Failed to retrieve checkout session:", e);
    }
  }

  if (!paymentIntentId) {
    console.warn(`No payment intent found for job ${job.id}, skipping capture`);
    return null;
  }

  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === "requires_capture") {
      await stripe.paymentIntents.capture(paymentIntentId);
      console.log(`Captured payment ${paymentIntentId} for job ${job.id} — $${(job.budget || 0).toFixed(2)} total, $${(job.platform_fee_amount || 0).toFixed(2)} platform fee`);
    } else {
      console.log(`Payment ${paymentIntentId} status is ${pi.status}, no capture needed`);
    }
    return paymentIntentId;
  } catch (e) {
    console.error(`Failed to capture payment for job ${job.id}:`, e);
    throw new Error("Failed to capture escrow payment. Please contact support.");
  }
}

/**
 * Transfer funds to the helper's connected Stripe account.
 */
async function transferToHelper(
  stripe: any,
  supabaseAdmin: any,
  helperId: string,
  amount: number,
  paymentIntentId: string | null,
  jobId: string
) {
  // Get helper's connected account
  const { data: helperProfile } = await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id")
    .eq("user_id", helperId)
    .single();

  if (!helperProfile?.stripe_account_id) {
    throw new Error("Helper must set up their payout account before payment can be released. Please ask the helper to connect their payout account in their profile settings.");
  }

  try {
    const transferParams: any = {
      amount: Math.round(amount * 100), // Convert to cents
      currency: "usd",
      destination: helperProfile.stripe_account_id,
      metadata: { job_id: jobId, helper_id: helperId },
    };

    // Link the transfer to the source charge if we have one
    if (paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.latest_charge) {
          transferParams.source_transaction = pi.latest_charge;
        }
      } catch (e) {
        console.warn("Could not retrieve charge for transfer linking:", e);
      }
    }

    const transfer = await stripe.transfers.create(transferParams);
    console.log(`Transferred $${amount.toFixed(2)} to helper ${helperId} (transfer: ${transfer.id})`);
  } catch (e) {
    console.error(`Failed to transfer to helper ${helperId}:`, e);
    // Notify admin
    const { data: adminRoles } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
    if (adminRoles) {
      for (const admin of adminRoles) {
        await supabaseAdmin.from("notifications").insert({
          user_id: admin.user_id,
          title: "⚠️ Transfer failed",
          message: `Failed to transfer $${amount.toFixed(2)} to helper for job ${jobId}. Error: ${e.message}`,
          type: "warning",
          link: "/admin",
        });
      }
    }
  }
}