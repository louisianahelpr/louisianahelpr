import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getHelperFeePercent, helperCommissionDollars, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { netUrgentFeeDollars } from "../_shared/stripeFees.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { formatPayoutDollars } from "../_shared/money.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Consecutive failed payout attempts on one job before this cron gives up.
 *
 * WHY A GIVE-UP EXISTS AT ALL. A single unpayable job used to be retried every
 * 30 minutes forever, and every retry answered HTTP 500, and
 * `sweep_cron_http_failures` pages Slack once per sweep that sees a new
 * failure. Measured 2026-08-31: 83 of this function's 257 recorded runs were
 * 500s, all of them the SAME job — a seed fixture whose helper never completed
 * Connect onboarding — for two solid days. The money alarm was permanently red,
 * which means a genuine payout failure would have arrived in a channel everyone
 * had already learned to ignore. That is precisely the alarm-fatigue outcome
 * the watcher's own comments were written to prevent.
 *
 * Five attempts at a 30-minute cadence is ~2.5 hours: long enough to ride out
 * a Stripe blip or a helper finishing onboarding, short enough that a genuinely
 * dead payout stops shouting the same sentence 48 times a day.
 *
 * GIVING UP IS NOT FORGETTING. Crossing the threshold pages ops ONCE and leaves
 * the job in `payout_pending`, where money-reconciliation's
 * `payout_pending_stranded` check reports it daily until a human resolves it.
 * An operator resumes it by clearing the failed `payout_transfers` rows for
 * that (job, helper) — set them to 'canceled' — or by invoking release-payout
 * directly, which has no give-up of its own.
 */
const GIVE_UP_AFTER_FAILED_ATTEMPTS = 5;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Declared before the config block so every failure path below — including
  // the two instant-release read failures that deliberately fail open — has
  // somewhere to record itself.
  const defects = defectTracker();

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

    // ── Seed fixtures are out of scope for the real money paths ──────────────
    // `jobs.is_seed` marks fixture / E2E rows. They are settled by harnesses and
    // replay scripts, so they sit in states the real settlement paths can never
    // resolve — a helper with no Connect account, a job with no payment intent —
    // and they fail here forever, legitimately.
    //
    // money-reconciliation:249 already scopes itself this way for exactly this
    // reason ("Alerting on them would train everyone to ignore this alarm inside
    // a week"). This function had no such filter, and the cost was measured:
    // ONE seed job produced 83 HTTP 500s over two days and saturated the money
    // alarm. Same escape hatch as the reconciler — `?include_seed=1` for a
    // deliberate manual run against fixtures.
    const includeSeed = new URL(req.url).searchParams.get("include_seed") === "1";

    let dueQuery = supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, urgent_fee, poster_completed_at, helper_completed_at, stripe_session_id, stripe_payment_intent_id, status, is_group_job, helpers_needed")
      .in("status", ["in_progress", "revision_requested", "accepted"])
      .eq("payment_status", "escrow")
      // A requested revision STOPS the payout clock. The 24h window is keyed on
      // helper_completed_at/poster_completed_at, and asking for a revision
      // resets neither — CompletionChoiceSheet writes only status,
      // revision_note and revision_requested_at. So a poster who requested a
      // revision 23 hours after the helper marked done had the job
      // auto-completed and paid out minutes later, against a UI that had just
      // promised them a 72-hour fix window and "Payment stays held until you
      // confirm" (HelperRevisionCard). They paid in full for work they had
      // formally sent back.
      //
      // Same guard sweep_release_last_chance (20260824263000) already uses, and
      // its existence is the tell: that sweep deliberately skips revision jobs
      // when sending the "releases in ~2 hours" warning, so the one poster who
      // most needed the nudge was also the only one guaranteed not to get it.
      // If revision jobs should ever settle on their own, that needs its own
      // pass keyed on revision_deadline — not this one.
      .is("revision_requested_at", null)
      .or(`poster_completed_at.lte.${cutoff},helper_completed_at.lte.${cutoff}`);
    if (!includeSeed) dueQuery = dueQuery.eq("is_seed", false);
    const { data: jobs, error } = await dueQuery;

    if (error) throw error;

    // ── Instant-release opt-in (owner, 2026-08-24) ──
    // Posters with profiles.auto_release_on_complete release on THIS pass
    // instead of waiting out the 24h window: pick up jobs the helper marked
    // done after the cutoff (i.e. not yet due), then keep only flagged
    // posters. Completion itself is DB-gated (photos + 30-min floor,
    // 20260824235000), so instant cannot mean ungated. Revision/dispute
    // rows are excluded the same way the main set excludes them — the
    // per-job guards below run for these rows too.
    let recentQuery = supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, urgent_fee, poster_completed_at, helper_completed_at, stripe_session_id, stripe_payment_intent_id, status, is_group_job, helpers_needed")
      .eq("status", "in_progress")
      .eq("payment_status", "escrow")
      .is("poster_completed_at", null)
      .gt("helper_completed_at", cutoff);
    if (!includeSeed) recentQuery = recentQuery.eq("is_seed", false);
    const { data: recentDone, error: recentErr } = await recentQuery;
    if (recentErr) {
      // Fail open to the normal 24h path — instant is an acceleration, never
      // a dependency.
      console.error("[auto-release-payment] instant-release candidate query failed:", recentErr);
      defects.record(`instant-release candidate query: ${recentErr.message}`);
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
        defects.record(`instant-release flag query: ${flagErr.message}`);
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
    const payoutResults: Array<{
      job_id: string;
      status: string;
      detail?: string;
      attempt?: number;
      /** True only on the run that crossed the give-up threshold — see below. */
      gave_up?: boolean;
    }> = [];

    if (autoPayoutEnabled) {
      const supabaseFnBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
      // Same seed exclusion as Phase 1, and THIS is the query that was actually
      // producing the 500 loop: the fixture sat in payout_pending, so it was
      // re-selected here every 30 minutes and handed to release-payout, which
      // refused it every time with "helper has not completed Stripe Connect
      // onboarding".
      let dueQuery2 = supabaseAdmin
        .from("jobs")
        .select("id, title, helper_id, budget, urgent_fee, is_group_job, helpers_needed, payout_scheduled_at")
        .eq("status", "completed")
        .eq("payment_status", "payout_pending")
        .lte("payout_scheduled_at", new Date().toISOString());
      if (!includeSeed) dueQuery2 = dueQuery2.eq("is_seed", false);
      const { data: dueJobs, error: dueJobsErr } = await dueQuery2;

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
        defects.record(`due-payouts query: ${dueJobsErr.message}`);
      }

      // ── How many times has each due payout already failed? ────────────────
      // One batched read rather than one per job. `payout_transfers` rows with
      // status='failed' are the durable attempt record: release-payout writes
      // one when stripe.transfers.create throws, and this function writes one
      // below when release-payout REFUSED before ever reaching Stripe (a 409
      // for a missing Connect account leaves no row of its own). Both are
      // failed attempts on the same payout, and both count toward the give-up.
      const dueJobIds = (dueJobs ?? []).map((j) => j.id);
      const failedAttempts = new Map<string, number>();
      if (dueJobIds.length > 0) {
        const { data: attemptRows, error: attemptsErr } = await supabaseAdmin
          .from("payout_transfers")
          .select("job_id")
          .in("job_id", dueJobIds)
          .eq("status", "failed");
        if (attemptsErr) {
          // Fail OPEN on this one read: the give-up is a noise control, not a
          // safety guard, and refusing to attempt payouts because we could not
          // count past failures would turn a logging problem into unpaid
          // helpers. Every real safety check still runs inside release-payout.
          console.error("[auto-release-payment] failed-attempt count read failed:", attemptsErr);
          defects.record(`failed-attempt count read: ${attemptsErr.message}`);
        } else {
          for (const r of attemptRows ?? []) {
            const k = r.job_id as string;
            failedAttempts.set(k, (failedAttempts.get(k) ?? 0) + 1);
          }
        }
      }

      /**
       * Record one failed attempt on a job whose payout release-payout refused.
       *
       * `payout_transfers` requires amount_cents > 0, so the row carries this
       * function's own estimate of the payout — the same figure it already
       * quotes to the helper in Phase 1. `stripe_transfer_id` and
       * `stripe_account_id` are NULL, which since migration 20260831190418 is
       * the honest encoding of "no Stripe object was ever created, and there
       * may not even be an account to send to".
       */
      const recordFailedAttempt = async (
        job: { id: string; helper_id: string | null; budget: number | null; urgent_fee: number | null; is_group_job: boolean | null; helpers_needed: number | null },
        detail: string,
        attemptNumber: number,
      ) => {
        if (!job.helper_id) return;
        const n = (job.is_group_job && (job.helpers_needed ?? 0) > 0) ? job.helpers_needed as number : 1;
        const estimateCents = Math.max(
          1,
          Math.round(((Number(job.budget ?? 0) / n) + netUrgentFeeDollars(job.urgent_fee) / n) * 100),
        );
        const { error: attemptErr } = await supabaseAdmin.from("payout_transfers").insert({
          job_id: job.id,
          helper_id: job.helper_id,
          stripe_transfer_id: null,
          stripe_account_id: null,
          amount_cents: estimateCents,
          platform_fee_cents: 0,
          status: "failed",
          failed_at: new Date().toISOString(),
          failure_reason: detail.slice(0, 500),
          initiated_by: "auto",
          metadata: { source: "auto-release-payment", attempt: attemptNumber, no_transfer_created: true },
        });
        if (attemptErr) {
          console.error(`[auto-release-payment] could not record failed attempt for job ${job.id}:`, attemptErr);
          defects.record(`record failed attempt ${job.id}: ${attemptErr.message}`);
        }
      };

      for (const job of dueJobs ?? []) {
        // ── Give up rather than page 48 times a day about the same job ──────
        const priorFailures = failedAttempts.get(job.id) ?? 0;
        if (priorFailures >= GIVE_UP_AFTER_FAILED_ATTEMPTS) {
          // An OUTCOME, not a defect: this is the noise control working. It
          // must never contribute to the defect count, or giving up would
          // itself keep the alarm red — the precise failure being fixed.
          payoutResults.push({
            job_id: job.id,
            status: "given_up",
            detail: `${priorFailures} failed attempts recorded; not retrying. Clear the failed payout_transfers rows for this job (set them to 'canceled') or invoke release-payout directly to resume.`,
          });
          continue;
        }

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
            const detail = json.error ?? `HTTP ${resp.status}`;
            // release-payout writes its own failed row only when
            // stripe.transfers.create THREW. A refusal before that point (no
            // Connect account, an inactive account, an uncaptured charge)
            // leaves no record at all, which is why this job could fail 83
            // times and the ledger still held one row. Re-read the count and
            // write our own row only if release-payout did not, so a single
            // failure is never counted twice.
            const { count: nowFailed, error: recountErr } = await supabaseAdmin
              .from("payout_transfers")
              .select("id", { count: "exact", head: true })
              .eq("job_id", job.id)
              .eq("status", "failed");
            const alreadyRecorded = !recountErr && (nowFailed ?? 0) > priorFailures;
            const attemptNumber = priorFailures + 1;
            if (!alreadyRecorded) {
              await recordFailedAttempt(job, detail, attemptNumber);
            }

            // Page ONCE, on the run that crosses the threshold — not on every
            // one of the 48 daily retries that came before it.
            if (attemptNumber >= GIVE_UP_AFTER_FAILED_ATTEMPTS) {
              await postSlackOpsAlert({
                kind: "payout_failed",
                severity: "critical",
                title: "Payout given up after repeated failures",
                message:
                  `Job ${job.id} has failed ${attemptNumber} payout attempts and will no longer be retried automatically. ` +
                  `It stays in payout_pending and money-reconciliation will keep reporting it once a day until it is resolved. ` +
                  `To resume: fix the underlying cause, set this job's failed payout_transfers rows to 'canceled', and the next run will retry.`,
                fields: {
                  "Job ID": job.id,
                  "Job title": job.title ?? "—",
                  "Helper ID": job.helper_id ?? "—",
                  Attempts: String(attemptNumber),
                  "Last error": String(detail).slice(0, 200),
                },
                link: "https://www.louisianahelpr.com/admin?tab=payouts",
              });
            }

            payoutResults.push({
              job_id: job.id,
              status: "failed",
              detail,
              attempt: attemptNumber,
              gave_up: attemptNumber >= GIVE_UP_AFTER_FAILED_ATTEMPTS,
            });
          }
        } catch (e) {
          payoutResults.push({ job_id: job.id, status: "errored", detail: (e as Error).message });
        }
      }
    }

    // Which of these statuses are DEFECTS, and which are the guards working:
    //   verify_failed  — the Stripe call threw. Defect.
    //   update_failed  — the escrow release UPDATE was rejected. Defect, and
    //                    money-critical: the job stays in escrow silently.
    //   skipped_no_pi / pi_status_* / skipped_status_changed — outcomes. The
    //                    last one is the chargeback race being caught correctly,
    //                    which must never page.
    // Payout attempts that came back not-ok or threw mean a MATURED payout did
    // not move. That is the single most expensive thing this function can fail
    // at silently, so it counts even though release-payout may have declined it
    // for a reason of its own.
    for (const r of results) {
      if (r.status === "verify_failed" || r.status === "update_failed") {
        defects.record(`${r.status} ${r.job_id}${r.error ? `: ${r.error}` : ""}`);
      }
    }
    // A matured payout that did not move is a defect and must page — for the
    // first few attempts. Two outcomes are deliberately excluded:
    //
    //   given_up  — the job is no longer being attempted. It is reported once
    //               (Slack, above) and then by money-reconciliation daily. If
    //               it counted here, the give-up would keep the alarm red
    //               forever, which is the exact thing it exists to stop.
    //   gave_up   — the run that CROSSED the threshold already sent its own
    //               explicit, actionable Slack message. Counting it too would
    //               page twice for one event.
    for (const p of payoutResults) {
      if ((p.status === "failed" || p.status === "errored") && !p.gave_up) {
        defects.record(`payout ${p.status} ${p.job_id}: ${p.detail ?? ""}`);
      }
    }

    return cronResult(
      "auto-release-payment",
      { success: true, released, results, paid, payoutResults, autoPayoutEnabled },
      defects.defects,
      corsHeaders,
    );
  } catch (error) {
    console.error("[auto-release-payment] fatal:", error);
    return cronError("auto-release-payment", "Internal server error", corsHeaders);
  }
});
