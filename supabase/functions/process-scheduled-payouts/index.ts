import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getHelperFeePercent, helperCommissionDollars, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { netUrgentFeeDollars } from "../_shared/stripeFees.ts";
import { loadAdminIds } from "../_shared/adminIds.ts";
import { formatPayoutDollars } from "../_shared/money.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { claimPayout, failClaim, settleClaim } from "../_shared/payoutClaim.ts";

/**
 * Job payment states this cron may legitimately walk forward to 'released'.
 *
 * 'payout_pending' is the normal one; 'released' stays in the set so a resumed
 * run is a clean no-op. Everything else — and 'chargeback' above all — means
 * something else owns this job's money now. Without this precondition the flip
 * below could overwrite a webhook-set 'chargeback' with 'released', which is
 * the exact hazard auto-release-payment:195-198 documents and guards against
 * on the escrow side.
 */
const RELEASABLE_PAYMENT_STATES = ["payout_pending", "released"] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Defects are things that BROKE (a read rejected, a write refused, a transfer
  // that threw) — never business outcomes like "this helper has no Connect
  // account", which are permanent facts that would page forever. See
  // _shared/cron-result.ts.
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
    // The `||` tail is logically redundant with `missing.length` — it is spelled
    // out so the compiler can narrow the three consts to `string` below. Without
    // it `createClient(supabaseUrl, serviceRoleKey)` and `new Stripe(key)` are
    // called with `string | undefined` as far as the types are concerned, which
    // is exactly the shape that hides a real missing-config crash.
    if (missing.length || !supabaseUrl || !stripeSecretKey || !serviceRoleKey) {
      throw new Error(`Missing required env vars: ${missing.join(", ")}`);
    }

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

    // Seed fixtures are settled by harnesses and replay scripts, never by the
    // real money paths, so they fail here forever and legitimately. Excluding
    // them is the precedent money-reconciliation:249 already set
    // (`if (!includeSeed) jobQuery = jobQuery.eq("is_seed", false)`), and it is
    // not cosmetic: one unpayable fixture drove auto-release-payment to HTTP
    // 500 on 83 of its last 257 runs, every 30 minutes for two days, saturating
    // the money alarm until a genuine payout failure would have landed in a
    // channel everyone had learned to ignore. `?include_seed=1` restores the
    // old behaviour for a manual run against fixtures.
    const includeSeed = new URL(req.url).searchParams.get("include_seed") === "1";
    let jobQuery = supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, helper_fee_percent, urgent_fee, stripe_session_id, stripe_payment_intent_id, status, is_group_job, helpers_needed, sales_tax_rate")
      .eq("status", "completed")
      .eq("payment_status", "payout_pending")
      .is("disputed_at", null)          // defense-in-depth: never pay out disputed jobs
      .lte("payout_scheduled_at", now);
    if (!includeSeed) jobQuery = jobQuery.eq("is_seed", false);
    const { data: jobs, error } = await jobQuery;

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

    // ── Fan out group jobs across their roster ──────────────────────────────
    // A group job holds ONE escrow for the whole job and splits it across N
    // helpers at completion (the per-helper math below already divides by
    // helpers_needed). But this loop used to resolve exactly one helper —
    // `jobs.helper_id` — so on a 3-helper job only the lead was ever paid and
    // the other two worked for nothing while their share sat on the platform
    // balance. Flatten to one entry per (job, helper) so each roster member
    // gets their own transfer, ledger row, and idempotency key.
    //
    // Iterating pairs rather than jobs also means every `continue` below still
    // reads as "skip this payout and move on", which gives partial-failure
    // isolation for free: one helper's missing Connect account can't block the
    // rest of the roster from being paid.
    const payoutTargets: { job: typeof jobs[number]; helperId: string }[] = [];
    // How many helpers this job will ACTUALLY be paid out to, keyed by job id.
    //
    // This is not the same number as `helpers_needed`, and conflating the two
    // strands money and wedges the job. `helpers_needed` is what the poster
    // asked for and what the escrow was split into; the roster is who turned
    // up. `accept_group_application` keeps the job 'open' until the roster is
    // full, but a roster row can still be removed while it is staffing, and a
    // legacy group job may have no roster at all — so an UNDER-FILLED group
    // job can reach 'completed'. When it does:
    //
    //   * every roster member is correctly paid `budget / helpers_needed`,
    //     which is exactly the 1/N share they accepted, and
    //   * the release check below used to require
    //     `distinctPaid >= helpers_needed`, a threshold an under-filled roster
    //     can never reach — so the job sat in `payout_pending` forever, was
    //     re-swept every hour, and the unallocated remainder of the escrow was
    //     never surfaced to anyone.
    //
    // Counting against the roster releases the job once everyone who is owed
    // has been paid, and the alert below makes the leftover escrow visible so
    // it can be refunded to the poster instead of resting on the platform
    // balance in silence.
    const rosterSizeByJob = new Map<string, number>();
    for (const job of (jobs || [])) {
      if (job.is_group_job) {
        const { data: roster, error: rosterErr } = await supabaseAdmin
          .from("group_job_helpers")
          .select("helper_id")
          .eq("job_id", job.id);
        if (rosterErr) {
          // Fail closed for this job only: paying just the lead helper off a
          // partial view of the roster is exactly the bug being fixed.
          console.error(`[process-scheduled-payouts] roster read failed for group job ${job.id}:`, rosterErr);
          results.push({ job_id: job.id, status: "roster_read_error", error: rosterErr.message });
          defects.record(`roster read ${job.id}: ${rosterErr.message}`);
          continue;
        }
        const rosterIds = (roster ?? []).map((r) => r.helper_id).filter(Boolean);
        if (rosterIds.length === 0) {
          // Roster empty but the job completed — fall back to the lead helper
          // so a legacy group job (created before the roster existed) still
          // pays someone rather than silently paying nobody.
          if (job.helper_id) {
            payoutTargets.push({ job, helperId: job.helper_id });
            rosterSizeByJob.set(job.id, 1);
          } else {
            // Empty roster AND no lead helper. `jobs.helper_id` is nullable and
            // is actively NULLed by the account-deletion purge (migration
            // 20260901033011 re-points the FK to ON DELETE SET NULL), so this
            // is reachable, not defensive. Refuse to pay — there is nobody to
            // pay — but SAY SO: this used to be a bare `continue`, which left
            // the job in payout_pending forever with no log, no `results`
            // entry, and therefore invisible to sweep_silent_cron_failures.
            console.error(
              `[process-scheduled-payouts] group job ${job.id} has an empty roster AND no lead helper_id (helper account deleted?) — nobody can be paid; escrow is held.`,
            );
            results.push({ job_id: job.id, status: "no_payable_helper", skipped: true });
          }
          continue;
        }
        const distinctRoster = new Set(rosterIds);
        rosterSizeByJob.set(job.id, distinctRoster.size);
        if (distinctRoster.size < (job.helpers_needed ?? 1)) {
          // Page, but do NOT skip. Everyone on the roster still gets the share
          // they agreed to; what needs a human is the slice of escrow that
          // belongs to a slot nobody filled, which no automatic path can
          // decide the destination of (refund to the poster vs. redistribute
          // is a product/contract call, not a cron's).
          console.error(
            `[process-scheduled-payouts] group job ${job.id} is under-filled: ${distinctRoster.size} of ${job.helpers_needed} slots. Paying the roster; the remaining share is unallocated.`,
          );
          await postSlackOpsAlert({
            kind: "payout_failed",
            severity: "warning",
            title: "Under-filled group job paid out — escrow remainder unallocated",
            message:
              "A group job completed with fewer helpers on its roster than it was funded for. Every roster member is being paid their agreed budget/helpers_needed share, but the unfilled slot's share stays on the platform balance and needs a decision (refund the poster, or redistribute).",
            fields: {
              "Job ID": job.id,
              "Roster size": String(distinctRoster.size),
              "Helpers needed": String(job.helpers_needed ?? 1),
              "Unallocated share":
                `${(job.helpers_needed ?? 1) - distinctRoster.size}/${job.helpers_needed ?? 1} of $${Number(job.budget ?? 0).toFixed(2)}`,
            },
            link: "https://www.louisianahelpr.com/admin?tab=payouts",
          });
        }
        for (const helperId of distinctRoster) payoutTargets.push({ job, helperId });
      } else if (job.helper_id) {
        payoutTargets.push({ job, helperId: job.helper_id });
      } else {
        // Same reachable NULL, same rule: refuse rather than guess a recipient.
        // Also previously a silent fall-through with no `results` entry.
        console.error(
          `[process-scheduled-payouts] job ${job.id} is payout_pending with a NULL helper_id (helper account deleted?) — refusing to pay; escrow is held.`,
        );
        results.push({ job_id: job.id, status: "no_payable_helper", skipped: true });
      }
    }

    for (const { job, helperId } of payoutTargets) {
      const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
      const perHelperBudget = job.budget / helpersCount;
      // Resolve the helper's live subscription tier at payout time; fall back to
      // the fee frozen on the job, then to the platform default, if the profile
      // read fails. The default is 12 (free tier), not the legacy 10 — a wrong
      // fallback under-collects $4 on a $200 job (see helperFees.ts).
      const jobHelperFeePercent = await getHelperFeePercent(
        supabaseAdmin,
        helperId,
        job.helper_fee_percent ?? DEFAULT_TIER_FEE_PERCENT,
      );
      // Shared with release-payout. This used to be an unrounded
      // (perHelperBudget * pct) / 100, which disagreed with that path by a
      // cent on 2,243 (budget, tier) pairs under $200.
      const helperCommission = helperCommissionDollars(perHelperBudget, jobHelperFeePercent);
      // Urgent fee is collected from the poster ONCE → split across the roster
      // like the budget, else each of N helpers is paid the full urgent bonus
      // against a single fee collected and the platform over-pays N×.
      let helperPayout = perHelperBudget - helperCommission + netUrgentFeeDollars(job.urgent_fee) / helpersCount;

      // ── Step 1: Get helper's connected Stripe account & onboarding fee status ──
      const { data: helperProfile, error: helperProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id, onboarding_fee_paid")
        .eq("user_id", helperId)
        .single();
      if (helperProfileErr) {
        // Fail closed: a transient DB read error must not masquerade as "helper
        // never set up their payout account" (which would fire a misleading
        // notification and permanently stall the payout until manual intervention).
        console.error(`[process-scheduled-payouts] helper profile read failed for ${helperId} (job ${job.id}):`, helperProfileErr);
        results.push({ job_id: job.id, status: "helper_profile_read_error", error: helperProfileErr.message });
        defects.record(`helper profile read ${job.id}: ${helperProfileErr.message}`);
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
        console.error(`Helper ${helperId} has no Stripe Connect for job ${job.id}`);
        await supabaseAdmin.from("notifications").insert({
          user_id: helperId,
          title: "Payout account required",
          message: `$${formatPayoutDollars(helperPayout)} from "${job.title}" is ready, but your payout account isn't set up yet. Add it in Profile → Payments.`,
          // User-facing and about money the helpr is owed — `financial_alerts`,
          // the category the prefs screen calls "Payments & Tips". As `warning`
          // it was gated by `system_alerts` instead.
          type: "financial_alerts", link: "/profile?tab=payment",
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
        defects.record(`pif_credits read ${job.id}: ${pifErr.message}`);
        continue;
      }
      const isPifFunded = !!pifRow;

      // How much of this escrow was funded by a gift credit, in cents.
      //
      // Needed for the HARD CAP below. `source_transaction` makes Stripe refuse
      // to over-draw a charge, but a gift-funded job has no charge to draw from
      // — so on that path the cap computed here is the ONLY guard left, and it
      // has to know what the gift was actually worth.
      //
      // Valued through the same dry-run RPC `execute-dispute-split` uses, so the
      // two payout paths cannot disagree about the size of the same escrow.
      let giftAppliedCents = 0;
      if (isPifFunded) {
        const { data: giftPreview, error: giftPreviewErr } = await supabaseAdmin.rpc(
          "restore_pif_credit_for_job",
          { p_job_id: job.id, p_share_bps: 10000, p_dry_run: true },
        );
        const preview = (giftPreview ?? null) as { outcome?: string; applied_cents?: number } | null;
        const outcome = giftPreviewErr ? null : preview?.outcome;
        if (outcome !== "would_restore" && outcome !== "already_restored") {
          // A null error is not an answer — only the outcomes the function
          // defines are. PGRST202 means the migration has not deployed yet.
          // Either way the gift half of this escrow is unknowable, so nothing
          // may move: defer to the next run rather than transfer uncapped.
          const why = giftPreviewErr
            ? `${giftPreviewErr.message}${(giftPreviewErr as { code?: string }).code ? ` (${(giftPreviewErr as { code?: string }).code})` : ""}`
            : `unrecognised outcome ${JSON.stringify(preview)}`;
          console.error(`[process-scheduled-payouts] gift valuation failed for job ${job.id}: ${why}`);
          results.push({ job_id: job.id, status: "gift_valuation_failed", error: why });
          defects.record(`gift valuation ${job.id}: ${why}`);
          continue;
        }
        giftAppliedCents = Number(preview?.applied_cents ?? 0);
        if (!Number.isFinite(giftAppliedCents) || giftAppliedCents < 0) {
          console.error(`[process-scheduled-payouts] job ${job.id} gift has no usable applied amount`);
          results.push({ job_id: job.id, status: "gift_amount_unusable", skipped: true });
          defects.record(`gift amount unusable ${job.id}`);
          continue;
        }
      }

      // ── Step 2: Resolve payment intent ID (skipped for PIF — no poster charge) ──
      /** What Stripe actually captured, in cents. 0 for a purely gift-funded job. */
      let capturedCents = 0;
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

          // Keep the AMOUNT, not just the status. This step already had the
          // PaymentIntent in hand and threw the figure away, which is why this
          // function could transfer more than was ever collected.
          const received = pi.amount_received;
          if (typeof received === "number" && received > 0) capturedCents = received;

          if (pi.status !== "succeeded") {
            console.error(`Payment ${paymentIntentId} for job ${job.id} has status "${pi.status}" — CANNOT transfer funds.`);
            results.push({ job_id: job.id, status: `pi_not_succeeded_${pi.status}`, skipped: true });
            const { ids: adminIds } = await loadAdminIds(supabaseAdmin, "process-scheduled-payouts.piNotSucceeded");
            {
              for (const adminId of adminIds) {
                await supabaseAdmin.from("notifications").insert({
                  user_id: adminId,
                  title: "Payout blocked — charge not captured",
                  message: `Job ${job.id} ("${job.title}") payout cannot proceed. PI status: ${pi.status}.`,
                  type: "admin_alert", link: "/admin",
                });
              }
            }
            continue;
          }
        } catch (e: any) {
          console.error(`Failed to verify payment for job ${job.id}:`, e);
          results.push({ job_id: job.id, status: "verify_error", error: (e as Error).message });
          defects.record(`payment verify ${job.id}: ${(e as Error).message}`);
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
      // Scoped to this HELPER, not just the job. On a group job the ledger holds
      // one row per roster member, so a job-wide query would see the first
      // helper's "paid" row and skip everyone after them — silently paying 1 of N.
      const { data: ledgerRows, error: ledgerReadErr } = await supabaseAdmin
        .from("payout_transfers")
        .select("id, stripe_transfer_id, status, created_at")
        .eq("job_id", job.id)
        .eq("helper_id", helperId);
      if (ledgerReadErr) {
        // Fail closed: without the ledger we can't rule out a prior transfer.
        console.error(`[process-scheduled-payouts] payout_transfers read failed for job ${job.id}:`, ledgerReadErr);
        results.push({ job_id: job.id, status: "ledger_read_error", error: ledgerReadErr.message });
        defects.record(`payout_transfers read ${job.id}: ${ledgerReadErr.message}`);
        continue;
      }
      const blockingPayout = (ledgerRows ?? []).find((r) =>
        r.stripe_transfer_id !== null && ["pending", "paid", "reversed"].includes(r.status)
      );
      if (blockingPayout) {
        console.log(`[process-scheduled-payouts] Payout already exists for job ${job.id} (${blockingPayout.stripe_transfer_id}/${blockingPayout.status}); skipping.`);
        results.push({ job_id: job.id, status: "already_transferred", transfer_id: blockingPayout.stripe_transfer_id });
        continue;
      }

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
          .eq("user_id", helperId)
          .eq("onboarding_fee_paid", false)
          .select("user_id");
        if (claimErr) {
          // Fail closed BEFORE the transfer — treating a failed claim as
          // "lost the race" would silently skip collecting the fee forever.
          console.error(`[process-scheduled-payouts] onboarding-fee claim failed for ${helperId} (job ${job.id}):`, claimErr);
          results.push({ job_id: job.id, status: "onboarding_fee_claim_error", error: claimErr.message });
          defects.record(`onboarding-fee claim ${job.id}: ${claimErr.message}`);
          continue;
        }
        if (claimed && claimed.length > 0) {
          if (Math.round(helperPayout * 100) <= onboardingFeeCents) {
            // Claim succeeded but this payout is too small to cover the fee.
            // Roll the claim back and skip so the flag doesn't lie, and a
            // future (larger) payout — or manual reconciliation — collects it.
            const { error: rollbackErr } = await supabaseAdmin
              .from("profiles")
              .update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
              .eq("user_id", helperId);
            if (rollbackErr) {
              console.error(
                `CRITICAL: [process-scheduled-payouts] payout too small AND onboarding-fee rollback failed for ${helperId} (job ${job.id}) — onboarding_fee_paid is incorrectly true but the fee was NOT collected; manual reconciliation needed:`,
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

      // Un-claim the one-time onboarding fee if THIS target claimed it. Every
      // post-claim exit that moves no money must call this, or the retry reads
      // the flag as already-paid and the $2 is silently lost forever.
      const rollBackOnboardingFeeClaim = async () => {
        if (!owesOnboardingFee) return;
        const { error: unclaimErr } = await supabaseAdmin
          .from("profiles")
          .update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
          .eq("user_id", helperId);
        if (unclaimErr) {
          console.error(
            `CRITICAL: [process-scheduled-payouts] payout did not proceed AND onboarding-fee un-claim failed for ${helperId} (job ${job.id}) — onboarding_fee_paid is incorrectly true but the fee was NOT collected; manual reconciliation needed:`,
            unclaimErr,
          );
        }
      };

      // ── Claim the payout BEFORE calling Stripe ──────────────────────────
      // The ledger read above cannot close the race the comment at Step 4
      // claims it closes. This cron and release-payout target the same jobs
      // with DIFFERENT Stripe idempotency keys, so both would send; an unlocked
      // SELECT can only lose that race. The INSERT below is arbitrated by the
      // partial unique index on (job_id, helper_id) over the live statuses
      // (migration 20260831190418) — exactly one runner gets the row and the
      // rest stop here rather than at the Stripe call. The same row is what
      // records a FAILED attempt, which nothing in this function ever wrote.
      const claimAmountCents = Math.round(helperPayout * 100);
      const claim = await claimPayout(supabaseAdmin, {
        jobId: job.id,
        helperId,
        amountCents: claimAmountCents,
        platformFeeCents: Math.round(helperCommission * 100),
        stripeAccountId: helperProfile.stripe_account_id,
        initiatedBy: "system",
        metadata: { source: "scheduled_payout" },
        ledgerRows: (ledgerRows ?? []) as { id: string; stripe_transfer_id: string | null; status: string; created_at?: string | null }[],
      });
      if (claim.kind === "error") {
        console.error(`[process-scheduled-payouts] payout claim failed for job ${job.id} / helper ${helperId}: ${claim.message}`);
        await rollBackOnboardingFeeClaim();
        results.push({ job_id: job.id, status: "claim_error", error: claim.message });
        defects.record(`payout claim ${job.id}: ${claim.message}`);
        continue;
      }
      if (claim.kind === "blocked") {
        console.log(`[process-scheduled-payouts] payout not claimed for job ${job.id} / helper ${helperId}: ${claim.reason}`);
        await rollBackOnboardingFeeClaim();
        results.push({ job_id: job.id, status: "already_claimed", detail: claim.reason });
        continue;
      }
      const failedCount = claim.failedCount;

      // ── Step 4b: HARD CAP — never transfer more than the escrow was funded with ──
      //
      // `jobs.budget` is writable by the poster under RLS while
      // `payment_status` is still 'unpaid', and the Checkout Session freezes its
      // amount at creation — so a poster can pay a $10 session, raise the
      // budget, and this cron would compute the payout from the raised figure.
      //
      // `release-payout` and `execute-dispute-split` have carried this
      // assertion for some time. This function — the one that pays MOST jobs,
      // on the normal schedule — did not, and `source_transaction` below is not
      // a substitute: it is deliberately omitted for gift-funded jobs, because
      // there is no charge to draw from. On that path this check is the only
      // thing standing between a raised budget and an uncapped transfer out of
      // the platform's own balance.
      //
      // The gift leg counts toward the cap: it is real value leaving the
      // platform, denominated in credit rather than dollars.
      const escrowValueCents = capturedCents + giftAppliedCents;
      const payoutCents = Math.round(helperPayout * 100);
      if (payoutCents > escrowValueCents) {
        console.error(
          `[process-scheduled-payouts] REFUSING: payout ${payoutCents}c exceeds escrow ${escrowValueCents}c ` +
            `(captured ${capturedCents}c + gift ${giftAppliedCents}c) for job ${job.id}`,
        );
        await rollBackOnboardingFeeClaim();
        await postSlackOpsAlert({
          kind: "custom",
          severity: "critical",
          title: "Scheduled payout blocked — exceeds captured escrow",
          message:
            "A scheduled payout computed to more than the escrow was funded with. Nothing moved. " +
            "The job's budget may have been altered after checkout.",
          fields: {
            job_id: job.id,
            helper_id: helperId,
            payout_cents: payoutCents,
            captured_cents: capturedCents,
            gift_applied_cents: giftAppliedCents,
          },
        });
        results.push({
          job_id: job.id,
          status: "exceeds_captured_escrow",
          payout_cents: payoutCents,
          escrow_cents: escrowValueCents,
        });
        // A defect, not an outcome: a payout that should have been payable and
        // was not means something upstream is wrong, and it must not answer 2xx.
        defects.record(
          `payout ${payoutCents}c exceeds escrow ${escrowValueCents}c for job ${job.id}`,
        );
        continue;
      }

      // ── Step 5: Transfer to helper (charge is confirmed captured) ──
      try {
        const transferParams: any = {
          amount: payoutCents,
          currency: "usd",
          destination: helperProfile.stripe_account_id,
          // Group all charges/transfers for this job so Stripe Dashboard
          // reconciliation and reporting shows them together. Mirrors the
          // transfer_group set by release-payout for admin-triggered payouts;
          // without this, cron-path transfers appear unlinked in the dashboard.
          transfer_group: `job_${job.id}`,
          metadata: {
            job_id: job.id,
            helper_id: helperId,
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
        // Group jobs add the helper id to the key: every roster member is a
        // DISTINCT transfer, so sharing one job-scoped key would make Stripe
        // return the first helper's transfer for all of them and only one
        // person would actually be paid. Single-helper jobs keep the exact
        // legacy key so in-flight dedupe against older runs still holds.
        const payoutKeyBase = job.is_group_job
          ? `scheduled-payout-${job.id}-${helperId}`
          : `scheduled-payout-${job.id}`;
        const idempotencyKey = failedCount > 0
          ? `${payoutKeyBase}-r${failedCount}`
          : payoutKeyBase;
        const transfer = await stripe.transfers.create(transferParams, {
          idempotencyKey,
        });
        console.log(`Payout: $${helperPayout.toFixed(2)} to helper ${helperId} for job ${job.id} (onboarding fee deducted: $${onboardingFeeDollars.toFixed(2)})`);

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
        // Settle the claim taken before the call. Same reason it is stamped
        // "paid" straight away: Stripe marketplace transfers settle
        // synchronously, and the `transfer.created` webhook that would flip
        // pending → paid can fire before this UPDATE runs — a webhook that
        // finds nothing to update is a no-op no future event repairs.
        const settled = await settleClaim(supabaseAdmin, claim.claimId, {
          stripeTransferId: transfer.id,
          amountCents: Math.round(helperPayout * 100),
          platformFeeCents: Math.round(helperCommission * 100),
          stripeAccountId: helperProfile.stripe_account_id,
          metadata: {
            source: "scheduled_payout",
            onboarding_fee_cents: owesOnboardingFee ? onboardingFeeCents : 0,
          },
        });
        if (!settled.ok) {
          // The transfer succeeded in Stripe but the ledger does not say so —
          // a financial reconciliation gap requiring a human. The claim row
          // still exists and still holds the (job, helper) lock, so this
          // cannot become a double transfer; it just cannot resolve itself.
          console.error(
            `[process-scheduled-payouts] Ledger settle failed for job ${job.id} (transfer ${transfer.id}): ${settled.message}`,
          );
          defects.record(`ledger settle ${job.id}: ${settled.message}`);
          await postSlackOpsAlert({
            kind: "payout_failed",
            severity: "critical",
            title: "Scheduled payout — transfer sent but payout_transfers ledger write FAILED",
            message: `A Stripe transfer succeeded for job ${job.id} but its payout_transfers claim row could not be stamped paid with the transfer id. The transfer exists in Stripe but the ledger does not record it — reconcile manually.`,
            fields: {
              "Job ID": job.id,
              "Transfer ID": transfer.id,
              "Amount": `$${helperPayout.toFixed(2)}`,
              "Helper ID": helperId,
              "Claim row": claim.claimId,
              "DB error": settled.message.slice(0, 200),
            },
          });
        }

        // On a group job, only the payout that completes the ROSTER may flip the
        // job to "released". The cron selects on payment_status = 'payout_pending',
        // so flipping after the first helper would drop the job out of the queue
        // and any roster member who still needed a retry would never be paid
        // again. Count paid ledger rows (this helper's row was just inserted
        // above) and hold the job open until every slot is settled.
        let allRosterPaid = true;
        if (job.is_group_job) {
          const { data: paidRows, error: paidCountErr } = await supabaseAdmin
            .from("payout_transfers")
            .select("helper_id")
            .eq("job_id", job.id)
            .in("status", ["pending", "paid"]);
          if (paidCountErr) {
            // Fail closed — leaving the job payout_pending is recoverable (the
            // next run retries and Stripe dedupes on the same key); wrongly
            // releasing it is not.
            console.error(`[process-scheduled-payouts] roster payout count failed for job ${job.id}:`, paidCountErr);
            allRosterPaid = false;
          } else {
            // SYMMETRY WITH THE ROSTER READ ABOVE, which does
            // `.map(r => r.helper_id).filter(Boolean)`. That one drops a NULL
            // `helper_id`; this one did not, and the two numbers are compared
            // to each other on the very next line.
            //
            // `payout_transfers.helper_id` is nullable and is actively NULLed
            // by the account-deletion purge (20260901033011 step 4d sets it to
            // NULL and stamps `helper_redacted_at`; 20260902014651 does the
            // same to the matching `group_job_helpers` row). So after one
            // roster member deletes their account, a group job's denominator
            // EXCLUDES them while the numerator COUNTED them: on a 3-slot job
            // with roster {A,B,C} where A is redacted, rosterSize becomes 2
            // while `new Set([null, "C"]).size` is also 2 — so paying C alone
            // trips `allRosterPaid`, flips the job to 'released', and drops it
            // out of a cron that selects on payment_status='payout_pending'.
            // B is then never retried, and their budget/helpers_needed share
            // rests on the platform balance with no alert. That is precisely
            // the failure the comment above says this block exists to prevent.
            //
            // A redacted row is not a roster member this run can pay, so it
            // must not count as one. Excluding it fails CLOSED: the job stays
            // payout_pending and is retried next run (Stripe dedupes on the
            // same idempotency key), which is recoverable — wrongly releasing
            // is not.
            const distinctPaid = new Set(
              (paidRows ?? [])
                .map((r) => r.helper_id)
                .filter((id): id is string => typeof id === "string" && id.length > 0),
            ).size;
            // Against the ROSTER, not `helpers_needed` — see rosterSizeByJob
            // above. `helpers_needed` is a threshold an under-filled roster can
            // never reach, which left the job cycling through this cron forever
            // with every member already paid.
            allRosterPaid = distinctPaid >= (rosterSizeByJob.get(job.id) ?? job.helpers_needed ?? 1);
          }
        }

        // The money is out. This write used to be a bare `.eq("id", job.id)`
        // with no `.select("id")` and no state precondition, which is two bugs
        // in one line:
        //
        //   1. a zero-row match returns `{ data: [], error: null }`, so a job
        //      whose payment_status had moved under us stayed in payout_pending
        //      forever while the run reported success and Stripe had paid;
        //   2. with no precondition it would happily overwrite a webhook-set
        //      'chargeback' with 'released' — paying out and then marking as
        //      settled a job the bank has already clawed back. That is the
        //      exact hazard auto-release-payment:195-198 documents and guards
        //      against on the escrow side, and this path had no such guard.
        //
        // Now it mirrors execute-dispute-split:879-885: explicit allowed
        // states, `.select("id")`, and a zero-row branch that alerts.
        // `helper_fee_percent` and `platform_fee_amount` are PER-HELPER values
        // on a row that a group job shares between N of them. This flip runs on
        // whichever roster member happened to settle last, so stamping them on a
        // group job wrote one arbitrary helper's tier rate onto everybody's job
        // — and `helperEarnings.ts` treats the frozen percent as the authority
        // on exactly those rows (`shares !== 1`), so an Elite helper's card
        // would quote a free-tier helper's 12% (or, worse, the reverse: a
        // displayed take-home HIGHER than the transfer, the one thing
        // `JobPrice.tsx` says must never happen). The truth is already per-helper
        // in `payout_transfers`; leave the shared row's escrow-time stamp alone
        // rather than overwriting it with a number that is right for one of N.
        const releaseFields: Record<string, unknown> = { payment_status: "released" };
        if (!job.is_group_job) {
          releaseFields.helper_fee_percent = jobHelperFeePercent;
          releaseFields.platform_fee_amount = Math.round(perHelperBudget * jobHelperFeePercent) / 100;
        }
        const { data: flippedJob, error: statusUpdateErr } = allRosterPaid
          ? await supabaseAdmin.from("jobs").update(releaseFields)
            .eq("id", job.id)
            .in("payment_status", [...RELEASABLE_PAYMENT_STATES])
            .select("id")
          : { data: [{ id: job.id }], error: null };
        if (statusUpdateErr || !flippedJob || flippedJob.length === 0) {
          const zeroRow = !statusUpdateErr;
          // The Stripe transfer already succeeded — throwing here would wrongly
          // mark this job as transfer_failed. Log critically and alert ops so
          // the row can be reconciled by hand.
          console.error(
            `[process-scheduled-payouts] CRITICAL: transfer sent but jobs.update ${zeroRow ? "matched ZERO rows (payment_status left the releasable set — chargeback or refund?)" : "failed"} for job ${job.id}:`,
            statusUpdateErr,
          );
          defects.record(
            `job release flip ${job.id}: ${zeroRow ? "zero rows matched" : (statusUpdateErr as Error)?.message ?? "update failed"}`,
          );
          await postSlackOpsAlert({
            kind: "payout_failed",
            severity: "critical",
            title: "Payout status flip failed — manual fix required",
            message: zeroRow
              ? `Transfer sent to helper for job ${job.id} but \`payment_status\` was no longer in {payout_pending, released}, so the flip matched zero rows. The helper has been paid on a job that may have been charged back or refunded underneath this run. Reconcile immediately — do NOT simply set it to released.`
              : `Transfer sent to helper for job ${job.id} but \`payment_status\` could not be flipped to "released". Job is stuck in payout_pending — requires manual DB update.`,
            fields: {
              "Job ID": job.id,
              "Helpr ID": helperId,
              Amount: `$${helperPayout.toFixed(2)}`,
              Error: (statusUpdateErr as Error)?.message?.slice(0, 200) ?? "zero rows matched",
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
          user_id: helperId,
          title: "Payout sent!",
          message: `$${formatPayoutDollars(helperPayout)} for "${job.title}" has been transferred to your account${feeNote}.`,
          type: "payment", link: "/earnings",
        });

        processed++;
        results.push({ job_id: job.id, status: "transferred", amount: helperPayout, onboarding_fee_deducted: onboardingFeeDollars });
      } catch (e) {
        console.error(`Payout failed for job ${job.id}:`, e);
        results.push({ job_id: job.id, status: "transfer_failed", error: (e as Error).message });
        defects.record(`transfer failed ${job.id}: ${(e as Error).message}`);

        // Record the FAILED attempt on the claim row. Nothing in this function
        // ever wrote `status='failed'` — the only writer was the
        // transfer.failed webhook, which never fires when the CREATE call
        // itself throws. So `failedCount` stayed 0, the idempotency key stayed
        // unsalted, and Stripe replayed this same cached failure for ~24h,
        // making every retry a silent no-op for a day.
        const failed = await failClaim(supabaseAdmin, claim.claimId, (e as Error).message, {
          source: "scheduled_payout",
        });
        if (!failed.ok) {
          console.error(
            `CRITICAL: [process-scheduled-payouts] transfer failed for job ${job.id} AND the claim row could not be marked failed (${failed.message}); the next run resumes it against the same idempotency key.`,
          );
          defects.record(`claim fail-mark ${job.id}: ${failed.message}`);
        }

        // Un-claim the onboarding fee if THIS job claimed it — no money moved,
        // so the fee was never collected and the flag must not say it was.
        await rollBackOnboardingFeeClaim();

        await postSlackOpsAlert({
          kind: "payout_failed",
          severity: "critical",
          title: "Scheduled payout failed",
          message: `Failed to transfer *$${helperPayout.toFixed(2)}* to helpr for job ${job.id}.`,
          fields: {
            "Job ID": job.id,
            "Helpr ID": helperId,
            Amount: `$${helperPayout.toFixed(2)}`,
            Error: (e as Error).message?.slice(0, 200),
          },
          link: "https://www.louisianahelpr.com/admin?tab=payouts",
        });

        const { ids: adminIds } = await loadAdminIds(supabaseAdmin, "process-scheduled-payouts.payoutFailed");
        {
          for (const adminId of adminIds) {
            await supabaseAdmin.from("notifications").insert({
              user_id: adminId,
              title: "Scheduled payout failed",
              message: `Failed to pay $${helperPayout.toFixed(2)} to helpr for job ${job.id}. Error: ${(e as Error).message}`,
              type: "admin_alert", link: "/admin",
            });
          }
        }
      }
    }

    // Name the function in the body. `sweep_silent_cron_failures` only ingests
    // responses matching `content ~ '"fn"\s*:\s*"'`, and `sweep_cron_http_failures`
    // otherwise falls back to timestamp proximity — which guessed wrong three
    // times in four. Without this key a payout cron is invisible to both
    // watchers built to watch it.
    return cronResult(
      "process-scheduled-payouts",
      { success: true, processed, results },
      defects.defects,
      corsHeaders,
    );
  } catch (error) {
    console.error("[process-scheduled-payouts] fatal:", error);
    return cronError(
      "process-scheduled-payouts",
      `Internal server error: ${(error as Error).message}`,
      corsHeaders,
    );
  }
});
