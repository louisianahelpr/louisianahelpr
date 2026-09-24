// money-reconciliation — the alarm for money rows that disagree with reality.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS FUNCTION IS STRICTLY READ-ONLY. It reports; it NEVER "fixes" money.
// Every Supabase call below is a `.select()`. No insert, no update, no upsert,
// no RPC with side effects. The ONLY Stripe calls are
// `paymentIntents.retrieve` (docs/OPEN.md Q50: the DB's word that a cancelled
// job's money went back is checked against Stripe's own) — never a create,
// capture, cancel or refund. If a future edit adds a write to
// this file, that edit is wrong: a reconciler that repairs its own findings
// can no longer be trusted to report them, and an automated money-mutator is
// exactly the thing nobody should build without a human in the loop.
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
// ---------------
// A poster who blocked their helper mid-job had the job cancelled with
// `cancellation_fee: 0` written from the CLIENT. The escrow itself settled
// correctly, because `void-cancelled-payments` RECOMPUTES the fee via
// `computeCancellationFee()` rather than reading the stored column (F-MONEY-32).
// But the persisted row then disagreed with the money that actually moved — and
// that stored lie is what feeds the fee pill the helper sees, the admin
// late-cancel revenue figures, and the helper's reliability record.
//
// Nothing surfaced the discrepancy. It was found by reading code. The escrow
// being right is precisely why nothing caught it: the ledger and the display
// layer had drifted apart with no alarm between them. This is that alarm.
//
// It re-derives each terminal state from the SAME shared modules the settlement
// paths use — `cancellationFee.ts`, `helperFees.ts` — so a rule change in one
// place cannot leave the reconciler asserting last month's ladder.
//
// SEED SCOPE
// ----------
// `jobs.is_seed` marks fixture / E2E rows. They are settled by test harnesses
// and replay scripts, not by the real money paths, so they drift constantly and
// legitimately. Alerting on them would train everyone to ignore this alarm
// inside a week. Default scope is therefore `is_seed = false`. Pass
// `?include_seed=1` for a manual run that also scans fixtures — useful for
// proving the checks actually fire, since (as of 2026-08-25) every prod job
// that has ever touched Stripe is a seed row. Hits on seed jobs are returned
// as `seed_findings` and go to the daily digest (postSlackOpsAlert `seed`);
// they never page and never fail the run (docs/OPEN.md Q90).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { computeCancellationFee, helperIsCommitted, hoursUntilJob } from "../_shared/cancellationFee.ts";
import { helperCommissionDollars, feePercentForTier } from "../_shared/helperFees.ts";
import { AUTO_COMPLETE_HOURS } from "../_shared/escrowTiming.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { scanAll, scanAllIn, scanDefect } from "../_shared/paginate.ts";
import { actualOrEstimatedFeeCents } from "../_shared/stripeFees.ts";

/** Offending ids reported per check. A bad day must not emit a 10MB payload. */
const MAX_IDS_PER_CHECK = 10;
/*
 * THERE IS NO `SCAN_LIMIT` ANY MORE, AND ITS REMOVAL IS THE POINT.
 *
 * IT USED TO BE `.limit(5000)` PLUS `if (rows.length >= 5000) caps.push(...)`,
 * AND THAT ALARM COULD NEVER FIRE.
 *
 * PostgREST enforces `db-max-rows = 1000` on this project, and an explicit
 * `.limit()` above the cap does not raise it. Measured against prod on
 * 2026-09-01: `notifications?select=id&limit=5000` against a 1,619-row table
 * returned `content-range: 0-999/*` — exactly 1000 rows. So every scan below
 * read at most a FIFTH of what it asked for, `rows.length` topped out at 1000,
 * `1000 >= 5000` was false every single time, and this reconciler reported
 * "clean, no caps hit" while auditing a fifth of the money. A reconciler that
 * silently scans a subset is worse than no reconciler: it is an assertion of
 * correctness over data it never looked at.
 *
 * The scans are now paged (`scanAll`, which walks `.range()` past the cap) and
 * the truncation check is against the SERVER'S OWN exact count rather than a
 * client-side limit the platform is free to override. The only ceiling left is
 * `MAX_PAGES × PAGE_SIZE` inside that helper, and reaching it is reported as a
 * defect rather than accepted. Nothing here declares a limit of its own,
 * because a limit is the thing that lied.
 */
/** Money compares are on dollars; tolerate half a cent of float noise. */
const EPSILON = 0.005;
/**
 * How long the settlement crons are allowed to take before an unsettled
 * terminal job counts as a real finding.
 *
 * `void-cancelled-payments` runs hourly (:10) and `auto-release-payment` every
 * 30 minutes, so a job that just flipped terminal legitimately sits in escrow
 * for up to an hour before anything moves it. Without this grace,
 * `escrow_on_terminal_job` fired `critical` on every normal cancellation — and
 * a critical that fires on normal operation is how people learn to ignore the
 * alarm, which defeats the point of having one. Two hours = cron cadence plus
 * slack; a genuinely stuck job is still reported on the next daily run.
 *
 * This mirrors the grace the sibling `cancellation_fee_status_incoherent`
 * check already gives itself (it only grades jobs whose escrow has actually
 * been settled) — same idea, expressed in time because this check's whole
 * subject is the un-settled state.
 */
const SETTLE_WINDOW_HOURS = 2;
const SETTLE_WINDOW_MS = SETTLE_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * How long a job may legitimately sit in `payout_pending` past its scheduled
 * payout time before it counts as stranded.
 *
 * auto-release-payment sets `payout_scheduled_at = now + 24h` and then fires
 * the payout from its own Phase 2, which runs every 30 minutes. So a job that
 * has been due for hours has not been "waiting"; something failed and said
 * nothing. Six hours is generous against a Stripe outage or a batch of retries
 * while still catching a stranded payout on the same day it strands.
 */
const PAYOUT_WINDOW_HOURS = 6;
const PAYOUT_WINDOW_MS = PAYOUT_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Stripe-side comparison window (docs/OPEN.md Q50). Every run asks Stripe about
 * each settled job's PaymentIntent, one `retrieve` per job, so the set has to be
 * bounded. 30 days: a disagreement is reported on every daily run for a month
 * before the job ages out, and an uncaptured card hold expires at Stripe after
 * 7 days anyway. The per-run ceiling is a safety valve, not a sample: hitting it
 * is reported as a truncated scan (a defect), never silently accepted.
 */
const STRIPE_LOOKBACK_DAYS = 30;
const STRIPE_LOOKBACK_MS = STRIPE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
const MAX_STRIPE_READS = 300;
const STRIPE_READ_CONCURRENCY = 10;
/**
 * Wall-clock budget for the Stripe phase. The cron calls this function through
 * pg_net with `timeout_milliseconds := 30000` (cron.job 51, read live
 * 2026-09-23), and a timed-out call is what the cron watchers see.
 *
 * MEASURED on prod 2026-09-23 (?include_seed=1, function_edge_logs
 * execution_time_ms): 79 PaymentIntent reads at concurrency 10 took the WHOLE
 * run 2,246 ms (2,368 ms on a second run); the same run without Stripe reads
 * took 648 ms. So 300 reads projects to roughly 8 s, well inside 30 s.
 *
 * ALSO MEASURED: the Edge runtime keeps running after the caller hangs up. A
 * call with pg_net timeout_milliseconds := 400 timed out at 401 ms
 * (net._http_response 595), and the function still finished at 2,368 ms and
 * recorded its critical alert in ops_alert_ledger (last_seen 07:54:12.52Z).
 * A slow run therefore does not lose the Slack/ledger alert, only the HTTP
 * status the cron watchers read.
 *
 * The budget keeps that status too: past it the phase stops, and the jobs it
 * did not reach are reported as a truncated scan (a defect, 500), never
 * silently dropped. 20 s leaves 10 s for the DB scans before and the alert
 * after, both measured well under 1 s.
 */
const STRIPE_PHASE_BUDGET_MS = 20_000;

type Severity = "critical" | "warning" | "info";

interface Finding {
  check: string;
  severity: Severity;
  /** One line a human can act on without opening the code. */
  detail: string;
  count: number;
  /** Capped sample. `truncated` says whether more exist. */
  sample: unknown[];
  truncated: boolean;
}

/** Collects hits for one check and caps the sample at emit time. */
class Check {
  private hits: unknown[] = [];
  constructor(
    readonly name: string,
    readonly severity: Severity,
    readonly detail: string,
  ) {}
  add(hit: unknown) {
    this.hits.push(hit);
  }
  get count() {
    return this.hits.length;
  }
  /** The finding over the hits `keep` accepts (all of them by default). */
  finding(keep: (hit: unknown) => boolean = () => true): Finding | null {
    const hits = this.hits.filter(keep);
    if (!hits.length) return null;
    return {
      check: this.name,
      severity: this.severity,
      detail: this.detail,
      count: hits.length,
      sample: hits.slice(0, MAX_IDS_PER_CHECK),
      truncated: hits.length > MAX_IDS_PER_CHECK,
    };
  }
}

/** Epoch ms for a nullable timestamp column, or null when unusable. */
const ts = (v: unknown): number | null => {
  if (!v) return null;
  const n = new Date(v as string).getTime();
  return Number.isFinite(n) ? n : null;
};

/** The later of two nullable timestamps, or null when neither is usable. */
const latest = (a: unknown, b: unknown): number | null => {
  const x = ts(a), y = ts(b);
  if (x === null) return y;
  if (y === null) return x;
  return Math.max(x, y);
};

const money = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Fail loud on missing config rather than letting createClient throw a
    // context-free "Internal Server Error" outside the try block.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const serviceRoleKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!serviceRoleKey) missing.push("SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);

    const authHeader = req.headers.get("Authorization");
    if (
      !authHeader ||
      ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && authHeader !== `Bearer ${serviceRoleKey}`)
    ) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const admin = createClient(supabaseUrl!, serviceRoleKey!);
    const includeSeed = new URL(req.url).searchParams.get("include_seed") === "1";

    // Every check is declared up front so a clean run still reports which
    // invariants were actually evaluated — "0 findings" is only meaningful
    // alongside the list of things that were looked at.
    const checks = {
      // ── Gift-card credit ──────────────────────────────────────────────
      // This file used to say gift_cards needed no reconciliation because it
      // carries no cached balance, so "asserting on them would be theatre".
      // That was true while the table was empty and stopped being true the
      // moment the feature shipped. The two assertions below are not balance
      // checks — they are the signatures of specific, known-possible defects.
      giftRevokedChildSpendable: new Check(
        "gift_revoked_donation_has_spendable_child",
        "critical",
        "A gift_cards row is payment_status='paid' while an ancestor of the same donation is 'refunded'. Spendable credit derived from money that already went back to the donor — the re-mint class closed in 20260922165121. A hit here means either that fix regressed or a row was written by hand.",
      ),
      giftSpentRevokedUnpaged: new Check(
        "gift_revoked_after_being_spent",
        "warning",
        "A redeemed gift_cards row is payment_status='refunded' — the donation was reversed AFTER it had funded a job, so the platform absorbed that value from its own balance. Not an error (we deliberately never claw back from the Helpr), but it is a real loss and should be reconciled against Stripe.",
      ),
      cancellationFee: new Check(
        "cancellation_fee_mismatch",
        "critical",
        "Stored jobs.cancellation_fee disagrees with computeCancellationFee() — the row lies to the Helpr's fee pill, admin revenue, and reliability record even though escrow settled correctly.",
      ),
      lateFlag: new Check(
        "late_cancellation_flag_wrong",
        "warning",
        "jobs.late_cancellation disagrees with the <24h tier derived from date_needed + cancelled_at.",
      ),
      feeStatus: new Check(
        "cancellation_fee_status_incoherent",
        "warning",
        "cancellation_fee_status says 'charged' with a zero owed fee, or a non-zero owed fee settled with no charged status.",
      ),
      platformFee: new Check(
        "platform_fee_self_inconsistent",
        "critical",
        "jobs.platform_fee_amount != helperCommissionDollars(per-helper budget, jobs.helper_fee_percent). release-payout writes both together, so they can never legitimately disagree.",
      ),
      // REWRITTEN 2026-09-07. This check used to compare jobs.helper_fee_percent
      // against the helper's tier ladder and call any difference a defect. That
      // was wrong, and it was wrong in the direction that cries wolf: it fired
      // on 12 jobs including every healthy subscriber job.
      //
      // Its own detail text asserted that a hit "means the helper's subscription
      // discount was not applied to their commission." It does not. The frozen
      // column is NOT what settles a payout. All six money paths —
      // release-payout, process-scheduled-payouts, auto-release-payment,
      // execute-dispute-split, charge-recurring-visits, void-cancelled-payments
      // — resolve the fee through getHelperFeePercent (_shared/helperFees.ts),
      // which reads the helper's LIVE subscription_tier and expiry.
      // jobs.helper_fee_percent is stamped from a GLOBAL platform_settings value
      // at escrow time, before any helper is attached, and is only ever consulted
      // as a fallback when that profile read fails. So the column disagreeing
      // with the ladder is the NORMAL, expected state of every subscriber job.
      //
      // What is actually worth alarming on is a settled payout whose recorded
      // commission does not match what the live tier would have charged — that,
      // and only that, means a discount was really not applied. Graded against
      // payout_transfers.platform_fee_cents, so it needs money to have moved.
      tierDrift: new Check(
        "helper_fee_percent_not_applied_at_payout",
        "critical",
        "A SETTLED payout_transfer recorded a commission that differs from what the Helpr's LIVE subscription tier would charge — the discount was not applied to money that actually moved. Graded against the transfer ledger, never against jobs.helper_fee_percent, which is a global escrow-time stamp and is expected to differ from the ladder.",
      ),
      releasedNoTransfer: new Check(
        "released_without_payout_transfer",
        "critical",
        "Job marked payment_status='released' with no payout_transfers ledger row — money supposedly left, with no record of where.",
      ),
      // The mirror of releasedNoTransfer, and the class check for the
      // refund-over-payout double outflow: a refund that landed on a job whose
      // Helpr was already paid. The budget then leaves the platform twice — once
      // to the Helpr (never clawed back), once back to the poster — and
      // 'refunded' is treated as "settled" everywhere else, so nothing but this
      // check ever sees it. Fires for any job whose payment_status is 'refunded'
      // while a LIVE (paid / pending-with-id, i.e. isSettledTransfer)
      // payout_transfers row exists for it.
      refundedWithLivePayout: new Check(
        "refunded_with_live_payout",
        "critical",
        "Job marked payment_status='refunded' while a live (paid / pending-with-id) payout_transfers row still exists and was not reversed — the poster was refunded while the Helpr keeps the payout, so the platform paid the budget twice.",
      ),
      transferFeeMismatch: new Check(
        "transfer_platform_fee_mismatch",
        "critical",
        "payout_transfers.platform_fee_cents disagrees with jobs.platform_fee_amount for the same job.",
      ),
      escrowTerminal: new Check(
        "escrow_on_terminal_job",
        "critical",
        `payment_status='escrow' on a cancelled/completed job more than ${SETTLE_WINDOW_HOURS}h after it ended (and, for completed jobs, past the ${AUTO_COMPLETE_HOURS}h auto-complete window) — the settlement cron should have moved these and did not.`,
      ),
      feeNoHelper: new Check(
        "cancellation_fee_without_helper",
        "critical",
        "Non-zero cancellation_fee with no COMMITTED Helpr (helper_id IS NULL, or helper_confirmed_at IS NULL so the offer was never accepted). The ladder charges 0% when nobody was committed, so this fee is owed to no one.",
      ),
      disputeNoRow: new Check(
        "dispute_flag_without_row",
        "warning",
        "jobs.has_active_dispute = true with no matching row in disputes — escrow can be frozen by a dispute that does not exist.",
      ),
      // The inverse, and the one that was ACTUALLY happening. Until the
      // trg_sync_has_active_dispute trigger landed, rpc_open_dispute set
      // status='disputed' + dispute_status='open' and NOTHING ever wrote the
      // flag — so disputeNoRow above keyed on a value that was always false
      // and could never fire: a dead check that read as a passing one. This
      // catches the live dispute the flag failed to record, which is what
      // silently un-gated can_review_job.
      disputeFlagMissing: new Check(
        "dispute_state_without_flag",
        "critical",
        "A job is in a live dispute (status='disputed', or dispute_status open/escalated/stripe_chargeback/reversal_hold) but has_active_dispute = false — the review gate and every other reader of the flag see an undisputed job.",
      ),
      payoutStranded: new Check(
        "payout_pending_stranded",
        "critical",
        `payment_status='payout_pending' more than ${PAYOUT_WINDOW_HOURS}h past payout_scheduled_at — the Helpr was told they would be paid and nothing has moved. This is the END STATE of an unguarded release write (a zero-row flip after the transfer went out) and of a payout that failed with nothing recorded, and until now NOTHING detected it: this reconciler only looked at 'escrow'.`,
      ),
      // ── The DB's settled state vs Stripe's (docs/OPEN.md Q50) ──────────
      // Every check above grades the DB against itself. A job the DB says is
      // settled — payment_status 'cancelled' or 'refunded' — was only ever
      // TRUSTED to have had its money returned. These ask Stripe.
      stripeHoldLive: new Check(
        "stripe_money_live_on_settled_job",
        "critical",
        "The DB says this job's payment is settled (payment_status 'cancelled'/'refunded'), but Stripe's PaymentIntent is still requires_capture (a live card hold) or processing (money still arriving). Nothing will release or refund it: the settlement paths only select jobs still in 'escrow'.",
      ),
      stripeUnderRefunded: new Check(
        "stripe_charge_not_refunded_on_cancelled_job",
        "critical",
        "A cancelled, undisputed job's charge is captured at Stripe and the platform kept more than the cancellation fee plus the non-refundable service fee (floored at Stripe's real processing cost) — the same ceiling void-cancelled-payments and cancel_escrow refund against. The poster was not given back money the DB says they were.",
      ),
      stripeRefundShort: new Check(
        "stripe_refund_recorded_not_at_stripe",
        "critical",
        "The payment_refunds ledger records MORE refunded on this job than Stripe's charge shows (amount_refunded). The DB, and the poster's screen, say money went back that Stripe never sent (or a refund later failed) — the poster is owed the difference.",
      ),
      stripeRefundUntracked: new Check(
        "stripe_refund_untracked",
        "warning",
        "Stripe refunded MORE on this job's charge than its payment_refunds ledger rows record — a refund moved with no ledger row (a dashboard refund, or a write that failed after the Stripe call). The poster has the money; the books do not.",
      ),
      stripeChargeShape: new Check(
        "stripe_charge_not_the_payment",
        "warning",
        "The PaymentIntent's latest_charge did not capture what the PaymentIntent received (amount_received). This reconciler assumes one charge carries a PaymentIntent's money; here another charge does, so its captured/refunded figures would be partial. Not graded — look at the PaymentIntent's charges in Stripe.",
      ),
      stripePiMissing: new Check(
        "stripe_payment_intent_not_found",
        "warning",
        "jobs.stripe_payment_intent_id names a PaymentIntent the configured Stripe key cannot see (resource_missing). Either the id is wrong or it belongs to the other key mode (test vs live) — so this job's money cannot be reconciled at all.",
      ),
      // `time_credit_balance_drift` was retired with the table it graded.
      // `public.time_credits` was dropped by migration 20260901035602 (its RLS
      // let any signed-in user mint their own credits, and nothing in the app
      // ever minted or spent them). Leaving the check here would have this
      // reconciler read a table that no longer exists on every run — it
      // degrades rather than crashes, but it would then push a
      // "time-credit check skipped" note into every single result, forever,
      // which is how a reconciler's output stops being read.
    };

    const notes: string[] = [];
    const caps: string[] = [];

    // ── Load jobs ────────────────────────────────────────────────────────────
    // Never drop a Supabase `error`: a swallowed failure here would report
    // "all clean" while having scanned nothing, which is worse than no alarm.
    // The column list MUST stay one unbroken string literal. postgrest-js parses
    // the select at the TYPE level to build the row shape, and it can only do
    // that from a literal: `"a, b" + "c, d"` widens to plain `string`, the parser
    // gives up and every row becomes `GenericStringError`, so `job.budget`,
    // `job.helper_id` and the other 20 columns below are all type errors. Written
    // as a `+` concatenation this one query produced 70 of the 120 errors the
    // edge typecheck first reported. Same characters, same query — a template
    // literal or a `+` chain would put it straight back.
    const jobScan = await scanAll<Record<string, unknown>>("jobs", (countOpt) => {
      const q = admin
        .from("jobs")
        .select(
          "id, is_seed, status, payment_status, budget, date_needed, start_time, cancelled_at, helper_id, helper_confirmed_at, cancellation_fee, cancellation_fee_status, late_cancellation, platform_fee_amount, helper_fee_percent, is_group_job, helpers_needed, has_active_dispute, dispute_status, poster_completed_at, helper_completed_at, payout_scheduled_at, updated_at, stripe_payment_intent_id, customer_fee_amount",
          countOpt,
        )
        // Paging without an ORDER BY is sampling, not paging: the cap and the
        // offset both apply after the sort, and with no sort there is no
        // stable one. `id` is the primary key.
        .order("id", { ascending: true });
      return includeSeed ? q : q.eq("is_seed", false);
    });
    if (jobScan.error) throw new Error(`jobs read failed: ${jobScan.error.message}`);
    const jobsCap = scanDefect("jobs", jobScan);
    if (jobsCap) caps.push(jobsCap);

    const jobRows = jobScan.rows;
    const jobById = new Map(jobRows.map((j) => [j.id as string, j]));

    // ── Cancelled-job checks ─────────────────────────────────────────────────
    for (const job of jobRows) {
      if (job.status !== "cancelled") continue;
      // A dispute decided for the poster (rpc_decide_dispute) sets 'cancelled'
      // with dispute_status 'resolved' and never stamps cancelled_at. The
      // decision governs its money, not the cancellation ladder: read as a
      // cancellation it "owes" a 50% fee and pages critical (Q336).
      if (job.dispute_status === "resolved" && !job.cancelled_at) continue;

      // Recompute from the SAME module void-cancelled-payments settles with.
      const expectedFee = computeCancellationFee({
        budget: money(job.budget),
        date_needed: job.date_needed as string | null,
        // Required by CancellationFeeJob: without it the recomputation
        // silently falls back to the midnight anchor and would 'confirm'
        // the very overcharge this reconciliation exists to catch.
        start_time: job.start_time as string | null,
        cancelled_at: job.cancelled_at as string | null,
        helper_id: job.helper_id as string | null,
        // Required by CancellationFeeJob since 2026-09-08: a Helpr who was
        // offered the job but never accepted is not committed, and the fee
        // ladder no longer charges for them. Omitting it here would make the
        // reconciliation flag every correctly-zeroed row as a mismatch.
        helper_confirmed_at: job.helper_confirmed_at as string | null,
      });
      const storedFee = money(job.cancellation_fee);

      if (Math.abs(storedFee - expectedFee) > EPSILON) {
        checks.cancellationFee.add({
          job_id: job.id,
          stored_fee: storedFee,
          expected_fee: expectedFee,
          budget: money(job.budget),
          has_helper: !!job.helper_id,
        });
      }

      // late_cancellation is the <24h tier. Only derivable when a helper was
      // assigned and the schedule is known; otherwise the flag has no defined
      // truth and is skipped rather than guessed at.
      // CHANGED 2026-09-08: gated on commitment, not assignment. A merely
      // offered Helpr is charged 0%, so late_cancellation is written false and
      // an assignment-based expectation here would flag every one of those.
      if (helperIsCommitted({ helper_id: job.helper_id as string | null, helper_confirmed_at: job.helper_confirmed_at as string | null }) && job.date_needed) {
        const hrs = hoursUntilJob(
          job.date_needed as string,
          job.cancelled_at as string | null,
          job.start_time as string | null,
        );
        const expectedLate = hrs < 24;
        if (!!job.late_cancellation !== expectedLate) {
          checks.lateFlag.add({
            job_id: job.id,
            stored: !!job.late_cancellation,
            expected: expectedLate,
            hours_until_job: Math.round(hrs * 100) / 100,
          });
        }
      }

      // Status coherence — only on jobs whose escrow has actually been settled
      // by the cron. A freshly cancelled job still in escrow has not been
      // charged yet, so a null status there is correct, not a finding.
      const settled = job.payment_status === "refunded" || job.payment_status === "cancelled";
      if (settled) {
        const charged = job.cancellation_fee_status === "charged";
        if (charged && expectedFee <= 0) {
          checks.feeStatus.add({ job_id: job.id, status: job.cancellation_fee_status, expected_fee: expectedFee });
        } else if (!charged && expectedFee > 0) {
          checks.feeStatus.add({
            job_id: job.id,
            status: job.cancellation_fee_status,
            expected_fee: expectedFee,
            note: "fee owed but never marked charged",
          });
        }
      }

      if (storedFee > 0 && !helperIsCommitted({ helper_id: job.helper_id as string | null, helper_confirmed_at: job.helper_confirmed_at as string | null })) {
        checks.feeNoHelper.add({ job_id: job.id, cancellation_fee: storedFee });
      }
    }

    // ── Impossible escrow states ─────────────────────────────────────────────
    const nowMs = Date.now();
    for (const job of jobRows) {
      if (job.payment_status !== "escrow") continue;
      if (job.status !== "cancelled" && job.status !== "completed") continue;

      // When did this job become terminal? That is the clock the settlement
      // cron runs against, so it is the clock the grace is measured from.
      const terminalAt = job.status === "cancelled"
        ? ts(job.cancelled_at)
        // A completed job legitimately holds escrow through the auto-complete
        // window (one party marked it done, the other still has AUTO_COMPLETE_HOURS
        // to confirm or dispute) before auto-release-payment touches it.
        : latest(job.poster_completed_at, job.helper_completed_at);
      // Fall back to updated_at rather than skipping: an unknown timestamp must
      // not become a silent exemption.
      const base = terminalAt ?? ts(job.updated_at) ?? 0;
      const graceMs = SETTLE_WINDOW_MS +
        (job.status === "completed" ? AUTO_COMPLETE_HOURS * 60 * 60 * 1000 : 0);

      if (nowMs - base <= graceMs) continue;

      checks.escrowTerminal.add({
        job_id: job.id,
        status: job.status,
        terminal_at: terminalAt === null ? null : new Date(base).toISOString(),
        hours_stuck: Math.round(((nowMs - base) / 3_600_000) * 100) / 100,
      });
    }

    // ── Payouts that were promised and never moved ───────────────────────────
    // This whole reconciler used to skip anything not in 'escrow' (`if
    // (job.payment_status !== "escrow") continue`), which left the single most
    // expensive terminal state unwatched. A job reaches `payout_pending` only
    // after auto-release-payment has told the helper "you will be paid in 24
    // hours", so a job stuck there is a promise the platform made and did not
    // keep — and it is exactly where an unguarded release write leaves a job
    // whose transfer already went out, and where a payout that failed with
    // nothing recorded leaves one whose transfer never did. Neither had an
    // alarm.
    for (const job of jobRows) {
      if (job.payment_status !== "payout_pending") continue;
      // Keyed on the SCHEDULED time, not on when the row was last touched: the
      // schedule is the promise, and `updated_at` moves for unrelated reasons.
      // A row with no schedule at all is still graded (falling back to
      // updated_at) rather than exempted — an unknown timestamp must not become
      // a silent pass, which is the same rule the escrow check above follows.
      const dueAt = ts(job.payout_scheduled_at) ?? ts(job.updated_at) ?? 0;
      if (nowMs - dueAt <= PAYOUT_WINDOW_MS) continue;
      checks.payoutStranded.add({
        job_id: job.id,
        budget: money(job.budget),
        payout_scheduled_at: job.payout_scheduled_at ?? null,
        hours_overdue: Math.round(((nowMs - dueAt) / 3_600_000) * 100) / 100,
      });
    }

    // ── Released / paying-out jobs ───────────────────────────────────────────
    const payoutJobs = jobRows.filter(
      (j) => j.payment_status === "released" || j.payment_status === "payout_pending",
    );

    for (const job of payoutJobs) {
      const pct = job.helper_fee_percent === null || job.helper_fee_percent === undefined
        ? null
        : Number(job.helper_fee_percent);
      if (pct === null || !Number.isFinite(pct)) continue;

      // release-payout divides the budget across helpers on a group job before
      // taking commission, so the reconciler must divide the same way.
      const helpers = job.is_group_job ? Math.max(1, Number(job.helpers_needed ?? 1)) : 1;
      const perHelperBudget = money(job.budget) / helpers;
      const expected = helperCommissionDollars(perHelperBudget, pct);
      const stored = money(job.platform_fee_amount);
      if (Math.abs(stored - expected) > EPSILON) {
        checks.platformFee.add({
          job_id: job.id,
          stored_platform_fee: stored,
          expected_platform_fee: expected,
          helper_fee_percent: pct,
          per_helper_budget: perHelperBudget,
        });
      }
    }

    // Tier-ladder cross-check (informational). Batched profile read.
    const payoutHelperIds = [
      ...new Set(payoutJobs.map((j) => j.helper_id).filter((v): v is string => !!v)),
    ];
    // job_id -> the commission rate the helper's LIVE tier would charge.
    // Graded against the payout ledger once it is read; see tierDrift.
    const liveFeeByJob = new Map<string, { ladder: number; tier: string }>();
    if (payoutHelperIds.length) {
      // `.in(...)` is capped like every other read — a 3,000-id IN list returns
      // 1000 rows with no complaint — and a long enough list blows the URL
      // length first. `scanAllIn` chunks the ids AND pages each chunk, so a
      // silently short profile read can no longer turn into "no tier drift".
      const profScan = await scanAllIn<Record<string, unknown>>(
        "profiles",
        payoutHelperIds,
        (chunk, countOpt) =>
          admin
            .from("profiles")
            .select("user_id, subscription_tier, subscription_expires_at", countOpt)
            .order("user_id", { ascending: true })
            .in("user_id", chunk),
      );
      if (profScan.error) {
        // Do NOT swallow. This check degrades; the rest of the run stands.
        notes.push(`tier cross-check skipped: profiles read failed (${profScan.error.message})`);
      } else {
        const profCap = scanDefect("profiles", profScan);
        if (profCap) caps.push(profCap);
        // Resolve the LIVE rate per job, exactly as getHelperFeePercent would
        // at payout time (tier + expiry, expiry handled the same way). The
        // comparison itself cannot happen here: it needs the payout ledger,
        // which is read further down, so it is deferred to liveFeeByJob.
        const tierBy = new Map(profScan.rows.map((p) => [p.user_id as string, p]));
        for (const job of payoutJobs) {
          const prof = job.helper_id ? tierBy.get(job.helper_id as string) : null;
          if (!prof) continue;
          const expired = prof.subscription_expires_at
            ? new Date(prof.subscription_expires_at as string).getTime() < Date.now()
            : false;
          liveFeeByJob.set(job.id as string, {
            ladder: feePercentForTier(expired ? "free" : (prof.subscription_tier as string | null)),
            tier: expired ? "expired→free" : ((prof.subscription_tier as string | null) ?? "free"),
          });
        }
      }
    }

    // ── Payout ledger ────────────────────────────────────────────────────────
    type TransferRow = {
      job_id: string;
      amount_cents: number | null;
      platform_fee_cents: number | null;
      status: string | null;
      stripe_transfer_id: string | null;
    };
    const transferScan = await scanAll<TransferRow>("payout_transfers", (countOpt) =>
      admin
        .from("payout_transfers")
        .select("job_id, amount_cents, platform_fee_cents, status, stripe_transfer_id", countOpt)
        .order("id", { ascending: true }),
    );
    if (transferScan.error) throw new Error(`payout_transfers read failed: ${transferScan.error.message}`);
    // A TRUNCATED payout ledger does not hide findings here — it MANUFACTURES
    // them. `paidJobIds` is built from whatever came back, so every `released`
    // job whose transfer row fell outside a short read is reported as
    // `released_without_payout_transfer`: "money supposedly left, with no
    // record of where." That is a CRITICAL, and a critical that fires because a
    // scan came up short is how an alarm gets muted. `transferFeeMismatch` has
    // the same exposure for the same reason.
    //
    // So both ledger checks degrade to "skipped", exactly as the dispute
    // cross-check below already does. Skipping is recorded in `notes`, which
    // feeds the defect count and the degraded Slack alert, so the skip is
    // louder than the false criticals would have been — and honest.
    const transferCap = scanDefect("payout_transfers", transferScan);
    const transfers = transferScan.rows;

    // Only rows where money actually moved count as "this job was paid".
    //
    // This used to be `status !== 'reversed'`, an allow-everything-else test
    // that was correct only because 'failed' rows never existed — nothing in
    // the payout set ever wrote one. They do now (the claim protocol in
    // _shared/payoutClaim.ts records every failed attempt), and so do 'pending'
    // CLAIM rows written moments before a transfer that may never happen. Under
    // the old test both would have counted as payment, and
    // `released_without_payout_transfer` — a critical check — would have gone
    // quiet on exactly the jobs it exists to catch.
    // Money is out, and stayed out, iff the row is 'paid' — or 'pending' with a
    // REAL Stripe transfer id, which is the brief window between
    // transfers.create returning and the row being stamped paid.
    //
    // 'reversed' and 'reversal_cleared' both mean money was clawed back, so
    // neither counts. A 'pending' row with a NULL id is a CLAIM taken moments
    // before a transfer that may never happen, and 'failed'/'canceled' are
    // attempts that moved nothing.
    const isSettledTransfer = (t: { status: unknown; stripe_transfer_id?: unknown }) =>
      String(t.status) === "paid" ||
      (String(t.status) === "pending" && t.stripe_transfer_id != null);
    if (transferCap) {
      notes.push(`payout-ledger checks skipped: ${transferCap}`);
    } else {
    const paidJobIds = new Set(
      transfers.filter(isSettledTransfer).map((t) => t.job_id as string),
    );
    for (const job of jobRows) {
      if (job.payment_status === "released" && !paidJobIds.has(job.id as string)) {
        checks.releasedNoTransfer.add({ job_id: job.id, budget: money(job.budget) });
      }
      // The inverse divergence: a 'refunded' job that STILL carries a live
      // payout means the refund walked over a settled payout with no reversal —
      // the double outflow. `paidJobIds` is exactly the settled (paid /
      // pending-with-id) set, so a 'refunded' job in it is the hole.
      if (job.payment_status === "refunded" && paidJobIds.has(job.id as string)) {
        checks.refundedWithLivePayout.add({ job_id: job.id, budget: money(job.budget) });
      }
    }

    for (const t of transfers) {
      const job = jobById.get(t.job_id as string);
      // A transfer whose job is outside this scan's scope (e.g. a seed job on a
      // non-seed run) is not a finding — it simply wasn't audited here.
      if (!job) continue;
      // Only settled rows carry a real commission to compare. A 'failed' attempt
      // records 0 and a 'pending' claim records an estimate; grading either
      // against jobs.platform_fee_amount would manufacture a critical finding
      // out of a row that never moved money.
      if (!isSettledTransfer(t)) continue;
      const expectedCents = Math.round(money(job.platform_fee_amount) * 100);
      const storedCents = Math.round(Number(t.platform_fee_cents ?? 0));
      if (expectedCents !== storedCents) {
        checks.transferFeeMismatch.add({
          job_id: t.job_id,
          transfer_platform_fee_cents: storedCents,
          job_platform_fee_cents: expectedCents,
          transfer_amount_cents: Number(t.amount_cents ?? 0),
        });
      }

      // Did the helper's live tier actually reach the money? Recompute the
      // commission from the LIVE ladder over the same per-helper budget
      // release-payout uses, and compare it to what the settled transfer
      // recorded. A mismatch is a discount that genuinely was not applied.
      const live = liveFeeByJob.get(t.job_id as string);
      if (live) {
        const helpers = job.is_group_job ? Math.max(1, Number(job.helpers_needed ?? 1)) : 1;
        const liveCents = Math.round(
          helperCommissionDollars(money(job.budget) / helpers, live.ladder) * 100,
        );
        if (liveCents !== storedCents) {
          checks.tierDrift.add({
            job_id: t.job_id,
            tier: live.tier,
            live_tier_percent: live.ladder,
            expected_commission_cents: liveCents,
            transfer_commission_cents: storedCents,
          });
        }
      }
    }
    } // end payout-ledger checks

    // ── Dispute flag vs dispute rows ─────────────────────────────────────────
    const flaggedJobIds = jobRows.filter((j) => j.has_active_dispute === true).map((j) => j.id as string);
    if (flaggedJobIds.length) {
      const disputeScan = await scanAllIn<Record<string, unknown>>(
        "disputes",
        flaggedJobIds,
        (chunk, countOpt) =>
          admin
            .from("disputes")
            .select("job_id", countOpt)
            .order("id", { ascending: true })
            .in("job_id", chunk),
      );
      // A TRUNCATED dispute read makes flagged jobs look like they have NO
      // dispute row, and `dispute_flag_without_row` is a CRITICAL. So an
      // incomplete read here does not merely hide findings, it MANUFACTURES
      // them — and a critical that fires because a scan came up short is how
      // people learn to ignore an alarm. Both failures therefore degrade the
      // check to "skipped" rather than grading a partial set.
      const disputeCap = scanDefect("disputes", disputeScan);
      if (disputeCap) {
        // `notes` only, not `caps` as well — both feed the defect list below
        // and a skipped check should be one defect, not two.
        notes.push(`dispute cross-check skipped: ${disputeCap}`);
      } else {
        const withDispute = new Set(disputeScan.rows.map((d) => d.job_id as string));
        for (const id of flaggedJobIds) {
          if (!withDispute.has(id)) checks.disputeNoRow.add({ job_id: id });
        }
      }
    }

    // Inverse direction. Mirrors trg_sync_has_active_dispute's predicate
    // exactly, so a finding here means the derived flag stopped being derived
    // (trigger dropped, disabled, or renamed out of its post-escalation sort
    // slot) — not that some individual write path forgot to set it.
    for (const job of jobRows) {
      const ds = (job.dispute_status ?? null) as string | null;
      const settled = ds === "resolved" || ds === "auto_resolved";
      const live = !settled && (job.status === "disputed" || ds !== null);
      if (live && job.has_active_dispute !== true) {
        checks.disputeFlagMissing.add({
          job_id: job.id,
          status: job.status,
          dispute_status: ds,
        });
      }
    }

    // ── Credit conservation ──────────────────────────────────────────────────
    // `time_credits` was the only credit table carrying a denormalized running
    // balance that could disagree with its own ledger, and migration
    // 20260901035602 dropped it. `referral_credits` still has no cached balance
    // and no `profiles` mirror, so there is no second copy to drift.
    //
    // `gift_cards` DOES need asserting, and this file used to say it did not.
    // Not for a balance — for the derived-value tree. A donation mints children
    // (`parent_credit_id`): `redeem_gift_card` mints the leftover when a gift is
    // bigger than the job it funds, and `restore_gift_card_for_job` mints a
    // replacement when a gift-funded job is cancelled. When the donation behind
    // that tree is refunded or charged back, every unspent node must be
    // 'refunded' too. A node still reading 'paid' under a 'refunded' ancestor is
    // spendable money conjured out of a reversal.
    {
      const { data: giftRows, error: giftErr } = await admin
        .from("gift_cards")
        .select("id, parent_credit_id, payment_status, status, amount, job_id");

      // Never swallow this. A dropped error here reads as "no gift defects",
      // which is exactly the false all-clear this function exists to prevent.
      if (giftErr) {
        throw new Error(`money-reconciliation: gift_cards read failed: ${giftErr.message}`);
      }

      const gifts = (giftRows ?? []) as Array<{
        id: string;
        parent_credit_id: string | null;
        payment_status: string | null;
        status: string | null;
        amount: number | null;
        job_id: string | null;
      }>;
      const byId = new Map(gifts.map((g) => [g.id, g]));

      /** Walk to the root, bounded, so a cyclic parent chain cannot hang the run. */
      const hasRefundedAncestor = (row: typeof gifts[number]): boolean => {
        const seen = new Set<string>([row.id]);
        let cur = row.parent_credit_id ? byId.get(row.parent_credit_id) : undefined;
        while (cur && !seen.has(cur.id)) {
          if (cur.payment_status === "refunded") return true;
          seen.add(cur.id);
          cur = cur.parent_credit_id ? byId.get(cur.parent_credit_id) : undefined;
        }
        return false;
      };

      for (const g of gifts) {
        if (g.payment_status === "paid" && hasRefundedAncestor(g)) {
          checks.giftRevokedChildSpendable.add({
            gift_card_id: g.id,
            parent_credit_id: g.parent_credit_id,
            status: g.status,
            amount: money(g.amount ?? 0),
          });
        }
        if (g.payment_status === "refunded" && g.status === "redeemed") {
          checks.giftSpentRevokedUnpaged.add({
            gift_card_id: g.id,
            job_id: g.job_id,
            amount: money(g.amount ?? 0),
          });
        }
      }
    }

    // ── Settled jobs vs Stripe (docs/OPEN.md Q50) ────────────────────────────
    // WHY: on 2026-09-23 the DB showed 79 cancelled jobs with a PaymentIntent,
    // every one payment_status 'cancelled'/'refunded' — "no live holds". That
    // was the DB grading itself. A one-off read of Stripe that day agreed (0
    // requires_capture, all 79 captured then refunded, each refund equal to its
    // payment_refunds row), but nothing would have noticed the day they did
    // not: void-cancelled-payments and cancel_escrow only select jobs still in
    // 'escrow', so a job flipped settled while its money stayed at Stripe is
    // never looked at again. This is the standing comparison.
    //
    // seed-policy: follows the run's seed scope (`jobRows` is is_seed = false unless
    // ?include_seed=1). READ-ONLY: paymentIntents.retrieve and nothing else.
    const settledWithPi = jobRows
      .filter((j) =>
        (j.payment_status === "cancelled" || j.payment_status === "refunded") &&
        typeof j.stripe_payment_intent_id === "string" && j.stripe_payment_intent_id !== ""
      )
      .map((j) => ({ job: j, at: ts(j.cancelled_at) ?? ts(j.updated_at) ?? 0 }))
      // An unknown timestamp sorts oldest but is NOT exempted by the window:
      // "we cannot tell when" must not become a silent pass.
      .filter(({ at }) => at === 0 || nowMs - at <= STRIPE_LOOKBACK_MS)
      .sort((a, b) => b.at - a.at);
    let stripeReads = 0;
    if (settledWithPi.length) {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) {
        notes.push(`stripe comparison skipped: STRIPE_SECRET_KEY not set (${settledWithPi.length} settled job(s) unchecked)`);
      } else {
        if (settledWithPi.length > MAX_STRIPE_READS) {
          caps.push(`stripe comparison: ${settledWithPi.length} settled jobs in the last ${STRIPE_LOOKBACK_DAYS}d, only the newest ${MAX_STRIPE_READS} checked`);
        }
        const batch = settledWithPi.slice(0, MAX_STRIPE_READS).map((x) => x.job);

        // The refund ledger for exactly these jobs. A short or failed read would
        // MANUFACTURE ledger mismatches, so either one skips that check only.
        const refundScan = await scanAllIn<{ job_id: string; amount_cents: number | null }>(
          "payment_refunds",
          batch.map((j) => j.id as string),
          (chunk, countOpt) =>
            admin
              .from("payment_refunds")
              .select("job_id, amount_cents", countOpt)
              .order("id", { ascending: true })
              .in("job_id", chunk),
        );
        const refundCap = scanDefect("payment_refunds", refundScan);
        let ledgerCents: Map<string, number> | null = null;
        if (refundCap) {
          notes.push(`stripe refund-ledger check skipped: ${refundCap}`);
        } else {
          ledgerCents = new Map();
          for (const r of refundScan.rows) {
            ledgerCents.set(r.job_id, (ledgerCents.get(r.job_id) ?? 0) + Math.round(Number(r.amount_cents ?? 0)));
          }
        }

        // Which of these jobs had their refund DECIDED by a dispute split. Not
        // `jobs.dispute_status`: rpc_withdraw_dispute (20260908024937) stamps
        // dispute_status='resolved' permanently on a WITHDRAWN dispute, and
        // poster_cancel_job then cancels such a job normally, so "any
        // dispute_status" exempted ordinary cancellations from the ceiling
        // (lh-money-escrow review, 2026-09-23). Only the disputes row knows —
        // the same ambiguity _shared/unsettledDispute.ts and
        // stripe-webhook/handlers/_chargebackHold.ts document. A decided split
        // that has not EXECUTED did not move this money, so it is graded.
        // A failed/short read falls back to the old, wider exemption (skip any
        // job with a dispute_status) and says so: a missing row would
        // otherwise grade a real split against the ladder and page falsely.
        const splitScan = await scanAllIn<{ job_id: string; status: string | null; execution_status: string | null }>(
          "disputes",
          batch.map((j) => j.id as string),
          (chunk, countOpt) =>
            admin
              .from("disputes")
              .select("job_id, status, execution_status", countOpt)
              .order("id", { ascending: true })
              .eq("status", "decided")
              .in("job_id", chunk),
        );
        const splitCap = scanDefect("disputes", splitScan);
        let decidedBySplit: Set<string> | null = null;
        if (splitCap) {
          notes.push(`stripe under-refund check: dispute-split lookup failed (${splitCap}); every job with a dispute_status was skipped`);
        } else {
          decidedBySplit = new Set(
            splitScan.rows
              .filter((d) => d.status === "decided" && d.execution_status === "executed")
              .map((d) => d.job_id),
          );
        }

        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
        const failures: string[] = [];
        const inspect = async (job: Record<string, unknown>) => {
          const piId = job.stripe_payment_intent_id as string;
          let pi: Stripe.PaymentIntent;
          try {
            pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge.balance_transaction"] });
            stripeReads++;
          } catch (e) {
            const err = e as { statusCode?: number; code?: string; message?: string };
            if (err?.statusCode === 404 || err?.code === "resource_missing") {
              checks.stripePiMissing.add({ job_id: job.id, payment_intent: piId });
            } else {
              failures.push(`${job.id}: ${err?.message ?? String(e)}`);
            }
            return;
          }
          const base = { job_id: job.id, payment_intent: piId, db_payment_status: job.payment_status, stripe_status: pi.status };

          if (pi.status === "requires_capture" || pi.status === "processing") {
            checks.stripeHoldLive.add({ ...base, amount_capturable: pi.amount_capturable, amount: pi.amount });
            return;
          }
          if (pi.status !== "succeeded") return; // canceled / never paid: nothing is held.

          const charge = (pi.latest_charge && typeof pi.latest_charge === "object")
            ? pi.latest_charge as Stripe.Charge
            : null;
          if (!charge) {
            failures.push(`${job.id}: PaymentIntent ${piId} succeeded but its charge was not returned`);
            return;
          }
          // ONE CHARGE PER PAYMENTINTENT is assumed below. A PaymentIntent
          // that succeeds has exactly one successful charge (failed attempts
          // before it move no money), and `latest_charge` is that charge. Not
          // listed with charges.list: that would double the Stripe reads this
          // phase is budgeted on. Instead the assumption is CHECKED — the
          // charge must have captured what the PaymentIntent received — and a
          // PaymentIntent where it did not is a finding, not graded on partial
          // numbers.
          const capturedCents = Math.round(Number(charge.amount_captured ?? 0));
          const receivedCents = Math.round(Number(pi.amount_received ?? 0));
          const refundedCents = Math.round(Number(charge.amount_refunded ?? 0));
          if (capturedCents !== receivedCents) {
            checks.stripeChargeShape.add({
              ...base,
              latest_charge: charge.id,
              amount_received_cents: receivedCents,
              latest_charge_captured_cents: capturedCents,
            });
            return;
          }

          if (ledgerCents) {
            const ledgerRefunded = ledgerCents.get(job.id as string) ?? 0;
            const ledgerBase = {
              ...base,
              stripe_refunded_cents: refundedCents,
              ledger_refunded_cents: ledgerRefunded,
              difference_cents: Math.abs(refundedCents - ledgerRefunded),
            };
            // The DB says more went back than Stripe sent: the poster is owed it.
            if (refundedCents < ledgerRefunded) {
              checks.stripeRefundShort.add({ ...ledgerBase, direction: "ledger_more_than_stripe" });
            }
            // Stripe sent a refund the books never recorded.
            if (refundedCents > ledgerRefunded) {
              checks.stripeRefundUntracked.add({ ...ledgerBase, direction: "stripe_more_than_ledger" });
            }
          }

          // The retention ceiling only has one defined truth on a plain
          // cancellation. A job whose refund an executed dispute split decided
          // settles by the admin's split, and a 'refunded' job that was never
          // cancelled is a dispute/admin refund — neither is graded against
          // the cancellation ladder. A WITHDRAWN dispute is not a split: see
          // decidedBySplit above.
          if (job.status !== "cancelled") return;
          if (decidedBySplit === null ? job.dispute_status != null : decidedBySplit.has(job.id as string)) return;
          const feeCents = Math.round(computeCancellationFee({
            budget: money(job.budget),
            date_needed: job.date_needed as string | null,
            start_time: job.start_time as string | null,
            cancelled_at: job.cancelled_at as string | null,
            helper_id: job.helper_id as string | null,
            helper_confirmed_at: job.helper_confirmed_at as string | null,
          }) * 100);
          const nonRefundableCents = Math.max(
            Math.round(money(job.customer_fee_amount) * 100),
            actualOrEstimatedFeeCents(pi, capturedCents),
          );
          const maxRetainedCents = feeCents + nonRefundableCents;
          const retainedCents = capturedCents - refundedCents;
          // One cent of slack for the two roundings above.
          if (retainedCents > maxRetainedCents + 1) {
            checks.stripeUnderRefunded.add({
              ...base,
              captured_cents: capturedCents,
              refunded_cents: refundedCents,
              retained_cents: retainedCents,
              max_retained_cents: maxRetainedCents,
            });
          }
        };
        const stripeStartedMs = Date.now();
        let reached = 0;
        for (let i = 0; i < batch.length; i += STRIPE_READ_CONCURRENCY) {
          if (Date.now() - stripeStartedMs > STRIPE_PHASE_BUDGET_MS) {
            // Truncation is a defect (caps -> 500), never a quiet sample.
            caps.push(
              `stripe comparison stopped at its ${Math.round(STRIPE_PHASE_BUDGET_MS / 1000)}s budget: ${reached} of ${batch.length} checked`,
            );
            break;
          }
          const slice = batch.slice(i, i + STRIPE_READ_CONCURRENCY);
          await Promise.all(slice.map(inspect));
          reached += slice.length;
        }
        if (failures.length) {
          // A job Stripe could not be asked about is unverified, not clean.
          notes.push(`stripe comparison incomplete: ${failures.length} of ${batch.length} read(s) failed (${failures.slice(0, 3).join(" | ")})`);
        }
      }
    }

    // ── Emit ─────────────────────────────────────────────────────────────────
    //
    // A NON-2xx STATUS FROM THIS FUNCTION IS BY DESIGN, NOT A CRASH.
    // When `defects > 0` the run returns HTTP 500 with a full findings body, so
    // that a defect is loud in cron_run_log.status_code and in any uptime check
    // watching this endpoint. A 500 here means "the reconciler ran fine and
    // found something", and the body is the report — read `defectReasons` and
    // `findings` before concluding anything failed.
    //
    // This is written down because it has already been misread once: a 500 on
    // 2026-09-07 04:55Z was reported up the chain as "money-reconciliation
    // crashes daily". It does not. That was the only non-200 in the log — the
    // three runs before it returned 200 clean — and it fired because a lane had
    // bulk-loaded seed fixtures into prod (79 jobs scanned against 4 the day
    // before), every one of which was torn down afterwards. If you are looking
    // at a 500 here, compare `scanned.jobs` against the previous run before
    // believing anything about the money.
    //
    // SEED FINDINGS DO NOT PAGE (docs/OPEN.md Q90). A `?include_seed=1` run
    // (manual, to prove the checks fire) used to post every hit to
    // #ops-alerts at `critical` and fail the run with a 500: 2026-09-23
    // ~07:54Z it opened ops_alert_ledger c974c7b3 for 17 discrepancies, every
    // one on an is_seed job. A hit is SEED when the job it names is is_seed;
    // those go to `seed_findings`, to the daily digest (postSlackOpsAlert
    // `seed: true`), and never count as a defect. Everything else (a real
    // job's hit, or a hit that names no job, e.g. the gift-card tree) pages
    // exactly as before. On the default run `jobRows` holds no seed job, so
    // nothing here changes what the nightly cron reports.
    const seedJobIds = new Set(
      jobRows.filter((j) => j.is_seed === true).map((j) => j.id as string),
    );
    const isSeedHit = (hit: unknown): boolean => {
      // A gift-card hit is NEVER seed by association: gift_cards has no
      // is_seed of its own, and a REAL card redeemed against a seed job (real
      // accounts do hold fixture jobs) is real money the platform lost — it must
      // page. Only job-scoped hits inherit their job's seed-ness; unknown => real.
      // (Review of a7522133e, 2026-09-23.)
      if ((hit as { gift_card_id?: unknown } | null)?.gift_card_id != null) return false;
      const id = (hit as { job_id?: unknown } | null)?.job_id;
      return typeof id === "string" && seedJobIds.has(id);
    };
    const findings = Object.values(checks)
      .map((c) => c.finding((h) => !isSeedHit(h)))
      .filter((f): f is Finding => f !== null);
    const seedFindings = Object.values(checks)
      .map((c) => c.finding(isSeedHit))
      .filter((f): f is Finding => f !== null);

    const summary = {
      // NOT named `ok`: cronResult owns that key and gives it a narrower
      // meaning (no DEFECTS, i.e. nothing critical and no degraded check).
      // `clean` is this reconciler's own, broader claim: no findings at all,
      // warnings included.
      clean: findings.length === 0,
      scope: includeSeed ? "all jobs (seed included)" : "real jobs only (is_seed = false)",
      scanned: {
        jobs: jobRows.length,
        payout_transfers: transfers.length,
        // `time_credits` was reported here until migration 20260901035602
        // dropped the table. Both the count and its server_total are gone
        // rather than pinned at 0: a zero would read as "scanned it, found
        // nothing", which is a different and untrue claim.
        // What the SERVER says exists for the same filters. Printed next to
        // what was read so "we scanned everything" is a comparison a human can
        // check at a glance rather than a claim to be taken on faith.
        server_totals: {
          jobs: jobScan.total,
          payout_transfers: transferScan.total,
        },
        pages: jobScan.pages + transferScan.pages,
        // PaymentIntents actually retrieved from Stripe this run (Q50). Next to
        // the settled-job count so "no Stripe findings" can be read against how
        // many were really asked about.
        stripe_payment_intents: stripeReads,
        settled_jobs_with_payment_intent: settledWithPi.length,
      },
      checks_run: Object.values(checks).map((c) => c.name),
      findings,
      // Hits on is_seed jobs (only possible with ?include_seed=1). Reported,
      // sent to the digest, never paged and never a defect; see above.
      seed_findings: seedFindings,
      notes,
      scan_caps: caps,
      run_at: new Date().toISOString(),
    };

    const worst: Severity | null = findings.some((f) => f.severity === "critical")
      ? "critical"
      : findings.some((f) => f.severity === "warning")
        ? "warning"
        : findings.length
          ? "info"
          : null;

    // SILENT WHEN CLEAN. That is the entire point — an alarm that speaks every
    // night is an alarm nobody reads. A degraded run (a check that could not
    // run at all) does speak, because a silent reconciler that scanned nothing
    // is indistinguishable from a healthy one.
    const findingFields = (list: Finding[]): Record<string, string | number> => {
      const fields: Record<string, string | number> = {
        scope: summary.scope,
        jobs_scanned: jobRows.length,
      };
      for (const f of list) {
        fields[f.check] = `${f.count}${f.truncated ? "+" : ""} — ${f.sample
          .map((s) => (s as { job_id?: string; time_credit_id?: string }).job_id ??
            (s as { time_credit_id?: string }).time_credit_id ?? "?")
          .join(", ")}`;
      }
      return fields;
    };
    if (seedFindings.length) {
      const seedWorst: Severity = seedFindings.some((f) => f.severity === "critical")
        ? "critical"
        : seedFindings.some((f) => f.severity === "warning") ? "warning" : "info";
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: seedWorst,
        seed: true,
        title: `Money reconciliation found ${seedFindings.length} discrepanc${seedFindings.length === 1 ? "y" : "ies"} on SEED jobs`,
        message:
          "Every job named here is is_seed (a ?include_seed=1 run). Digest only, it does not page. Real jobs are reported separately.",
        fields: findingFields(seedFindings),
      });
    }
    if (worst) {
      const fields = findingFields(findings);
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: worst,
        title: `Money reconciliation found ${findings.length} discrepanc${findings.length === 1 ? "y" : "ies"}`,
        message:
          "Persisted money rows disagree with what the settlement logic derives. This function is read-only — nothing has been corrected. Investigate before the numbers reach a helper's payout, the admin revenue view, or a reliability score.",
        fields,
      });
    } else if (notes.length || caps.length) {
      // A truncated scan belongs here and not in the silent branch. "No
      // findings over an unknown fraction of the money" is not a clean run, and
      // the old `caps` could never reach this line because the condition that
      // produced it — `rows.length >= 5000` against a server that returns 1000
      // — was unsatisfiable.
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "warning",
        title: "Money reconciliation ran degraded",
        message: "No discrepancies found, but one or more checks could not run or could not read every row — a clean result here is not trustworthy.",
        fields: {
          notes: notes.join(" | ") || "none",
          truncated_scans: caps.join(" | ") || "none",
          scope: summary.scope,
        },
      });
    } else {
      console.log(`[money-reconciliation] clean — ${jobRows.length} jobs, ${summary.checks_run.length} checks`);
    }

    // ── Answer the watchers, not just Slack ──────────────────────────────────
    // Two defects were hiding in the old `new Response(...)`:
    //
    // 1. NO `fn` KEY. `sweep_silent_cron_failures` only ingests responses whose
    //    body matches `content ~ '"fn"\s*:\s*"'`, so this function had ZERO
    //    rows in `cron_run_log` despite running daily since 2026-08-28 —
    //    invisible to the watcher built alongside it. `sweep_cron_http_failures`
    //    would likewise have had to guess its name from timestamp proximity.
    //
    // 2. ALWAYS 200. A run that found `critical` discrepancies answered exactly
    //    like a clean one. Slack carried the news and nothing else did, so a
    //    Slack outage or a muted channel erased the finding entirely.
    //
    // `cronResult` fixes both. Defects are the CRITICAL findings plus any
    // degraded note (a check that could not run) — a critical discrepancy is
    // positive evidence that money rows disagree with reality, which is exactly
    // what the convention says should page. Warnings deliberately do NOT count:
    // they are already in Slack and in this body, and a watcher that pages on
    // them is a watcher people mute — the failure mode this file exists to fix.
    const criticalFindings = findings.filter((f) => f.severity === "critical");
    //
    // A TRUNCATED SCAN is a defect too, and it did not used to be one — `caps`
    // was collected and printed and never counted, which was survivable only
    // because the condition that filled it could not occur. Now that the check
    // is against the server's own exact count it can, and a reconciler that
    // read part of the money and reported `ok: true` is the exact failure this
    // function exists to prevent in the data it audits.
    const defectReasons = [
      ...criticalFindings.map((f) => `${f.check}: ${f.count}${f.truncated ? "+" : ""}`),
      ...notes.map((n) => `degraded — ${n}`),
      ...caps.map((c) => `truncated scan — ${c}`),
    ];
    return cronResult(
      "money-reconciliation",
      summary,
      { count: defectReasons.length, reasons: defectReasons },
      corsHeaders,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[money-reconciliation] run failed:", message);
    // A reconciler that dies quietly is the same failure mode it was built to
    // fix, so the crash itself pages ops.
    await postSlackOpsAlert({
      kind: "custom",
      severity: "critical",
      title: "Money reconciliation failed to run",
      message: "The nightly money reconciliation errored. No money invariants were checked on this run.",
      fields: { error: message },
    });
    return cronError("money-reconciliation", message, corsHeaders);
  }
});
