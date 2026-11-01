// seed-policy: pages for seed/E2E jobs too, on purpose: every defect here is a
// poster's card held (or charged) while the database says otherwise.
//
// card-hold-sweep (Q2399, owner 2026-10-25): the cron half of "hold the
// poster's card when a job is posted; charge it only when someone is hired".
// Every 10 minutes, over EVERY open card hold (job_card_holds, paged):
//   1. RESUME a capture whose claim went stale (it died between the claim and
//      the answer): the same amount under the same key, so Stripe answers the
//      first request again and nothing is charged twice.
//   2. RELEASE: the job closed with nobody hired (the poster cancelled, the
//      expiry sweep closed it): the authorization is cancelled (no refund, no
//      fee) and the poster is told their card was not charged; the hold stays
//      open until they have been told.
//   3. RECONCILE a hold whose job was paid another way (a bank re-pay, a gift):
//      a live authorization left over is cancelled, the row closed.
//   4. RE-SEND a missed "pay again / confirm" notice to the poster.
//   5. COMPLETE a pending accept (or crew Confirm) whose Helpr is ready now,
//      only while it is still live: the card is captured and the accept
//      completes through the same completion the profiles trigger uses.
//   6. PLACE a scheduled hold (a job more than 6 days out) once its place_at
//      arrives: off-session, under $300 and on an untaxed category.
//   7. RENEW an authorization within 12 h of its capture_before while the job
//      is still unhired, after reading what Stripe says it is now.
//   8. INSTANT BOOK (CMP-4): a booking whose 2-hour decline window ended is
//      captured with the same captureCardHold and hired; a refused card ends
//      the booking and tells both sides (_shared/instantBookSweep.ts).
// Plus: a pending accept on a hold already CAPTURED that never completed, and
// a job 'held' with no open hold row, are defects.
// A failed hold takes the job off the listing (payment_status 'failed': nobody
// can be hired until the poster pays again) and tells the poster once.
// Each hold is settled in its OWN Stripe mode (job_card_holds.stripe_mode).
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { memberDisplayName } from "../_shared/memberDisplayName.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { createStripeModeResolver, type StripeMode } from "../_shared/stripeMode.ts";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import {
  HOLD_COLUMNS,
  RENEW_WITHIN_MS,
  STALE_CAPTURE_MS,
  captureBeforeIso,
  captureCardHold,
  failHold,
  notifyHelprWaiting,
  notifyPosterOnce,
  placeOffSessionHold,
  readHold,
  readJob,
  refundInstantBookingWith,
  releaseCardHold,
  takeFailedHoldOffListing,
  updateHold,
  CARD_HOLD_COPY,
  type HoldJob,
  type HoldRow,
} from "../_shared/cardHold.ts";
import { offSessionAllowed } from "../_shared/cardHoldPlan.ts";
import { settleInstantBooking } from "../_shared/instantBookSweep.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPEN_STATES = ["authorized", "scheduled", "capturing", "needs_action", "failed"];
const PAGE = 200;
/** Holds one run reaches before it says so (lh-silent-failure review #6). */
const MAX_PAGES = 25;
/** A capture this young is the moment between capture_hold and its accept, not "captured, nobody hired". */
const CAPTURED_UNHIRED_GRACE_MS = 30 * 60 * 1000;

// deno-lint-ignore no-explicit-any
type Db = any;
type Deps = { db: Db; stripe: Stripe; mode: StripeMode };
type Defects = ReturnType<typeof defectTracker>;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      // A hung read must not eat the cron's run (Q592): reads are bounded and retried, writes are not.
      { global: { fetch: boundedFetch() } },
    );
    const stripes = createStripeModeResolver(db, (key) => new Stripe(key, { apiVersion: "2025-08-27.basil" }));
    const defects = defectTracker();
    const counts = { holds: 0, resumed: 0, released: 0, reconciled: 0, renotified: 0, completed: 0, crew_confirmed: 0, placed: 0, renewed: 0, failed_over: 0, instant_hired: 0, instant_failed: 0, instant_ended: 0, instant_captured_not_hired: 0, instant_refunded: 0 };
    const now = Date.now();
    const depsFor = (hold: HoldRow): Deps => {
      const mode = hold.stripe_mode as StripeMode;
      return { db, stripe: stripes.clientFor(mode), mode };
    };

    // Paged by job_id (stable whatever a run moves), so no hold is ever starved.
    let after: string | null = null;
    let pages = 0;
    for (;;) {
      let q = db.from("job_card_holds").select(HOLD_COLUMNS).in("state", OPEN_STATES).order("job_id", { ascending: true }).limit(PAGE);
      if (after) q = q.gt("job_id", after);
      const { data: page, error: pageErr } = await q;
      if (pageErr) return cronError("card-hold-sweep", `job_card_holds read failed: ${pageErr.message}`, corsHeaders);
      const rows = (page ?? []) as HoldRow[];
      for (const hold of rows) {
        counts.holds++;
        try {
          await sweepOne(depsFor(hold), hold, now, counts, defects);
        } catch (e) {
          defects.record(`job ${hold.job_id}: ${caughtMessage(e).slice(0, 300)}`);
        }
      }
      pages++;
      if (rows.length < PAGE) break;
      after = rows[rows.length - 1].job_id;
      if (pages >= MAX_PAGES) {
        defects.record(`more than ${PAGE * MAX_PAGES} open card holds: the rest wait for the next run`);
        break;
      }
    }

    // 8. Instant bookings due: the 2-hour window ended, or the job's payment
    // failed (an early confirm's capture was refused). Read from the jobs side,
    // so a booking whose hold was already captured is finished too.
    const nowIso = new Date(now).toISOString();
    const { data: due, error: dueErr } = await db.from("jobs").select("id, payment_status, is_seed")
      .eq("direct_offer_status", "pending").eq("status", "open").not("instant_decline_until", "is", null)
      .or(`instant_decline_until.lte.${nowIso},payment_status.eq.failed`).limit(500);
    if (dueErr) defects.record(`instant bookings not read: ${dueErr.message}`);
    else if ((due ?? []).length === 500) defects.record("500 instant bookings due (the cap): the rest wait for the next run");
    for (const j of (due ?? []) as Array<{ id: string; payment_status: string | null; is_seed: boolean | null }>) {
      try {
        const hold = await readHold(db, j.id);
        const outcome = await settleInstantBooking({
          db,
          now,
          record: (d) => defects.record(d),
          // One alert per job: instant_book_captured_not_hired answers true once, and the key dedupes a retried run.
          page: (title, message, fields) => postSlackOpsAlert({ kind: "money_at_risk", severity: "critical", title, message, fields, seed: j.is_seed === true, oncePerDayKey: `instant-book-captured-not-hired:${j.id}` }),
          // The full refund of a job closed for review (charged, hire refused), at once.
          refund: (id) => hold
            ? refundInstantBookingWith(depsFor(hold), id, (d) => defects.record(d), j.is_seed === true)
            : Promise.resolve("retry" as const),
          // The Helpr's accept's own capture: one claim, one key per attempt. A job with no
          // hold row (paid at post) is captured already, or not capturable here.
          // offerTo: the claim goes back, nothing charged, if the Helpr declined after it (CMP-4 race fix).
          capture: (id, helper) => hold
            ? captureCardHold(depsFor(hold), id, { offerTo: helper })
            : Promise.resolve(["escrow", "payout_pending", "released"].includes(String(j.payment_status))
              ? { ok: true as const, already: true, paidAtPost: true }
              : { ok: false as const, reason: "not_held" as const }),
        }, j.id);
        if (outcome === "hired") counts.instant_hired++;
        else if (outcome === "payment_failed") counts.instant_failed++;
        else if (outcome === "ended_unhireable") counts.instant_ended++;
        else if (outcome === "captured_not_hired") counts.instant_captured_not_hired++;
      } catch (e) {
        defects.record(`job ${j.id} (instant booking): ${caughtMessage(e).slice(0, 300)}`);
      }
    }

    // 8b. Instant bookings charged with nobody hired, closed for review: the
    // full refund is retried until it goes out (instantBookRefund.ts). Read by
    // the claim's holder row, so no closed job is ever left with its money.
    const { data: owed, error: owedErr } = await db.from("job_refund_claims").select("job_id")
      .eq("claimed_by", "instant_book_refund").order("job_id", { ascending: true }).limit(200);
    if (owedErr) defects.record(`instant booking refunds not read: ${owedErr.message}`);
    else if ((owed ?? []).length === 200) defects.record("200 instant booking refunds open (the cap): the rest wait for the next run");
    for (const o of (owed ?? []) as Array<{ job_id: string }>) {
      try {
        const hold = await readHold(db, o.job_id);
        if (!hold) {
          defects.record(`job ${o.job_id}: an instant booking refund is open but the job has no card hold`);
          continue;
        }
        const job = await readJob(db, o.job_id);
        if ((await refundInstantBookingWith(depsFor(hold), o.job_id, (d) => defects.record(d), job?.is_seed === true)) === "refunded") counts.instant_refunded++;
      } catch (e) {
        defects.record(`job ${o.job_id} (instant booking refund): ${caughtMessage(e).slice(0, 300)}`);
      }
    }

    // A pending accept on a hold already CAPTURED that never completed (the
    // completion failed after the capture): finished here, or a defect
    // (lh-silent-failure review #8).
    const since = new Date(now - 2 * 86_400_000).toISOString();
    const { data: captured, error: capErr } = await db.from("job_card_holds").select(HOLD_COLUMNS).eq("state", "captured").gte("updated_at", since).limit(500);
    if (capErr) defects.record(`captured holds not read: ${capErr.message}`);
    else if ((captured ?? []).length === 500) defects.record("500 captured holds read (the cap): the rest wait for the next run");
    for (const hold of (captured ?? []) as HoldRow[]) {
      try {
        const job = await readJob(db, hold.job_id);
        if (!job || job.payment_status !== "escrow") continue;
        if (await completePendingAccept(depsFor(hold), job, defects)) counts.completed++;
        else if (await completePendingCrewConfirms(depsFor(hold), job, defects)) counts.crew_confirmed++;
      } catch (e) {
        defects.record(`job ${hold.job_id} (captured): ${caughtMessage(e).slice(0, 300)}`);
      }
    }

    // A job 'held' with no open hold row is a hold nothing will ever capture or release.
    const { data: heldJobs, error: heldErr } = await db.from("jobs").select("id").eq("payment_status", "held").limit(1000);
    if (heldErr) defects.record(`held jobs not read: ${heldErr.message}`);
    else if ((heldJobs ?? []).length === 1000) defects.record("1000 held jobs read (the cap): the open-hold check skipped the rest");
    const heldIds = ((heldJobs ?? []) as Array<{ id: string }>).map((j) => j.id);
    if (heldIds.length > 0) {
      const { data: rows, error: rowsErr } = await db.from("job_card_holds").select("job_id, state").in("job_id", heldIds);
      if (rowsErr) defects.record(`hold rows for held jobs not read: ${rowsErr.message}`);
      else {
        const open = new Set(((rows ?? []) as Array<{ job_id: string; state: string }>).filter((r) => ["authorized", "scheduled", "capturing"].includes(r.state)).map((r) => r.job_id));
        for (const id of heldIds) if (!open.has(id)) defects.record(`job ${id} is 'held' with no open card hold: nothing will capture or release it`);
      }
    }

    // A held card CAPTURED with nobody hired (lh-silent-failure 2026-10-26 #4):
    // the completion after the capture kept failing, or the pending accept
    // stopped being live. Read from the jobs side with no time cutoff, so it
    // is reported every run until someone hires or refunds it, never only for
    // the two days the retry loop above covers. A capture younger than
    // CAPTURED_UNHIRED_GRACE_MS is the moment between capture_hold and its
    // accept, not a defect.
    const { data: unhired, error: unhiredErr } = await db.from("jobs")
      .select("id, payment_status, helper_confirmed_at, is_group_job, status")
      .eq("payment_status", "escrow").is("helper_confirmed_at", null).in("status", ["open", "accepted"]).limit(1000);
    if (unhiredErr) defects.record(`funded unhired jobs not read: ${unhiredErr.message}`);
    else {
      if ((unhired ?? []).length === 1000) defects.record("1000 funded unhired jobs read (the cap): the captured-nobody-hired check skipped the rest");
      const candidates = ((unhired ?? []) as Array<{ id: string; payment_status: string; helper_confirmed_at: string | null; is_group_job: boolean | null; status: string }>)
        .filter((j) => j.payment_status === "escrow" && j.helper_confirmed_at == null && ["open", "accepted"].includes(j.status));
      if (candidates.length > 0) {
        const { data: capRows, error: capRowsErr } = await db.from("job_card_holds").select("job_id, state, updated_at")
          .in("job_id", candidates.map((j) => j.id)).eq("state", "captured");
        if (capRowsErr) defects.record(`captured holds of unhired jobs not read: ${capRowsErr.message}`);
        else {
          const capturedAt = new Map(((capRows ?? []) as Array<{ job_id: string; state: string; updated_at: string | null }>)
            .filter((r) => r.state === "captured").map((r) => [r.job_id, Date.parse(r.updated_at ?? "")]));
          for (const j of candidates) {
            const at = capturedAt.get(j.id);
            if (at === undefined || !(now - at > CAPTURED_UNHIRED_GRACE_MS)) continue;
            if (j.is_group_job === true) {
              const { count, error: seatsErr } = await db.from("group_job_helpers").select("id", { count: "exact", head: true })
                .eq("job_id", j.id).not("helper_confirmed_at", "is", null);
              if (seatsErr) { defects.record(`job ${j.id}: crew seats not read for the captured-hold check (${seatsErr.message})`); continue; }
              if ((count ?? 0) > 0) continue;
            }
            defects.record(`job ${j.id}: the poster's held card was CAPTURED but nobody is hired; complete the hire or refund the poster in full`);
          }
        }
      }
    }

    return cronResult("card-hold-sweep", counts, defects.defects, corsHeaders);
  } catch (e) {
    return cronError("card-hold-sweep", caughtMessage(e), corsHeaders);
  }
});

async function sweepOne(deps: Deps, hold: HoldRow, now: number, counts: Record<string, number>, defects: Defects): Promise<void> {
  const { db, stripe } = deps;
  const job = await readJob(db, hold.job_id);
  // A job is never deleted with an open hold (jobs_refuse_delete_with_open_card_hold).
  if (!job) { defects.record(`job ${hold.job_id}: gone with an open card hold (${hold.state})`); return; }

  // 1. A capture that died between its claim and Stripe's answer.
  if (hold.state === "capturing") {
    if (!hold.updated_at || now - Date.parse(hold.updated_at) < STALE_CAPTURE_MS) return; // in flight
    const r = await captureCardHold(deps, hold.job_id, { resume: true });
    if (r.ok) {
      counts.resumed++;
      // The Helpr whose accept made this claim was told "try again" while it hung, and their
      // accept rolled back: the card is charged now, so they hear they can accept (round 4, silent #1).
      if (!r.already) await tellWaitingHelprsReady(db, job, defects);
    }
    else if (r.reason === "retry") defects.record(`job ${hold.job_id}: a stale capture will be resumed again: ${r.detail}`);
    else {
      // Settled (a closed job's claim refunded or put back for release) or not
      // capturable: re-read, and a claim still open is a defect every run (round 2, #1/#2).
      const after = await readHold(db, hold.job_id);
      if (after?.state === "capturing") defects.record(`job ${hold.job_id}: a stale capture claim is still open after a resume (${r.reason})`);
      else counts.resumed++;
    }
    return;
  }

  // 2. Nobody hired: the job is closed while the card is still held.
  if (["cancelled", "completed"].includes(String(job.status)) && ["held", "failed", "cancelled"].includes(String(job.payment_status))) {
    const r = await releaseCardHold(deps, hold.job_id);
    if (r === "released") counts.released++;
    else if (r === "released_untold") defects.record(`job ${hold.job_id}: hold released, but the poster's "not charged" notice was not written (retried next run)`);
    else if (r === "captured") defects.record(`job ${hold.job_id}: a hold on a closed job reads captured: check whether a hire happened`);
    return;
  }

  // 3. Paid another way (or captured) while this row stayed open.
  if (!["held", "failed"].includes(String(job.payment_status))) {
    if (hold.payment_intent_id && job.stripe_payment_intent_id === hold.payment_intent_id) {
      await updateHold(db, hold.job_id, { state: "captured" }, [hold.state]);
    } else {
      if (hold.state === "authorized" && hold.payment_intent_id) {
        try {
          await stripe.paymentIntents.cancel(hold.payment_intent_id, { cancellation_reason: "duplicate" }, { idempotencyKey: `card-hold-superseded-${hold.payment_intent_id}` });
        } catch (e) {
          const pi = await stripe.paymentIntents.retrieve(hold.payment_intent_id);
          if (pi.status !== "canceled") throw new Error(`superseded hold ${hold.payment_intent_id} not cancelled (${pi.status}): ${caughtMessage(e)}`);
        }
      }
      // The poster paid another way: no "not charged" notice (notified_state set).
      await updateHold(db, hold.job_id, { state: "released", notified_state: "released" }, [hold.state]);
    }
    counts.reconciled++;
    return;
  }

  // 4. Waiting on the poster: make sure they were told. A failed hold whose job still reads
  // 'held' (the job write failed after the row moved) is taken off the listing again first
  // (round 4, silent #5): nobody can be hired on it, and the poster is asked to pay again.
  if (job.payment_status === "failed" || hold.state === "failed" || hold.state === "needs_action") {
    if (job.payment_status === "held") {
      await takeFailedHoldOffListing(db, job.id);
      defects.record(`job ${hold.job_id}: its hold is ${hold.state} but the job still read 'held'; taken off the listing now`);
    }
    if ((hold.state === "failed" || hold.state === "needs_action") && hold.notified_state !== hold.state) {
      if (await notifyPosterOnce(db, job, hold, hold.state)) counts.renotified++;
      else defects.record(`job ${hold.job_id}: the poster's "${hold.state}" notice still did not land`);
    }
    return;
  }

  // 5. A pending accept whose Helpr is ready now.
  if (await completePendingAccept(deps, job, defects)) { counts.completed++; return; }
  if (await completePendingCrewConfirms(deps, job, defects)) { counts.crew_confirmed++; return; }

  // 6. A scheduled hold whose day has come.
  if (hold.state === "scheduled" && hold.place_at && Date.parse(hold.place_at) <= now) {
    const allowed = offSessionAllowed(hold.amount_cents, job.category);
    if (!allowed.ok) {
      await failHold(deps, job, hold, "needs_action", allowed.why === "large" ? "on_session_required" : "taxed_on_session",
        allowed.why === "large" ? "a hold of $300 or more is confirmed on a Checkout page (Q210b)" : "a taxed category is held on a Checkout page");
      counts.failed_over++;
      return;
    }
    const placed = await placeOffSessionHold(stripe, hold.job_id, hold, hold.amount_cents, `a${hold.attempts}`);
    if (!placed.ok) {
      await failHold(deps, job, hold, placed.state, placed.code, placed.message);
      counts.failed_over++;
      return;
    }
    if (await recordAuthorized(deps, hold, placed.pi, defects)) counts.placed++;
    return;
  }

  // 7. An authorization near (or past) its expiry, the job still unhired.
  if (hold.state === "authorized" && hold.capture_before && Date.parse(hold.capture_before) - now <= RENEW_WITHIN_MS) {
    const oldPi = hold.payment_intent_id as string;
    // What Stripe says it is NOW, before anything is placed (lh-money-escrow review #6c).
    const current = await stripe.paymentIntents.retrieve(oldPi);
    if (current.status === "succeeded") {
      defects.record(`job ${hold.job_id}: hold ${oldPi} is captured at Stripe while the job reads 'held' (paged)`);
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "A card hold is captured at Stripe but the job still reads held",
        message: "card-hold-sweep found the hold captured while jobs.payment_status is 'held'. Nothing was renewed. Move the job to escrow by hand (or refund the poster if nobody was hired).",
        fields: { job_id: hold.job_id, payment_intent: oldPi },
        seed: job.is_seed === true,
      });
      return;
    }
    if (current.status === "canceled") {
      await failHold(deps, job, hold, "failed", "hold_expired", "the hold expired before anyone was hired");
      counts.failed_over++;
      return;
    }
    // Still capturable at Stripe past the recorded window (the window read was early, or a run was
    // missed): renewed now all the same, never left to lapse in silence (round 4, silent #6).
    if (Date.parse(hold.capture_before) <= now) defects.record(`job ${hold.job_id}: hold ${oldPi} is past its recorded capture_before and still capturable; renewing it now`);
    const allowed = offSessionAllowed(hold.amount_cents, job.category);
    if (!allowed.ok || !hold.payment_method_id) {
      await failHold(deps, job, hold, "needs_action", allowed.ok ? "no_saved_card" : allowed.why === "large" ? "on_session_required" : "taxed_on_session",
        "the hold is about to expire and can only be renewed on a Checkout page");
      counts.failed_over++;
      return;
    }
    // Only Stripe's definite no (a decline, or an invalid request: the saved card
    // cannot be used off-session) asks the poster (placeOffSessionHold answers it).
    // A timeout, a 5xx, a rate limit or a key still in use THROWS: the next run
    // retries with the same key, which answers the same hold if this one was
    // placed (round 2, silent #3).
    const renewed = await placeOffSessionHold(stripe, hold.job_id, hold, hold.amount_cents, `renew-${oldPi}`);
    if (!renewed.ok) {
      await failHold(deps, job, hold, renewed.state, renewed.code, renewed.message);
      counts.failed_over++;
      return;
    }
    if (!(await recordAuthorized(deps, hold, renewed.pi, defects))) return;
    // The new hold is recorded first, so a cancel that fails leaves the old
    // one to lapse on its own (never captured: nothing points at it).
    try {
      await stripe.paymentIntents.cancel(oldPi, { cancellation_reason: "abandoned" }, { idempotencyKey: `card-hold-renewed-${oldPi}` });
    } catch (e) {
      defects.record(`job ${hold.job_id}: the renewed hold's old authorization ${oldPi} was not cancelled: ${caughtMessage(e).slice(0, 150)}`);
    }
    counts.renewed++;
  }
}

/**
 * Record a placed (or renewed) authorization, pinned to the state and
 * PaymentIntent the hold was read with (lh-money-escrow review #7): when a
 * capture moved the row meanwhile, the new authorization is cancelled and the
 * miss recorded, never written over a captured hold.
 */
async function recordAuthorized(deps: Deps, hold: HoldRow, pi: Stripe.PaymentIntent, defects: Defects): Promise<boolean> {
  const { db, stripe } = deps;
  let q = db.from("job_card_holds")
    .update({ state: "authorized", payment_intent_id: pi.id, amount_cents: pi.amount, capture_before: captureBeforeIso(pi, true),
      failure_code: null, failure_message: null, updated_at: new Date().toISOString() })
    .eq("job_id", hold.job_id).eq("state", hold.state);
  q = hold.payment_intent_id ? q.eq("payment_intent_id", hold.payment_intent_id) : q.is("payment_intent_id", null);
  const { data: rows, error } = await q.select("job_id");
  if (error) throw new Error(`job ${hold.job_id}: the placed hold ${pi.id} was not recorded: ${error.message}`);
  const { data: jobRows, error: jobErr } = rows && rows.length > 0
    ? await db.from("jobs").update({ stripe_payment_intent_id: pi.id }).eq("id", hold.job_id).eq("payment_status", "held").select("id")
    : { data: [], error: null };
  if (jobErr) throw new Error(`job ${hold.job_id}: the placed hold ${pi.id} was not recorded on the job: ${jobErr.message}`);
  if (rows && rows.length > 0 && jobRows && jobRows.length > 0) return true;
  // The hold moved under us (a capture, a release): the new authorization is not ours to keep.
  try {
    await stripe.paymentIntents.cancel(pi.id, { cancellation_reason: "duplicate" }, { idempotencyKey: `card-hold-unrecorded-${pi.id}` });
  } catch (e) {
    defects.record(`job ${hold.job_id}: an unrecorded authorization ${pi.id} was not cancelled: ${caughtMessage(e).slice(0, 150)}`);
    return false;
  }
  defects.record(`job ${hold.job_id}: the hold moved while ${pi.id} was placed; that authorization was cancelled`);
  return false;
}

/**
 * A ban in force, as complete_pending_accepts_on_setup reads it (is_caller_banned's predicate,
 * 20261021061341): the sweep's completions run as the server, where enforce_ban_gate is skipped,
 * so a banned Helpr's pending accept is never charged for (round 4, money #2). Fails closed.
 */
async function helprBanInForce(db: Db, helperId: string): Promise<boolean> {
  const { data, error } = await db.from("profiles").select("ban_status, auto_suspended_until").eq("user_id", helperId).maybeSingle();
  if (error) throw new Error(`ban state not read for ${helperId}: ${error.message}`);
  const p = data as { ban_status?: string | null; auto_suspended_until?: string | null } | null;
  const status = String(p?.ban_status ?? "");
  if (!["banned", "temp_banned", "permanently_banned"].includes(status)) return false;
  return status !== "temp_banned" || !p?.auto_suspended_until || Date.parse(p.auto_suspended_until) > Date.now();
}

/**
 * A resumed capture (step 1) charged the card for an accept that rolled back while it hung: the
 * Helpr (or crew member) whose offer is still live hears they can accept now, through their own
 * accept and every gate it runs. Never throws; a miss is a defect.
 */
async function tellWaitingHelprsReady(db: Db, job: HoldJob, defects: Defects): Promise<void> {
  try {
    const { data, error } = await db.from("jobs")
      .select("status, helper_id, helper_confirmed_at, offered_to_helper_id, direct_offer_status, is_group_job, title")
      .eq("id", job.id).maybeSingle();
    if (error) throw new Error(error.message);
    const j = data as { status: string; helper_id: string | null; helper_confirmed_at: string | null; offered_to_helper_id: string | null;
      direct_offer_status: string | null; is_group_job: boolean | null; title: string | null } | null;
    if (!j) return;
    const ids: string[] = [];
    if (j.is_group_job) {
      const { data: seats, error: seatErr } = await db.from("group_job_helpers").select("helper_id, helper_confirmed_at").eq("job_id", job.id);
      if (seatErr) throw new Error(seatErr.message);
      for (const seat of (seats ?? []) as Array<{ helper_id: string | null; helper_confirmed_at: string | null }>) {
        if (seat.helper_id && seat.helper_confirmed_at == null) ids.push(seat.helper_id);
      }
    } else if (j.status === "accepted" && j.helper_id && j.helper_confirmed_at == null) ids.push(j.helper_id);
    else if (j.status === "open" && j.offered_to_helper_id && j.direct_offer_status === "pending") ids.push(j.offered_to_helper_id);
    if (ids.length === 0) return;
    const title = j.title ?? job.title ?? "the job";
    const landed = await insertNotifications(db, ids.map((id) => ({
      user_id: id, job_id: job.id, title: CARD_HOLD_COPY.helprReadyTitle, message: CARD_HOLD_COPY.helprReady(title), type: "job_updates", link: `/jobs?job=${job.id}`,
    })));
    if (!landed) defects.record(`job ${job.id}: captured on resume, but the "you can accept now" notice was not written`);
  } catch (e) {
    defects.record(`job ${job.id}: captured on resume, but the waiting Helpr was not told (${caughtMessage(e).slice(0, 150)})`);
  }
}

/**
 * The Hire's accept (or a direct offer's) recorded while the Helpr's setup was
 * unfinished, and the Helpr is ready now. Captured ONLY while that accept is
 * still live (lh-money-escrow review #3), then completed through the one
 * completion the profiles trigger uses (which skipped it while the card was
 * only held). A completion refused after the capture is paged.
 */
async function completePendingAccept(deps: Deps, job: HoldJob, defects: Defects): Promise<boolean> {
  const { db } = deps;
  const { data: pending, error } = await db.from("job_accept_pending").select("helper_id").eq("job_id", job.id).maybeSingle();
  if (error) throw new Error(`job_accept_pending read failed: ${error.message}`);
  const helperId = (pending as { helper_id?: string } | null)?.helper_id;
  if (!helperId) return false;
  const { data: block, error: blockErr } = await db.rpc("helper_accept_block_reason", { p_user_id: helperId });
  if (blockErr) throw new Error(`helper_accept_block_reason failed for ${helperId}: ${blockErr.message}`);
  if (block != null) return false;
  // complete_job_accept runs as the server, where the ban gate is skipped (round 4, money #2).
  if (await helprBanInForce(db, helperId)) return false;
  const { data: live, error: liveErr } = await db
    .from("jobs")
    .select("status, helper_id, helper_confirmed_at, response_deadline, offered_to_helper_id, direct_offer_status")
    .eq("id", job.id)
    .maybeSingle();
  if (liveErr) throw new Error(`job ${job.id} re-read failed: ${liveErr.message}`);
  const l = live as { status: string; helper_id: string | null; helper_confirmed_at: string | null; response_deadline: string | null; offered_to_helper_id: string | null; direct_offer_status: string | null } | null;
  if (!l) return false;
  const direct = l.status === "open";
  if (direct) {
    if (l.offered_to_helper_id !== helperId || l.direct_offer_status !== "pending") return false;
    const { data: why, error: whyErr } = await db.rpc("direct_accept_block_reason", { p_job_id: job.id, p_helper: helperId });
    if (whyErr) throw new Error(`direct_accept_block_reason failed for job ${job.id}: ${whyErr.message}`);
    if (why != null) return false;
  } else if (l.status !== "accepted" || l.helper_id !== helperId || l.helper_confirmed_at != null ||
             (l.response_deadline != null && Date.parse(l.response_deadline) <= Date.now())) {
    return false;
  }
  const captured = await captureCardHold(deps, job.id);
  if (!captured.ok) {
    if (captured.reason === "retry") defects.record(`job ${job.id}: pending accept capture will retry: ${captured.detail}`);
    // The poster has to pay again: the waiting Helpr hears why (once a day), as a tapped Accept does (round 2, silent #9).
    else if (captured.reason === "poster_must_pay") await notifyHelprWaiting(db, helperId, job);
    return false;
  }
  const { data: done, error: doneErr } = direct
    ? await db.rpc("complete_direct_offer_accept", { p_job_id: job.id, p_helper: helperId })
    : await db.rpc("complete_job_accept", { p_job_id: job.id });
  if (doneErr || (direct ? done == null : done !== true)) {
    const why = doneErr?.message ?? "the accept did not complete";
    defects.record(`job ${job.id}: captured for a pending accept that did not complete (${why}); retried next run`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "A card hold was captured for a pending accept that did not complete",
      message: "card-hold-sweep charged the poster's held card for a Helpr's pending accept, and the completion was refused. The next run retries it; if it keeps failing, the job is funded with nobody hired.",
      fields: { job_id: job.id, helpr: helperId, error: why.slice(0, 200) },
      seed: job.is_seed === true,
    });
    return false;
  }
  return true;
}

/**
 * A crew member's Confirm recorded on a held job while their setup was
 * unfinished (crew_confirm_pending), the member ready now and the spot still
 * theirs on a live job: the first one captures the card, and each confirms
 * exactly as complete_pending_crew_confirms_on_setup does (which skipped them
 * while the card was only held): the seat is confirmed, the member and the
 * poster hear it, the pending row goes.
 */
async function completePendingCrewConfirms(deps: Deps, job: HoldJob, defects: Defects): Promise<boolean> {
  const { db } = deps;
  if (!["open", "accepted", "in_progress"].includes(String(job.status))) return false;
  const { data: rows, error } = await db.from("crew_confirm_pending").select("slot_id, helper_id").eq("job_id", job.id);
  if (error) throw new Error(`crew_confirm_pending read failed: ${error.message}`);
  let any = false;
  for (const r of (rows ?? []) as Array<{ slot_id: string; helper_id: string }>) {
    const { data: block, error: blockErr } = await db.rpc("helper_accept_block_reason", { p_user_id: r.helper_id });
    if (blockErr) throw new Error(`helper_accept_block_reason failed for ${r.helper_id}: ${blockErr.message}`);
    if (block != null) continue;
    if (await helprBanInForce(db, r.helper_id)) continue;
    const { data: slot, error: slotErr } = await db.from("group_job_helpers").select("helper_id, helper_confirmed_at").eq("id", r.slot_id).maybeSingle();
    if (slotErr) throw new Error(`crew seat ${r.slot_id} read failed: ${slotErr.message}`);
    const seat = slot as { helper_id: string | null; helper_confirmed_at: string | null } | null;
    if (!seat || seat.helper_id !== r.helper_id || seat.helper_confirmed_at != null) continue;
    const captured = await captureCardHold(deps, job.id);
    if (!captured.ok) {
      if (captured.reason === "retry") defects.record(`job ${job.id}: crew confirm capture will retry: ${captured.detail}`);
      return any;
    }
    const { data: confirmed, error: seatErr } = await db
      .from("group_job_helpers")
      .update({ helper_confirmed_at: new Date().toISOString() })
      .eq("id", r.slot_id)
      .eq("helper_id", r.helper_id)
      .is("helper_confirmed_at", null)
      .select("id");
    if (seatErr) throw new Error(`job ${job.id}: captured, but crew seat ${r.slot_id} was not confirmed: ${seatErr.message}`);
    if ((confirmed ?? []).length > 0) {
      const { data: prof, error: profErr } = await db.from("profiles").select("full_name").eq("user_id", r.helper_id).maybeSingle();
      if (profErr) defects.record(`job ${job.id}: member name not read for the confirm notice (${profErr.message}); the fallback name was used`);
      // "First L." (the member-name rule, Q2292), as complete_pending_crew_confirms_on_setup writes it in SQL.
      const name = memberDisplayName((prof as { full_name?: string | null } | null)?.full_name, "Someone");
      const title = job.title ?? "the job";
      const landed = await insertNotifications(db, [
        { user_id: r.helper_id, job_id: job.id, title: "You're all set", type: "job_updates", link: `/jobs?job=${job.id}`,
          message: `Your setup is done, so your spot on "${title}" is confirmed.` },
        ...(job.customer_id ? [{ user_id: job.customer_id, job_id: job.id, title: `${name} confirmed their spot`, type: "job_updates",
          link: `/posts?job=${job.id}`, message: `${name} confirmed their spot on "${title}".` }] : []),
      ]);
      if (!landed) defects.record(`job ${job.id}: crew confirm notices not written`);
      any = true;
    }
    const { error: delErr } = await db.from("crew_confirm_pending").delete().eq("slot_id", r.slot_id);
    if (delErr) defects.record(`job ${job.id}: crew_confirm_pending ${r.slot_id} not cleared: ${delErr.message}`);
  }
  return any;
}
