// auto-tip-charge — charges a poster's standing auto-tip after a job completes.
//
// Lyft's model: the poster sets a preference once (Profile → Money → Auto-tip)
// and the tip is charged automatically when the work is done. It is NOT
// bundled into the job's original charge — Helpr captures the job in full at
// checkout, so a bundled tip would have to be REFUNDED whenever the poster
// adjusted it down, and Stripe keeps the processing fee on refunds.
//
// Invoked by pg_cron. Never by a user: this moves money without a tap, so the
// only caller is the scheduler holding the service key.
//
// Money shape matches the MANUAL tip exactly (create-payment, action="tip"),
// both computed by `tipChargeBreakdown` (_shared/tipFees.ts): the poster's
// card is charged tip + card-processing fee, the application fee is that
// card-processing fee, and the Helpr's connected account receives exactly the
// tip. The Helpr gets 100%; the poster covers the card fee.
//
// Safety properties, in order of how much they matter:
//   1. At most ONE automatic tip per (job, Helpr), enforced by a UNIQUE index
//      (tips_one_auto_per_job_member, 20260925154606), not by this function's
//      bookkeeping. A single-Helpr job therefore gets one; a crew job gets one
//      per hired member. Overlapping ticks or a slow Stripe call cannot
//      double-charge.
//   2. The tips row is written BEFORE the charge. A row with no payment is
//      recoverable and visible; a payment with no row is money nobody can
//      account for.
//   3. A poster with no saved card is never silently skipped forever — the
//      row records why and is marked prompted, so the app can ask them once.

import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { TIP_MIN_CENTS, tipChargeBreakdown } from "../_shared/tipFees.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { checkIdentityHold, checkPayoutHold } from "../_shared/payoutHold.ts";
import { featureEnabledForUser } from "../_shared/featureSwitch.ts";
import { frozenByBanReview, loadBanReviewUsers } from "../_shared/banReview.ts";
import { createStripeModeResolver, StripeModeRefused, type StripeMode } from "../_shared/stripeMode.ts";
import { storedStripeCustomer, StripeCustomerUnavailable } from "../_shared/stripeCustomer.ts";
import { DESTINATION_REFUSED_HELPR_SENTENCE, noteDestinationChargeRefused } from "../_shared/livePayoutHold.ts";

/** ME-011: a charge whose outcome is unknown (lost response, Stripe 5xx). */
class AmbiguousCharge extends Error {}

/** Stripe answered and refused: no charge was made. */
function isDefiniteRefusal(err: unknown): boolean {
  const type = (err as { type?: string } | null)?.type;
  return type === "StripeCardError" || type === "StripeInvalidRequestError";
}

/**
 * Q1224: auto_tip_candidates() offers a job for 336 hours (14 days) after it
 * was completed (its _since_hours default, 20260925053956). A tip still held on
 * the window's last day is recorded and the poster told, instead of dropping
 * out of the window silently. One day of margin covers missed hourly ticks.
 */
const AUTO_TIP_HELD_RECORD_AFTER_MS = 13 * 24 * 60 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details?: unknown) =>
  console.log(`[auto-tip-charge] ${step}${details ? ` ${JSON.stringify(details)}` : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey =
      Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const cronSecret = Deno.env.get("CRON_SECRET");

    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!serviceRoleKey) missing.push("SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeSecretKey) missing.push("STRIPE_SECRET_KEY");
    if (missing.length) {
      log("misconfigured", { missing });
      return new Response(JSON.stringify({ error: `Missing env: ${missing.join(", ")}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Same guard as the other cron-invoked functions. No user path exists.
    const authHeader = req.headers.get("Authorization");
    const authorized =
      authHeader &&
      ((cronSecret && authHeader === `Bearer ${cronSecret}`) ||
        authHeader === `Bearer ${serviceRoleKey}`);
    if (!authorized) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { persistSession: false },
      global: { fetch: boundedFetch() },
    });
    // Stripe mode (owner 2026-10-12): each tip runs in its job's own mode (test
    // accounts on the test key); a job mixing test and real accounts is skipped.
    const stripes = createStripeModeResolver(supabase, (key) => new Stripe(key, { apiVersion: "2025-08-27.basil" }));

    // No window argument: the function's own default (14 days, anchored on
    // completed_at and on the poster's auto_tip_enabled_at) is the policy, so
    // a missed run drains on the next one and no job finished before the
    // poster opted in is ever tipped (migration 20260925053956, CJ-008).
    const { data: candidates, error: candErr } = await supabase.rpc("auto_tip_candidates");
    if (candErr) {
      log("ERROR loading candidates", { error: candErr.message });
      throw new Error(`auto_tip_candidates failed: ${candErr.message}`);
    }

    const results = { considered: candidates?.length ?? 0, charged: 0, prompted: 0, failed: 0, held: 0, heldAgedOut: 0, closed: 0 };
    /** Q1224: jobs whose poster was already told this run that a held tip aged out. */
    const agedOutNotified = new Set<string>();
    // `results.failed` is NOT the page-worthy counter. It mixes real defects
    // (a read that errored) with business outcomes that recur forever by
    // design: a helper with no connected account, a poster with no saved card,
    // a declined card. Paging on it would fire every hour for one bad card,
    // which is how a watcher gets muted. `defects` counts only the broken ones.
    const defects = defectTracker();
    /**
     * Q2138: tips not charged because the poster's wallet has no stored
     * customer or no default card. One summary defect per run (review of
     * ad052465c #5), so the gap Q2139 closes stays visible without one alert
     * per job.
     */
    const walletGaps: string[] = [];

    // Q1324 (money review 2026-10-06): an account under an open ban
    // settlement review moves no money, as poster or as Helpr, until an admin
    // confirms or lifts it. Read once per run; a failed read charges nothing
    // this run (fail closed) and is a defect.
    // Scoped to this run's parties: an unscoped read past PostgREST's row cap
    // would be truncated, which reads as "not under review" (fails open).
    const parties: string[] = [];
    for (const c of candidates ?? []) {
      for (const id of [c.customer_id, c.helper_id]) if (typeof id === "string" && !parties.includes(id)) parties.push(id);
    }
    const banReview = await loadBanReviewUsers(supabase, parties);
    if (!banReview.ok) {
      log("ERROR reading open ban reviews — charging no tips this run", { error: banReview.message });
      return cronError("auto-tip-charge", `ban review read failed: ${banReview.message}`, corsHeaders);
    }

    /**
     * Records an automatic tip that will never be charged (a 'failed' auto
     * row, which also ends its candidacy) and tells the poster once per job.
     * Used when a held tip ages out (ageOutHeldTip) and at once when the job's
     * money went back (tip_state 'closed', 20261019043709): a tip is never
     * dropped without a row and a word to the poster. Nothing is charged.
     */
    const recordUnsentTip = async (
      c: Record<string, unknown>,
      tipDollars: number,
      failureReason: string,
      posterMessage: string,
      counter: "heldAgedOut" | "closed",
    ): Promise<void> => {
      const jobId = c.job_id as string;
      const { data: agedRow, error: agedErr } = await supabase
        .from("tips")
        .insert({
          job_id: jobId,
          tipper_id: c.customer_id,
          helper_id: c.helper_id,
          amount: tipDollars,
          source: "auto",
          payment_status: "failed",
          failure_reason: failureReason,
          auto_prompt_sent_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (agedErr || !agedRow) {
        // 23505: a row for this (job, member) already exists; it was recorded.
        if ((agedErr as { code?: string } | null)?.code !== "23505") {
          log("ERROR recording an auto-tip that will not be sent", { jobId, counter, error: agedErr?.message });
          defects.record(`unsent tip record (${counter}) ${jobId}: ${agedErr?.message ?? "no row returned"}`);
        }
        return;
      }
      results[counter]++;
      // One notice per JOB (review of Q1224): a crew job has one candidate
      // per member, and its members' rows are recorded in the same run.
      if (agedOutNotified.has(jobId)) return;
      agedOutNotified.add(jobId);
      const { error: agedNotifyErr } = await supabase.from("notifications").insert({
        user_id: c.customer_id,
        job_id: c.job_id,
        type: "payment",
        title: "Your automatic tip wasn't sent",
        message: posterMessage,
        link: `/posts?job=${c.job_id}`,
      });
      if (agedNotifyErr) {
        log("ERROR writing the unsent-tip notification", { jobId, counter, error: agedNotifyErr.message });
        defects.record(`unsent tip notification (${counter}) ${jobId}: ${agedNotifyErr.message}`);
      }
    };

    /**
     * A tip that cannot be charged now (the Helpr's payout hold, Q1224, or an
     * open ban settlement review on either party, Q1415 (a)) stays a
     * candidate, but auto_tip_candidates offers a job for 14 days only. On the
     * window's last day it is recorded (a 'failed' auto row, which also ends
     * its candidacy) and the poster is told once per job. Nothing is charged.
     */
    const ageOutHeldTip = async (
      c: Record<string, unknown>,
      tipDollars: number,
      failureReason: string,
      posterMessage: string,
    ): Promise<void> => {
      const jobId = c.job_id as string;
      const { data: heldJob, error: heldJobErr } = await supabase
        .from("jobs")
        .select("id, completed_at")
        .eq("id", jobId)
        .maybeSingle();
      if (heldJobErr) {
        log("ERROR reading a held tip's job — cannot tell whether its window is closing", { jobId, error: heldJobErr.message });
        defects.record(`held tip job read ${jobId}: ${heldJobErr.message}`);
        return;
      }
      const completedMs = heldJob?.completed_at ? Date.parse(heldJob.completed_at as string) : NaN;
      if (!Number.isFinite(completedMs) || Date.now() - completedMs < AUTO_TIP_HELD_RECORD_AFTER_MS) return;
      await recordUnsentTip(c, tipDollars, failureReason, posterMessage, "heldAgedOut");
    };

    for (const c of candidates ?? []) {
      const jobId = c.job_id as string;
      // The job's money and dispute state (auto_tip_candidates' tip_state,
      // the rule of 20261019043709, read in the same query as the candidate):
      //   'closed'  the payment went back (refund, chargeback, closed with no
      //             payment): recorded as a 'failed' auto tip and the poster
      //             told, nothing charged (never a silent skip);
      //   'held'    a live dispute: stays a candidate, like a payout hold, and
      //             ages out on the window's last day with a word to the poster;
      //   'chargeable' goes on, and is asked again right before the charge.
      const tipState = c.tip_state as string | null;
      if (tipState === "closed") {
        log("Job's payment went back — recording the auto-tip as not sent", { jobId });
        const closedCents = Math.round(Number(c.tip_amount) * 100);
        await recordUnsentTip(
          c,
          Number.isFinite(closedCents) && closedCents > 0 ? closedCents / 100 : 0,
          "payment_returned: the job's payment was refunded, charged back or closed with no payment; nothing was charged",
          "The payment for this job was returned, so your automatic tip was not charged. Nothing was taken from your card.",
          "closed",
        );
        continue;
      }
      if (tipState === "held") {
        log("Live dispute on the job — tip not charged", { jobId });
        results.held++;
        const disputeTipCents = Math.round(Number(c.tip_amount) * 100);
        if (Number.isFinite(disputeTipCents) && disputeTipCents > 0) {
          await ageOutHeldTip(
            c,
            disputeTipCents / 100,
            "dispute: the job was under dispute for the whole automatic-tip window; nothing was charged",
            "Your automatic tip for this job couldn't be sent while the job was under review, so it was not charged. Nothing was taken from your card.",
          );
        }
        continue;
      }
      if (tipState !== "chargeable") {
        log("ERROR unknown tip_state from auto_tip_candidates — not charging", { jobId, tipState });
        results.failed++;
        defects.record(`tip_state ${jobId}: ${String(tipState)}`);
        continue;
      }
      if (frozenByBanReview(banReview, c as { customer_id?: string | null; helper_id?: string | null })) {
        // Stays a candidate: charged after a lift, inside the candidate window.
        log("Ban review open on the poster or Helpr — tip not charged", { jobId });
        results.held++;
        // Q1415 (a): a review that outlasts the window ages the tip out like a
        // payout hold does, told in words that never say whose account is
        // under review (the poster may be the one).
        const reviewTipCents = Math.round(Number(c.tip_amount) * 100);
        if (Number.isFinite(reviewTipCents) && reviewTipCents > 0) {
          await ageOutHeldTip(
            c,
            reviewTipCents / 100,
            "ban_review: an account review held this job's payments for the whole automatic-tip window; nothing was charged",
            "Your automatic tip for this job couldn't be sent in time, so it was not charged. Nothing was taken from your card.",
          );
        }
        continue;
      }
      let stripe: Stripe;
      let mode: StripeMode;
      try {
        ({ stripe, mode } = await stripes.clientForJob(jobId, "new", [c.customer_id as string | null, c.helper_id as string | null]));
      } catch (e) {
        if (!(e instanceof StripeModeRefused)) throw e;
        log("No Stripe mode for this job — tip not charged", { jobId, reason: e.reason });
        results.failed++;
        defects.record(`stripe mode ${jobId}: ${e.reason}: ${e.message}`);
        continue;
      }
      const rawTipDollars = Number(c.tip_amount);
      const tipCents = Math.round(rawTipDollars * 100);
      if (!Number.isFinite(tipCents) || tipCents <= 0) continue;
      /*
       * THE RECORDED DOLLARS ARE DERIVED FROM THE CENTS WE ACTUALLY CHARGE.
       *
       * `profiles_auto_tip_valid` bounds `auto_tip_value` to 1..500 on a bare
       * `numeric` with NO scale (verified live 2026-09-21), so a `fixed`
       * preference of 10.555 is stored intact. Charging `Math.round(x * 100)`
       * then bills $10.56 while `tips.amount` — also scale-less — recorded
       * 10.555. Every receipt, ledger total and reconciliation read one number
       * and Stripe read another.
       *
       * Same class as the gift-card 10.555 bug (GiftCard.tsx) and the manual
       * tip dialog (TipDialog.tsx), both fixed 2026-09-21.
       *
       * Deriving rather than rounding separately is the point: there is only
       * ONE rounding in this function, and both readers use its result, so the
       * two figures cannot drift apart no matter how the rounding rule changes.
       * A CHECK constraint was rejected deliberately — it would refuse the
       * `tips` insert AFTER the card had been charged.
       */
      const tipDollars = tipCents / 100;

      // ── Payout hold (Q764) ─────────────────────────────────────────────
      // The tip is a destination charge: Stripe moves it to the Helpr the
      // moment the card is charged. A held Helpr is sent nothing, so the tip is
      // not claimed or charged; it stays a candidate and is charged on the
      // first tick after the hold is released (inside the candidate window).
      // Checked BEFORE the claim so a held Helpr leaves no tips row behind. A
      // hold is an outcome; an unreadable hold is a defect and fails closed.
      const tipHold = await checkPayoutHold(supabase, c.helper_id as string);
      if (tipHold.kind === "error") {
        log("ERROR reading payout hold — not charging", { jobId, error: tipHold.message });
        results.failed++;
        defects.record(`payout hold read ${jobId}: ${tipHold.message}`);
        continue;
      }
      if (tipHold.kind === "held") {
        log("Helpr on payout hold — tip not charged", { jobId });
        results.held++;
        // Q1224: auto_tip_candidates offers a job for 14 days after it was
        // completed, so a hold longer than that dropped the tip with nobody
        // told. On the window's last day the tip is recorded and the poster
        // is told (ageOutHeldTip below).
        await ageOutHeldTip(
          c,
          tipDollars,
          "payout_hold: the Helpr's payouts were on hold for the whole automatic-tip window; nothing was charged",
          "Your Helpr can't receive payments right now, so your automatic tip for this job was not charged. Nothing was taken from your card.",
        );
        continue;
      }
      // Owner 2026-10-30: no tip until the Helpr has verified their ID. Not claimed, not charged; a candidate until the
      // window's last day, then recorded and the poster told. FALSE while the identity_check switch is off. Fails closed.
      const tipIdHold = await checkIdentityHold(supabase, c.helper_id as string);
      if (tipIdHold.kind === "error") {
        log("ERROR reading the ID check — not charging", { jobId, error: tipIdHold.message });
        results.failed++;
        defects.record(`ID check read ${jobId}: ${tipIdHold.message}`);
        continue;
      }
      if (tipIdHold.kind === "waits") {
        log("Helpr has not verified their ID — tip not charged", { jobId });
        results.held++;
        await ageOutHeldTip(
          c,
          tipDollars,
          "identity: the Helpr had not verified their ID for the whole automatic-tip window; nothing was charged",
          "Your Helpr hasn't verified their ID yet, so your automatic tip for this job was not charged. Nothing was taken from your card.",
        );
        continue;
      }

      // Claim the job FIRST. The unique partial index on (job_id, helper_id)
      // WHERE source='auto' (tips_one_auto_per_job_member, 20260925154606: a
      // crew's auto-tip is one claim per member) means a concurrent tick loses
      // this insert and skips it — each charge below can only ever run once.
      const { data: tipRow, error: claimErr } = await supabase
        .from("tips")
        .insert({
          job_id: jobId,
          tipper_id: c.customer_id,
          helper_id: c.helper_id,
          amount: tipDollars,
          source: "auto",
          payment_status: "pending",
        })
        .select("id")
        .single();

      if (claimErr || !tipRow) {
        // 23505 = another tick already claimed it. Not an error worth logging
        // loudly; it is the guard doing its job.
        if ((claimErr as { code?: string } | null)?.code !== "23505") {
          log("ERROR claiming tip row", { jobId, error: claimErr?.message });
          results.failed++;
          defects.record(`claim ${jobId}: ${claimErr?.message}`);
        }
        continue;
      }

      // Release the claim row so the NEXT cron tick can retry this job, and
      // PROVE the row went away.
      //
      // A DELETE matching zero rows returns `{ data: [], error: null }`, so
      // discarding the result — which this used to do entirely, no error check
      // and no returning projection — makes the worst outcome the invisible
      // one. A surviving claim row is worse than a 23505 on the next tick:
      // `auto_tip_candidates` excludes any job that already has a
      // `source='auto'` tips row, so the job drops out of the candidate list
      // ENTIRELY and no tick ever looks at it again. The poster asked for an
      // automatic tip, the helper never receives it, and nothing in the system
      // says so.
      //
      // Policy on zero rows: fail the RUN loudly, and do not try to recover
      // here. There is no safe automatic recovery — `giveUp()` is the obvious
      // candidate and is exactly wrong, because it sets `auto_prompt_sent_at`
      // and marks the tip failed, permanently cementing the state we are trying
      // to escape. Retrying the delete would only repeat the same predicate.
      // The claim row is durable and visible (`payment_status='pending'`), so a
      // human deleting one row restores the retry — what they need is to be
      // told. `defects.record()` makes the run answer 500 through `cronResult`,
      // which is the one channel `sweep_cron_http_failures()` watches. It is a
      // true defect, not a business outcome: nothing about the poster, the
      // helper or the card caused it.
      const releaseClaimForRetry = async (why: string) => {
        const { data: released, error: releaseErr } = await supabase
          .from("tips")
          .delete()
          .eq("id", tipRow.id)
          .select("id");
        if (releaseErr) {
          log("ERROR releasing tip claim — auto-tip for this job is now blocked", {
            jobId, tipId: tipRow.id, error: releaseErr.message,
          });
          defects.record(`tip claim release ${jobId} (${why}): ${releaseErr.message}`);
          return;
        }
        if (!released || released.length === 0) {
          log("Tip claim release matched ZERO rows — auto-tip for this job is now blocked", {
            jobId, tipId: tipRow.id,
          });
          defects.record(
            `tip claim release ${jobId} (${why}): matched 0 rows — the pending claim row survives and removes this job from auto_tip_candidates forever; delete tips.id=${tipRow.id} to unblock`,
          );
        }
      };

      // Write a TERMINAL outcome onto the claim row, and prove it landed.
      //
      // `.select("id")` because `tips` genuinely has an `id` column — unlike
      // `stripe_webhook_events`, whose primary key is `event_id` and which 400s
      // on `select=id`. The right projection is a per-table fact, not a reflex.
      //
      // Zero rows is never legitimate at either call site:
      //   • `tipRow.id` came from THIS iteration's own claim INSERT moments ago.
      //   • The only code that removes that row is `releaseClaimForRetry()`, and
      //     every path calling it `continue`s without reaching here.
      //   • Nothing else in the repo updates or deletes `tips` at all (grepped
      //     across src/ and supabase/functions/), so no concurrent writer exists.
      //   • A concurrent tick cannot have claimed the same (job, member) — the
      //     unique partial index on (job_id, helper_id) WHERE source='auto'
      //     guarantees it.
      //   • An UPDATE returns its matched rows even when the values are
      //     unchanged, so a repeat write still matches 1 row rather than 0.
      // So zero rows means the write did not happen. And because
      // `auto_tip_candidates()` filters on `NOT EXISTS (… tips WHERE
      // source='auto')` — the STATUS is never consulted, only the row's
      // existence — the job leaves the candidate list either way and no tick
      // ever revisits it. A defect, not a business outcome: nothing about the
      // poster, the helper or the card can produce it. `defects.record()` makes
      // the run answer 500 through `cronResult`, the one channel
      // `sweep_cron_http_failures()` watches, and the reason names `tips.id` so
      // clearing it is not a hunt.
      const settleTip = async (
        patch: Record<string, unknown>,
        what: string,
        consequence: string,
      ): Promise<boolean> => {
        const { data: settled, error: settleErr } = await supabase
          .from("tips")
          .update(patch)
          .eq("id", tipRow.id)
          .select("id");
        if (settleErr) {
          log(`ERROR: ${what}`, { jobId, tipId: tipRow.id, error: settleErr.message });
          defects.record(
            `${what} ${jobId}: ${settleErr.message} — ${consequence}; row is tips.id=${tipRow.id}`,
          );
          return false;
        }
        if (!settled || settled.length === 0) {
          log(`${what} matched ZERO rows`, { jobId, tipId: tipRow.id });
          defects.record(
            `${what} ${jobId}: matched 0 rows with no error — ${consequence}; row is tips.id=${tipRow.id}`,
          );
          return false;
        }
        return true;
      };

      // Mark the row failed-with-reason rather than deleting it: a poster who
      // meant to tip and couldn't should be asked, and a deleted row would
      // make the sweeper re-attempt the same doomed charge every tick.
      //
      // `notify` is false for failures the POSTER cannot act on. Telling
      // someone "your tip failed" when the cause is the helper's missing
      // payout account is noise they can do nothing with, and it leaks the
      // other party's account state.
      const giveUp = async (reason: string, notify: boolean, message?: string) => {
        // A no-op here is the more insidious half of the pair the claim-release
        // guard fixes: it tells the system the tip is permanently resolved when
        // it may have written nothing at all. The row stays `pending` with no
        // `failure_reason` and no `auto_prompt_sent_at`, so the "confirm your
        // tip" nudge that reads that column never fires — while the poster has
        // already been told the tip failed, if `notify`.
        await settleTip(
          {
            payment_status: "failed",
            failure_reason: reason,
            auto_prompt_sent_at: new Date().toISOString(),
          },
          "tip give-up write",
          `the row stays 'pending' with no failure_reason and no auto_prompt_sent_at, so the poster is never nudged to tip manually and no tick revisits this job (reason was "${reason}")`,
        );

        // The poster is told either way. Whether we managed to record the
        // failure has no bearing on whether it happened to them.
        if (!notify) return;
        // The one thing this function must never do is fail silently. A
        // poster who configured an automatic tip and got nothing — no charge,
        // no message — would reasonably believe their helper was tipped.
        const { error: notifyErr } = await supabase.from("notifications").insert({
          user_id: c.customer_id,
          type: "payment",
          title: "Your tip didn't go through",
          message:
            message ??
            "We couldn't charge your automatic tip — usually because there's no saved card on file. You can send it in a tap.",
          // Straight to the finished job the tip was for. A bare "/posts"
          // opened on "Needs you", which a completed job is never in — so the
          // "send it in a tap" was a tap into an empty list.
          link: `/posts?job=${c.job_id}`,
        });
        if (notifyErr) {
          // Never swallowed: if this insert fails the poster is back to
          // silence, which is the exact failure mode being guarded against.
          log("ERROR writing tip-failure notification", { jobId, error: notifyErr.message });
          defects.record(`tip-failure notification ${jobId}: ${notifyErr.message}`);
        }
      };

      // Charge = tip + card fee; application fee = card fee; the Helpr's
      // destination transfer = the tip, to the cent. Computed before the try so
      // the ambiguous-outcome branch below can name the idempotency key too.
      const tipQuote = tipChargeBreakdown(tipCents);

      // A percent auto-tip on a small job can come to less than the $3 tip
      // minimum. Nothing is charged; the poster is asked to tip by hand.
      if (tipCents < TIP_MIN_CENTS) {
        await giveUp(
          "below_tip_minimum",
          true,
          `Your automatic tip came to $${tipDollars.toFixed(2)}, under the $${(TIP_MIN_CENTS / 100).toFixed(0)} tip minimum, so nothing was charged. You can send your Helpr a tip in a tap.`,
        );
        results.prompted++;
        continue;
      }

      try {
        const { data: helperProfile, error: helperProfileErr } = await supabase
          .from("profiles")
          .select("stripe_account_id")
          .eq("user_id", c.helper_id)
          .maybeSingle();

        if (helperProfileErr) {
          // Transient read failure — delete the claim so the next cron tick can
          // retry rather than permanently mis-labelling the tip as failed and
          // setting auto_prompt_sent_at (which giveUp does), which would block
          // all future retry attempts for this job's auto-tip.
          log("ERROR reading helper profile — deleting claim for retry", { jobId, error: helperProfileErr.message });
          await releaseClaimForRetry("helper profile read");
          results.failed++;
          defects.record(`helper profile read ${jobId}: ${helperProfileErr.message}`);
          continue;
        }

        // No connected account means the helper cannot receive money at all.
        // Charging the poster and holding it on the platform would be taking
        // money for a transfer that can't happen.
        if (!helperProfile?.stripe_account_id) {
          // Owner 2026-10-25 (payout_after_hire): a hired Helpr sets up payouts
          // AFTER the hire, so "no account yet" is the normal state for a while.
          // Nothing is charged; the claim is released and a later tick retries
          // (within auto_tip_candidates' window) instead of dropping the tip
          // (lh-money-escrow review #3). Off for them: as before.
          if (await featureEnabledForUser(supabase, "payout_after_hire", { id: c.helper_id as string })) {
            log("helper has no payout account yet (payout_after_hire) — deleting claim for retry", { jobId });
            await releaseClaimForRetry("helper payout account not set up yet");
            continue;
          }
          await giveUp("helper_not_connected", false);
          results.failed++;
          continue;
        }

        const { data: authUser, error: authUserErr } = await supabase.auth.admin.getUserById(c.customer_id as string);
        if (authUserErr) {
          // Same reasoning as helperProfileErr above: don't call giveUp on a
          // transient auth read failure — delete the claim and retry next tick.
          log("ERROR reading poster auth record — deleting claim for retry", { jobId, error: authUserErr.message });
          await releaseClaimForRetry("poster auth read");
          results.failed++;
          defects.record(`poster auth read ${jobId}: ${authUserErr.message}`);
          continue;
        }
        const email = authUser?.user?.email;
        if (!email) {
          await giveUp("no_poster_email", false);
          results.failed++;
          continue;
        }

        // Q2138 (one wallet, owner 2026-10-18): the card charged is the
        // DEFAULT card of the poster's OWN stored Stripe customer
        // (public.stripe_customers, this job's mode), never a customer found by
        // email. This used to scan every customer carrying the poster's email
        // and charge the first card it met. Stripe does not treat email as a
        // key, so that pool held a deleted member's customer whenever an
        // address was reused (measured 2026-10-18: 3 of 7 live customers carry
        // an email that now belongs to a newer account) and any other section's
        // customer, all charged off-session.
        //
        // Only the wallet's DEFAULT card, never "any card on it" (lh-money-escrow
        // review of ad052465c #1): a card saved before the wallet existed may
        // sit on the customer without the member's consent to off-session use.
        // Setting the default is the consent step (one wallet card everywhere,
        // owner 2026-10-18): the card saved most recently in ANY section (Jobs'
        // "save card for next time", Declutter's card page) becomes it
        // (stripe-webhook handlers/_walletDefaultCard.ts, Q2139). No default
        // card -> nothing is charged: the poster is asked to tip by hand and
        // the run reports it.
        let customerId: string | null;
        try {
          customerId = await storedStripeCustomer(supabase, c.customer_id as string, mode);
        } catch (walletErr) {
          if (!(walletErr instanceof StripeCustomerUnavailable)) throw walletErr;
          // Transient: release the claim so the next tick retries.
          log("ERROR reading the poster's wallet — deleting claim for retry", { jobId, error: walletErr.message });
          await releaseClaimForRetry("wallet read");
          results.failed++;
          defects.record(`wallet read ${jobId}: ${walletErr.message}`);
          continue;
        }
        if (!customerId) {
          await giveUp("no_wallet_customer", true);
          results.prompted++;
          walletGaps.push(`${jobId} (no stored ${mode} customer)`);
          continue;
        }

        type WalletCard = { id?: string; type?: string; customer?: string | { id?: string } | null };
        type WalletCustomer = {
          deleted?: boolean;
          invoice_settings?: { default_payment_method?: string | WalletCard | null } | null;
        } | null;
        let walletCustomer: WalletCustomer;
        try {
          walletCustomer = await stripe.customers.retrieve(customerId, {
            expand: ["invoice_settings.default_payment_method"],
          }) as WalletCustomer;
        } catch (lookupErr) {
          if ((lookupErr as { code?: string } | null)?.code === "resource_missing") {
            walletCustomer = { deleted: true };
          } else {
            // A Stripe outage is not a failed tip: release the claim so the
            // next tick retries (review of ad052465c #2).
            const lookupMessage = caughtMessage(lookupErr);
            log("ERROR reading the poster's wallet in Stripe — deleting claim for retry", { jobId, error: lookupMessage });
            await releaseClaimForRetry("wallet card lookup");
            results.failed++;
            defects.record(`wallet card lookup ${jobId}: ${lookupMessage}`);
            continue;
          }
        }
        // A customer deleted in Stripe (Dashboard, test-data wipe) has no card
        // to charge; recovery is Q2140.
        if (walletCustomer?.deleted) {
          await giveUp("wallet_customer_deleted", true);
          results.prompted++;
          defects.record(`auto-tip ${jobId}: the poster's stored Stripe customer ${customerId} is deleted in Stripe (${mode}); nothing charged (Q2140)`);
          continue;
        }
        const defaultCard = walletCustomer?.invoice_settings?.default_payment_method;
        const defaultCardOwner = typeof defaultCard === "object" && defaultCard
          ? (typeof defaultCard.customer === "string" ? defaultCard.customer : defaultCard.customer?.id)
          : undefined;
        // Charged only when it is a CARD attached to THIS customer.
        const paymentMethodId =
          typeof defaultCard === "object" && defaultCard?.type === "card" && defaultCardOwner === customerId
            ? defaultCard.id
            : undefined;

        // Without one we stop and let the app ask — never a silent no-op.
        if (!paymentMethodId) {
          await giveUp("no_saved_card", true);
          results.prompted++;
          walletGaps.push(`${jobId} (no default card on the ${mode} wallet)`);
          continue;
        }

        // LAST READ BEFORE THE CHARGE (lead re-review 2026-10-19): the job's
        // state asked again, uncached, after every other read, so a refund,
        // chargeback or dispute that landed during this run is seen with the
        // claim row already holding off a concurrent tick. Anything but
        // 'chargeable' releases the claim and charges nothing; 'closed' is
        // then recorded and told (it is no longer a candidate), 'held' and an
        // unreadable answer are retried next tick.
        const { data: stateNow, error: stateNowErr } = await supabase.rpc("auto_tip_job_state", { p_job_id: jobId });
        if (stateNowErr || stateNow !== "chargeable") {
          await releaseClaimForRetry(`job state before the charge: ${stateNowErr ? stateNowErr.message : String(stateNow)}`);
          if (stateNowErr || typeof stateNow !== "string") {
            log("ERROR re-reading the job's state before the charge — not charging", { jobId, error: stateNowErr?.message });
            results.failed++;
            defects.record(`job state before charge ${jobId}: ${stateNowErr?.message ?? "no answer"}`);
          } else if (stateNow === "closed") {
            log("Job's payment went back during the run — not charging", { jobId });
            await recordUnsentTip(
              c,
              tipDollars,
              "payment_returned: the job's payment was refunded, charged back or closed with no payment; nothing was charged",
              "The payment for this job was returned, so your automatic tip was not charged. Nothing was taken from your card.",
              "closed",
            );
          } else {
            log("Live dispute opened during the run — not charging", { jobId });
            results.held++;
          }
          continue;
        }

        const createIntent = () => stripe.paymentIntents.create(
          {
            amount: tipQuote.chargeCents,
            currency: "usd",
            customer: customerId,
            payment_method: paymentMethodId,
            // The whole point: no redirect, no user present.
            off_session: true,
            confirm: true,
            description:
              // Owner 2026-10-25: no card-fee line to the tipper (Stripe shows this on the receipt).
              `Auto-tip — job ${jobId}: your Helpr receives the whole $${(tipQuote.tipCents / 100).toFixed(2)} tip`,
            // The asymmetry this closes: a FAILED auto-tip already gets a
            // notification (giveUp, above) — a successful one, the card
            // actually being charged off-session with no confirmation step
            // at all, got nothing. Stripe's own receipt is the cheapest
            // confirmation channel available for a charge with no client
            // present to show a success toast to.
            receipt_email: email,
            transfer_data: { destination: helperProfile.stripe_account_id as string },
            application_fee_amount: tipQuote.feeCents,
            metadata: {
              type: "tip",
              source: "auto",
              tip_cents: String(tipQuote.tipCents),
              fee_cents: String(tipQuote.feeCents),
              helper_cents: String(tipQuote.helperCents),
              job_id: jobId,
              tipper_id: String(c.customer_id),
              helper_id: String(c.helper_id),
            },
          },
          {
            // Keyed on the tips row id (unique per job by the index above) and
            // the amount charged, so a Stripe-level retry of this exact call
            // can never mint a second charge, and a retry with a different
            // charge total is a new request rather than a parameter mismatch.
            idempotencyKey: `auto-tip:${tipRow.id}:c${tipQuote.chargeCents}`,
          },
        );

        // ME-011: only a card or request error proves no charge happened. A
        // lost response or a Stripe 5xx can follow a charge that went through,
        // and treating it as a decline told a charged poster "your tip didn't
        // go through". Retry once on the same idempotency key (Stripe replays
        // the original outcome); still unknown -> AmbiguousCharge below.
        let intent: Awaited<ReturnType<typeof createIntent>>;
        try {
          intent = await createIntent();
        } catch (firstErr) {
          if (isDefiniteRefusal(firstErr)) throw firstErr;
          try {
            intent = await createIntent();
          } catch (retryErr) {
            if (isDefiniteRefusal(retryErr)) throw retryErr;
            throw new AmbiguousCharge(retryErr instanceof Error ? retryErr.message : String(retryErr));
          }
        }

        if (intent.status === "succeeded") {
          // THE MONEY HAS ALREADY MOVED. This is the one write in the function
          // that runs after a real charge, and it was the only one with neither
          // an error check nor a returning projection — so the worst outcome in
          // the file was also the most invisible: the poster is debited, the
          // helper's transfer is on its way, and `tips` still reads 'pending'
          // with a null `stripe_payment_intent_id`.
          //
          // That is not merely a stale label. The intent id is the ONLY join key
          // between this charge and the ledger, so without it the charge is
          // unreconcilable — money-reconciliation cannot match it to anything —
          // and `auto_tip_candidates()` still excludes the job (it tests the
          // row's existence, not its status), so nothing revisits it to notice.
          // The comment at the top of this file says a payment with no row is
          // money nobody can account for; a payment with an unfinished row is
          // the same hole one column narrower.
          //
          // Observation only: the success path still does exactly what it did.
          // Charging is NOT retried on a failed settle — `results.charged` and
          // the log stay truthful about the charge, because the charge really
          // did succeed. What changes is that the run now reports the defect
          // instead of returning 200 as though the tip were fully recorded.
          await settleTip(
            { payment_status: "paid", stripe_payment_intent_id: intent.id },
            "tip paid-settlement write",
            `the poster WAS charged (payment_intent ${intent.id}, ${tipQuote.chargeCents}c for a ${tipQuote.tipCents}c tip) but the tips row still reads 'pending' with no stripe_payment_intent_id, leaving the charge unreconcilable`,
          );
          results.charged++;
          log("charged", { jobId, tipCents, feeCents: tipQuote.feeCents, chargeCents: tipQuote.chargeCents });

          // SC-003: the failure path (giveUp, above) has told the poster for
          // as long as this function has existed. The success path — a card
          // being charged off-session, without them present to see a toast —
          // told them nothing at all, so the FIRST time they learned about an
          // auto-tip was potentially a bank statement line. Mirrors the
          // failure notification's shape and its "never swallowed" guard.
          const { error: successNotifyErr } = await supabase.from("notifications").insert({
            user_id: c.customer_id,
            type: "payment",
            title: "Your auto-tip was sent",
            message: `We sent your Helpr a $${(tipQuote.tipCents / 100).toFixed(2)} tip for this job — they receive all of it. Your card was charged $${(tipQuote.chargeCents / 100).toFixed(2)} in total. No action needed.`,
            link: `/posts?job=${c.job_id}`,
          });
          if (successNotifyErr) {
            log("ERROR writing tip-success notification", { jobId, error: successNotifyErr.message });
            defects.record(`tip-success notification ${jobId}: ${successNotifyErr.message}`);
          }
        } else {
          // requires_action means the card wants SCA, which needs the user
          // present — exactly what off-session cannot do. Treat as prompt.
          await giveUp(`intent_${intent.status}`, true);
          results.prompted++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof AmbiguousCharge) {
          // The poster may have been charged. Do not tell them it failed and do
          // not mark it failed; leave the row 'pending' with the reason and turn
          // the run red so someone checks Stripe for auto-tip:<tips.id>:c<charge cents>.
          await settleTip(
            { failure_reason: `ambiguous: ${message}`.slice(0, 200) },
            "tip ambiguous-outcome write",
            "the charge outcome is unknown and the row carries no reason",
          );
          defects.record(
            `auto-tip ${jobId}: charge outcome UNKNOWN after retry (${message.slice(0, 120)}) — check Stripe for idempotency key auto-tip:${tipRow.id}:c${tipQuote.chargeCents} before telling the poster anything`,
          );
          results.failed++;
          log("charge outcome unknown", { jobId, error: message });
          continue;
        }
        // A tip is a DESTINATION charge: Stripe refuses it, before any money
        // moves, when the Helpr's account cannot receive money. That is told
        // as what it is (not "no saved card") and to ops once a day
        // (error_logs), lead 2026-10-23 (_shared/livePayoutHold.ts).
        const refused = await noteDestinationChargeRefused(err, {
          fn: "auto-tip-charge",
          what: "An automatic tip",
          helperId: c.helper_id ? String(c.helper_id) : null,
          fields: { job_id: jobId },
        });
        if (refused) {
          // "once they're set up" only when the Helpr's account is the cause (reviews of the live gate, LOW).
          await giveUp(`payee_not_payable: ${message}`.slice(0, 200), true, refused.startsWith(DESTINATION_REFUSED_HELPR_SENTENCE) ? `${refused} You can send it in a tap once they're set up.` : refused);
          results.failed++;
          log("charge refused: the Helpr's account cannot receive money", { jobId, error: message });
          continue;
        }
        // Card declines land here (authentication_required, card_declined…).
        await giveUp(message.slice(0, 200), true);
        results.failed++;
        log("charge failed", { jobId, error: message });
      }
    }

    if (walletGaps.length > 0) {
      defects.record(
        `auto-tip: ${walletGaps.length} tip(s) not charged, the poster's wallet has no stored customer or no default card (Q2138 fails closed, never by email; Q2139 records Jobs' saved card): ${walletGaps.join(", ")}`,
      );
    }
    log("done", results);
    return cronResult("auto-tip-charge", results, defects.defects, corsHeaders);
  } catch (err) {
    const message = caughtMessage(err);
    log("FATAL", { error: message });
    return cronError("auto-tip-charge", message, corsHeaders);
  }
});
