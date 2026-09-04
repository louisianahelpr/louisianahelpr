import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { loadAdminIds } from "../_shared/adminIds.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";

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
    // The money went back to the poster.
    case "refunded":
    case "partially_refunded":
    case "chargeback":
      return "poster";
    default:
      return null;
  }
}

Deno.serve(async (req) => {
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
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
    );

    // Fail loud on a missing key rather than passing "" to the SDK, which the
    // constructor accepts and only throws on later — an undiagnosable generic
    // error. Matches auto-release-payment's upfront config check.
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) throw new Error("Missing required env var: STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-08-27.basil",
    });

    // Find disputed jobs past their 72-hour deadline
    const { data: expiredDisputes, error: fetchErr } = await supabase
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, dispute_reason, disputed_at, dispute_deadline, dispute_status, payment_status, stripe_payment_intent_id, stripe_session_id")
      .eq("status", "disputed")
      .not("dispute_deadline", "is", null)
      .lte("dispute_deadline", new Date().toISOString());

    if (fetchErr) throw fetchErr;

    const resolved: string[] = [];
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
        .in("title", [ESCALATED_TITLE, STUCK_SPLIT_TITLE])
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
        console.error(`[auto-resolve-disputes] ${defectLabel} matched 0 rows — nobody was told`);
        defects.record(`${defectLabel}: insert returned 0 rows`);
        return 0;
      }
      // Mark them sent so a second job in this same run can't re-notify the
      // same admin on the same link.
      for (const p of pending) recentlyRemindedKeys.add(reminderKey(p.user_id, title, link));
      return inserted.length;
    }

    /**
     * Close the `public.disputes` record for a job whose escrow has just been
     * settled. This function used to write `jobs` and NOTHING else, so every
     * auto-resolved dispute left its record `status='open'` forever — and
     * `disputes_one_open_per_job_idx` then made that stale row the only dispute
     * the job could ever have, with `rpc_open_dispute`'s existing-dispute branch
     * re-freezing a settled job off the back of it.
     *
     * A NULL return is legitimate (a dispute filed before `public.disputes`
     * existed has no record to close); an ERROR is not, and is never dropped.
     */
    async function closeDisputeRecord(jobId: string, decisionText: string): Promise<void> {
      const { data: disputeId, error: settleErr } = await supabase.rpc("settle_dispute_record", {
        _job_id: jobId,
        _outcome: "helper",
        _decided_by: null,
        _decision_text: decisionText,
        // The transfer happens later, in release-payout / process-scheduled-payouts.
        // This cron has no transfer id or settled amount to record, and a
        // fabricated $0 would be a claim about money that is simply false.
        _helper_cents: null,
        _refund_cents: null,
        _transfer_id: null,
        _refund_id: null,
      });
      if (settleErr) {
        // PGRST202 = the RPC isn't deployed yet (migration lag window). The job
        // is already settled and correct; the orphan sweep below closes the
        // record on the next tick once the function lands.
        const code = (settleErr as { code?: string }).code;
        console.error(`[auto-resolve-disputes] settle_dispute_record failed for job ${jobId}:`, settleErr);
        defects.record(`settle dispute record ${jobId}: ${settleErr.message}${code ? ` (${code})` : ""}`);
        return;
      }
      console.log(
        disputeId
          ? `[auto-resolve-disputes] closed dispute record ${disputeId} for job ${jobId}`
          : `[auto-resolve-disputes] job ${jobId} had no disputes row to close (pre-table dispute)`,
      );
    }

    for (const job of expiredDisputes || []) {
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

      // ── Fail closed: verify the escrow charge actually succeeded before
      // promising the helper a payout. Auto-resolving a dispute flips the job
      // to payout_pending, which process-scheduled-payouts / auto-release-payment
      // Phase 2 then pays out for real. Without this check a dispute on a job
      // whose PI never captured (or was charged back) would auto-release real
      // money against unfunded escrow. Mirrors auto-release-payment's Step 2. ──
      let paymentIntentId = job.stripe_payment_intent_id as string | null;
      if (!paymentIntentId && job.stripe_session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
          paymentIntentId = typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null;
        } catch (e) {
          console.error(`[auto-resolve-disputes] failed to retrieve session for job ${job.id}:`, e);
          defects.record(`session retrieve ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!paymentIntentId) {
        console.error(`[auto-resolve-disputes] no payment intent for job ${job.id} — cannot auto-release, leaving for admin`);
        continue;
      }
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.status !== "succeeded") {
          console.error(`[auto-resolve-disputes] PI ${paymentIntentId} for job ${job.id} status "${pi.status}" — not auto-releasing`);
          continue;
        }
      } catch (e) {
        console.error(`[auto-resolve-disputes] failed to verify PI for job ${job.id}:`, e);
        defects.record(`PI verify ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      // Non-escalated: auto-release payment to helper.
      // Also flip payment_status to 'payout_pending' so the auto-release-payment
      // cron's Phase 2 (release-payout invocation, gated on RELEASE_PAYOUT_AUTO=1)
      // actually moves the money. Without this, the job sat in escrow forever
      // and the helper got a "payment released" notification that wasn't true.
      //
      // Optimistic concurrency: guard on payment_status="escrow" so a chargeback
      // webhook that fires between our read and this write (flipping the job to
      // "chargeback"/"refunded") isn't blindly overwritten with "payout_pending".
      const { data: claimed, error: updateErr } = await supabase
        .from("jobs")
        .update({
          status: "completed",
          payment_status: "payout_pending",
          // +24h hold before the payout actually fires — a chargeback buffer,
          // matching auto-release-payment. now() would make the job eligible on
          // the very next payout cron tick with no safety window.
          payout_scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          dispute_status: "auto_resolved",
          dispute_resolved_at: new Date().toISOString(),
          dispute_reason: `[AUTO-RESOLVED] Original: ${job.dispute_reason || "N/A"}. Dispute expired after 72 hours without resolution. Payment released to helper.`,
        })
        .eq("id", job.id)
        .eq("payment_status", "escrow")
        .select("id");

      if (updateErr) {
        console.error(`Failed to resolve dispute for job ${job.id}:`, updateErr);
        continue;
      }
      if (!claimed || claimed.length === 0) {
        console.log(`[auto-resolve-disputes] job ${job.id} payment_status changed since read (chargeback/refund race); skipping.`);
        continue;
      }

      // The job is settled — now close the RECORD, in the same tick, so the two
      // sources of truth agree. Runs only after the claim succeeded, so a job
      // this run did not actually resolve never has its dispute closed.
      await closeDisputeRecord(
        job.id,
        "Auto-resolved by platform policy: the dispute passed its 72-hour deadline without the poster resolving or escalating it, so the escrow was released to the helpr.",
      );

      // Notify both parties
      const notifications = [];

      if (job.helper_id) {
        notifications.push({
          user_id: job.helper_id,
          title: "Dispute auto-resolved",
          message: `The dispute on "${job.title}" expired after 72 hours without the poster resolving or escalating. Payment will be released to you.`,
          type: "payment",
          // `?job=`, not `?filter=completed` — `completed` is a legacy key with
          // no chip (the bucket is `done`), and the job may still be settling.
          link: `/my-jobs?job=${job.id}`,
        });
      }

      notifications.push({
        user_id: job.customer_id,
        title: "Dispute auto-resolved",
        message: `The dispute on "${job.title}" was not resolved or escalated within 72 hours. Per platform policy, payment has been released to the helpr.`,
        // The helpr's half of this same event is already `payment` (above); the
        // poster's half said `warning`, so ONE event landed in two different
        // preference categories depending on which side of it you were on.
        type: "payment",
        link: `/my-posts?job=${job.id}`,
      });

      // Notify admins
      const { ok: autoResolvedAdminsOk, ids: autoResolvedAdminIds } = await loadAdminIds(supabase, "auto-resolve-disputes.autoResolved");
      if (!autoResolvedAdminsOk) defects.record(`admin lookup failed for auto-resolution notice job ${job.id}`);

      {
        for (const adminId of autoResolvedAdminIds) {
          notifications.push({
            user_id: adminId,
            title: "Dispute auto-resolved",
            message: `Dispute on "${job.title}" expired without poster action. Payment auto-released to helpr.`,
            type: "admin_alert",
            link: "/admin",
          });
        }
      }

      if (notifications.length > 0) {
        const { error: notifErr } = await supabase.from("notifications").insert(notifications);
        if (notifErr) {
          console.error(`[auto-resolve-disputes] resolution notifications insert failed for job ${job.id}:`, notifErr);
          defects.record(`resolution notifications ${job.id}: ${notifErr.message}`);
        }
      }
      resolved.push(job.id);
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
          // why. `status` / `dispute_status` / `dispute_resolved_at` are all
          // writable by a party to the job, so trusting them here would let the
          // side LOSING a dispute forge a settled-looking job and have this
          // sweep permanently close their own live dispute. They are still
          // checked, as a second condition, never as the only one.
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
    {
      const stuckCutoff = Date.now() - STUCK_SPLIT_MINUTES * 60 * 1000;
      const { data: claimed, error: stuckErr } = await supabase
        .from("disputes")
        .select("id, job_id, execution_status, execution_started_at, execution_error")
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
        const stuck = (claimed ?? []).filter((row) => {
          const startedAt = row.execution_started_at as string | null;
          if (!startedAt) return true;
          const t = Date.parse(startedAt);
          return Number.isNaN(t) || t < stuckCutoff;
        });
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

    // "No payment intent" and "PI not succeeded" are deliberately NOT defects —
    // both leave the dispute for an admin, which is the designed behaviour.
    return cronResult(
      "auto-resolve-disputes",
      {
        resolved: resolved.length,
        ids: resolved,
        dispute_records_swept: sweptRecords.length,
        swept_dispute_ids: sweptRecords,
        stuck_splits: stuckSplits,
      },
      defects.defects,
      corsHeaders,
    );
  } catch (err) {
    console.error("Auto-resolve disputes error:", err);
    return cronError("auto-resolve-disputes", (err as Error).message, corsHeaders);
  }
});
