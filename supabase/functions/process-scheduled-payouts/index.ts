import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getHelperFeePercent } from "../_shared/helperFees.ts";
import { netUrgentFeeDollars } from "../_shared/stripeFees.ts";

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
      .is("disputed_at", null)          // defense-in-depth: never pay out disputed jobs
      .lte("payout_scheduled_at", now);

    if (error) throw error;

    let processed = 0;
    const results: any[] = [];

    // Load onboarding fee setting once. A dropped error here previously
    // defaulted to a hardcoded 200 (¢) — if the real configured fee differs,
    // that silently over/under-charges every payout in the run. On a read
    // failure, skip the deduction entirely (0): under-charging is recoverable
    // (onboarding_fee_paid stays false, so it's collected next run) whereas
    // over-charging on a bad read is not.
    const { data: settingsRow, error: settingsErr } = await supabaseAdmin
      .from("platform_settings")
      .select("onboarding_fee_cents")
      .limit(1)
      .single();
    if (settingsErr || settingsRow?.onboarding_fee_cents == null) {
      console.error("[process-scheduled-payouts] platform_settings read failed — skipping onboarding-fee deduction this run:", settingsErr);
    }
    const onboardingFeeCents = settingsErr ? 0 : (settingsRow?.onboarding_fee_cents ?? 0);

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
      // Urgent fee is collected from the poster ONCE → split across the roster
      // like the budget, else each of N helpers is paid the full urgent bonus
      // against a single fee collected and the platform over-pays N×.
      let helperPayout = perHelperBudget - helperCommission + netUrgentFeeDollars(job.urgent_fee) / helpersCount;

      // ── Step 1: Get helper's connected Stripe account & onboarding fee status ──
      const { data: helperProfile, error: helperProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id, onboarding_fee_paid")
        .eq("user_id", job.helper_id)
        .single();
      if (helperProfileErr) {
        // Fail closed: a transient DB read error must not masquerade as "helper
        // never set up their payout account" (which would fire a misleading
        // notification and permanently stall the payout until manual intervention).
        console.error(`[process-scheduled-payouts] helper profile read failed for ${job.helper_id} (job ${job.id}):`, helperProfileErr);
        results.push({ job_id: job.id, status: "helper_profile_read_error", error: helperProfileErr.message });
        continue;
      }

      // NOTE: the one-time onboarding-fee claim is deliberately deferred to
      // just before the transfer (Step 5 below), NOT here. Every viability
      // check between this point and the transfer (`continue`s for no Connect
      // account, missing/failed payment intent, ledger read error, an
      // already-existing transfer) must run BEFORE the flag is flipped —
      // otherwise a skip-after-claim would orphan `onboarding_fee_paid=true`
      // with no money moved, and the retry would read it as paid and never
      // collect the $2. Claiming immediately before the transfer leaves the
      // transfer-failure catch as the sole post-claim exit, which rolls back.
      let owesOnboardingFee = false;
      let onboardingFeeDollars = 0;

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

      // ── Detect Pay It Forward funding ──
      // A PIF-redeemed job was funded from the prepaid platform balance (the
      // donor's captured gift), not from a poster charge on THIS job. There is
      // either no payment intent (gift fully covered the budget) or one that
      // only covers the shortfall — so the normal "resolve PI → verify captured
      // → link source_transaction" path doesn't apply. We pay the helper from
      // the platform balance with a plain transfer instead. Detected by a
      // redeemed credit pointing at this job (set by redeem_pif_credit or the
      // difference-payment webhook).
      const { data: pifRow, error: pifErr } = await supabaseAdmin
        .from("pif_credits")
        .select("id")
        .eq("job_id", job.id)
        .eq("status", "redeemed")
        .limit(1)
        .maybeSingle();
      if (pifErr) {
        // Fail closed: if we can't tell whether this is PIF-funded, don't risk
        // paying out against an unverified charge — defer to the next run.
        console.error(`[process-scheduled-payouts] pif_credits read failed for job ${job.id}:`, pifErr);
        results.push({ job_id: job.id, status: "pif_check_error", error: pifErr.message });
        continue;
      }
      const isPifFunded = !!pifRow;

      // ── Step 2: Resolve payment intent ID (skipped for PIF — no poster charge) ──
      let paymentIntentId = job.stripe_payment_intent_id;
      if (!isPifFunded) {
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
      }

      // ── Step 4: Guard against duplicate transfers ──
      // release-payout (called by auto-release-payment Phase 2 or an admin)
      // and this cron both target the same payout_pending jobs. If they run
      // concurrently, the job's payment_status may not yet be flipped to
      // "released" when both read it, so both would pass the payment_status
      // filter above. They use DIFFERENT Stripe idempotency keys
      // ("release-payout-X" vs "scheduled-payout-X"), so Stripe would create
      // two distinct transfers — doubling the helper's payout. Checking
      // payout_transfers here closes the race window. Fetch ALL ledger rows
      // for the job once and derive two things:
      //  - blocking rows: pending/paid (transfer already sent) and reversed
      //    (money moved once and was clawed back — re-paying is a human
      //    decision; an operator signals it by setting the row to
      //    'reversal_cleared', which doesn't block). Mirrors release-payout.
      //  - failedCount: number of prior FAILED attempts, used to salt the
      //    Stripe idempotency key below.
      const { data: ledgerRows, error: ledgerReadErr } = await supabaseAdmin
        .from("payout_transfers")
        .select("stripe_transfer_id, status")
        .eq("job_id", job.id);
      if (ledgerReadErr) {
        // Fail closed: without the ledger we can't rule out a prior transfer.
        console.error(`[process-scheduled-payouts] payout_transfers read failed for job ${job.id}:`, ledgerReadErr);
        results.push({ job_id: job.id, status: "ledger_read_error", error: ledgerReadErr.message });
        continue;
      }
      const blockingPayout = (ledgerRows ?? []).find((r) =>
        ["pending", "paid", "reversed"].includes(r.status)
      );
      if (blockingPayout) {
        console.log(`[process-scheduled-payouts] Payout already exists for job ${job.id} (${blockingPayout.stripe_transfer_id}/${blockingPayout.status}); skipping.`);
        results.push({ job_id: job.id, status: "already_transferred", transfer_id: blockingPayout.stripe_transfer_id });
        continue;
      }
      const failedCount = (ledgerRows ?? []).filter((r) => r.status === "failed").length;

      // ── Onboarding-fee claim (deferred to HERE, immediately before the
      // transfer) ──
      // Every viability `continue` above (no Connect account, no/failed PI,
      // verify error, ledger read error, already-transferred) runs BEFORE
      // this point, so a skip can no longer orphan the claim. Race-safe
      // atomic claim: the conditional `.eq("onboarding_fee_paid", false)`
      // guarantees exactly one concurrent path (this cron, release-payout,
      // or create-payment) wins the $2. From here the ONLY post-claim exits
      // are the `helperPayout <= 0` guard and the transfer-failure catch —
      // both roll the claim back.
      if (!helperProfile.onboarding_fee_paid && onboardingFeeCents > 0) {
        const { data: claimed, error: claimErr } = await supabaseAdmin
          .from("profiles")
          .update({
            onboarding_fee_paid: true,
            onboarding_fee_charged_at: new Date().toISOString(),
          })
          .eq("user_id", job.helper_id)
          .eq("onboarding_fee_paid", false)
          .select("user_id");
        if (claimErr) {
          // Fail closed BEFORE the transfer — treating a failed claim as
          // "lost the race" would silently skip collecting the fee forever.
          console.error(`[process-scheduled-payouts] onboarding-fee claim failed for ${job.helper_id} (job ${job.id}):`, claimErr);
          results.push({ job_id: job.id, status: "onboarding_fee_claim_error", error: claimErr.message });
          continue;
        }
        if (claimed && claimed.length > 0) {
          if (helperPayout * 100 <= onboardingFeeCents) {
            // Claim succeeded but this payout is too small to cover the fee.
            // Roll the claim back and skip so the flag doesn't lie, and a
            // future (larger) payout — or manual reconciliation — collects it.
            const { error: rollbackErr } = await supabaseAdmin
              .from("profiles")
              .update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
              .eq("user_id", job.helper_id);
            if (rollbackErr) {
              console.error(
                `CRITICAL: [process-scheduled-payouts] payout too small AND onboarding-fee rollback failed for ${job.helper_id} (job ${job.id}) — onboarding_fee_paid is incorrectly true but the fee was NOT collected; manual reconciliation needed:`,
                rollbackErr,
              );
            }
            results.push({ job_id: job.id, status: "payout_below_onboarding_fee", skipped: true });
            continue;
          }
          onboardingFeeDollars = onboardingFeeCents / 100;
          helperPayout -= onboardingFeeDollars;
          owesOnboardingFee = true;
        }
        // else: lost the race — flag flipped between read and claim. Don't deduct.
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

        // Link to source charge for clean reporting — use PI from Step 3.
        // Pay It Forward jobs are funded from the platform's prepaid balance
        // (the donation was captured at donate time), so there is NO per-job
        // charge to link. Setting source_transaction here would cap the
        // transfer at that (nonexistent/zero) charge — so skip it for PIF and
        // let the transfer draw from the platform balance.
        if (!isPifFunded && paymentIntentId) {
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
        }

        // Idempotency key prevents double-pay if the cron fires twice before
        // the first run's payment_status flip is visible (overlapping runs,
        // retry on timeout). Stripe returns the existing transfer on a
        // duplicate call with the same key instead of creating a new one.
        // Salt the key with the count of prior FAILED attempts: Stripe's
        // idempotency window (~24h) replays the ORIGINAL response for a key —
        // including a failed transfer. When transferFailed resets the job to
        // payout_pending for retry, an unsalted key would replay the same
        // failure, yet the code below would still flip the job "released" and
        // send a false "Payout sent!" notification. A fresh key per retry
        // makes the retry a real new transfer attempt. First attempt keeps
        // the legacy unsalted key so in-flight dedupe against older runs holds.
        const idempotencyKey = failedCount > 0
          ? `scheduled-payout-${job.id}-r${failedCount}`
          : `scheduled-payout-${job.id}`;
        const transfer = await stripe.transfers.create(transferParams, {
          idempotencyKey,
        });
        console.log(`Payout: $${helperPayout.toFixed(2)} to helper ${job.helper_id} for job ${job.id} (onboarding fee deducted: $${onboardingFeeDollars.toFixed(2)})`);

        // Write the payout_transfers ledger row immediately after the transfer
        // and BEFORE the payment_status flip. Without this, a crash between
        // stripe.transfers.create() and jobs.update() below leaves the job in
        // 'payout_pending' with no ledger row. On the next cron run,
        // release-payout's duplicate-transfer guard (which queries
        // payout_transfers) finds nothing and issues a second Stripe transfer
        // under a different idempotency key — doubling the payout.
        // Insert as "paid" immediately: Stripe marketplace transfers settle
        // synchronously on creation. The transfer.created webhook handler also
        // tries to flip this row from "pending" → "paid", but it can fire before
        // this insert executes, leaving the row stuck at "pending" forever with no
        // future event to fix it. Inserting as "paid" upfront eliminates that race.
        const { error: ledgerErr } = await supabaseAdmin
          .from("payout_transfers")
          .insert({
            job_id: job.id,
            helper_id: job.helper_id,
            stripe_transfer_id: transfer.id,
            stripe_account_id: helperProfile.stripe_account_id,
            amount_cents: Math.round(helperPayout * 100),
            platform_fee_cents: Math.round(helperCommission * 100),
            status: "paid",
            paid_at: new Date().toISOString(),
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

        // Un-claim the onboarding fee if THIS job claimed it. The atomic claim
        // above flipped the flag to true BEFORE the transfer; the transfer
        // failed, so no money moved and the fee was never collected. Leaving
        // the flag true would make the retry (which re-reads onboarding_fee_paid
        // as already-paid) skip the deduction, silently losing the fee. The
        // atomic claim guarantees sole ownership, so this rollback is safe.
        if (owesOnboardingFee) {
          const { error: unclaimErr } = await supabaseAdmin
            .from("profiles")
            .update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
            .eq("user_id", job.helper_id);
          if (unclaimErr) {
            console.error(
              `CRITICAL: [process-scheduled-payouts] transfer failed AND onboarding-fee un-claim failed for ${job.helper_id} (job ${job.id}) — onboarding_fee_paid is incorrectly true but the fee was NOT collected; manual reconciliation needed:`,
              unclaimErr,
            );
          }
        }

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
