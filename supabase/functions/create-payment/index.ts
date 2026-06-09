import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Throttle abuse: 10 payment-creation attempts per IP per minute. The real
  // Stripe-side throttle is generous, but every call hits stripe.customers.list
  // and (often) stripe.customers.create, which costs us money + adds latency
  // for legit users if a script floods it.
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 10,
    keyPrefix: "create-payment",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
  );

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
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
    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      // Fetch user's profile name for the Stripe customer record
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .single();
      const newCustomer = await stripe.customers.create({
        email: user.email,
        name: profile?.full_name || user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = newCustomer.id;
    }

    // ─── ESCROW: Create checkout with manual capture ───
    if (action === "escrow") {
      const { jobId, saveCardForFuture } = body;
      if (!jobId) throw new Error("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");
      if (job.customer_id !== user.id) throw new Error("Not authorized");

      // Idempotency: if payment is already in progress or paid, don't create another session
      if (job.stripe_session_id && job.payment_status && job.payment_status !== "unpaid") {
        throw new Error("Payment has already been initiated for this job. If you need to retry, please cancel the existing payment first.");
      }

      const { data: settings } = await supabaseAdmin
        .from("platform_settings")
        .select("customer_fee_percent, helper_fee_percent, platform_fee_percent, onboarding_fee_cents")
        .limit(1).single();
      const customerFeePercent = settings?.customer_fee_percent ?? 10;
      const helperFeePercent = settings?.helper_fee_percent ?? 10;
      const onboardingFeeCents = settings?.onboarding_fee_cents ?? 200;

      // Check if poster owes the one-time onboarding fee (first job post)
      const { data: posterProfile } = await supabaseAdmin
        .from("profiles")
        .select("onboarding_fee_paid")
        .eq("user_id", user.id)
        .single();
      const owesOnboardingFee = !posterProfile?.onboarding_fee_paid && onboardingFeeCents > 0;

      // Customer service fee (added as a line item — taxable, platform revenue)
      const customerFeeAmount = (job.budget * customerFeePercent) / 100;
      // Helper commission is deducted at payout time, not charged to poster
      const helperFeeAmount = (job.budget * helperFeePercent) / 100;

      // ─── Louisiana sales-tax classification ───
      // LA R.S. 47:301(14) defines a narrow list of taxable services. Most
      // labor services (cleaning, yard work, moving, painting houses, errands,
      // pet care, delivery) are NOT subject to LA state sales tax. The clearest
      // taxable case in this app is *assembly* — installation/assembly of
      // tangible personal property (e.g. IKEA furniture). Handyman work is
      // ambiguous (taxable if repairing a TV, exempt if repairing a doorframe);
      // we default it to exempt and rely on operator judgment per-job. If LDR
      // clarifies otherwise, add categories to TAXABLE_CATEGORIES below.
      const TAXABLE_CATEGORIES = new Set(["assembly"]);
      const isLaborTaxable = TAXABLE_CATEGORIES.has(job.category);

      const lineItems: any[] = [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Helpr Task: ${job.title}`,
              description: isLaborTaxable
                ? `Secure escrow payment for taxable labor (${job.category}). Funds release once both parties confirm completion.`
                : `Secure escrow payment for exempt service (${job.category}). Funds release once both parties confirm completion.`,
              // Assembly/installation of tangible personal property: LA repair/install code.
              // All other categories: pass-through (no LA state tax on the labor).
              tax_code: isLaborTaxable ? "txcd_20030000" : "txcd_00000000",
            },
            unit_amount: Math.round(job.budget * 100),
          },
          quantity: 1,
        },
      ];

      // Poster service fee — treated as a non-taxable platform commission
      // until LA Dept. of Revenue clarifies B2C SaaS treatment post-Act 470.
      // (Switch tax_code to "txcd_10103001" if a CPA confirms it should be
      // taxed as a digital service.)
      if (customerFeeAmount > 0) {
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: "Service Fee",
              description: `${customerFeePercent}% platform service fee`,
              tax_code: "txcd_00000000", // Non-taxable until LDR clarifies
            },
            unit_amount: Math.round(customerFeeAmount * 100),
          },
          quantity: 1,
        });
      }

      // Urgent tip — non-taxable (passes through to helper)
      if ((job.urgent_fee ?? 0) > 0) {
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: "Urgent Tip",
              description: "Urgent tip — goes directly to the helpr",
              tax_code: "txcd_00000000", // Non-taxable: passes through to helper
            },
            unit_amount: Math.round(job.urgent_fee * 100),
          },
          quantity: 1,
        });
      }

      // One-time onboarding fee — first job post only. Treated as a non-taxable
      // platform setup fee (matching the service-fee treatment above).
      if (owesOnboardingFee) {
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: "One-time Account Setup",
              description: "One-time identity verification & account setup fee. Charged once per account.",
              tax_code: "txcd_00000000",
            },
            unit_amount: onboardingFeeCents,
          },
          quantity: 1,
        });
      }

      // When the poster opts in to "Save card for next time", ask Stripe
      // to save the card via off_session setup_future_usage on the
      // resulting PaymentIntent. Doesn't change the user flow — Stripe
      // shows a tiny "Save my info" disclosure inside Checkout — but lets
      // them one-tap the next post via a saved card.
      const paymentIntentExtras: Record<string, any> = {
        metadata: {
          job_id: jobId,
          customer_id: user.id,
          customer_fee_percent: String(customerFeePercent),
          helper_fee_percent: String(helperFeePercent),
          onboarding_fee_charged: owesOnboardingFee ? "true" : "false",
        },
      };
      if (saveCardForFuture === true) {
        paymentIntentExtras.setup_future_usage = "off_session";
      }
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_update: { address: 'auto' },
        line_items: lineItems,
        mode: "payment",
        automatic_tax: { enabled: true },
        payment_intent_data: paymentIntentExtras,
        success_url: `${req.headers.get("origin")}/payment-success?job_id=${jobId}`,
        cancel_url: `${req.headers.get("origin")}/post-job`,
        metadata: { job_id: jobId, customer_id: user.id, onboarding_fee_charged: owesOnboardingFee ? "true" : "false" },
      });

      // Store both fee structures on the job
      await supabaseAdmin.from("jobs").update({
        stripe_session_id: session.id,
        platform_fee_percent: customerFeePercent,
        platform_fee_amount: helperFeeAmount,
        customer_fee_amount: customerFeeAmount,
        helper_fee_percent: helperFeePercent,
      }).eq("id", jobId);

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // (repay_escrow action removed — immediate capture eliminates expiry risk)

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
        // Payment was already captured at checkout (immediate capture).
        // Verify the charge succeeded before scheduling payout.
        let paymentIntentId = job.stripe_payment_intent_id;
        if (!paymentIntentId && job.stripe_session_id) {
          const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
          paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
          if (paymentIntentId) {
            await supabaseAdmin.from("jobs").update({ stripe_payment_intent_id: paymentIntentId }).eq("id", job.id);
          }
        }
        if (paymentIntentId) {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          if (pi.status !== "succeeded") {
            throw new Error(`Payment not captured (status: ${pi.status}). Cannot release payout.`);
          }
        }

        // Charge confirmed — schedule payout
        const payoutTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        updateFields.payout_scheduled_at = payoutTime;
        updateFields.status = "completed";
        updateFields.payment_status = "payout_pending";
      } else if (job.status === "accepted") {
        // If job was still in accepted, move to in_progress when one party marks complete
        updateFields.status = "in_progress";
      }

      const { error: updateError } = await supabaseAdmin.from("jobs").update(updateFields).eq("id", jobId);
      if (updateError) {
        console.error("Failed to update job:", updateError);
        throw new Error("Failed to update job status: " + updateError.message);
      }
      console.log("Job updated successfully:", jobId, updateFields);

      // Calculate helper payout: budget/helpers - helperCommission + urgent_fee
      // Commission tax is already collected at checkout — no deduction here
      const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
      const perHelperBudget = job.budget / helpersCount;
      const jobHelperFeePercent = job.helper_fee_percent ?? 10;
      const helperCommission = (perHelperBudget * jobHelperFeePercent) / 100;
      const helperPayout = perHelperBudget - helperCommission + (job.urgent_fee ?? 0);
      if (isPoster && job.helper_id && !helperDone) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Poster marked the job complete",
          message: `The poster marked "${job.title}" as complete. Please confirm completion to release payment.`,
          type: "info", link: "/my-jobs?filter=in_progress",
        });
      }
      if (isHelper && !posterDone) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Helpr marked the job complete",
          message: `The helpr marked "${job.title}" as complete. Please confirm completion to release payment.`,
          type: "info", link: "/my-posts?filter=in_progress",
        });
      }

      if (bothDone) {
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
          type: "payment", link: "/my-posts?filter=completed",
        });
      }

      return new Response(JSON.stringify({
        success: true, bothDone,
        helperPayout: bothDone ? helperPayout : 0,
        platformFee: bothDone ? (job.platform_fee_amount || 0) : 0,
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
          type: "warning", link: "/my-jobs?filter=revision",
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

      const now = new Date();
      const acceptanceDeadline = new Date(now.getTime() + 72 * 60 * 60 * 1000);

      await supabaseAdmin.from("jobs").update({
        revision_completed_at: now.toISOString(),
        revision_acceptance_deadline: acceptanceDeadline.toISOString(),
      }).eq("id", jobId);

      await supabaseAdmin.from("notifications").insert({
        user_id: job.customer_id,
        title: "Revision completed — review needed",
        message: `The helpr has fixed the revision for "${job.title}". You have 72 hours to accept (mark complete) or dispute. If you do nothing, payment auto-releases.`,
        type: "warning", link: "/my-posts?filter=revision_requested",
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
      if (user.id !== job.customer_id) throw new Error("Only the customer can tip the helper");
      if (!job.helper_id) throw new Error("No helper assigned to this job");

      const helperId = job.helper_id;

      // Check if helper has a connected Stripe account for direct tip transfer
      const { data: helperProfile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", helperId)
        .single();

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
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
        success_url: `${req.headers.get("origin")}/my-posts?tip=success`,
        cancel_url: `${req.headers.get("origin")}/my-posts`,
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

      // With immediate capture, we need to refund instead of cancel
      if (job.stripe_payment_intent_id) {
        try {
          const pi = await stripe.paymentIntents.retrieve(job.stripe_payment_intent_id);
          if (pi.status === "succeeded") {
            await stripe.refunds.create({ payment_intent: job.stripe_payment_intent_id });
          }
        } catch (e) {
          console.error("Failed to refund payment:", e);
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

      // Verify payment is captured (immediate capture — should already be succeeded)
      let paymentIntentId = job.stripe_payment_intent_id;
      if (!paymentIntentId && job.stripe_session_id) {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
        paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      }
      if (!paymentIntentId) throw new Error("No payment intent found for this job");
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== "succeeded") throw new Error(`Payment not captured (status: ${pi.status})`);
      const captureResult = { paymentIntentId };

      // Transfer to helpr
      const feeAmt = job.platform_fee_amount || 0;
      const dpHelpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
      const helperPayout = (job.budget / dpHelpersCount) - (feeAmt / dpHelpersCount) + (job.urgent_fee ?? 0);
      if (job.helper_id && helperPayout > 0) {
        await transferToHelper(stripe, supabaseAdmin, job.helper_id, helperPayout, captureResult.paymentIntentId, job.id);
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
        type: "info", link: "/my-posts?filter=completed",
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

      // Refund the captured payment
      let paymentIntentId = job.stripe_payment_intent_id;
      if (!paymentIntentId && job.stripe_session_id) {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
        paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      }
      if (paymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          if (pi.status === "succeeded") {
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
        type: "payment", link: "/my-posts?filter=cancelled",
      });
      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Dispute resolved",
          message: `The dispute on "${job.title}" has been resolved. The customer has been refunded.`,
          type: "info", link: "/my-jobs?filter=not_selected",
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── ADMIN: General refund (non-dispute) — admin discretion ───
    // Mirrors admin_refund_dispute but with neutral notification copy
    // for refunds outside of an active dispute (e.g., goodwill refund,
    // chargeback prevention, customer support resolution).
    if (action === "admin_refund_general") {
      // Accepts an optional `amountCents` for partial refunds. When omitted,
      // refunds the full captured amount and cancels the job (existing
      // behavior). When provided + less than the total, issues a partial
      // refund and leaves the job state untouched — useful for goodwill
      // adjustments, partial-completion settlements, etc.
      const { jobId, reason, amountCents } = body;
      if (!jobId) throw new Error("Missing jobId");

      const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!isAdmin) throw new Error("Not authorized — admin only");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new Error("Job not found");

      const totalCents = Math.round(Number(job.budget || 0) * 100);
      const requestedCents = typeof amountCents === "number" ? Math.round(amountCents) : null;
      const isPartial = requestedCents !== null && requestedCents > 0 && requestedCents < totalCents;
      if (requestedCents !== null && (requestedCents <= 0 || requestedCents > totalCents)) {
        throw new Error(`Invalid partial amount: ${requestedCents} cents (job total ${totalCents} cents)`);
      }

      let paymentIntentId = job.stripe_payment_intent_id;
      if (!paymentIntentId && job.stripe_session_id) {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
        paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      }
      if (paymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          if (pi.status === "succeeded") {
            await stripe.refunds.create({
              payment_intent: paymentIntentId,
              ...(isPartial ? { amount: requestedCents } : {}),
              metadata: {
                reason: reason || (isPartial ? "admin_partial_refund" : "admin_general_refund"),
                admin_user_id: user.id,
                partial: String(isPartial),
              },
            });
          }
        } catch (e) {
          console.error("[create-payment] admin_refund_general — refund error:", e);
          throw e;
        }
      }

      // Only cancel the job + flip payment_status on a FULL refund. Partial
      // refunds leave the job state intact — the customer still owes the
      // remaining work or the helper still earned the unrefunded portion.
      if (!isPartial) {
        await supabaseAdmin.from("jobs").update({
          status: "cancelled",
          payment_status: "refunded",
          cancellation_reason: reason ? `[ADMIN REFUND] ${reason}` : "[ADMIN REFUND] Issued by support",
          cancelled_at: new Date().toISOString(),
          cancelled_by: user.id,
        }).eq("id", jobId);
      }

      await supabaseAdmin.from("admin_audit_log").insert({
        admin_id: user.id,
        action: isPartial ? "job_admin_refund_partial" : "job_admin_refund",
        target_type: "job",
        target_id: jobId,
        details: {
          reason: reason || null,
          job_title: job.title,
          customer_id: job.customer_id,
          helper_id: job.helper_id,
          budget: job.budget,
          partial_amount_cents: isPartial ? requestedCents : null,
          partial_amount_dollars: isPartial ? (requestedCents! / 100).toFixed(2) : null,
          payment_intent_id: paymentIntentId,
        },
      });

      const dollarAmount = isPartial
        ? `$${(requestedCents! / 100).toFixed(2)}`
        : `$${Number(job.budget).toFixed(2)}`;
      const customerMessage = isPartial
        ? `A partial refund of ${dollarAmount} has been issued for "${job.title}".${reason ? ` Reason: ${reason}` : ""} It should appear on your card in 5-10 business days.`
        : `A refund has been issued for "${job.title}".${reason ? ` Reason: ${reason}` : ""} It should appear on your card in 5-10 business days.`;

      await supabaseAdmin.from("notifications").insert({
        user_id: job.customer_id,
        title: isPartial ? "Partial refund issued" : "Refund issued",
        message: customerMessage,
        type: "payment",
        link: isPartial ? `/my-posts` : "/my-posts?filter=cancelled",
      });

      // Helper notification — only on full refund (job is cancelled). Partial
      // refunds don't change the helper's stake; if a partial-refund scenario
      // ever needs helper notification, send a separate manual message.
      if (!isPartial && job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Job cancelled",
          message: `"${job.title}" was cancelled by support and refunded to the customer.${reason ? ` Reason: ${reason}` : ""}`,
          type: "info", link: "/my-jobs?filter=not_selected",
        });
      }

      return new Response(JSON.stringify({ success: true, refunded: true, partial: isPartial }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    throw new Error("Invalid action");
  } catch (error) {
    // Defensive logging: Supabase log API only surfaces status codes, not
    // response bodies. Without console.error, every 500 here would be
    // diagnosable only by reproducing the call. Same pattern shipped in
    // stripe-connect after that function had hours of opaque 500s.
    const err = error as Error & { type?: string; code?: string; statusCode?: number };
    console.error("[create-payment] 500 — full error:", {
      message: err.message,
      stripe_type: err.type,
      stripe_code: err.code,
      stripe_status: err.statusCode,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
    });
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});

// captureEscrowPayment and handleExpiredEscrow removed — immediate capture eliminates expiry risk

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
    throw new Error("Helpr must set up their payout account before payment can be released. Please ask the helpr to connect their payout account in their profile settings.");
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
          message: `Failed to transfer $${amount.toFixed(2)} to helper for job ${jobId}. Error: ${(e as Error).message}`,
          type: "warning",
          link: "/admin",
        });
      }
    }
  }
}