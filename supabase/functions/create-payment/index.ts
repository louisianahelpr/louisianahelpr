import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getHelperFeePercent } from "../_shared/helperFees.ts";
import { stripeProcessingCostCents } from "../_shared/stripeFees.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";

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
    const { data, error: userErr } = await supabaseClient.auth.getUser(token);
    if (userErr) console.error("[create-payment] auth.getUser error:", userErr.message);
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

      // Fail LOUD if platform_settings can't be read — a silent default
      // here misprices every escrow created during a config outage.
      const { data: settings, error: settingsErr } = await supabaseAdmin
        .from("platform_settings")
        .select("customer_fee_percent, helper_fee_percent, platform_fee_percent, onboarding_fee_cents")
        .limit(1).single();
      if (settingsErr || settings?.customer_fee_percent == null || settings?.helper_fee_percent == null) {
        console.error(`[create-payment] platform_settings read failed — refusing to price escrow with default fees:`, settingsErr);
        throw new Error("Pricing configuration is temporarily unavailable — please try again in a moment");
      }
      const customerFeePercent = settings.customer_fee_percent;
      const helperFeePercent = settings.helper_fee_percent;
      const onboardingFeeCents = settings.onboarding_fee_cents; // NOT NULL DEFAULT 200 in schema

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
        success_url: `${getAppUrl()}/payment-success?job_id=${jobId}`,
        cancel_url: `${getAppUrl()}/post-job`,
        metadata: { job_id: jobId, customer_id: user.id, onboarding_fee_charged: owesOnboardingFee ? "true" : "false", onboarding_fee_cents: String(onboardingFeeCents) },
      }, {
        // Idempotency: a double-submit (double-tap, retried request) for the same
        // job reuses the existing Checkout Session instead of creating a second
        // escrow charge. Scoped per job; Stripe expires the key after 24h.
        idempotencyKey: `escrow-${jobId}`,
      });

      // Store both fee structures on the job. Fail the request if this write
      // fails: without stripe_session_id the double-payment guard is blind and
      // the frozen fee percents are lost — the unused Checkout Session is
      // harmless, so failing loudly here costs nothing.
      const { error: escrowUpdateErr } = await supabaseAdmin.from("jobs").update({
        stripe_session_id: session.id,
        platform_fee_percent: customerFeePercent,
        platform_fee_amount: helperFeeAmount,
        customer_fee_amount: customerFeeAmount,
        helper_fee_percent: helperFeePercent,
      }).eq("id", jobId);
      if (escrowUpdateErr) {
        console.error(`[create-payment] escrow session ${session.id} created for job ${jobId} but jobs.update failed:`, escrowUpdateErr);
        throw new Error("Could not record the payment session — please try again");
      }

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
      // Excludes "disputed" (and every other terminal state): a disputed job
      // can only be resolved through the admin dispute actions below, never the
      // normal two-party release path.
      if (!["in_progress", "revision_requested", "accepted"].includes(job.status)) {
        throw new Error(
          job.status === "disputed"
            ? "This job is currently under dispute. Payment cannot be released until the dispute is resolved."
            : "Job is not in progress",
        );
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
      // Resolve the helper's live tier for an accurate payout estimate; the real
      // transfer in process-scheduled-payouts re-resolves it at payout time.
      const jobHelperFeePercent = await getHelperFeePercent(
        supabaseAdmin,
        job.helper_id,
        job.helper_fee_percent ?? 10,
      );
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

      const { error: revisionUpdateErr } = await supabaseAdmin.from("jobs").update({
        status: "revision_requested",
        revision_note: note || "The poster has requested revisions.",
        revision_requested_at: new Date().toISOString(),
      }).eq("id", jobId);
      if (revisionUpdateErr) {
        console.error("[create-payment] request_revision update failed:", revisionUpdateErr);
        throw new Error("Failed to record revision request — please try again");
      }

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

      const { error: resolveUpdateErr } = await supabaseAdmin.from("jobs").update({
        revision_completed_at: now.toISOString(),
        revision_acceptance_deadline: acceptanceDeadline.toISOString(),
      }).eq("id", jobId);
      if (resolveUpdateErr) {
        console.error("[create-payment] resolve_revision update failed:", resolveUpdateErr);
        throw new Error("Failed to record revision completion — please try again");
      }

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

      // Check if helper has a connected Stripe account for direct tip transfer.
      // A read ERROR must fail the request — treating it as "no Connect account"
      // would silently reroute the tip to the platform balance instead of the
      // helper. Only a genuine missing row (PGRST116) may fall through.
      const { data: helperProfile, error: helperProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", helperId)
        .maybeSingle();
      if (helperProfileErr) {
        console.error(`[create-payment] tip — helper profile read failed for ${helperId}:`, helperProfileErr);
        throw new Error("Could not verify the helper's payout account — please try again");
      }

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
        success_url: `${getAppUrl()}/my-posts?tip=success`,
        cancel_url: `${getAppUrl()}/my-posts`,
        metadata: { job_id: jobId, tipper_id: user.id, helper_id: helperId, type: "tip" },
      }, {
        // Dedupe client retries (double-tap, network retry) without blocking a
        // deliberate repeat tip later: same job+tipper+amount collapses to one
        // session (and one pending `tips` row) within a 10-minute bucket.
        idempotencyKey: `tip-${jobId}-${user.id}-${Math.round(amount * 100)}-${Math.floor(Date.now() / 600_000)}`,
      });

      // Ledger row for the webhook to reconcile against. The idempotency key
      // above can return an EXISTING session on a retry, so dedupe on
      // stripe_session_id — never a second pending row for the same session.
      // Both the lookup and the insert must fail the request: a paid tip with
      // no ledger row silently pools on the platform balance.
      const { data: existingTip, error: tipLookupErr } = await supabaseAdmin
        .from("tips")
        .select("id")
        .eq("stripe_session_id", session.id)
        .maybeSingle();
      if (tipLookupErr) {
        console.error(`[create-payment] tip — ledger lookup failed for session ${session.id}:`, tipLookupErr);
        throw new Error("Could not record the tip — please try again");
      }
      if (!existingTip) {
        const { error: tipInsertErr } = await supabaseAdmin.from("tips").insert({
          job_id: jobId, tipper_id: user.id, helper_id: helperId,
          amount, stripe_session_id: session.id, payment_status: "pending",
        });
        if (tipInsertErr) {
          console.error(`[create-payment] tip — ledger insert failed for session ${session.id} (job ${jobId}):`, tipInsertErr);
          throw new Error("Could not record the tip — please try again");
        }
      }

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

      // Atomic state claim: only an escrow-held job may be refunded.
      // Without this, a cancel racing the payout release could refund a
      // PI whose funds were already transferred to the helper — the
      // platform pays twice. 'cancelling' stays claimable so a run that
      // failed after the claim can be retried (the Stripe idempotency
      // key below makes the refund itself single-shot either way).
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from("jobs")
        .update({ payment_status: "cancelling" })
        .eq("id", jobId)
        .in("payment_status", ["escrow", "cancelling"])
        .select("id");
      if (claimErr) {
        console.error(`[create-payment] cancel_escrow state claim failed for job ${jobId}:`, claimErr);
        throw new Error("Could not cancel — please try again");
      }
      if (!claimed || claimed.length === 0) {
        return new Response(JSON.stringify({
          error: "This payment can no longer be cancelled — it has already been released, refunded, or was never held in escrow.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
      }

      // With immediate capture, we need to refund instead of cancel.
      // Errors propagate to the outer catch so the job is NOT silently
      // marked "cancelled" when the refund fails — the customer would
      // lose their money with no indication anything went wrong.
      if (job.stripe_payment_intent_id) {
        const pi = await stripe.paymentIntents.retrieve(job.stripe_payment_intent_id);
        if (pi.status === "succeeded") {
          // Service fee is non-refundable: Stripe already took 2.9%+$0.30 on the
          // full capture and does NOT return it on a refund, so a full refund
          // leaves the platform out-of-pocket by that processing cost on every
          // free cancellation. Withhold the poster's service fee, floored at
          // Stripe's actual processing cost so the platform never loses money to
          // fees even when the service fee is tiny/missing (legacy/accept_bids).
          const capturedCents = pi.amount_received ?? pi.amount;
          const serviceFeeCents = Math.round(Number(job.customer_fee_amount ?? 0) * 100);
          const nonRefundableCents = Math.max(serviceFeeCents, stripeProcessingCostCents(capturedCents));
          const refundAmount = capturedCents - nonRefundableCents;
          // Idempotency key prevents a double-refund on concurrent cancel
          // requests (double-tap, network retry) from both succeeding before
          // the payment_status flip below makes the second 409 out.
          // Skip the refund entirely if the withholding consumes the whole
          // capture (Stripe rejects a $0 refund); the job still flips cancelled.
          if (refundAmount > 0) {
            const refund = await stripe.refunds.create(
              { payment_intent: job.stripe_payment_intent_id, amount: refundAmount },
              { idempotencyKey: `cancel-escrow-${jobId}` },
            );
            await recordRefund(supabaseAdmin, {
              refund,
              jobId,
              customerId: job.customer_id,
              paymentIntentId: job.stripe_payment_intent_id,
              source: "cancel_escrow",
              isPartial: nonRefundableCents > 0,
              reason: "escrow cancellation refund (minus non-refundable service fee)",
              initiatedByUserId: user.id,
            });
          } else {
            // The withholding consumed the whole capture, so the poster gets $0
            // back while the job still flips to cancelled. That can be legitimate
            // (a tiny capture entirely eaten by the non-refundable fee) but it can
            // also mean bad data (a stale/oversized customer_fee_amount, or a
            // degenerate/NaN capturedCents). Either way it must NEVER pass
            // silently — no ledger row is written in this branch, so ops is the
            // only trace. Alert with the inputs so a human can reconcile.
            console.error(
              `[create-payment] cancel_escrow: refundAmount<=0 for job ${jobId} ` +
                `(capturedCents=${capturedCents}, serviceFeeCents=${serviceFeeCents}, ` +
                `nonRefundableCents=${nonRefundableCents}) — poster refunded $0.`,
            );
            const suspicious =
              !Number.isFinite(capturedCents) || (capturedCents as number) <= 0;
            postSlackOpsAlert({
              kind: "custom",
              severity: suspicious ? "warning" : "info",
              title: "Escrow cancellation resolved with $0 refund",
              message:
                "A cancellation flipped the job to cancelled but returned nothing to the poster. Verify this was intended.",
              fields: {
                job_id: jobId,
                payment_intent: job.stripe_payment_intent_id,
                captured_cents: capturedCents,
                service_fee_cents: serviceFeeCents,
                non_refundable_cents: nonRefundableCents,
                refund_amount: refundAmount,
              },
            });
          }
        }
      }

      // The refund is already out — a failed status flip here must be LOUD,
      // or the job stays "in progress" on a refunded payment (helper still
      // sees it, auto-release could treat it as payable).
      const { error: cancelUpdateErr } = await supabaseAdmin.from("jobs").update({
        payment_status: "cancelled",
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.id,
      }).eq("id", jobId);
      if (cancelUpdateErr) {
        console.error(`CRITICAL: refund issued for job ${jobId} (pi ${job.stripe_payment_intent_id}) but jobs.update to cancelled failed — manual reconciliation needed:`, cancelUpdateErr);
        return new Response(JSON.stringify({
          error: "refund issued but job status update failed — contact support",
          stripe_payment_intent_id: job.stripe_payment_intent_id,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
      }

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

      // Only a job that is actually under dispute may be resolved here. Without
      // this guard an admin call could release escrow on an already-completed,
      // cancelled, or never-disputed job (double-pay / out-of-band release).
      if (job.status !== "disputed") {
        throw new Error(`Job is not under dispute (status: ${job.status}). Cannot resolve a dispute that doesn't exist.`);
      }

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

      // Transfer to helpr. Resolve the platform fee from the helper's live
      // subscription tier at release time; fall back to the amount frozen on the
      // job at checkout if the profile read fails.
      const disputeFeePercent = await getHelperFeePercent(
        supabaseAdmin,
        job.helper_id,
        job.helper_fee_percent ?? 10,
      );
      const feeAmt = Math.round(Number(job.budget) * disputeFeePercent) / 100 || (job.platform_fee_amount || 0);
      const dpHelpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
      const helperPayout = (job.budget / dpHelpersCount) - (feeAmt / dpHelpersCount) + (job.urgent_fee ?? 0);
      if (job.helper_id && helperPayout > 0) {
        // Throws on transfer/ledger failure → outer catch returns 500 and the
        // job stays disputed (never silently flipped to released below).
        await transferToHelper(stripe, supabaseAdmin, job.helper_id, helperPayout, captureResult.paymentIntentId, job.id, feeAmt / dpHelpersCount, user.id);
      }

      // Transfer already sent — a failed flip would leave the job "disputed"
      // (permanently blocked by release-payout's dispute guard) while the
      // notifications below assert it was resolved. Fail loudly instead.
      const { error: releaseUpdateErr } = await supabaseAdmin.from("jobs").update({
        status: "completed",
        payment_status: "released",
        helper_fee_percent: disputeFeePercent,
        platform_fee_amount: feeAmt,
      }).eq("id", jobId);
      if (releaseUpdateErr) {
        console.error(`CRITICAL: dispute transfer sent for job ${jobId} but jobs.update to released failed — manual reconciliation needed:`, releaseUpdateErr);
        return new Response(JSON.stringify({
          error: "transfer sent but job status update failed — manual reconciliation needed",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
      }

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

      // Same guard as admin_release_dispute: only a genuinely disputed job may
      // be resolved via this path. Non-dispute refunds go through
      // admin_refund_general (which intentionally accepts any state).
      if (job.status !== "disputed") {
        throw new Error(`Job is not under dispute (status: ${job.status}). Use a general refund for non-dispute cases.`);
      }

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
            // The poster WON the dispute, so they get the budget + service fee
            // back — but Stripe's 2.9%+$0.30 on the original capture is NOT
            // returned on a refund, so a full refund would leave the platform
            // out-of-pocket by that processing cost. Withhold ONLY that
            // unavoidable Stripe fee (never the service fee — the poster won the
            // dispute), so the platform never loses money to fees here.
            const capturedCents = pi.amount_received ?? pi.amount;

            // A disputed job's escrow was always captured, so a non-positive or
            // NaN captured amount here is bad data — NEVER silently flip the job
            // to refunded on it. Abort loudly (awaited alert + throw) so the job
            // stays disputed for manual reconciliation instead of the poster
            // being marked refunded for $0 with no ledger trace.
            if (!Number.isFinite(capturedCents) || (capturedCents as number) <= 0) {
              await postSlackOpsAlert({
                kind: "custom",
                severity: "warning",
                title: "Dispute refund aborted — invalid captured amount",
                message:
                  "admin_refund_dispute could not compute a refund: the PaymentIntent's captured amount was missing or non-positive. No refund issued; job left disputed for manual review.",
                fields: {
                  job_id: jobId,
                  payment_intent: paymentIntentId,
                  captured_cents: String(capturedCents),
                },
              });
              throw new Error(
                `admin_refund_dispute: invalid captured amount (${capturedCents}) for job ${jobId} — aborting, no refund issued.`,
              );
            }

            const nonRefundableCents = stripeProcessingCostCents(capturedCents);
            const refundAmount = capturedCents - nonRefundableCents;
            // A retried/double-clicked call within Stripe's ~24h key lifetime
            // returns the original refund. After key expiry, a repeat attempt
            // is rejected by Stripe with charge_already_refunded — still loud.
            // Skip entirely if withholding consumes the whole capture (Stripe
            // rejects a $0 refund); the job still flips to refunded below.
            if (refundAmount > 0) {
              const refund = await stripe.refunds.create(
                { payment_intent: paymentIntentId, amount: refundAmount },
                { idempotencyKey: `refund-dispute-${jobId}` },
              );
              await recordRefund(supabaseAdmin, {
                refund,
                jobId,
                customerId: job.customer_id,
                paymentIntentId,
                source: "admin_refund_dispute",
                isPartial: nonRefundableCents > 0,
                reason: "dispute refund (minus non-refundable Stripe processing fee)",
                initiatedByUserId: user.id,
              });
            } else {
              // Legitimate tiny capture fully consumed by the flat Stripe fee:
              // the poster genuinely gets $0 back and the job still flips to
              // refunded. No ledger row is written, so AWAIT the alert (a
              // fire-and-forget can be killed when the request returns) — it is
              // this money-relevant event's only durable trace.
              console.error(
                `[create-payment] admin_refund_dispute: refundAmount<=0 for job ${jobId} ` +
                  `(capturedCents=${capturedCents}, nonRefundableCents=${nonRefundableCents}) ` +
                  `— poster refunded $0.`,
              );
              await postSlackOpsAlert({
                kind: "custom",
                severity: "info",
                title: "Dispute resolved with $0 refund to poster",
                message:
                  "A dispute was resolved in the poster's favor but the Stripe processing fee consumed the whole capture, so nothing was returned. Verify this was intended.",
                fields: {
                  job_id: jobId,
                  payment_intent: paymentIntentId,
                  captured_cents: capturedCents,
                  non_refundable_cents: nonRefundableCents,
                  refund_amount: refundAmount,
                },
              });
            }
          } else {
            // A disputed job's escrow was captured, so a PaymentIntent that is
            // not "succeeded" here is an anomaly — don't silently mark the job
            // refunded (poster would get nothing with no signal). Abort loudly
            // (awaited alert + throw) and leave it disputed for manual review.
            await postSlackOpsAlert({
              kind: "custom",
              severity: "warning",
              title: "Dispute refund aborted — PaymentIntent not succeeded",
              message:
                `admin_refund_dispute found the PaymentIntent in status "${pi.status}" (expected "succeeded"). No refund issued; job left disputed for manual review.`,
              fields: {
                job_id: jobId,
                payment_intent: paymentIntentId,
                pi_status: pi.status,
              },
            });
            throw new Error(
              `admin_refund_dispute: PaymentIntent ${paymentIntentId} status is "${pi.status}", not "succeeded" — aborting, no refund for job ${jobId}.`,
            );
          }
        } catch (e) {
          console.error("[create-payment] admin_refund_dispute — refund error:", e);
          throw e;
        }
      }

      // Refund is out — same fail-loud rule as admin_release_dispute above.
      const { error: refundUpdateErr } = await supabaseAdmin.from("jobs").update({
        status: "cancelled",
        payment_status: "refunded",
      }).eq("id", jobId);
      if (refundUpdateErr) {
        console.error(`CRITICAL: refund issued for disputed job ${jobId} but jobs.update to refunded failed — manual reconciliation needed:`, refundUpdateErr);
        return new Response(JSON.stringify({
          error: "refund issued but job status update failed — manual reconciliation needed",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
      }

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
            const refund = await stripe.refunds.create({
              payment_intent: paymentIntentId,
              ...(isPartial ? { amount: requestedCents } : {}),
              metadata: {
                reason: reason || (isPartial ? "admin_partial_refund" : "admin_general_refund"),
                admin_user_id: user.id,
                partial: String(isPartial),
              },
            }, {
              // Full refund: deduped within Stripe's ~24h key lifetime; after
              // expiry a repeat is rejected with charge_already_refunded.
              // Partial: dedupe retries of the same amount within a 10-minute
              // bucket while still allowing a deliberate second partial later.
              idempotencyKey: isPartial
                ? `refund-general-${jobId}-${requestedCents}-${Math.floor(Date.now() / 600_000)}`
                : `refund-general-${jobId}-full`,
            });
            await recordRefund(supabaseAdmin, {
              refund,
              jobId,
              customerId: job.customer_id,
              paymentIntentId,
              source: "admin_refund_general",
              isPartial,
              reason: reason || null,
              initiatedByUserId: user.id,
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
        const { error: generalRefundUpdateErr } = await supabaseAdmin.from("jobs").update({
          status: "cancelled",
          payment_status: "refunded",
          cancellation_reason: reason ? `[ADMIN REFUND] ${reason}` : "[ADMIN REFUND] Issued by support",
          cancelled_at: new Date().toISOString(),
          cancelled_by: user.id,
        }).eq("id", jobId);
        if (generalRefundUpdateErr) {
          console.error(`CRITICAL: general refund issued for job ${jobId} but jobs.update to refunded failed — manual reconciliation needed:`, generalRefundUpdateErr);
          return new Response(JSON.stringify({
            error: "refund issued but job status update failed — manual reconciliation needed",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
        }
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
  jobId: string,
  platformFeeAmount = 0,
  initiatedByUserId: string | null = null
) {
  // Get helper's connected account. Distinguish a READ ERROR from a missing
  // account so a transient failure doesn't send admins chasing "helper never
  // onboarded" when the truth is "the profiles read blipped".
  const { data: helperProfile, error: helperProfileErr } = await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id")
    .eq("user_id", helperId)
    .maybeSingle();
  if (helperProfileErr) {
    console.error(`[create-payment] transferToHelper — profile read failed for ${helperId}:`, helperProfileErr);
    throw new Error("Could not verify the helpr's payout account — please try again");
  }

  if (!helperProfile?.stripe_account_id) {
    throw new Error("Helpr must set up their payout account before payment can be released. Please ask the helpr to connect their payout account in their profile settings.");
  }

  // DB-level idempotency: if a payout ledger row already exists for this job
  // the money already went out — don't send a second transfer. A FAILED read
  // must fail closed: it is indistinguishable from "no prior transfer" and
  // proceeding could double-pay once the Stripe idempotency key expires.
  const { data: existingTransfer, error: existingTransferErr } = await supabaseAdmin
    .from("payout_transfers")
    .select("stripe_transfer_id, status")
    .eq("job_id", jobId)
    .in("status", ["pending", "paid"])
    .maybeSingle();
  if (existingTransferErr) {
    console.error(`[create-payment] transferToHelper — duplicate-transfer check failed for job ${jobId}:`, existingTransferErr);
    throw new Error("Could not verify payout status — please try again");
  }
  if (existingTransfer) {
    console.log(`Payout already exists for job ${jobId} (${existingTransfer.stripe_transfer_id}); skipping duplicate transfer.`);
    return;
  }

  try {
    const transferParams: any = {
      amount: Math.round(amount * 100), // Convert to cents
      currency: "usd",
      destination: helperProfile.stripe_account_id,
      metadata: { job_id: jobId, helper_id: helperId, initiated_by: "admin" },
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

    // Stripe-level idempotency: same dispute release = same transfer, so a
    // retry never double-pays even if the ledger write below failed first.
    const transfer = await stripe.transfers.create(transferParams, {
      idempotencyKey: `dispute-release-${jobId}`,
    });
    console.log(`Transferred $${amount.toFixed(2)} to helper ${helperId} (transfer: ${transfer.id})`);

    // Ledger row mirrors release-payout so every payout path reconciles the
    // same way (stripe-webhook flips status to 'paid' on transfer.paid).
    const { error: ledgerErr } = await supabaseAdmin
      .from("payout_transfers")
      .insert({
        job_id: jobId,
        helper_id: helperId,
        stripe_transfer_id: transfer.id,
        stripe_account_id: helperProfile.stripe_account_id,
        amount_cents: Math.round(amount * 100),
        platform_fee_cents: Math.round(platformFeeAmount * 100),
        status: "pending",
        initiated_by: "admin",
        initiated_by_user_id: initiatedByUserId,
        metadata: { source: "admin_release_dispute" },
      });
    if (ledgerErr) {
      throw new Error(`transfer ${transfer.id} sent but ledger write failed — manual reconciliation needed: ${ledgerErr.message}`);
    }
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
    // Re-throw so the caller does NOT flip the job to 'released'. Fail closed:
    // the job stays disputed and an admin can retry once the cause is fixed.
    throw e;
  }
}

/**
 * Write a row to the payment_refunds ledger after a successful
 * stripe.refunds.create(). Best-effort by design: the refund has already left
 * Stripe and the job status has (or will) flip, so a ledger write failure must
 * NOT throw and turn a successful refund into a 500 the customer sees — it is
 * logged loudly instead so it can be reconciled. Upsert on stripe_refund_id so a
 * retried/replayed refund (same Stripe idempotency key → same refund id) updates
 * the one row rather than duplicating the ledger.
 */
async function recordRefund(
  supabaseAdmin: any,
  args: {
    refund: { id: string; amount?: number; currency?: string };
    jobId: string;
    customerId: string | null;
    paymentIntentId: string | null;
    source: string;
    isPartial?: boolean;
    reason?: string | null;
    initiatedByUserId: string | null;
  },
) {
  try {
    const { error } = await supabaseAdmin.from("payment_refunds").upsert({
      job_id: args.jobId,
      customer_id: args.customerId,
      stripe_refund_id: args.refund.id,
      stripe_payment_intent_id: args.paymentIntentId,
      amount_cents: Math.round(Number(args.refund.amount ?? 0)),
      currency: args.refund.currency ?? "usd",
      is_partial: args.isPartial ?? false,
      reason: args.reason ?? null,
      source: args.source,
      initiated_by_user_id: args.initiatedByUserId,
    }, { onConflict: "stripe_refund_id", ignoreDuplicates: true });
    if (error) {
      console.error(`[create-payment] recordRefund — ledger write failed for refund ${args.refund.id} (job ${args.jobId}); refund succeeded, reconcile manually:`, error);
      // The refund already left Stripe, so we never throw here — but a dropped
      // ledger row is a real Stripe↔ledger divergence that a human must
      // reconcile, so surface it to ops instead of leaving it in a Deno log.
      postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: "Refund ledger write failed",
        message: `A Stripe refund succeeded but its payment_refunds row was not written. Reconcile manually.`,
        fields: {
          refund_id: args.refund.id,
          job_id: args.jobId,
          source: args.source,
          amount_cents: Math.round(Number(args.refund.amount ?? 0)),
          db_error: error.message,
        },
      });
    }
  } catch (e) {
    console.error(`[create-payment] recordRefund — unexpected error for refund ${args.refund.id} (job ${args.jobId}):`, e);
  }
}