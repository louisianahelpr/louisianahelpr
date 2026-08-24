import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getHelperFeePercent, helperCommissionDollars, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { netUrgentFeeDollars } from "../_shared/stripeFees.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { formatPayoutDollars } from "../_shared/money.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: jobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, urgent_fee, poster_completed_at, helper_completed_at, stripe_session_id, stripe_payment_intent_id, status, is_group_job, helpers_needed")
      .in("status", ["in_progress", "revision_requested", "accepted"])
      .eq("payment_status", "escrow")
      .or(`poster_completed_at.lte.${cutoff},helper_completed_at.lte.${cutoff}`);

    if (error) throw error;

    // ── Instant-release opt-in (owner, 2026-08-24) ──
    // Posters with profiles.auto_release_on_complete release on THIS pass
    // instead of waiting out the 24h window: pick up jobs the helper marked
    // done after the cutoff (i.e. not yet due), then keep only flagged
    // posters. Completion itself is DB-gated (photos + 30-min floor,
    // 20260824235000), so instant cannot mean ungated. Revision/dispute
    // rows are excluded the same way the main set excludes them — the
    // per-job guards below run for these rows too.
    const { data: recentDone, error: recentErr } = await supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, urgent_fee, poster_completed_at, helper_completed_at, stripe_session_id, stripe_payment_intent_id, status, is_group_job, helpers_needed")
      .eq("status", "in_progress")
      .eq("payment_status", "escrow")
      .is("poster_completed_at", null)
      .gt("helper_completed_at", cutoff);
    if (recentErr) {
      // Fail open to the normal 24h path — instant is an acceleration, never
      // a dependency.
      console.error("[auto-release-payment] instant-release candidate query failed:", recentErr);
    }
    const instantIds = new Set<string>();
    if (recentDone && recentDone.length > 0) {
      const posterIds = [...new Set(recentDone.map((j) => j.customer_id).filter(Boolean))];
      const { data: flagged, error: flagErr } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .in("user_id", posterIds)
        .eq("auto_release_on_complete", true);
      if (flagErr) {
        console.error("[auto-release-payment] instant-release flag query failed:", flagErr);
      } else {
        const flaggedSet = new Set((flagged || []).map((p) => p.user_id));
        for (const j of recentDone) {
          if (flaggedSet.has(j.customer_id)) {
            instantIds.add(j.id);
            (jobs || []).push(j);
          }
        }
      }
    }

    let released = 0;
    const results: any[] = [];

    for (const job of (jobs || [])) {
      // ── Step 0: Pay It Forward detection ──
      // A PIF-funded job has NO Stripe charge — it was funded from the
      // platform's prepaid balance when a redeemed pif_credit was applied.
      // Detect it via a redeemed credit pointing at this job so we can skip
      // the payment-intent resolution + capture verification (which would
      // otherwise dead-end at skipped_no_pi and strand the helper's money).
      // Fail closed on a read error: don't release without knowing.
      const { data: pifRow, error: pifErr } = await supabaseAdmin
        .from("pif_credits")
        .select("id")
        .eq("job_id", job.id)
        .eq("status", "redeemed")
        .limit(1)
        .maybeSingle();
      if (pifErr) {
        console.error(`[auto-release-payment] pif_credits check failed for job ${job.id}:`, pifErr);
        results.push({ job_id: job.id, status: "pif_check_error", error: pifErr.message });
        continue;
      }
      const isPifFunded = !!pifRow;

      // ── Step 1: Resolve payment intent ID (skipped for PIF — no charge) ──
      let paymentIntentId = job.stripe_payment_intent_id;

      if (!isPifFunded) {
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
          results.push({ job_id: job.id, status: "verify_failed", error: (e as Error).message });
          continue;
        }
      }

      // ── Step 3: Schedule the payout ──
      const payoutTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // Optimistic concurrency: guard on payment_status="escrow" so that if a
      // Stripe chargeback webhook fires between our read (above) and this write,
      // it can flip payment_status to "chargeback" before us. Without this WHERE
      // clause our UPDATE blindly overwrites "chargeback" with "payout_pending",
      // letting process-scheduled-payouts pay out a disputed/chargebacked job.
      const { data: claimed, error: releaseErr } = await supabaseAdmin
        .from("jobs")
        .update({ status: "completed", payment_status: "payout_pending", payout_scheduled_at: payoutTime })
        .eq("id", job.id)
        .eq("payment_status", "escrow")
        .select("id");
      if (releaseErr) {
        console.error(`[auto-release-payment] jobs.update failed for job ${job.id}:`, releaseErr);
        results.push({ job_id: job.id, status: "update_failed" });
        continue;
      }
      if (!claimed || claimed.length === 0) {
        console.log(`[auto-release-payment] job ${job.id} payment_status changed since read (chargeback race); skipping.`);
        results.push({ job_id: job.id, status: "skipped_status_changed" });
        continue;
      }

      // Estimate only — the real transfer in process-scheduled-payouts resolves
      // the tier again at payout time. Keep this preview consistent with it.
      // Group jobs: budget is the total for the roster; each helper earns budget/N.
      const helperFeePercent = await getHelperFeePercent(supabaseAdmin, job.helper_id, DEFAULT_TIER_FEE_PERCENT);
      const helpersCount = (job.is_group_job && job.helpers_needed > 0) ? job.helpers_needed : 1;
      const perHelperBudget = job.budget / helpersCount;
      // Same rounding as the path that actually pays, so the preview can never
      // quote a cent the transfer won't send.
      const helperCommission = helperCommissionDollars(perHelperBudget, helperFeePercent);
      const helperPayout = perHelperBudget - helperCommission + netUrgentFeeDollars(job.urgent_fee) / helpersCount;
      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Job auto-completed!",
          message: instantIds.has(job.id)
            ? `"${job.title}" is complete — the poster releases instantly. $${formatPayoutDollars(helperPayout)} will be transferred to your account in 24 hours.`
            : `"${job.title}" was auto-completed after 24 hours. $${formatPayoutDollars(helperPayout)} will be transferred to your account in 24 hours.`,
          type: "payment", link: "/my-jobs?filter=completed",
        });
      }
      if (job.customer_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Job auto-completed",
          message: instantIds.has(job.id)
            ? `"${job.title}" released instantly per your Instant Release setting. The Helpr will be paid in 24 hours.`
            : `"${job.title}" was automatically marked complete after 24 hours. The helpr will be paid in 24 hours.`,
          type: "info", link: "/my-posts?filter=completed",
        });
      }
      released++;
      results.push({ job_id: job.id, status: "released", paymentIntentId });
    }

    // ── Phase 2: Process payout_pending jobs whose 24h hold has elapsed ──
    // The block above sets jobs to payout_pending with payout_scheduled_at
    // = now + 24h. Once that window passes we invoke release-payout to
    // actually move money from the platform balance to the helper's
    // Connect account.
    //
    // Gated behind RELEASE_PAYOUT_AUTO=1 env var so the very first transfer
    // never happens automatically — flip the var to "1" in Supabase
    // Functions config only after a manual test transfer in Stripe test
    // mode confirms the full path works (validation → transfer →
    // payout_transfers row → notification). When disabled, this function
    // continues to do Phase 1 (escrow → payout_pending) so jobs still
    // queue up for payout, they just don't auto-fire.
    const autoPayoutEnabled = Deno.env.get("RELEASE_PAYOUT_AUTO") === "1";
    let paid = 0;
    const payoutResults: Array<{ job_id: string; status: string; detail?: string }> = [];

    if (autoPayoutEnabled) {
      const supabaseFnBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
      const { data: dueJobs, error: dueJobsErr } = await supabaseAdmin
        .from("jobs")
        .select("id, title, helper_id, payout_scheduled_at")
        .eq("status", "completed")
        .eq("payment_status", "payout_pending")
        .lte("payout_scheduled_at", new Date().toISOString());

      // A dropped read here silently returns paid=0 with no signal, leaving
      // matured payouts stranded until someone notices the money never moved.
      if (dueJobsErr) {
        console.error("[auto-release-payment] due-payouts query failed:", dueJobsErr);
        await postSlackOpsAlert({
          kind: "payout_failed",
          severity: "critical",
          title: "Auto-payout sweep could not read due jobs",
          message: "The scheduled auto-release run failed to query jobs due for payout. Matured payouts may be stranded until this is investigated.",
          fields: { db_error: dueJobsErr.message },
        });
      }

      for (const job of dueJobs ?? []) {
        try {
          const resp = await fetch(`${supabaseFnBase}/release-payout`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Always use the service role key here: release-payout has
              // verify_jwt=true, so Supabase validates the Authorization header
              // at the gateway before the function runs. Forwarding the incoming
              // authHeader works when the caller used the service role key, but
              // fails silently (401 before function code runs) when the caller
              // used CRON_SECRET — which is not a valid Supabase JWT. Using the
              // service role key directly guarantees the request is accepted.
              "Authorization": `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ job_id: job.id, initiated_by: "auto" }),
          });
          const json = await resp.json().catch(() => ({}));
          if (resp.ok) {
            paid++;
            payoutResults.push({ job_id: job.id, status: "paid", detail: json.stripe_transfer_id });
          } else {
            payoutResults.push({ job_id: job.id, status: "failed", detail: json.error ?? `HTTP ${resp.status}` });
          }
        } catch (e) {
          payoutResults.push({ job_id: job.id, status: "errored", detail: (e as Error).message });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        released, results,
        paid, payoutResults,
        autoPayoutEnabled,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("[auto-release-payment] fatal:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        detail: (error as Error).message,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
