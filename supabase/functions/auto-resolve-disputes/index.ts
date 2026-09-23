import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { loadAdminIds } from "../_shared/adminIds.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { seedBoundaryDropsRow } from "../_shared/seedBoundary.ts";

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
      .select("id, title, helper_id, customer_id, budget, dispute_reason, disputed_at, dispute_deadline, dispute_status, payment_status, stripe_payment_intent_id, stripe_session_id, disputed_by")
      .eq("status", "disputed")
      .not("dispute_deadline", "is", null)
      .lte("dispute_deadline", new Date().toISOString());

    if (fetchErr) throw fetchErr;

    const resolved: string[] = [];
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

      // ── The filer cannot win by silence ─────────────────────────────────
      //
      // Everything below this point settles the dispute with `_outcome:
      // "helper"` and flips the job to `payout_pending`. That is the right
      // default for a POSTER-filed dispute nobody answered: the poster raised
      // the complaint, went quiet for 72 hours, and the work is presumed done.
      // The counterparty's silence is what loses them the dispute.
      //
      // It is the WRONG default when the HELPER filed. `rpc_open_dispute`
      // authorises either party (`IF _uid <> _customer AND _uid <> _helper
      // THEN RAISE`), and filing freezes the job — so a helper could open a
      // dispute on an `in_progress` job, say nothing for 72 hours, and have
      // this sweep write `status: "completed"` and hand them the full escrow.
      // The poster never approved the work and never released anything; the
      // timeout did it for them. Their only defence was to escalate.
      //
      // Nothing auto-refunds the poster here either — that is the same
      // unevidenced money movement pointed the other way, and it would let a
      // poster win by staying silent after the helper filed. An unattended
      // dispute that the FILER never substantiated has no honest automatic
      // winner, so the money stays in escrow and a human decides.
      //
      // `escalated` is the existing device for exactly this, not a new state:
      // this cron already skips escalated disputes and nags admins daily, the
      // admin queue still lists the job (AdminDisputes filters `jobs.status =
      // 'disputed'`, which escalation preserves), and `helper_abort_job`
      // (20260825190000) already opens ESCALATED disputes on purpose so a
      // helper who walked off a started job cannot be paid in full by a
      // timeout. This closes the gap that migration left open for the ordinary
      // filing path.
      //
      // Written on `jobs.dispute_status`, never `disputes.status` — the
      // latter's CHECK admits only open/decided/withdrawn/superseded, so mirroring it
      // there would throw and abort the sweep.
      if (job.disputed_by && job.helper_id && job.disputed_by === job.helper_id) {
        // Guarded on payment_status="escrow" for the same chargeback race the
        // release path below guards, and `.select("id")` because a null error
        // on a zero-row update would read as "escalated" while the deadline
        // stayed live and the next tick paid the helper anyway.
        const { data: escalatedRows, error: escalateErr } = await supabase
          .from("jobs")
          .update({ dispute_status: "escalated" })
          .eq("id", job.id)
          .eq("payment_status", "escrow")
          .select("id");
        if (escalateErr) {
          console.error(`[auto-resolve-disputes] failed to escalate helper-filed dispute on job ${job.id}:`, escalateErr);
          defects.record(`escalate helper-filed ${job.id}: ${escalateErr.message}`);
          continue;
        }
        if (!escalatedRows || escalatedRows.length === 0) {
          console.log(`[auto-resolve-disputes] job ${job.id} payment_status changed since read; not escalating.`);
          continue;
        }
        const { ok: helperFiledAdminsOk, ids: helperFiledAdminIds } = await loadAdminIds(supabase, "auto-resolve-disputes.helperFiled");
        if (!helperFiledAdminsOk) defects.record(`admin lookup failed for helper-filed escalation job ${job.id}`);
        await remindAdmins(
          helperFiledAdminIds,
          ESCALATED_TITLE,
          `"${job.title}" was disputed by the Helpr, who did not substantiate it within 72 hours. ` +
            `The escrow was NOT auto-released — it needs an admin decision.`,
          `/admin?view=disputes&job=${job.id}`,
          `helper-filed escalation job ${job.id}`,
        );
        escalatedHelperFiled.push(job.id);
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

      // ── Take the settlement claim before the flip ───────────────────────
      //
      // The flip below is this sweep's money step: `payout_pending` is what
      // release-payout / process-scheduled-payouts pay out for real. Its
      // `payment_status = 'escrow'` guard sees a chargeback that already
      // committed, but NOT an admin Quick Refund in flight — create-payment runs
      // `stripe.refunds.create` BEFORE its own guarded flip, and for that whole
      // window the job still reads disputed/escrow. The sweep won the flip, the
      // admin's flip matched zero rows, and the Helpr was paid 24h later on top
      // of the refund.
      //
      // `claim_dispute_settlement` is the one lock create-payment's Quick
      // Release/Refund and execute-dispute-split already share (20260915034822).
      // Taken HERE — after every check above that can skip without moving
      // anything, immediately before the flip — as action 'sweep', which is
      // none of the others, so all four are mutually exclusive.
      //
      // Anything but a fresh `claimed` skips the job:
      //   held_by_*    another settlement is moving this escrow right now.
      //   joined       another sweep run holds it (overlapping ticks); that run
      //                settles it, and a tokenless joiner must not.
      //   not_disputed the job settled since the read above.
      // An RPC ERROR fails CLOSED and is a defect: PGRST202 means the migration
      // has not deployed, and running unguarded is exactly the race. No payout
      // is lost by skipping — the job stays disputed and the next tick retries.
      const { data: claimRow, error: claimErr } = await supabase.rpc("claim_dispute_settlement", {
        _job_id: job.id,
        _action: "sweep",
        _admin_id: null,
      });
      if (claimErr) {
        const code = (claimErr as { code?: string }).code;
        console.error(`[auto-resolve-disputes] settlement claim failed for job ${job.id}; not auto-resolving:`, claimErr);
        defects.record(`settlement claim ${job.id}: ${claimErr.message}${code ? ` (${code})` : ""} — not auto-resolved`);
        continue;
      }
      const claimVerdict = String((claimRow as { verdict?: string } | null)?.verdict ?? "missing");
      const claimToken = (claimRow as { token?: string } | null)?.token ?? null;
      const overExpired = (claimRow as { over_expired?: boolean } | null)?.over_expired === true;
      if (claimVerdict !== "claimed" || !claimToken) {
        console.log(`[auto-resolve-disputes] job ${job.id} settlement claim answered ${claimVerdict}; not auto-resolving.`);
        claimSkipped.push({ job_id: job.id, verdict: claimVerdict });
        // held_by_* / joined / not_disputed: another settlement is moving it,
        // or already did — the designed outcome, silent. The rest can never
        // clear by waiting, so a person is told (deduped daily), or the sweep
        // would skip them every tick forever with nobody the wiser:
        //   not_settleable  disputed, but the escrow is not held.
        //   split_pending   a decided split has not executed.
        //   stuck_*         a dead holder may have moved money (the claim
        //                   function has already paged ops with the fix).
        if (claimVerdict === "not_settleable" || claimVerdict === "split_pending" || claimVerdict.startsWith("stuck_")) {
          const { ok: stuckAdminsOk, ids: stuckAdminIds } = await loadAdminIds(supabase, "auto-resolve-disputes.unsettleable");
          if (!stuckAdminsOk) defects.record(`admin lookup failed for unsettleable dispute job ${job.id}`);
          await remindAdmins(
            stuckAdminIds,
            UNSETTLEABLE_TITLE,
            `"${job.title}" is past its 72h dispute deadline but can't be auto-settled (${claimVerdict}). It needs an admin decision.`,
            `/admin?view=disputes&job=${job.id}`,
            `unsettleable dispute reminder job ${job.id}`,
          );
          if (claimVerdict.startsWith("stuck_")) {
            defects.record(`dispute job ${job.id}: settlement lock held by a dead ${claimVerdict.slice(6)} — money may be half-moved; reconcile and clear the claim`);
          }
        }
        continue;
      }

      // From here on this run OWNS the claim, and every exit hands it back by
      // token — `finally`, so a `continue` or a throw cannot strand it.
      let flipped = false;
      try {
        // Won by expiring a DEAD holder's claim. That holder may have moved
        // money and died before writing its ledger row or flipping the job —
        // the ledger check below cannot see a write that never happened, and
        // the sweep would then pay the Helpr on top of it (lh-money-escrow
        // review, HIGH-2). A person decides that job; the stale-claim page has
        // already gone out. Released, not held: holding it would only block
        // the admin who comes to fix it.
        if (overExpired) {
          console.error(`[auto-resolve-disputes] job ${job.id}: settlement claim was taken over an expired holder — not auto-resolving over a dead settlement.`);
          defects.record(`settlement claim on ${job.id} was won over an expired holder — not auto-resolved; reconcile against Stripe first`);
          continue;
        }
        // ── The ledger cross-check, same as create-payment's release path ──
        // The claim is a mutex, not a settlement record: it says
        // nothing about a refund that FINISHED but whose flip failed (create-
        // payment leaves that job disputed and pages for manual reconciliation)
        // or whose holder died after Stripe answered. A `payment_refunds` row
        // is written only after Stripe returned the refund, so its existence
        // means the poster already has the money; paying the Helpr as well is
        // the double spend. Fails CLOSED on a read error — indistinguishable
        // from "nothing moved", the one guess that pays twice.
        const { data: refundRows, error: refundLedgerErr } = await supabase
          .from("payment_refunds")
          .select("id")
          .eq("job_id", job.id)
          .limit(1);
        if (refundLedgerErr) {
          console.error(`[auto-resolve-disputes] refund ledger read failed for job ${job.id}; not auto-resolving:`, refundLedgerErr);
          defects.record(`refund ledger read ${job.id}: ${refundLedgerErr.message} — not auto-resolved`);
          continue;
        }
        if ((refundRows ?? []).length > 0) {
          console.error(`[auto-resolve-disputes] job ${job.id} is disputed/escrow but already has a refund ledger row — refusing to schedule a payout on top of it.`);
          defects.record(`refund ledger row exists on disputed job ${job.id} — escrow already refunded, payout NOT scheduled; needs manual reconciliation`);
          continue;
        }

        // ── And Stripe itself, which is not best-effort ───────────────────
        // `recordRefund` swallows its own write failure, so an empty ledger is
        // not proof no refund left. The charge's `amount_refunded` is. Read
        // INSIDE the claim: the PI check above ran before it and cannot see a
        // refund issued since. Fails closed.
        try {
          const chargePi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
          const charge = (chargePi as { latest_charge?: unknown }).latest_charge;
          const refundedCents = charge && typeof charge === "object"
            ? Number((charge as { amount_refunded?: number }).amount_refunded ?? 0)
            : 0;
          // Refunds only. `charge.disputed` stays true after a chargeback is WON,
          // so gating on it deferred that job forever with a defect every run
          // (lh-money-escrow round 2); a live chargeback already reads
          // payment_status 'chargeback' and fails the flip's escrow pin.
          if (refundedCents > 0) {
            console.error(`[auto-resolve-disputes] job ${job.id}: Stripe shows the charge refunded ${refundedCents}¢ — not scheduling a payout.`);
            defects.record(`Stripe charge on disputed job ${job.id} is refunded (${refundedCents}¢) with no matching ledger/flip — payout NOT scheduled; needs manual reconciliation`);
            continue;
          }
        } catch (e) {
          console.error(`[auto-resolve-disputes] Stripe refund check failed for job ${job.id}; not auto-resolving:`, e);
          defects.record(`Stripe refund check ${job.id}: ${e instanceof Error ? e.message : String(e)} — not auto-resolved`);
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
        //
        // AND on the dispute state this run read (race-class audit 2026-09-14).
        // Two party moves keep payment_status 'escrow' and were overwritten:
        //   rpc_withdraw_dispute  restores status (in_progress/…) — the flip then
        //                         wrote completed + payout_pending on a job the
        //                         parties had just taken back out of dispute.
        //   rpc_escalate_dispute  sets dispute_status 'escalated' with status
        //                         still disputed — the flip then paid the Helpr
        //                         out of a dispute the poster had just handed to
        //                         an admin, the one outcome escalation exists to stop.
        // The Stripe round-trips above hold this row unlocked, so the window is real.
        // (The settlement claim above covers the admin/split money paths; these
        // predicates cover the PARTY moves, which take no claim.)
        let claimQuery = supabase
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
            dispute_reason: `[AUTO-RESOLVED] Original: ${job.dispute_reason || "N/A"}. Dispute expired after 72 hours without resolution. Payment released to Helpr.`,
          })
          .eq("id", job.id)
          .eq("status", "disputed")
          .eq("payment_status", "escrow")
          // A withdraw + re-file inside the window returns disputed/open again
          // (ABA): the deadline and filer pin it to the dispute this run judged —
          // a re-filed dispute has a fresh 72h clock, and a Helpr-filed one must
          // escalate (above), never pay.
          .lte("dispute_deadline", new Date().toISOString());
        claimQuery = job.dispute_status == null
          ? claimQuery.is("dispute_status", null)
          : claimQuery.eq("dispute_status", job.dispute_status);
        claimQuery = job.disputed_by == null
          ? claimQuery.is("disputed_by", null)
          : claimQuery.eq("disputed_by", job.disputed_by);
        const { data: claimed, error: updateErr } = await claimQuery.select("id");

        if (updateErr) {
          console.error(`Failed to resolve dispute for job ${job.id}:`, updateErr);
          // A defect, not a log line: the claim and every check passed, so a
          // failed write here is the one thing standing between an expired
          // dispute and its payout, and a 2xx run would hide it.
          defects.record(`resolve flip ${job.id}: ${updateErr.message}`);
          continue;
        }
        if (!claimed || claimed.length === 0) {
          console.log(`[auto-resolve-disputes] job ${job.id} status, dispute_status or payment_status changed since read (withdraw / escalate / chargeback race); skipping.`);
          continue;
        }

        // The job is settled — now close the RECORD, in the same tick, so the two
        // sources of truth agree. Runs only after the claim succeeded, so a job
        // this run did not actually resolve never has its dispute closed.
        await closeDisputeRecord(
          job.id,
          "Auto-resolved by platform policy: the dispute passed its 72-hour deadline without the person who posted this job resolving or escalating it, so the escrow was released to the helpr.",
        );
        flipped = true;
      } finally {
        // Retried once (round 3, M2): a claim left behind by one failed RPC
        // blocks the admin buttons until it expires. A sweep claim is never
        // stamped, so even a leftover only ever expires or is cleared by the
        // monitor as a warning — never a stuck_* or a page.
        let { error: releaseErr } = await supabase.rpc("release_dispute_settlement_claim", {
          _job_id: job.id,
          _token: claimToken,
        });
        if (releaseErr) {
          ({ error: releaseErr } = await supabase.rpc("release_dispute_settlement_claim", {
            _job_id: job.id,
            _token: claimToken,
          }));
        }
        if (releaseErr) {
          // Not a defect: the claim expires on its own, and a leftover on a
          // settled job is reported (not paged) by check_stale_dispute_settlement_claims.
          console.error(`[auto-resolve-disputes] could not release the settlement claim on job ${job.id}:`, releaseErr);
        }
      }
      if (!flipped) continue;

      // Notify both parties
      const notifications = [];

      if (job.helper_id) {
        notifications.push({
          user_id: job.helper_id,
          title: "Dispute auto-resolved",
          message: `The dispute on "${job.title}" expired after 72 hours without the person who posted it resolving or escalating. Payment will be released to you.`,
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
    let seedStuckSplitsSkipped = 0;
    {
      const stuckCutoff = Date.now() - STUCK_SPLIT_MINUTES * 60 * 1000;
      const { data: claimed, error: stuckErr } = await supabase
        .from("disputes")
        .select("id, job_id, execution_status, execution_started_at, execution_error")
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
            .select("id, is_seed")
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

    // "No payment intent" and "PI not succeeded" are deliberately NOT defects —
    // both leave the dispute for an admin, which is the designed behaviour.
    return cronResult(
      "auto-resolve-disputes",
      {
        resolved: resolved.length,
        ids: resolved,
        claim_skipped: claimSkipped,
        escalated_helper_filed: escalatedHelperFiled.length,
        escalated_helper_filed_ids: escalatedHelperFiled,
        dispute_records_swept: sweptRecords.length,
        swept_dispute_ids: sweptRecords,
        stuck_splits: stuckSplits,
        seed_stuck_splits_skipped: seedStuckSplitsSkipped,
      },
      defects.defects,
      corsHeaders,
    );
  } catch (err) {
    console.error("Auto-resolve disputes error:", err);
    return cronError("auto-resolve-disputes", (err as Error).message, corsHeaders);
  }
});
