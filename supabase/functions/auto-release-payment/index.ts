import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts";
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { getHelperFeePercent, jobHelprCommissionDollars, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { flatFeePercentOf } from "../_shared/helprFlatFee.ts";
import { netUrgentFeeDollars } from "../_shared/stripeFees.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { payoutPromiseSentence, readPromisedPayout } from "../_shared/payoutPromise.ts";
import { APPROVAL_WINDOW_HOURS, hoursToMs, payoutDayLabel, standardPayoutAtIso } from "../_shared/escrowTiming.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import { checkPayoutHold, loadPayoutHolds, PAYOUT_HELD_CODE } from "../_shared/payoutHold.ts";
import { CONNECT_HELD_CODES } from "../_shared/livePayoutGate.ts";
import { frozenByBanReview, loadBanReviewUsers } from "../_shared/banReview.ts";
import { loadComeBackJobs, loadRefundHeldJobs } from "../_shared/refundRequestHold.ts";
import { heldByContinueDay, loadContinuingJobs } from "../_shared/continueDay.ts";
import { createStripeModeResolver, StripeModeRefused } from "../_shared/stripeMode.ts";

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

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { global: { fetch: boundedFetch() } });

    // Stripe mode (owner 2026-10-12): each job is verified with the key of its
    // own mode (test accounts on the test key); a job mixing test and real
    // accounts is skipped and counted.
    const stripes = createStripeModeResolver(supabaseAdmin, (key) => new Stripe(key, { apiVersion: "2025-08-27.basil" }));

    // The poster's approval window (owner 2026-10-23): past it, an unapproved job goes to Helpr support.
    const cutoff = new Date(Date.now() - hoursToMs(APPROVAL_WINDOW_HOURS)).toISOString();

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

    // ── Seed subjects never page (docs/OPEN.md Q91) ──────────────────────────
    // On an `?include_seed=1` run the job scans above hold fixtures, and every
    // per-job alert and defect below used to page #ops-alerts exactly like a
    // real failure (money-reconciliation had the same bug, Q90). A job is SEED
    // only by its OWN `jobs.is_seed === true` — never by an associated row, and
    // a missing flag is REAL (unknown => page). Seed jobs' alerts go out with
    // postSlackOpsAlert `seed` (error_logs + daily digest, never Slack, never
    // the ledger) and their defects are reported as `seedDefects`, not counted.
    // ROUTING ONLY: nothing here changes which job is released, paid or skipped.
    // On the default run no seed job is selected, so this set stays empty.
    const seedJobIds = new Set<string>();
    const noteSeed = (rows: Array<{ id: string; is_seed?: boolean | null }> | null | undefined) => {
      for (const r of rows ?? []) if (r.is_seed === true) seedJobIds.add(r.id);
    };
    const seedDefects: string[] = [];
    /** A defect about ONE job: counted, unless that job is a seed fixture. */
    const jobDefect = (jobId: string, reason: string) => {
      if (seedJobIds.has(jobId)) seedDefects.push(reason);
      else defects.record(reason);
    };
    /** Q764: the hold read behind Phase 1's "you'll be paid" notice. */
    const holdBeforePromise = (helperId: string | null) => checkPayoutHold(supabaseAdmin, helperId);

    let dueQuery = supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, urgent_fee, helper_fee_percent, helper_fee_flat_cents, poster_completed_at, helper_completed_at, stripe_session_id, stripe_payment_intent_id, status, is_group_job, helpers_needed, is_seed")
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
    noteSeed(jobs);

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
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, urgent_fee, helper_fee_percent, helper_fee_flat_cents, poster_completed_at, helper_completed_at, stripe_session_id, stripe_payment_intent_id, status, is_group_job, helpers_needed, is_seed")
      .eq("status", "in_progress")
      .eq("payment_status", "escrow")
      .is("poster_completed_at", null)
      .gt("helper_completed_at", cutoff);
    if (!includeSeed) recentQuery = recentQuery.eq("is_seed", false);
    const { data: recentDone, error: recentErr } = await recentQuery;
    noteSeed(recentDone);
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
        // Board 141 (Q2326): never instantly after an agreed "Come back and
        // finish"; those wait out the normal 24 hours. FAIL CLOSED: an
        // unreadable check sends every candidate to the 24-hour path.
        const flaggedJobs = recentDone.filter((j) => flaggedSet.has(j.customer_id));
        const comeBack = await loadComeBackJobs(supabaseAdmin, flaggedJobs.map((j) => j.id));
        if (!comeBack.ok) {
          console.error("[auto-release-payment] come-back read failed; no instant release this run:", comeBack.message);
          defects.record(`instant-release come-back read: ${comeBack.message}`);
        } else {
          for (const j of flaggedJobs) {
            if (comeBack.jobs.has(j.id)) continue;
            instantIds.add(j.id);
            (jobs || []).push(j);
          }
        }
      }
    }

    // ── Revision settle-out (2026-09-05) ──
    // The pass the main query's own comment asks for: "If revision jobs should
    // ever settle on their own, that needs its own pass keyed on
    // revision_deadline — not this one." This is that pass.
    //
    // WHY IT WAS MISSING AND WHY IT MATTERS. The main set excludes every
    // revision job (`.is("revision_requested_at", null)`) and that exclusion is
    // CORRECT — it stopped posters being auto-paid out from under a fix they
    // had formally requested. But nothing was ever written to settle the OTHER
    // end of that flow, so a revision job could never settle at all: the helper
    // delivered the fix, the poster went quiet, and the escrow sat forever. The
    // only exit was the helper filing a dispute — which the UI never suggests,
    // because three separate surfaces promise the opposite:
    //   ActiveJobSection  "payment auto-releases to you"
    //   PostedJobCard     "If no action is taken, payment auto-releases"
    //   create-payment    "If you do nothing, payment auto-releases"
    // Those promises were false. Since 2026-10-23 (owner: nothing is paid
    // without the poster's approval) this pass no longer pays: a fix the poster
    // never answered goes to Helpr support exactly like an unanswered
    // completion (job_approval_escalations, below), and the copy says so.
    //
    // THE GUARD IS DELIBERATELY TIGHT, because the failure mode is paying out
    // money that should not move:
    //   revision_completed_at IS NOT NULL  the helper actually delivered a fix.
    //                                      A revision still being worked on has
    //                                      no deadline running and must not
    //                                      settle.
    //   revision_acceptance_deadline <= now()  the poster's 72h to respond, set
    //                                      by create-payment's resolve_revision
    //                                      branch, has genuinely elapsed.
    //   status = 'revision_requested'      any poster response (approve,
    //   payment_status = 'escrow'          re-request, dispute) moves one of
    //                                      these, so acting on them cannot race
    //                                      a poster who did reply.
    // These rows are escalated, never released (the partition below).
    let revisionQuery = supabaseAdmin
      .from("jobs")
      // The two revision_* columns are selected as well as filtered on: they
      // are what makes this query self-describing next to its two identical
      // siblings, and they are the discriminator the edge-test harness matches
      // on (it keys mock results by column list).
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount, urgent_fee, helper_fee_percent, helper_fee_flat_cents, poster_completed_at, helper_completed_at, revision_completed_at, revision_acceptance_deadline, stripe_session_id, stripe_payment_intent_id, status, is_group_job, helpers_needed, is_seed")
      .eq("status", "revision_requested")
      .eq("payment_status", "escrow")
      .not("revision_completed_at", "is", null)
      .lte("revision_acceptance_deadline", new Date().toISOString());
    if (!includeSeed) revisionQuery = revisionQuery.eq("is_seed", false);
    const { data: revisionDue, error: revisionErr } = await revisionQuery;
    noteSeed(revisionDue);
    if (revisionErr) {
      // Fail open, exactly like the instant-release set above: a broken
      // revision sweep must never take the ordinary 24h releases down with it.
      console.error("[auto-release-payment] revision settle-out query failed:", revisionErr);
      defects.record(`revision settle-out query: ${revisionErr.message}`);
    }
    // ── NOTHING IS PAID WITHOUT THE POSTER'S APPROVAL (owner 2026-10-23) ──
    // A job whose window ran out with no approval (the Helpr marked it done 24 hours ago, or delivered a
    // revision fix 72 hours ago, and the poster said nothing) is no longer completed and paid here. It
    // goes to Helpr support: one job_approval_escalations row (the admin queue), both sides told, and the
    // escrow stays held until the poster or an admin approves, or an admin refunds. Only a job the poster
    // DID approve (poster_completed_at) or pre-approved (Instant Release) is released below.
    // deno-lint-ignore no-explicit-any
    const escalate: Array<{ job: any; reason: "approval" | "revision" }> = [];
    for (const j of revisionDue || []) escalate.push({ job: j, reason: "revision" });
    // deno-lint-ignore no-explicit-any
    const approvedJobs: any[] = [];
    for (const j of jobs || []) {
      if (j.poster_completed_at || instantIds.has(j.id)) approvedJobs.push(j);
      else escalate.push({ job: j, reason: "approval" });
    }

    // ── Revision NEVER DELIVERED → open the dispute (2026-09-11) ──
    // The other half of the revision flow, and the one with no exit at all.
    //
    // The settle-out pass above requires `revision_completed_at IS NOT NULL`,
    // deliberately, because it moves money. So when the helper never delivers
    // the fix, nothing matches it — and nothing else reads `revision_deadline`
    // either: it had ZERO readers in supabase/functions, the only two hits
    // being comments. The helper's "6h 5m remaining" countdown enforced
    // nothing, the poster's card offered a dispute as an OPTIONAL act, and if
    // both parties went quiet the escrow sat indefinitely.
    //
    // So the platform files the dispute the UI already promises the poster,
    // and an admin decides the split. NO MONEY MOVES HERE — these rows are
    // deliberately NOT pushed into `jobs`, so they never reach the release
    // loop below. `open_dispute_as` flips the job to `disputed`, which is what
    // freezes the escrow.
    //
    // IDEMPOTENT TWICE OVER: the job leaves `revision_requested` the moment
    // the dispute opens, so a second sweep does not select it; and if it
    // somehow did, `open_dispute_as`'s existing-open-dispute branch appends
    // nothing and returns the same id rather than inserting a second row.
    let revisionDisputesOpened = 0;
    let undeliveredQuery = supabaseAdmin
      .from("jobs")
      // `revision_deadline` is the discriminator against the two sibling
      // revision reads above — this is the only one keyed on it.
      .select("id, title, revision_deadline, revision_note, is_seed")
      .eq("status", "revision_requested")
      .eq("payment_status", "escrow")
      .is("revision_completed_at", null)
      .not("revision_deadline", "is", null)
      .lte("revision_deadline", new Date().toISOString());
    if (!includeSeed) undeliveredQuery = undeliveredQuery.eq("is_seed", false);
    const { data: undelivered, error: undeliveredErr } = await undeliveredQuery;
    noteSeed(undelivered);
    if (undeliveredErr) {
      // Fail open like its two siblings: a broken dispute sweep must never
      // take the ordinary releases down with it.
      console.error("[auto-release-payment] undelivered-revision query failed:", undeliveredErr);
      defects.record(`undelivered-revision query: ${undeliveredErr.message}`);
    }
    for (const j of undelivered || []) {
      // Long enough to clear the RPC's own 15-character description guard, and
      // written as the admin will read it — they decide this from these words.
      const reason =
        `Revision not delivered before the deadline. The person who posted this job requested a revision on ` +
        `"${j.title ?? "this job"}" and the Helpr did not mark it complete before ` +
        `${j.revision_deadline}. Opened automatically by the platform so the payment is ` +
        `decided rather than left in escrow.`;
      const { error: openErr } = await supabaseAdmin.rpc("open_dispute_as", {
        _job_id: j.id,
        // NULL opener = the platform filed it. See the migration header:
        // the column is nullable, the admin queue never renders it, and
        // rpc_withdraw_dispute correctly refuses to let either party
        // unilaterally withdraw a dispute neither of them opened.
        _opener_id: null,
        _reason: reason,
        _evidence_urls: [],
      });
      if (openErr) {
        // PGRST202 = the RPC has not finished deploying yet. Not a defect on
        // the first tick after a merge; it resolves itself on the next run.
        if ((openErr as { code?: string }).code === "PGRST202") {
          console.log(`[auto-release-payment] open_dispute_as not deployed yet — job ${j.id} deferred`);
          continue;
        }
        console.error(`[auto-release-payment] failed to open dispute for job ${j.id}:`, openErr);
        jobDefect(j.id, `open dispute for undelivered revision ${j.id}: ${openErr.message}`);
        continue;
      }
      revisionDisputesOpened++;
    }

    let released = 0;
    const results: any[] = [];

    // ── Q1324: ban settlement reviews freeze money ─────────────────────────
    // A job whose poster or Helpr is under an OPEN review is not completed or
    // paid until an admin confirms or lifts the ban (owner, 2026-10-05). One
    // read; if it fails, nothing is released this run (fail closed).
    const banReview = await loadBanReviewUsers(supabaseAdmin);
    if (!banReview.ok) {
      console.error("[auto-release-payment] ban review read failed; nothing released this run:", banReview.message);
      defects.record(`ban review read: ${banReview.message}`);
    }

    // ── Board 141 (Q2272): a live refund request holds the job ─────────────
    // A poster asked the Helpr for money back and it is not settled (open,
    // declined awaiting its dispute, or agreed and not yet split): the job is
    // not completed or paid this run. The database refuses the flip too
    // (refuse_payout_pending_while_refund_requested); this read makes it an
    // outcome rather than a refused write. Fails closed: unread, none released.
    const refundHeld = await loadRefundHeldJobs(supabaseAdmin, [...approvedJobs, ...escalate.map((e) => e.job)].map((j) => j.id));
    if (!refundHeld.ok) {
      console.error("[auto-release-payment] refund request read failed; nothing released this run:", refundHeld.message);
      defects.record(`refund request read: ${refundHeld.message}`);
    }

    // ── Continue another day (owner 2026-11-01): the work is not done yet ──
    // A job with an active continue day (proposed or set) waits: no escalation and no instant release while the
    // Helpr is coming back. A poster's own approval still releases (it closes the continue day). Fails closed.
    const continuing = await loadContinuingJobs(supabaseAdmin, [...approvedJobs, ...escalate.map((e) => e.job)].map((j) => j.id));
    if (!continuing.ok) {
      console.error("[auto-release-payment] continue-day read failed; no escalation or instant release this run:", continuing.message);
      defects.record(`continue day read: ${continuing.message}`);
    }

    // ── Helpr support steps in (no money moves) ──
    let escalated = 0;
    if (escalate.length > 0) {
      const { data: adminRows, error: adminsErr } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
      if (adminsErr) {
        console.error("[auto-release-payment] admin list read failed; escalations wait for the next run:", adminsErr.message);
        defects.record(`approval escalation admin read: ${adminsErr.message}`);
      }
      for (const { job, reason } of adminsErr ? [] : escalate) {
        // A live refund request is its own flow with its own clock (board 141); unread = not escalated now.
        const heldByRequest = !refundHeld.ok || refundHeld.jobs.has(job.id);
        if (heldByRequest) {
          results.push({ job_id: job.id, status: "refund_requested", skipped: true });
          continue;
        }
        if (heldByContinueDay(continuing, job.id)) {
          results.push({ job_id: job.id, status: "continuing", skipped: true });
          continue;
        }
        // Filed once per stall, atomically (file_approval_escalation, 20261023143240): a second run finds it
        // open and tells nobody again; a row an admin closed BEFORE this stall began is re-opened (a new
        // cycle, e.g. a revision fix the poster then ignored), so a second stall is never silent.
        const anchor = reason === "revision" ? job.revision_completed_at : job.helper_completed_at;
        const { data: filed, error: escErr } = await supabaseAdmin.rpc("file_approval_escalation", {
          p_job_id: job.id, p_reason: reason, p_anchor: anchor ?? null,
        });
        if (escErr) {
          console.error(`[auto-release-payment] approval escalation for job ${job.id} not filed:`, escErr.message);
          jobDefect(job.id, `approval escalation ${job.id}: ${escErr.message}`);
          continue;
        }
        if (filed !== true) {
          results.push({ job_id: job.id, status: "escalated_before", skipped: true });
          continue;
        }
        // Every Helpr on the job: one for a single job; each member for a crew (jobs.helper_id is NULL on a
        // crew, 20260925154606). An unreadable roster is a defect; the poster and admins are still told.
        let helprIds: string[] = job.helper_id ? [job.helper_id] : [];
        if (job.is_group_job === true) {
          const { data: crew, error: crewErr } = await supabaseAdmin
            .from("group_job_helpers").select("helper_id").eq("job_id", job.id);
          if (crewErr) jobDefect(job.id, `approval escalation crew read ${job.id}: ${crewErr.message}`);
          else helprIds = [...new Set((crew ?? []).map((c: { helper_id: string | null }) => c.helper_id).filter((h): h is string => !!h))];
        }
        const told = (ok: boolean, who: string) => {
          // insertNotifications never throws; a notice that did not land is a defect (the row is filed, so no
          // later run re-sends it).
          if (!ok) jobDefect(job.id, `approval escalation notice to ${who} ${job.id} not written`);
        };
        const title = job.title ?? "your job";
        const waited = reason === "revision" ? "finished the change you asked for" : "marked it done";
        if (job.customer_id) {
          told(await insertNotifications(supabaseAdmin, {
            user_id: job.customer_id, job_id: job.id,
            title: "Please approve your Helpr's work",
            message: `Your Helpr ${waited} on "${title}" and we haven't heard from you. Approve it, or ask for a change if something's wrong. Helpr support will also reach out. Your payment stays held until then.`,
            type: "warning", link: `/posts?job=${job.id}`,
          }), "the person who posted it");
        }
        if (helprIds.length > 0) {
          told(await insertNotifications(supabaseAdmin, helprIds.map((h) => ({
            user_id: h, job_id: job.id,
            title: "Helpr support is stepping in",
            message: `The person who posted "${title}" hasn't approved your work yet, so Helpr support is reaching out to them. Your payment is held safely until the job is approved.`,
            type: "info", link: `/jobs?job=${job.id}`,
          }))), "the Helpr");
        }
        const adminNotices = (adminRows ?? []).map((a: { user_id: string }) => ({
          user_id: a.user_id, job_id: job.id,
          title: "Job waiting on approval",
          message: `"${title}": the Helpr ${reason === "revision" ? "delivered a requested fix 72 hours ago" : `marked it done ${APPROVAL_WINDOW_HOURS} hours ago`} and the person who posted it hasn't answered. The money is held. Approve it for them, refund, or reach out.`,
          type: "admin_alert", link: `/admin?view=stalled&job=${job.id}`,
        }));
        if (adminNotices.length > 0) told(await insertNotifications(supabaseAdmin, adminNotices), "the admins");
        await postSlackOpsAlert({
          kind: "custom",
          severity: "warning",
          seed: seedJobIds.has(job.id) === true,
          title: "Job waiting on approval",
          message: `Job ${job.id}: no approval ${reason === "revision" ? "72h after a revision fix" : `${APPROVAL_WINDOW_HOURS}h after the Helpr marked it done`}. Escrow held; nothing moves until the person who posted it or an admin approves.`,
          fields: { job_id: job.id },
          oncePerDayKey: `approval-escalation:${job.id}`,
        });
        escalated++;
        results.push({ job_id: job.id, status: "escalated" });
      }
    }

    for (const job of approvedJobs) {
      if (!banReview.ok || frozenByBanReview(banReview, job)) {
        results.push({ job_id: job.id, status: "ban_review", skipped: true });
        continue;
      }
      if (!refundHeld.ok || refundHeld.jobs.has(job.id)) {
        results.push({ job_id: job.id, status: "refund_requested", skipped: true });
        continue;
      }
      // An instant release (not the poster's own approval) waits while a continue day is active.
      if (instantIds.has(job.id) && !job.poster_completed_at && heldByContinueDay(continuing, job.id)) {
        results.push({ job_id: job.id, status: "continuing", skipped: true });
        continue;
      }
      // ── Step 0: Gift card detection ──
      // A gift-card-funded job has NO Stripe charge — it was funded from the
      // platform's prepaid balance when a redeemed gift_card was applied.
      // Detect it via a redeemed credit pointing at this job so we can skip
      // the payment-intent resolution + capture verification (which would
      // otherwise dead-end at skipped_no_pi and strand the helper's money).
      // Fail closed on a read error: don't release without knowing.
      const { data: giftCardRow, error: giftCardErr } = await supabaseAdmin
        .from("gift_cards")
        .select("id")
        .eq("job_id", job.id)
        .eq("status", "redeemed")
        .limit(1)
        .maybeSingle();
      if (giftCardErr) {
        console.error(`[auto-release-payment] gift_cards check failed for job ${job.id}:`, giftCardErr);
        results.push({ job_id: job.id, status: "gift_card_check_error", error: giftCardErr.message });
        continue;
      }
      const isPifFunded = !!giftCardRow;

      // ── Step 1: Resolve payment intent ID (skipped for gift cards — no charge) ──
      let paymentIntentId = job.stripe_payment_intent_id;

      if (!isPifFunded) {
        let stripe: Stripe;
        try {
          ({ stripe } = await stripes.clientForJob(job.id, "read"));
        } catch (e) {
          if (!(e instanceof StripeModeRefused)) throw e;
          results.push({ job_id: job.id, status: "stripe_mode_refused", error: e.reason });
          jobDefect(job.id, `stripe mode ${job.id}: ${e.reason}: ${e.message}`);
          continue;
        }
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
            if (isTestObjectUnderLiveKey(e)) {
              logTestObjectUnderLiveKey("auto-release-payment", { job_id: job.id, object: "checkout.session", id: job.stripe_session_id });
              results.push({ job_id: job.id, status: "skipped_test_mode_object", skipped: true });
              continue;
            }
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
          if (isTestObjectUnderLiveKey(e)) {
            logTestObjectUnderLiveKey("auto-release-payment", { job_id: job.id, object: "payment_intent", id: paymentIntentId });
            results.push({ job_id: job.id, status: "skipped_test_mode_object", skipped: true });
            continue;
          }
          console.error(`Failed to verify payment for job ${job.id}:`, e);
          results.push({ job_id: job.id, status: "verify_failed", error: (e as Error).message });
          continue;
        }
      }

      // ── Step 3: Schedule the payout ──
      // STANDARD PAY: 3 days after the poster APPROVED (owner 2026-10-23). Instant Release is the
      // poster's approval given in advance, so its clock starts now. _shared/escrowTiming.ts owns it.
      const payoutTime = standardPayoutAtIso(instantIds.has(job.id) ? null : job.poster_completed_at);

      // Optimistic concurrency: guard on payment_status="escrow" so that if a
      // Stripe chargeback webhook fires between our read (above) and this write,
      // it can flip payment_status to "chargeback" before us. Without this WHERE
      // clause our UPDATE blindly overwrites "chargeback" with "payout_pending",
      // letting process-scheduled-payouts pay out a disputed/chargebacked job.
      //
      // AND on the status this run read (race-class audit 2026-09-14). The
      // payment_status guard alone cannot see the two lifecycle moves that
      // leave escrow untouched: open_dispute_as flips in_progress → disputed
      // and a revision request flips in_progress → revision_requested, both
      // with payment_status still 'escrow'. The Stripe round-trips above hold
      // this row unlocked for hundreds of ms, and enforce_job_status_transition
      // allows disputed → completed and revision_requested → completed, so a
      // dispute filed in that window was overwritten to completed/payout_pending
      // and the payout cron paid the Helpr on a job under dispute.
      const { data: claimed, error: releaseErr } = await supabaseAdmin
        .from("jobs")
        .update({ status: "completed", payment_status: "payout_pending", payout_scheduled_at: payoutTime })
        .eq("id", job.id)
        .eq("status", job.status)
        .eq("payment_status", "escrow")
        .select("id");
      if (releaseErr) {
        console.error(`[auto-release-payment] jobs.update failed for job ${job.id}:`, releaseErr);
        results.push({ job_id: job.id, status: "update_failed" });
        continue;
      }
      if (!claimed || claimed.length === 0) {
        console.log(`[auto-release-payment] job ${job.id} status or payment_status changed since read (dispute / revision / chargeback race); skipping.`);
        results.push({ job_id: job.id, status: "skipped_status_changed" });
        continue;
      }

      // Estimate only — the real transfer in process-scheduled-payouts resolves
      // the tier again at payout time. Keep this preview consistent with it.
      // Group jobs: budget is the total for the roster; each helper earns budget/N.
      //
      // The fallback chain must be IDENTICAL to the payer's, not merely land on
      // the same number in the common case. This used to pass
      // DEFAULT_TIER_FEE_PERCENT straight through and never selected
      // `helper_fee_percent` at all, so the moment a tier read blipped, an Elite
      // job frozen at 8% was previewed at 12 — the helper was told $176 on a
      // $200 job that process-scheduled-payouts would still pay at $184,
      // because THAT function prefers the frozen rate before the free rung.
      //
      // No money was ever wrong here (this path only writes a notification), and
      // that is exactly why it was easy to leave alone. It is still a figure a
      // helper is shown and cannot check — the same defect class as a report
      // emailing the wrong number. Agreeing with the payer costs one column.
      //
      // DEFAULT_TIER_FEE_PERCENT, never a bare 12, so retuning the ladder moves
      // this preview and the payout together.
      // Roadmap F3: a flat-model job keeps its stamp; no tier read.
      const helperFeePercent = flatFeePercentOf(job) ?? await getHelperFeePercent(
        supabaseAdmin,
        job.helper_id,
        job.helper_fee_percent ?? DEFAULT_TIER_FEE_PERCENT,
      );
      const helpersCount = (job.is_group_job && job.helpers_needed > 0) ? job.helpers_needed : 1;
      const perHelperBudget = job.budget / helpersCount;
      // Same rounding as the path that actually pays, so the preview can never
      // quote a cent the transfer won't send.
      const helperCommission = jobHelprCommissionDollars(job, perHelperBudget, helperFeePercent, netUrgentFeeDollars(job.urgent_fee) / helpersCount);
      const helperPayout = perHelperBudget - helperCommission + netUrgentFeeDollars(job.urgent_fee) / helpersCount;
      // Q764: a held Helpr is not promised a payout that every payout path
      // will refuse until the hold is released. The notice is skipped; an
      // unreadable hold skips it too (no promise on an unknown) and is a
      // defect. The job itself still moves to payout_pending as before.
      // (A helper of its own on purpose: src/test/payoutPathsHonourHold.test.ts
      // counts a hold check only in the money site's own or an enclosing
      // function, so this notice check can never stand in for Phase 2's.)
      const promiseHold = await holdBeforePromise(job.helper_id);
      if (promiseHold.kind === "error") {
        console.error(`[auto-release-payment] payout hold read failed for ${job.helper_id} (job ${job.id}); payout notice skipped: ${promiseHold.message}`);
        jobDefect(job.id, `payout hold read ${job.id}: ${promiseHold.message}`);
      }
      // A: the DAY the money is sent (owner 2026-10-23). Both roads here are approvals.
      const payDay = payoutDayLabel(payoutTime);
      if (job.helper_id && promiseHold.kind !== "clear") {
        // Q764: no payout promise to a held (or unreadable) Helpr, but they are still told the job is approved
        // (the trigger's generic notice is skipped on this write; lh-money-escrow review should-fix 9).
        await insertNotifications(supabaseAdmin, {
          user_id: job.helper_id, job_id: job.id, title: "Job approved!",
          message: `"${job.title}" was approved.`, type: "payment", link: `/jobs?job=${job.id}`,
        });
      }
      if (job.helper_id && promiseHold.kind === "clear") {
        await insertNotifications(supabaseAdmin, {
          user_id: job.helper_id,
          job_id: job.id,
          title: "Job approved!",
          message: `"${job.title}" was approved. ${payoutPromiseSentence(await readPromisedPayout(supabaseAdmin, job.helper_id, job, helperPayout), payDay)}`,
          // `?job=`, not `?filter=completed`: `completed` is a legacy filter key
          // with no chip in the five-bucket strip (the bucket is `done`), and the
          // bucket is resolved live by Activity from the job id.
          type: "payment", link: `/jobs?job=${job.id}`,
        });
      }
      if (job.customer_id) {
        await insertNotifications(supabaseAdmin, {
          user_id: job.customer_id,
          job_id: job.id,
          title: "Job complete",
          message: instantIds.has(job.id)
            ? `"${job.title}" was approved by your Instant Release setting. ${job.is_group_job === true ? "Every Helpr on your crew is" : "Your Helpr is"} paid ${payDay}.`
            : `"${job.title}" is complete. You approved it, so ${job.is_group_job === true ? "every Helpr on your crew is" : "your Helpr is"} paid ${payDay}.`,
          type: "info", link: `/posts?job=${job.id}`,
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
        .select("id, title, helper_id, customer_id, budget, urgent_fee, is_group_job, helpers_needed, payout_scheduled_at, is_seed")
        .eq("status", "completed")
        .eq("payment_status", "payout_pending")
        .lte("payout_scheduled_at", new Date().toISOString())
        // ── Group jobs belong to the fan-out path, not here ────────────────
        // release-payout REFUSES a multi-helper roster (index.ts:160) rather
        // than pay 1 of N, and answers 409 plus a CRITICAL Slack page every
        // time. Handing it group jobs therefore cannot ever settle one — it
        // only burns this job's 5-attempt give-up budget and saturates the
        // money alarm, the exact alarm-fatigue outcome
        // GIVE_UP_AFTER_FAILED_ATTEMPTS exists to stop.
        // process-scheduled-payouts (re-scheduled by 20260831195609) is the
        // only path that pays every roster member.
        //
        // `.or(...)`, not `.eq("is_group_job", false)`: the column is
        // nullable and .eq drops NULL rows — which is every legacy
        // single-helper job. This disjunction mirrors release-payout's own
        // predicate `is_group_job && (helpers_needed ?? 1) > 1` so the two
        // agree exactly on what "group" means.
        .or("is_group_job.is.null,is_group_job.eq.false,helpers_needed.lte.1");
      if (!includeSeed) dueQuery2 = dueQuery2.eq("is_seed", false);
      const { data: dueJobs, error: dueJobsErr } = await dueQuery2;
      noteSeed(dueJobs);

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
          jobDefect(job.id, `record failed attempt ${job.id}: ${attemptErr.message}`);
        }
      };

      // ── Payout holds (Q764) ───────────────────────────────────────────────
      // A held Helpr is not attempted at all. release-payout would refuse it
      // too, but as a refusal: this sweep would record a failed attempt every
      // 30 minutes, burn the give-up budget and page on an admin decision. A
      // hold is an outcome; the job stays payout_pending and is paid on the
      // first run after the hold is released. One batched read; if it fails,
      // NO payout is attempted this run (fail closed) and the run is a defect.
      const holdLookup = await loadPayoutHolds(supabaseAdmin, (dueJobs ?? []).map((j) => j.helper_id));
      if (!holdLookup.ok) {
        console.error("[auto-release-payment] payout hold read failed; no payouts attempted this run:", holdLookup.message);
        defects.record(`payout hold read: ${holdLookup.message}`);
      }

      for (const job of holdLookup.ok ? dueJobs ?? [] : []) {
        if (holdLookup.ok && job.helper_id && holdLookup.holds.has(job.helper_id)) {
          payoutResults.push({ job_id: job.id, status: PAYOUT_HELD_CODE, detail: "Helpr is on a payout hold; not attempted" });
          continue;
        }
        // Q1324: the poster (or Helpr) is under an open ban settlement review.
        if (!banReview.ok || frozenByBanReview(banReview, job)) {
          payoutResults.push({ job_id: job.id, status: "ban_review", detail: "an account on this job is under a ban settlement review; not attempted" });
          continue;
        }
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
              // Always use the service role key here rather than forwarding the
              // incoming authHeader. This comment used to explain that as a
              // workaround for release-payout's verify_jwt=true, which made the
              // gateway 401 a CRON_SECRET bearer before the function ran; that
              // is no longer true (config.toml sets verify_jwt=false for it, for
              // the reasons written there). The choice stands on its own anyway:
              // this caller may itself have been invoked with CRON_SECRET, and
              // release-payout is the only function here that also honours an
              // admin JWT — forwarding whatever arrived would make which
              // credential reaches the transfer depend on who invoked us.
              "Authorization": `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ job_id: job.id, initiated_by: "auto" }),
          });
          const json = await resp.json().catch(() => ({}));
          if (resp.ok) {
            paid++;
            payoutResults.push({ job_id: job.id, status: "paid", detail: json.stripe_transfer_id });
          } else if (json.code === PAYOUT_HELD_CODE) {
            // The hold landed between the read above and release-payout's own
            // check. Same outcome as above: not a failed attempt, no page.
            payoutResults.push({ job_id: job.id, status: PAYOUT_HELD_CODE, detail: json.error });
          } else if (typeof json.code === "string" && CONNECT_HELD_CODES.has(json.code)) {
            // Lead 2026-10-23: release-payout refused before any transfer
            // because Stripe does not say the Helpr's account is payable (or
            // refuses the platform). A held payout, already told to ops once a
            // day by release-payout: not a failed attempt, so no give-up page
            // per job while it waits (lh-money-escrow review #4).
            payoutResults.push({ job_id: job.id, status: "payee_not_payable", detail: `${json.code}: ${json.error ?? ""}` });
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
                // Q91: a seed fixture's give-up is digest-only (see seedJobIds).
                seed: seedJobIds.has(job.id),
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
                // `?view=` is the ONLY query param /admin routes on (src/pages/admin/Admin.tsx
                // resolves `searchParams.get("view")` against VIEW_LABELS). This link
                // read `?tab=payouts` for as long as it has existed, which Admin.tsx
                // never looked at — every one of these alerts opened the dashboard home.
                link: "https://www.louisianahelpr.com/admin?view=payouts",
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
        jobDefect(r.job_id, `${r.status} ${r.job_id}${r.error ? `: ${r.error}` : ""}`);
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
        jobDefect(p.job_id, `payout ${p.status} ${p.job_id}: ${p.detail ?? ""}`);
      }
    }

    // Seed jobs' defects: reported in the body and to the digest, never paged
    // and never counted (Q91). Only reachable on an `?include_seed=1` run.
    if (seedDefects.length) {
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "critical",
        seed: true,
        title: `Auto-release hit ${seedDefects.length} defect${seedDefects.length === 1 ? "" : "s"} on SEED jobs`,
        message: "Every job named here is is_seed (an ?include_seed=1 run). Digest only, it does not page. Real jobs are counted in `defects` as usual.",
        fields: { seed_defects: seedDefects.slice(0, 5).join(" | ").slice(0, 900) },
      });
    }

    return cronResult(
      "auto-release-payment",
      { success: true, released, escalated, results, paid, payoutResults, autoPayoutEnabled, revisionDisputesOpened, seedDefects },
      defects.defects,
      corsHeaders,
    );
  } catch (error) {
    console.error("[auto-release-payment] fatal:", error);
    return cronError("auto-release-payment", "Internal server error", corsHeaders);
  }
});
