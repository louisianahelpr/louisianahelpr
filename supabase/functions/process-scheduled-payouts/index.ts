import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getHelperFeePercent } from "../_shared/helperFees.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Fail loud on missing config — previously masked by `?? ""` / `|| ""`
    // fallbacks below, which let the Stripe SDK constructor throw a generic
    // error outside the try block, producing a text/plain "Internal Server
    // Error" with no diagnostic context.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const serviceRoleKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!stripeSecretKey) missing.push("STRIPE_SECRET_KEY");
    if (!serviceRoleKey) missing.push("SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);

    // Verify cron secret
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && authHeader !== `Bearer ${serviceRoleKey}`)) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-08-27.basil",
    });

    const now = new Date().toISOString();

    const { data: jobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, helper_fee_percent, urgent_fee, stripe_session_id, stripe_payment_intent_id, status, is_group_job, helpers_needed, sales_tax_rate")
      .eq("status", "completed")
      .eq("payment_status", "payout_pending")
      .lte("payout_scheduled_at", now);

    if (error) throw error;

    let processed = 0;
    const results: any[] = [];

    // Load onboarding fee setting once
    const { data: settingsRow } = await supabaseAdmin
      .from("platform_settings")
      .select("onboarding_fee_cents")
      .limit(1)
      .single();
    const onboardingFeeCents = settingsRow?.onboarding_fee_cents ?? 200;

    for (const job of (jobs || [])) {
      if (!job.helper_id) continue;

      const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
      const perHelperBudget = job.budget / helpersCount;
      // Resolve the helper's live subscription tier at payout time; fall back to
      // the fee frozen on the job (or the legacy 10%) if the profile read fails.
      const jobHelperFeePercent = await getHelperFeePercent(
        supabaseAdmin,
        job.helper_id,
        job.helper_fee_percent ?? 10,
      );
      const helperCommission = (perHelperBudget * jobHelperFeePercent) / 100;
      let helperPayout = perHelperBudget - helperCommission + (job.urgent_fee ?? 0);

      // ── Step 1: Get helper's connected Stripe account & onboarding fee status ──
      const { data: helperProfile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id, onboarding_fee_paid")
        .eq("user_id", job.helper_id)
        .single();

      // First-payout onboarding fee — race-safe atomic claim BEFORE deducting.
      // The atomic UPDATE only flips the flag if it was still false at write
      // time, so two concurrent paths (e.g. checkout webhook + this cron)
      // can't both think they're collecting the fee. We deduct only if the
      // claim succeeds; otherwise the helper keeps their full payout.
      let owesOnboardingFee = false;
      let onboardingFeeDollars = 0;
      if (!helperProfile?.onboarding_fee_paid && onboardingFeeCents > 0) {
        const { data: claimed } = await supabaseAdmin
          .from("profiles")
          .update({
            onboarding_fee_paid: true,
            onboarding_fee_charged_at: new Date().toISOString(),
          })
          .eq("user_id", job.helper_id)
          .eq("onboarding_fee_paid", false)
          .select("user_id");

        if (claimed && claimed.length > 0) {
          owesOnboardingFee = true;
          onboardingFeeDollars = onboardingFeeCents / 100;
          helperPayout = Math.max(0, helperPayout - onboardingFeeDollars);
        }
        // Lost the race: another path collected the fee first; do not deduct.
      }

      if (helperPayout <= 0) {
        console.error(`Payout for job ${job.id} is $0 after onboarding fee — skipping transfer.`);
        results.push({ job_id: job.id, status: "zero_after_onboarding_fee" });
        continue;
      }

      if (!helperProfile?.stripe_account_id) {
        console.error(`Helper ${job.helper_id} has no Stripe Connect for job ${job.id}`);
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Payout account required",
          message: `$${helperPayout.toFixed(2)} from "${job.title}" is ready, but your payout account isn't set up yet. Add it in Profile → Payments.`,
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
        results.push({ job_id: job.id, status: "verify_error", error: (e as Error).message });
        continue;
      }

      // ── Step 4: Guard against duplicate transfers ──
      // release-payout (called by auto-release-payment Phase 2 or an admin)
      // and this cron both target the same payout_pending jobs. If they run
      // concurrently, the job's payment_status may not yet be flipped to
      // "released" when both read it, so both would pass the payment_status
      // filter above. They use DIFFERENT Stripe idempotency keys
      // ("release-payout-X" vs "scheduled-payout-X"), so Stripe would create
      // two distinct transfers — doubling the helper's payout. Checking
      // payout_transfers here closes the race window: if a row already exists
      // (pending or paid), the other path already sent the transfer and we skip.
      const { data: existingPayout } = await supabaseAdmin
        .from("payout_transfers")
        .select("stripe_transfer_id, status")
        .eq("job_id", job.id)
        .in("status", ["pending", "paid"])
        .maybeSingle();
      if (existingPayout) {
        console.log(`[process-scheduled-payouts] Payout already exists for job ${job.id} (${existingPayout.stripe_transfer_id}/${existingPayout.status}); skipping.`);
        results.push({ job_id: job.id, status: "already_transferred", transfer_id: existingPayout.stripe_transfer_id });
        continue;
      }

      // ── Step 5: Transfer to helper (charge is confirmed captured) ──
      // Re-use the PI object from Step 3 verification above (already retrieved)
      try {
        const transferParams: any = {
          amount: Math.round(helperPayout * 100),
          currency: "usd",
          destination: helperProfile.stripe_account_id,
          metadata: {
            job_id: job.id,
            helper_id: job.helper_id,
            scheduled_payout: "true",
            // Audit trail: $2 (or configured) one-time account setup fee deducted from this transfer.
            // The platform retains the fee on its Stripe balance — no separate charge needed because
            // the gross was already captured at job funding and we're transferring the net.
            onboarding_fee_cents: owesOnboardingFee ? String(onboardingFeeCents) : "0",
            onboarding_fee_first_payout: owesOnboardingFee ? "true" : "false",
          },
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

        // Idempotency key prevents double-pay if the cron fires twice before
        // the first run's payment_status flip is visible (overlapping runs,
        // retry on timeout). Stripe returns the existing transfer on a
        // duplicate call with the same key instead of creating a new one.
        const transfer = await stripe.transfers.create(transferParams, {
          idempotencyKey: `scheduled-payout-${job.id}`,
        });
        console.log(`Payout: $${helperPayout.toFixed(2)} to helper ${job.helper_id} for job ${job.id} (onboarding fee deducted: $${onboardingFeeDollars.toFixed(2)})`);

        // Write the payout_transfers ledger row immediately after the transfer
        // and BEFORE the payment_status flip. Without this, a crash between
        // stripe.transfers.create() and jobs.update() below leaves the job in
        // 'payout_pending' with no ledger row. On the next cron run,
        // release-payout's duplicate-transfer guard (which queries
        // payout_transfers) finds nothing and issues a second Stripe transfer
        // under a different idempotency key — doubling the payout.
        const { error: ledgerErr } = await supabaseAdmin
          .from("payout_transfers")
          .insert({
            job_id: job.id,
            helper_id: job.helper_id,
            stripe_transfer_id: transfer.id,
            stripe_account_id: helperProfile.stripe_account_id,
            amount_cents: Math.round(helperPayout * 100),
            platform_fee_cents: Math.round(helperCommission * 100),
            status: "pending",
            initiated_by: "system",
            metadata: {
              source: "scheduled_payout",
              onboarding_fee_cents: owesOnboardingFee ? onboardingFeeCents : 0,
            },
          });
        if (ledgerErr && (ledgerErr as any).code !== "23505") {
          // 23505 = unique_violation: idempotent retry returned the same transfer.id
          // (already logged on a previous partial run). Any other error is logged
          // loudly — the transfer already sent so the missing row needs manual fix.
          console.error(
            `[process-scheduled-payouts] Ledger insert failed for job ${job.id} (transfer ${transfer.id}):`,
            ledgerErr,
          );
        }

        const { error: statusUpdateErr } = await supabaseAdmin.from("jobs").update({
          payment_status: "released",
          helper_fee_percent: jobHelperFeePercent,
          platform_fee_amount: Math.round(perHelperBudget * jobHelperFeePercent) / 100,
        }).eq("id", job.id);
        if (statusUpdateErr) {
          // The Stripe transfer already succeeded — throwing here would wrongly
          // mark this job as transfer_failed. Log critically and alert ops so
          // the row can be manually flipped; the cron will retry idempotently
          // (same transfer key → Stripe dedupes, same ledger key → 23505 deduped).
          console.error(
            `[process-scheduled-payouts] CRITICAL: transfer sent but jobs.update failed for job ${job.id}:`,
            statusUpdateErr,
          );
          postSlackOpsAlert({
            kind: "payout_failed",
            severity: "critical",
            title: "Payout status flip failed — manual fix required",
            message: `Transfer sent to helper for job ${job.id} but \`payment_status\` could not be flipped to "released". Job is stuck in payout_pending — requires manual DB update.`,
            fields: {
              "Job ID": job.id,
              "Helpr ID": job.helper_id,
              Amount: `$${helperPayout.toFixed(2)}`,
              Error: (statusUpdateErr as Error)?.message?.slice(0, 200) ?? String(statusUpdateErr),
            },
            link: "https://www.louisianahelpr.com/admin?tab=payouts",
          });
        }

        // Note: the onboarding-fee flag was already flipped atomically
        // above, before the transfer ran, so no follow-up write is needed
        // here. Leaving this comment as a marker for the prior pattern.

        const feeNote = owesOnboardingFee
          ? ` (one-time $${onboardingFeeDollars.toFixed(2)} account setup fee deducted)`
          : "";
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "💰 Payout sent!",
          message: `$${helperPayout.toFixed(2)} for "${job.title}" has been transferred to your account${feeNote}.`,
          type: "payment", link: "/earnings",
        });

        processed++;
        results.push({ job_id: job.id, status: "transferred", amount: helperPayout, onboarding_fee_deducted: onboardingFeeDollars });
      } catch (e) {
        console.error(`Payout failed for job ${job.id}:`, e);
        results.push({ job_id: job.id, status: "transfer_failed", error: (e as Error).message });

        postSlackOpsAlert({
          kind: "payout_failed",
          severity: "critical",
          title: "Scheduled payout failed",
          message: `Failed to transfer *$${helperPayout.toFixed(2)}* to helpr for job ${job.id}.`,
          fields: {
            "Job ID": job.id,
            "Helpr ID": job.helper_id,
            Amount: `$${helperPayout.toFixed(2)}`,
            Error: (e as Error).message?.slice(0, 200),
          },
          link: "https://www.louisianahelpr.com/admin?tab=payouts",
        });

        const { data: adminRoles } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
        if (adminRoles) {
          for (const admin of adminRoles) {
            await supabaseAdmin.from("notifications").insert({
              user_id: admin.user_id,
              title: "⚠️ Scheduled payout failed",
              message: `Failed to pay $${helperPayout.toFixed(2)} to helpr for job ${job.id}. Error: ${(e as Error).message}`,
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
    console.error("[process-scheduled-payouts] fatal:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        detail: (error as Error).message,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
