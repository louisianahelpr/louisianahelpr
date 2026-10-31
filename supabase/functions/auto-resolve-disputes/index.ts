import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { loadAdminIds } from "../_shared/adminIds.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { seedBoundaryDropsRow } from "../_shared/seedBoundary.ts";
import { checkIdentityHold, loadJobPayoutHolds, loadPayoutHolds, PAYOUT_HOLD_SPLIT_ERROR, PAYOUT_JOB_HOLD_SPLIT_ERROR } from "../_shared/payoutHold.ts";
import { CONNECT_HOLD_SPLIT_ERROR } from "../_shared/livePayoutGate.ts";
import { frozenByBanReview, loadBanReviewUsers } from "../_shared/banReview.ts";
import { REFUND_AGREEMENT_HELD_ERROR, loadStillHeldAgreements } from "../_shared/refundRequestHold.ts";
import { serve } from "../_shared/buildStamp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Notification titles this cron sends to admins. All three are REMINDERS about
 * a condition that persists between ticks, so all three are deduped through
 * `recentlyRemindedKeys` below — see the comment there for why.
 *
 * Adding a title here is only half the job: it MUST also go into the
 * `.in("title", …)` filter that builds `recentlyRemindedKeys`, or it is never
 * deduped and this cron re-sends it every tick — the exact duplicate flood
 * that comment describes.
 */
const ESCALATED_TITLE = "Escalated dispute overdue";
const STUCK_SPLIT_TITLE = "Dispute split did not settle";
const UNSETTLEABLE_TITLE = "Dispute stuck — escrow cannot auto-settle";

/** One reminder per admin per job per day, not one per cron tick. */
const REMINDER_WINDOW_HOURS = 24;

/**
 * A half-executed split older than this needs a person, not another retry.
 * `execute-dispute-split` claims 'executing' before its first Stripe call and
 * writes 'failed' on any leg failure; both states are re-claimable by design,
 * so a row still sitting in one an hour later means nobody came back to it.
 */
const STUCK_SPLIT_MINUTES = 60;

/**
 * How long a refund the two parties agreed (board 141, decided_via
 * 'agreement') may wait for refund-request-sweep's first hand-out before it
 * counts as stuck: the sweep runs every 10 minutes, so 90 leaves room for a
 * missed run or two without paging anyone.
 */
const AGREEMENT_HANDOUT_MINUTES = 90;

/** Bound every sweep read — a runaway page is a silent partial sweep. */
const SWEEP_LIMIT = 500;

/**
 * `<admin id>|<title>|<link>` — the dedupe key for an admin reminder.
 *
 * `title` is in the key because the two reminder kinds share a job-scoped link.
 * Without it, a job that is BOTH an overdue escalation and a stuck split would
 * send the escalation reminder (which runs first) and silently swallow the
 * "money may be half-moved" one for 24 hours — suppressing the more urgent of
 * the two.
 */
const reminderKey = (userId: string, title: string, link: string) => `${userId}|${title}|${link}`;

/**
 * Which side kept the money, derived from the job the record is being closed
 * against. Returns null when the job's own state does not say — in which case
 * the record is LEFT OPEN and reported, never guessed.
 *
 * Guessing here is not a cosmetic risk. `settle_dispute_record` writes
 * `payout_split` and is terminal — nothing can correct the row afterwards, and
 * the admin cannot re-run the action because create-payment refuses a job that
 * is no longer `disputed`. A sweep that assumed "helper" would have stamped
 * "poster 0% · Helpr 100%" onto every job an admin had REFUNDED to the poster,
 * permanently, in the surface the parties read to see what was decided.
 */
function outcomeFromPaymentStatus(paymentStatus: unknown): "helper" | "poster" | null {
  switch (paymentStatus) {
    // The money went to the helper (or is scheduled to).
    case "released":
    case "payout_pending":
      return "helper";
    // The money went back to the poster. (jobs_payment_status_check admits no
    // partial-refund value, so there is no such case; Q727.)
    case "refunded":
    case "chargeback":
      return "poster";
    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
      { global: { fetch: boundedFetch() } },
    );

    // No Stripe client: since Q2362 this sweep never settles a dispute (it
    // escalates the expired ones to Helpr support), so it makes no Stripe call.

    // Find disputed jobs past their 72-hour deadline
    const { data: expiredDisputes, error: fetchErr } = await supabase
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, dispute_reason, disputed_at, dispute_deadline, dispute_status, payment_status, stripe_payment_intent_id, stripe_session_id, disputed_by, is_group_job")
      .eq("status", "disputed")
      .not("dispute_deadline", "is", null)
      .lte("dispute_deadline", new Date().toISOString());

    if (fetchErr) throw fetchErr;

    // Every expired, unescalated escrow dispute this run handed to support (Q2362).
    const escalatedAtDeadline: string[] = [];
    // Jobs this run left alone because another settlement holds (or shares)
    // the claim. Reported, not a defect: an admin or a split moving the escrow
    // is the designed outcome, and the next tick re-reads the job.
    const claimSkipped: Array<{ job_id: string; verdict: string }> = [];
    // Helper-filed disputes this run pushed to an admin instead of paying out.
    // Reported so the count is visible per run rather than only in the log —
    // a sudden rise is someone probing the timeout for free money.
    const escalatedHelperFiled: string[] = [];
    const defects = defectTracker();

    // ── Which admin reminders already went out in the last day? ─────────────
    // This cron runs every 6 hours (`21 */6 * * *`, 20260829010000). The
    // escalated-dispute reminder had no dedupe at all, so ONE overdue escalated
    // dispute mailed every admin four times a day, forever: production held 168
    // "Escalated dispute overdue" rows across 13 admins for a single seed job,
    // growing 52/day since 2026-08-29. A reminder nobody can clear is a
    // reminder everybody learns to ignore — and it buries the real ones.
    //
    // Fails CLOSED: if the read fails we cannot tell what was already sent, and
    // re-sending is the exact defect being fixed. The run still goes non-2xx via
    // the defect, so the condition is not silent — it just doesn't spam.
    const remindersReadable = { ok: true };
    const recentlyRemindedKeys = new Set<string>();
    {
      const cutoff = new Date(Date.now() - REMINDER_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
      const { data: recent, error: recentErr } = await supabase
        .from("notifications")
        .select("user_id, title, link")
        .in("title", [ESCALATED_TITLE, STUCK_SPLIT_TITLE, UNSETTLEABLE_TITLE])
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(SWEEP_LIMIT);
      if (recentErr) {
        console.error("[auto-resolve-disputes] recent-reminder read failed; suppressing reminders this run:", recentErr);
        defects.record(`recent reminder read: ${recentErr.message}`);
        remindersReadable.ok = false;
      } else if ((recent ?? []).length >= SWEEP_LIMIT) {
        // A TRUNCATED read is worse than a failed one: it looks like a complete
        // answer and its missing rows read as "never reminded", which is
        // precisely how the duplicate flood restarts. Treated exactly like a
        // read failure — suppress and say so.
        console.error(`[auto-resolve-disputes] recent-reminder read hit the ${SWEEP_LIMIT}-row cap; suppressing reminders this run`);
        defects.record(`recent reminder read hit the ${SWEEP_LIMIT}-row cap — dedupe set is incomplete`);
        remindersReadable.ok = false;
      } else {
        for (const n of recent ?? []) {
          if (n.user_id && n.title && n.link) {
            recentlyRemindedKeys.add(reminderKey(n.user_id as string, n.title as string, n.link as string));
          }
        }
      }
    }

    /**
     * Send one admin reminder per admin per link per REMINDER_WINDOW_HOURS.
     * Returns how many actually went out.
     */
    async function remindAdmins(
      adminIds: string[],
      title: string,
      message: string,
      link: string,
      defectLabel: string,
    ): Promise<number> {
      if (!remindersReadable.ok) return 0;
      const pending = adminIds
        .filter((adminId) => !recentlyRemindedKeys.has(reminderKey(adminId, title, link)))
        // `admin_alert`, not `warning`. This fan-out is 246 of the 644
        // operator-facing rows in prod and it is addressed to admins only —
        // typing it as a severity put it in the same preference bucket as
        // "your job was cancelled" (N-011).
        .map((adminId) => ({ user_id: adminId, title, message, type: "admin_alert", link }));
      if (pending.length === 0) return 0;
      // `.select("id")`: notifications has an `id` column, and a null error on a
      // policy-refused insert would otherwise read as "the admins were told".
      const { data: inserted, error: notifErr } = await supabase
        .from("notifications")
        .insert(pending)
        .select("id");
      if (notifErr) {
        console.error(`[auto-resolve-disputes] ${defectLabel} insert failed:`, notifErr);
        defects.record(`${defectLabel}: ${notifErr.message}`);
        return 0;
      }
      if (!inserted || inserted.length === 0) {
        // A seed job's reminder to real admins is dropped BY DESIGN by the
        // Q137 seed boundary (the `&job=` in the link is its subject): not a
        // defect (Q139).
        if ((await seedBoundaryDropsRow(supabase, pending[0])) === true) return 0;
        console.error(`[auto-resolve-disputes] ${defectLabel} matched 0 rows — nobody was told`);
        defects.record(`${defectLabel}: insert returned 0 rows`);
        return 0;
      }
      // Mark them sent so a second job in this same run can't re-notify the
      // same admin on the same link.
      for (const p of pending) recentlyRemindedKeys.add(reminderKey(p.user_id, title, link));
      return inserted.length;
    }

    // Q1324: a dispute on a job whose poster or Helpr is under an OPEN ban
    // settlement review is not auto-resolved (no refund, no payout) until an
    // admin confirms or lifts the ban; the confirm escalates it. One read; if
    // it fails, no dispute is auto-resolved this run (fail closed).
    const banReview = await loadBanReviewUsers(supabase);
    if (!banReview.ok) {
      console.error("[auto-resolve-disputes] ban review read failed; nothing auto-resolved this run:", banReview.message);
      defects.record(`ban review read: ${banReview.message}`);
    }

    for (const job of expiredDisputes || []) {
      if (!banReview.ok || frozenByBanReview(banReview, job)) {
        claimSkipped.push({ job_id: job.id, verdict: "ban_review" });
        continue;
      }
      const disputeStatus = job.dispute_status || "open";

      // If escalated to admin, don't auto-resolve — admin must handle it
      if (disputeStatus === "escalated") {
        // Just send a reminder to admins — at most one per admin per day.
        // The link is job-scoped so two overdue escalations still produce two
        // reminders; `?view=` is the only param Admin.tsx reads, and the extra
        // `job=` is both inert there and the dedupe key here.
        const { ok: escalatedAdminsOk, ids: escalatedAdminIds } = await loadAdminIds(supabase, "auto-resolve-disputes.escalated");
        // loadAdminIds exists to make this failure LOUD — its whole contract is
        // the `ok` flag. Dropping it turns "the user_roles read failed" into an
        // empty list, which remindAdmins treats as "nobody to tell" and the run
        // reports 2xx with the overdue dispute unwatched.
        if (!escalatedAdminsOk) defects.record(`admin lookup failed for escalation reminder job ${job.id}`);
        await remindAdmins(
          escalatedAdminIds,
          ESCALATED_TITLE,
          `"${job.title}" dispute was escalated and is past its 72h deadline. Please resolve ASAP.`,
          `/admin?view=disputes&job=${job.id}`,
          `escalation reminder job ${job.id}`,
        );
        continue;
      }

      // ── A dispute re-opened inside the 24h payout hold ─────────────────
      // `disputed` + `payout_pending`. The flip below is pinned to 'escrow'
      // (a chargeback guard), so it matched zero rows on every tick, forever,
      // silently (lh-money-escrow round 2). Whether the Helpr should now be
      // paid is exactly the question a re-filed dispute asks, so a person
      // decides; the sweep tells them, once a day.
      //
      // ABOVE the helper-filed escalation, on purpose (lh-money-escrow round 3,
      // M4): that escalation is pinned to payment_status='escrow' too, so a
      // HELPER-filed dispute re-opened inside the hold matched zero rows there,
      // logged "payment_status changed since read" and was skipped silently on
      // every tick. Every non-escrow disputed job reaches a person from here,
      // whoever filed it.
      if (job.payment_status !== "escrow") {
        claimSkipped.push({ job_id: job.id, verdict: `payment_${job.payment_status ?? "null"}` });
        const { ok: holdAdminsOk, ids: holdAdminIds } = await loadAdminIds(supabase, "auto-resolve-disputes.payoutHold");
        if (!holdAdminsOk) defects.record(`admin lookup failed for payout-hold dispute job ${job.id}`);
        await remindAdmins(
          holdAdminIds,
          UNSETTLEABLE_TITLE,
          `"${job.title}" is past its 72h dispute deadline with its payment in ${job.payment_status ?? "an unknown state"}, so it can't be auto-settled. It needs an admin decision.`,
          `/admin?view=disputes&job=${job.id}`,
          `payout-hold dispute reminder job ${job.id}`,
        );
        continue;
      }

      // ── Nobody wins by silence: the money stays held for Helpr support ──
      //
      // OWNER RULE (2026-10-23 "never auto-release without the poster's
      // approval"; #3565 answered 2026-10-25, option 1; docs/OPEN.md Q2362):
      // a dispute that nobody settles or escalates within its 72 hours stays
      // HELD until Helpr support decides. It no longer pays the Helpr.
      //
      // Until Q2362 this sweep settled a POSTER-filed dispute for the Helpr
      // (status completed, payout_pending, dispute_status auto_resolved) and
      // escalated only a Helpr-filed one, so a timeout could still move the
      // escrow without the poster's approval. Now every filer takes the path
      // the Helpr-filed dispute already took (helper_abort_job's ESCALATED
      // disputes, 20260825190000): dispute_status 'escalated', which this cron
      // already skips and nags admins about daily (ESCALATED_TITLE above), and
      // which the admin queue still lists (AdminDisputes filters
      // jobs.status = 'disputed', which escalation keeps). Nothing here takes
      // the settlement claim, calls Stripe, flips payment_status or closes the
      // dispute record: escalating moves no money.
      //
      // A CREW has no helper_id (Q407): a dispute filed by anyone but the
      // poster is the Helpr side's filing (Q728); the admin message says which
      // side filed so support knows who went quiet.
      //
      // Guarded on payment_status = 'escrow' (a chargeback that landed since the
      // read must not be overwritten) and on the dispute state this run read,
      // with `.select("id")`: a null error on a zero-row update is not an
      // escalation, and a job a party withdrew or escalated meanwhile is left
      // to that move.
      const helprSideFiled = !!job.disputed_by && (
        (!!job.helper_id && job.disputed_by === job.helper_id) ||
        (job.is_group_job === true && job.disputed_by !== job.customer_id)
      );
      let escalateQuery = supabase
        .from("jobs")
        .update({ dispute_status: "escalated" })
        .eq("id", job.id)
        .eq("status", "disputed")
        .eq("payment_status", "escrow")
        .lte("dispute_deadline", new Date().toISOString());
      escalateQuery = job.dispute_status == null
        ? escalateQuery.is("dispute_status", null)
        : escalateQuery.eq("dispute_status", job.dispute_status);
      const { data: escalatedRows, error: escalateErr } = await escalateQuery.select("id");
      if (escalateErr) {
        console.error(`[auto-resolve-disputes] failed to escalate the expired dispute on job ${job.id}:`, escalateErr);
        defects.record(`escalate expired dispute ${job.id}: ${escalateErr.message}`);
        continue;
      }
      if (!escalatedRows || escalatedRows.length === 0) {
        console.log(`[auto-resolve-disputes] job ${job.id} dispute or payment state changed since read; not escalating.`);
        continue;
      }
      const { ok: expiredAdminsOk, ids: expiredAdminIds } = await loadAdminIds(supabase, "auto-resolve-disputes.expired");
      if (!expiredAdminsOk) defects.record(`admin lookup failed for expired-dispute escalation job ${job.id}`);
      await remindAdmins(
        expiredAdminIds,
        ESCALATED_TITLE,
        `"${job.title}" was disputed by ${helprSideFiled ? "the Helpr" : "the person who posted it"} and nobody settled it within 72 hours. ` +
          `The escrow was NOT released; it is held until an admin decides.`,
        `/admin?view=disputes&job=${job.id}`,
        `expired-dispute escalation job ${job.id}`,
      );
      // Both sides were told the 72-hour clock decides; tell them it did not.
      const partyIds = [job.customer_id, job.helper_id].filter((id): id is string => typeof id === "string" && id.length > 0);
      if (partyIds.length > 0) {
        const { error: partyErr } = await supabase.from("notifications").insert(
          partyIds.map((userId) => ({
            user_id: userId,
            title: "Dispute sent to Helpr support",
            message: `The dispute on "${job.title}" was not settled within 72 hours, so Helpr support will decide it. The payment stays on hold until then.`,
            type: "payment",
            link: userId === job.customer_id ? `/posts?job=${job.id}` : `/jobs?job=${job.id}`,
          })),
        );
        if (partyErr) {
          console.error(`[auto-resolve-disputes] party notice insert failed for job ${job.id}:`, partyErr);
          defects.record(`expired-dispute party notice ${job.id}: ${partyErr.message}`);
        }
      }
      escalatedAtDeadline.push(job.id);
      if (helprSideFiled) escalatedHelperFiled.push(job.id);
    }

    // ── Sweep 1: dispute RECORDS orphaned open on a settled job ─────────────
    // The direct close above covers this tick. This covers everything else:
    // the rows auto-resolution left open before this fix shipped, a crash
    // between the `jobs` claim and the `settle_dispute_record` call, and any
    // future path that settles a dispute's money and forgets its record. It is
    // the reason the fix does not need a trigger on `public.jobs` (which could
    // not be written safely — see the migration's header).
    //
    // The predicate is deliberately narrow: the JOB must already say the
    // dispute is over. `settle_dispute_record` re-checks that itself and RAISEs
    // otherwise, so a live dispute can never be swept closed.
    const sweptRecords: string[] = [];
    {
      const { data: openRecords, error: openRecordsErr } = await supabase
        .from("disputes")
        .select("id, job_id")
        .eq("status", "open")
        .limit(SWEEP_LIMIT);
      if (openRecordsErr) {
        console.error("[auto-resolve-disputes] open-dispute-record read failed:", openRecordsErr);
        defects.record(`open dispute record read: ${openRecordsErr.message}`);
      } else if ((openRecords ?? []).length > 0) {
        if ((openRecords ?? []).length === SWEEP_LIMIT) {
          // A truncated sweep silently leaves rows behind. Say so rather than
          // reporting a clean pass over a partial set.
          defects.record(`open dispute record read hit the ${SWEEP_LIMIT}-row cap — sweep is partial`);
        }
        const jobIds = [...new Set((openRecords ?? []).map((d) => d.job_id as string))];
        const { data: recordJobs, error: recordJobsErr } = await supabase
          .from("jobs")
          .select("id, status, payment_status, dispute_status, dispute_resolved_at")
          .in("id", jobIds);
        if (recordJobsErr) {
          console.error("[auto-resolve-disputes] orphan-sweep job read failed:", recordJobsErr);
          defects.record(`orphan sweep job read: ${recordJobsErr.message}`);
        } else {
          // Keyed on `payment_status` — see settle_dispute_record's own gate for
          // why. `status` / `dispute_status` / `dispute_resolved_at` were once
          // writable by a party to the job; since 20260915033734
          // (enforce_dispute_markers_server_owned) only the dispute RPCs, the
          // server and admins move them (Q964 (5)). They stay a SECOND
          // condition here, never the only one, so a regression in that lock
          // still cannot let the losing side close their own live dispute.
          const settledJobs = new Map<string, "helper" | "poster">();
          for (const j of recordJobs ?? []) {
            const outcome = outcomeFromPaymentStatus(j.payment_status);
            if (!outcome) continue;
            if (j.status === "disputed") continue;
            if (j.dispute_status === "open" || j.dispute_status === "escalated") continue;
            settledJobs.set(j.id as string, outcome);
          }
          for (const record of openRecords ?? []) {
            const outcome = settledJobs.get(record.job_id as string);
            // No outcome = the job's own money state does not say which way it
            // went. LEAVE IT OPEN. `settle_dispute_record` is terminal and
            // writes `payout_split`, so a guess here would stamp a settlement
            // direction that contradicts Stripe onto a row nothing can correct,
            // in the surface both parties read to see what was decided.
            if (!outcome) continue;
            const { error: sweepErr } = await supabase.rpc("settle_dispute_record", {
              _job_id: record.job_id,
              _outcome: outcome,
              _decided_by: null,
              _decision_text:
                "Record closed to match the job: this dispute's escrow was already settled by another path, leaving the record open. Closed by the auto-resolve sweep.",
              _helper_cents: null,
              _refund_cents: null,
              _transfer_id: null,
              _refund_id: null,
            });
            if (sweepErr) {
              console.error(`[auto-resolve-disputes] orphan sweep failed for dispute ${record.id}:`, sweepErr);
              defects.record(`orphan sweep ${record.id}: ${sweepErr.message}`);
              continue;
            }
            sweptRecords.push(record.id as string);
          }
        }
      }
    }

    // ── Sweep 2: splits that claimed the money and never finished ───────────
    // `execute-dispute-split` writes 'executing' before its first Stripe call
    // and 'failed' on a leg failure — a transfer may already have left with the
    // refund leg still owed. Both are re-claimable, so the design intent is
    // that someone comes back; nothing ever looked, and the partial index
    // 20260824230000 created for exactly this question ("which decided splits
    // have not settled yet?") had no reader anywhere in the repo.
    //
    // This does NOT auto-retry: `execute-dispute-split` requires an admin USER
    // jwt (index.ts:126-153), which a cron does not hold, and half-moved money
    // deserves a person regardless. It raises the alarm two ways — a defect, so
    // the run answers non-2xx and the silent-cron watcher fires every tick
    // until a human clears it, and one deduped admin notification per day.
    const stuckSplits: Array<{ id: string; job_id: string; execution_status: string }> = [];
    let seedStuckSplitsSkipped = 0;
    // Q764: splits an admin's payout hold is keeping unexecuted on purpose.
    const heldStuckSplits: Array<{ id: string; job_id: string }> = [];
    {
      const stuckCutoff = Date.now() - STUCK_SPLIT_MINUTES * 60 * 1000;
      const { data: claimed, error: stuckErr } = await supabase
        .from("disputes")
        .select("id, job_id, execution_status, execution_started_at, execution_error, decided_via, decided_at")
        // DECIDED rows only (round-5 review, MEDIUM-2): a dispute superseded by
        // rpc_supersede_dispute_decision keeps its execution record as history,
        // and without this every supersede raised a permanent stuck-split alarm.
        // Guard: src/test/disputeExecutionReadsFilterStatus.test.ts.
        .eq("status", "decided")
        // 'pending' is in here even though nothing writes it today: the CHECK
        // and the partial index both admit it, and "decided, queued, never
        // claimed" is exactly as unsettled as the other two.
        .in("execution_status", ["pending", "executing", "failed"])
        .limit(SWEEP_LIMIT);
      if (stuckErr) {
        console.error("[auto-resolve-disputes] stuck-split read failed:", stuckErr);
        defects.record(`stuck split read: ${stuckErr.message}`);
      } else {
        if ((claimed ?? []).length === SWEEP_LIMIT) {
          defects.record(`stuck split read hit the ${SWEEP_LIMIT}-row cap — sweep is partial`);
        }
        // The age test is done HERE, not as a `.lt("execution_started_at", …)`
        // server-side filter, because SQL comparisons against NULL are false —
        // a row claimed without a timestamp would have slipped past the filter
        // and been silently excluded from the one sweep that watches it. A NULL
        // stamp on a claimed row is MORE alarming than an old one, so it counts
        // as stuck rather than being skipped.
        const aged = (claimed ?? []).filter((row) => {
          // Board 141: a refund the two parties AGREED is queued for the
          // refund-request-sweep (every 10 minutes, retried 30 minutes apart),
          // so a fresh, never-claimed agreement is not stuck yet (lh-money-escrow
          // review, #5). Past the window it is judged like any other split.
          if (row.decided_via === "agreement" && row.execution_status === "pending" && !row.execution_started_at) {
            const decidedAt = Date.parse(String(row.decided_at ?? ""));
            if (Number.isFinite(decidedAt) && decidedAt > Date.now() - AGREEMENT_HANDOUT_MINUTES * 60 * 1000) return false;
          }
          const startedAt = row.execution_started_at as string | null;
          if (!startedAt) return true;
          const t = Date.parse(startedAt);
          return Number.isNaN(t) || t < stuckCutoff;
        });
        // Seed fixtures are not money. Prod holds a decided-but-never-executed
        // split on an is_seed job (dispute c7a12050, job bb2c3732, 2026-09-07),
        // and it alone turned every run of this cron into a 500 and paged every
        // admin daily. A seed job's split is skipped and counted, never paged.
        // If the seed flag cannot be read, every row is treated as real: a
        // missed half-moved payout is worse than one noisy run.
        let stuck = aged;
        if (aged.length > 0) {
          const jobIds = [...new Set(aged.map((row) => row.job_id as string))];
          const { data: seedRows, error: seedErr } = await supabase
            .from("jobs")
            .select("id, is_seed, helper_id")
            .in("id", jobIds);
          if (seedErr) {
            console.error("[auto-resolve-disputes] seed-flag read failed; treating every stuck split as real:", seedErr);
            defects.record(`stuck split seed-flag read: ${seedErr.message}`);
          } else {
            const seedJobIds = new Set(
              (seedRows ?? []).filter((j) => j.is_seed === true).map((j) => j.id as string),
            );
            stuck = aged.filter((row) => !seedJobIds.has(row.job_id as string));
            seedStuckSplitsSkipped = aged.length - stuck.length;

            // ── Payout holds (Q764) ────────────────────────────────────────
            // execute-dispute-split refuses a held Helpr's split BEFORE any
            // leg moves and records PAYOUT_HOLD_SPLIT_ERROR; it waits for the
            // hold, it is not half-moved. Only a split whose recorded error is
            // exactly that AND whose Helpr is still held is set aside (body
            // only, no page). Any other failure on a held Helpr's split still
            // pages. FAIL CLOSED: an unreadable hold exempts nothing.
            const helperByJob = new Map(
              (seedRows ?? []).map((j) => [j.id as string, (j.helper_id as string | null) ?? null]),
            );
            const holdCandidates = stuck.filter((row) =>
              typeof row.execution_error === "string" &&
              (row.execution_error as string).startsWith(PAYOUT_HOLD_SPLIT_ERROR) &&
              !!helperByJob.get(row.job_id as string)
            );
            if (holdCandidates.length) {
              const holds = await loadPayoutHolds(
                supabase,
                holdCandidates.map((row) => helperByJob.get(row.job_id as string)),
              );
              if (!holds.ok) {
                console.error("[auto-resolve-disputes] payout hold read failed; every stuck split stays stuck:", holds.message);
                defects.record(`stuck split payout-hold read: ${holds.message}`);
              } else {
                const heldIds = new Set(
                  holdCandidates
                    .filter((row) => holds.holds.has(helperByJob.get(row.job_id as string) as string))
                    .map((row) => row.id as string),
                );
                for (const row of stuck) {
                  if (heldIds.has(row.id as string)) heldStuckSplits.push({ id: row.id as string, job_id: row.job_id as string });
                }
                stuck = stuck.filter((row) => !heldIds.has(row.id as string));
                // A split waiting on the Helpr's ID (owner 2026-10-30) records the same error with no
                // payout_holds row: nothing moved, so set aside while the ID is still outstanding. Asked
                // per Helpr, FAIL CLOSED: an unreadable answer exempts nothing. Verified since: it pages, as a lifted hold does.
                const idWaiting = new Map<string, boolean>();
                const idHeldIds = new Set<string>();
                for (const row of holdCandidates) {
                  if (!stuck.includes(row)) continue;
                  const helper = helperByJob.get(row.job_id as string) as string;
                  if (!idWaiting.has(helper)) {
                    const idHold = await checkIdentityHold(supabase, helper);
                    if (idHold.kind === "error") defects.record(`stuck split ID check read: ${idHold.message}`);
                    idWaiting.set(helper, idHold.kind === "waits");
                  }
                  if (idWaiting.get(helper)) idHeldIds.add(row.id as string);
                }
                for (const row of stuck) {
                  if (idHeldIds.has(row.id as string)) heldStuckSplits.push({ id: row.id as string, job_id: row.job_id as string });
                }
                stuck = stuck.filter((row) => !idHeldIds.has(row.id as string));
              }
            }

            // ── Agreed refunds held for an admin (board 141) ───────────────
            // refund_agreements_due never settles an agreement automatically
            // when a party is banned, suspended, under a ban review or on a
            // payout hold: it marks an untouched one REFUND_AGREEMENT_HELD_ERROR,
            // the admin queue lists it unsettled, and the sweep paged ops once.
            // Set aside here (body only) ONLY while a party is still held, as
            // the payout-hold block above does; once the hold lifts it is stuck
            // again and pages, so nobody forgets it. FAIL CLOSED: an unreadable
            // check sets nothing aside.
            const agreementCandidates = stuck.filter((row) =>
              typeof row.execution_error === "string" && (row.execution_error as string).startsWith(REFUND_AGREEMENT_HELD_ERROR)
            );
            if (agreementCandidates.length) {
              const stillHeld = await loadStillHeldAgreements(supabase, agreementCandidates.map((row) => row.id as string));
              if (!stillHeld.ok) {
                console.error("[auto-resolve-disputes] held-agreement read failed; every stuck split stays stuck:", stillHeld.message);
                defects.record(`stuck split held-agreement read: ${stillHeld.message}`);
              } else {
                for (const row of stuck) {
                  if (stillHeld.disputes.has(row.id as string)) heldStuckSplits.push({ id: row.id as string, job_id: row.job_id as string });
                }
                stuck = stuck.filter((row) => !stillHeld.disputes.has(row.id as string));
              }
            }

            // ── Live payout gate holds (money review of the live gate, M2) ──
            // execute-dispute-split holds a split BEFORE any leg moves when
            // Stripe does not say the Helpr's account is payable (rejected,
            // not payable, unusable, or Stripe refusing our platform) and
            // records CONNECT_HOLD_SPLIT_ERROR. Nothing moved, so it is not
            // "half-moved": set aside (body only). The dispute stays failed in
            // the admin queue, and a retry re-runs the gate (ops hear once a
            // day). An unexplained "could not verify" is not this and pages.
            {
              const connectHeldIds = new Set(
                stuck
                  .filter((row) => row.execution_status === "failed" && typeof row.execution_error === "string" && (row.execution_error as string).startsWith(CONNECT_HOLD_SPLIT_ERROR))
                  .map((row) => row.id as string),
              );
              for (const row of stuck) {
                if (connectHeldIds.has(row.id as string)) heldStuckSplits.push({ id: row.id as string, job_id: row.job_id as string });
              }
              stuck = stuck.filter((row) => !connectHeldIds.has(row.id as string));
            }

            // ── Job payout holds (Q1491) ───────────────────────────────────
            // The same rule for a JOB hold (job_payout_holds: an underfunded
            // gift-card job): execute-dispute-split refuses it before any leg
            // moves and records PAYOUT_JOB_HOLD_SPLIT_ERROR. Set aside only
            // while that job is still held; FAIL CLOSED on an unreadable read.
            const jobHoldCandidates = stuck.filter((row) =>
              typeof row.execution_error === "string" &&
              (row.execution_error as string).startsWith(PAYOUT_JOB_HOLD_SPLIT_ERROR)
            );
            if (jobHoldCandidates.length) {
              const jobHolds = await loadJobPayoutHolds(supabase, jobHoldCandidates.map((row) => row.job_id as string));
              if (!jobHolds.ok) {
                console.error("[auto-resolve-disputes] job payout hold read failed; every stuck split stays stuck:", jobHolds.message);
                defects.record(`stuck split job-payout-hold read: ${jobHolds.message}`);
              } else {
                const jobHeldIds = new Set(
                  jobHoldCandidates.filter((row) => jobHolds.jobs.has(row.job_id as string)).map((row) => row.id as string),
                );
                for (const row of stuck) {
                  if (jobHeldIds.has(row.id as string)) heldStuckSplits.push({ id: row.id as string, job_id: row.job_id as string });
                }
                stuck = stuck.filter((row) => !jobHeldIds.has(row.id as string));
              }
            }
          }
        }
        const { ok: splitAdminsOk, ids: splitAdminIds } = stuck.length > 0
          ? await loadAdminIds(supabase, "auto-resolve-disputes.stuckSplit")
          : { ok: true, ids: [] as string[] };
        if (!splitAdminsOk) defects.record("admin lookup failed for stuck-split reminders");
        for (const row of stuck) {
          stuckSplits.push({
            id: row.id as string,
            job_id: row.job_id as string,
            execution_status: row.execution_status as string,
          });
          defects.record(
            `stuck dispute split ${row.id} (job ${row.job_id}) has been "${row.execution_status}" since ` +
              `${row.execution_started_at ?? "unknown"}${row.execution_error ? `: ${row.execution_error}` : ""}`,
          );
          await remindAdmins(
            splitAdminIds,
            STUCK_SPLIT_TITLE,
            `A dispute split has been stuck in "${row.execution_status}" since ${row.execution_started_at ?? "an unknown time"}. ` +
              `Money may be half-moved — open the dispute and retry the settlement.`,
            `/admin?view=disputes&job=${row.job_id}`,
            `stuck split reminder dispute ${row.id}`,
          );
        }
      }
    }

    return cronResult(
      "auto-resolve-disputes",
      {
        // Always 0 since Q2362: an expired dispute is escalated, never settled.
        resolved: 0,
        escalated_at_deadline: escalatedAtDeadline.length,
        escalated_at_deadline_ids: escalatedAtDeadline,
        claim_skipped: claimSkipped,
        escalated_helper_filed: escalatedHelperFiled.length,
        escalated_helper_filed_ids: escalatedHelperFiled,
        dispute_records_swept: sweptRecords.length,
        swept_dispute_ids: sweptRecords,
        stuck_splits: stuckSplits,
        seed_stuck_splits_skipped: seedStuckSplitsSkipped,
        held_stuck_splits: heldStuckSplits,
      },
      defects.defects,
      corsHeaders,
    );
  } catch (err) {
    console.error("Auto-resolve disputes error:", err);
    return cronError("auto-resolve-disputes", (err as Error).message, corsHeaders);
  }
});
