// money-reconciliation — the alarm for money rows that disagree with reality.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS FUNCTION IS STRICTLY READ-ONLY. It reports; it NEVER "fixes" money.
// Every Supabase call below is a `.select()`. No insert, no update, no upsert,
// no Stripe call, no RPC with side effects. If a future edit adds a write to
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
// that has ever touched Stripe is a seed row.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { computeCancellationFee, hoursUntilJob } from "../_shared/cancellationFee.ts";
import { helperCommissionDollars, feePercentForTier } from "../_shared/helperFees.ts";
import { AUTO_COMPLETE_HOURS } from "../_shared/escrowTiming.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";

/** Offending ids reported per check. A bad day must not emit a 10MB payload. */
const MAX_IDS_PER_CHECK = 10;
/** Hard cap on rows pulled per table, so one runaway table can't OOM the run. */
const SCAN_LIMIT = 5000;
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
  finding(): Finding | null {
    if (!this.hits.length) return null;
    return {
      check: this.name,
      severity: this.severity,
      detail: this.detail,
      count: this.hits.length,
      sample: this.hits.slice(0, MAX_IDS_PER_CHECK),
      truncated: this.hits.length > MAX_IDS_PER_CHECK,
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
      cancellationFee: new Check(
        "cancellation_fee_mismatch",
        "critical",
        "Stored jobs.cancellation_fee disagrees with computeCancellationFee() — the row lies to the helper's fee pill, admin revenue, and reliability record even though escrow settled correctly.",
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
      tierDrift: new Check(
        "helper_fee_percent_off_tier_ladder",
        "warning",
        "jobs.helper_fee_percent differs from the helper's tier rate. This was graded 'info' on the premise that the tier merely changed after payout — that premise is FALSE for every job: the column is stamped from a global setting at ESCROW time, before any helper exists, so it never encoded a tier in the first place. A hit here means the helper's subscription discount was not applied to their commission.",
      ),
      releasedNoTransfer: new Check(
        "released_without_payout_transfer",
        "critical",
        "Job marked payment_status='released' with no payout_transfers ledger row — money supposedly left, with no record of where.",
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
        "Non-zero cancellation_fee with helper_id IS NULL. The ladder charges 0% when nobody was committed, so this fee is owed to no one.",
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
        `payment_status='payout_pending' more than ${PAYOUT_WINDOW_HOURS}h past payout_scheduled_at — the helper was told they would be paid and nothing has moved. This is the END STATE of an unguarded release write (a zero-row flip after the transfer went out) and of a payout that failed with nothing recorded, and until now NOTHING detected it: this reconciler only looked at 'escrow'.`,
      ),
      timeCredits: new Check(
        "time_credit_balance_drift",
        "warning",
        "time_credits.balance_after does not equal the running sum of amount_minutes for that user — the denormalized balance has drifted from its own ledger.",
      ),
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
    let jobQuery = admin
      .from("jobs")
      .select(
        "id, is_seed, status, payment_status, budget, date_needed, cancelled_at, helper_id, cancellation_fee, cancellation_fee_status, late_cancellation, platform_fee_amount, helper_fee_percent, is_group_job, helpers_needed, has_active_dispute, dispute_status, poster_completed_at, helper_completed_at, payout_scheduled_at, updated_at",
      )
      .limit(SCAN_LIMIT);
    if (!includeSeed) jobQuery = jobQuery.eq("is_seed", false);
    const { data: jobs, error: jobsErr } = await jobQuery;
    if (jobsErr) throw new Error(`jobs read failed: ${jobsErr.message}`);
    if ((jobs?.length ?? 0) >= SCAN_LIMIT) caps.push(`jobs scan hit the ${SCAN_LIMIT}-row cap`);

    const jobRows = jobs ?? [];
    const jobById = new Map(jobRows.map((j) => [j.id as string, j]));

    // ── Cancelled-job checks ─────────────────────────────────────────────────
    for (const job of jobRows) {
      if (job.status !== "cancelled") continue;

      // Recompute from the SAME module void-cancelled-payments settles with.
      const expectedFee = computeCancellationFee({
        budget: money(job.budget),
        date_needed: job.date_needed as string | null,
        cancelled_at: job.cancelled_at as string | null,
        helper_id: job.helper_id as string | null,
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
      if (job.helper_id && job.date_needed) {
        const hrs = hoursUntilJob(job.date_needed as string, job.cancelled_at as string | null);
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

      if (storedFee > 0 && !job.helper_id) {
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
    if (payoutHelperIds.length) {
      const { data: profs, error: profErr } = await admin
        .from("profiles")
        .select("user_id, subscription_tier, subscription_expires_at")
        .in("user_id", payoutHelperIds);
      if (profErr) {
        // Do NOT swallow. This check degrades; the rest of the run stands.
        notes.push(`tier cross-check skipped: profiles read failed (${profErr.message})`);
      } else {
        const tierBy = new Map((profs ?? []).map((p) => [p.user_id as string, p]));
        for (const job of payoutJobs) {
          const prof = job.helper_id ? tierBy.get(job.helper_id as string) : null;
          if (!prof) continue;
          const expired = prof.subscription_expires_at
            ? new Date(prof.subscription_expires_at as string).getTime() < Date.now()
            : false;
          const ladder = feePercentForTier(expired ? "free" : (prof.subscription_tier as string | null));
          const pct = Number(job.helper_fee_percent);
          if (Number.isFinite(pct) && pct !== ladder) {
            checks.tierDrift.add({
              job_id: job.id,
              frozen_percent: pct,
              current_tier_percent: ladder,
              tier: expired ? "expired→free" : (prof.subscription_tier ?? "free"),
            });
          }
        }
      }
    }

    // ── Payout ledger ────────────────────────────────────────────────────────
    const { data: transfers, error: trErr } = await admin
      .from("payout_transfers")
      .select("job_id, amount_cents, platform_fee_cents, status, stripe_transfer_id")
      .limit(SCAN_LIMIT);
    if (trErr) throw new Error(`payout_transfers read failed: ${trErr.message}`);
    if ((transfers?.length ?? 0) >= SCAN_LIMIT) caps.push(`payout_transfers scan hit the ${SCAN_LIMIT}-row cap`);

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
    const paidJobIds = new Set(
      (transfers ?? []).filter(isSettledTransfer).map((t) => t.job_id as string),
    );
    for (const job of jobRows) {
      if (job.payment_status === "released" && !paidJobIds.has(job.id as string)) {
        checks.releasedNoTransfer.add({ job_id: job.id, budget: money(job.budget) });
      }
    }

    for (const t of transfers ?? []) {
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
    }

    // ── Dispute flag vs dispute rows ─────────────────────────────────────────
    const flaggedJobIds = jobRows.filter((j) => j.has_active_dispute === true).map((j) => j.id as string);
    if (flaggedJobIds.length) {
      const { data: disputeRows, error: dErr } = await admin
        .from("disputes")
        .select("job_id")
        .in("job_id", flaggedJobIds);
      if (dErr) {
        notes.push(`dispute cross-check skipped: disputes read failed (${dErr.message})`);
      } else {
        const withDispute = new Set((disputeRows ?? []).map((d) => d.job_id as string));
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
    // Only `time_credits` carries a denormalized running balance
    // (`balance_after`) that can disagree with its own ledger. referral_credits
    // and pif_credits have no cached balance column and no `profiles` mirror —
    // their balances are summed live from the rows, so there is no second copy
    // to drift. Nothing to reconcile there; asserting on them would be theatre.
    const { data: tc, error: tcErr } = await admin
      .from("time_credits")
      .select("id, user_id, amount_minutes, balance_after, created_at")
      .order("user_id", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(SCAN_LIMIT);
    if (tcErr) {
      notes.push(`time-credit check skipped: time_credits read failed (${tcErr.message})`);
    } else {
      if ((tc?.length ?? 0) >= SCAN_LIMIT) caps.push(`time_credits scan hit the ${SCAN_LIMIT}-row cap`);
      let currentUser: string | null = null;
      let running = 0;
      for (const row of tc ?? []) {
        const uid = row.user_id as string;
        if (uid !== currentUser) {
          currentUser = uid;
          running = 0;
        }
        running += Number(row.amount_minutes ?? 0);
        const after = row.balance_after;
        if (after !== null && after !== undefined && Number(after) !== running) {
          checks.timeCredits.add({
            time_credit_id: row.id,
            balance_after: Number(after),
            expected_running_balance: running,
          });
        }
      }
    }

    // ── Emit ─────────────────────────────────────────────────────────────────
    const findings = Object.values(checks)
      .map((c) => c.finding())
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
        payout_transfers: transfers?.length ?? 0,
        time_credits: tc?.length ?? 0,
      },
      checks_run: Object.values(checks).map((c) => c.name),
      findings,
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
    if (worst) {
      const fields: Record<string, string | number> = {
        scope: summary.scope,
        jobs_scanned: jobRows.length,
      };
      for (const f of findings) {
        fields[f.check] = `${f.count}${f.truncated ? "+" : ""} — ${f.sample
          .map((s) => (s as { job_id?: string; time_credit_id?: string }).job_id ??
            (s as { time_credit_id?: string }).time_credit_id ?? "?")
          .join(", ")}`;
      }
      await postSlackOpsAlert({
        kind: "custom",
        severity: worst,
        title: `Money reconciliation found ${findings.length} discrepanc${findings.length === 1 ? "y" : "ies"}`,
        message:
          "Persisted money rows disagree with what the settlement logic derives. This function is read-only — nothing has been corrected. Investigate before the numbers reach a helper's payout, the admin revenue view, or a reliability score.",
        fields,
      });
    } else if (notes.length) {
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: "Money reconciliation ran degraded",
        message: "No discrepancies found, but one or more checks could not run — a clean result here is not trustworthy.",
        fields: { notes: notes.join(" | "), scope: summary.scope },
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
    const defectReasons = [
      ...criticalFindings.map((f) => `${f.check}: ${f.count}${f.truncated ? "+" : ""}`),
      ...notes.map((n) => `degraded — ${n}`),
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
