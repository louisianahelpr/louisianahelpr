// seed-policy: pages for seed/E2E jobs too, on purpose: every defect here is a
// poster's card held (or charged) while the database says otherwise.
//
// card-hold-sweep (Q2399, owner 2026-10-25): the cron half of "hold the
// poster's card when a job is posted; charge it only when someone is hired".
// Every 10 minutes, over every open card hold (job_card_holds):
//   1. RELEASE: the job closed with nobody hired (the poster cancelled, the
//      expiry sweep closed it): the authorization is cancelled (no refund, no
//      fee) and the poster is told their card was not charged.
//   2. COMPLETE a pending accept: a Helpr accepted while their payout setup
//      was unfinished, and is ready now: the card is captured and the accept
//      completes (complete_job_accept / complete_direct_offer_accept); a crew
//      member's recorded Confirm completes the same way.
//   3. PLACE a scheduled hold (a job more than 6 days out) once its place_at
//      arrives: off-session, under $300 and on an untaxed category; otherwise
//      the poster confirms it on a Checkout page (Q210b, tax).
//   4. RENEW an authorization within 12 h of its capture_before while the job
//      is still unhired; a hold Stripe already dropped fails over to the poster.
// A failed hold takes the job off the listing (payment_status 'failed': nobody
// can be hired until the poster pays again) and tells the poster once.
// Each hold is settled in its OWN Stripe mode (job_card_holds.stripe_mode).
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { createStripeModeResolver, type StripeMode } from "../_shared/stripeMode.ts";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import {
  RENEW_WITHIN_MS,
  captureBeforeIso,
  captureCardHold,
  failHold,
  offSessionAllowed,
  placeOffSessionHold,
  readJob,
  releaseCardHold,
  updateHold,
  type HoldRow,
} from "../_shared/cardHold.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPEN_STATES = ["authorized", "scheduled", "needs_action", "failed"];
const BATCH = 200;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );
    const stripes = createStripeModeResolver(db, (key) => new Stripe(key, { apiVersion: "2025-08-27.basil" }));
    const defects = defectTracker();
    const counts = { holds: 0, released: 0, completed: 0, crew_confirmed: 0, placed: 0, renewed: 0, failed_over: 0 };

    const { data: holds, error: holdsErr } = await db
      .from("job_card_holds")
      .select("job_id, stripe_mode, stripe_customer_id, payment_method_id, payment_intent_id, state, amount_cents, onboarding_fee_cents, intent_metadata, capture_before, place_at, attempts, notified_state")
      .in("state", OPEN_STATES)
      .order("updated_at", { ascending: true })
      .limit(BATCH);
    if (holdsErr) return cronError("card-hold-sweep", `job_card_holds read failed: ${holdsErr.message}`, corsHeaders);
    const now = Date.now();

    for (const hold of (holds ?? []) as HoldRow[]) {
      counts.holds++;
      const mode = hold.stripe_mode as StripeMode;
      const deps = { db, stripe: stripes.clientFor(mode), mode };
      try {
        const job = await readJob(db, hold.job_id);
        // 1. Nobody hired: the job is closed (or gone) while the card is still held.
        if (!job || ["cancelled", "completed"].includes(String(job.status))) {
          if (!job || job.payment_status === "held" || job.payment_status === "failed") {
            const r = await releaseCardHold(deps, hold.job_id);
            if (r === "released") counts.released++;
            else if (r === "captured") defects.record(`job ${hold.job_id}: a hold being released had been captured (paged)`);
          }
          continue;
        }
        if (job.payment_status !== "held") continue; // failed: waiting on the poster, who was told

        // 2. A pending accept whose Helpr is ready now.
        const completed = await completePendingAccept(deps, job, defects);
        if (completed) { counts.completed++; continue; }
        if (await completePendingCrewConfirms(deps, job, defects)) { counts.crew_confirmed++; continue; }

        // 3. A scheduled hold whose day has come.
        if (hold.state === "scheduled" && hold.place_at && Date.parse(hold.place_at) <= now) {
          const allowed = offSessionAllowed(hold.amount_cents, job.category);
          if (!allowed.ok) {
            await failHold(deps, job, hold, "needs_action", allowed.why === "large" ? "on_session_required" : "taxed_on_session",
              allowed.why === "large" ? "a hold of $300 or more is confirmed by the poster (Q210b)" : "a taxed category is held on a Checkout page");
            counts.failed_over++;
            continue;
          }
          const placed = await placeOffSessionHold(deps.stripe, hold.job_id, hold, hold.amount_cents, `a${hold.attempts}`);
          if (!placed.ok) {
            await failHold(deps, job, hold, placed.state, placed.code, placed.message);
            counts.failed_over++;
            continue;
          }
          await recordAuthorized(db, hold.job_id, placed.pi);
          counts.placed++;
          continue;
        }

        // 4. An authorization near (or past) its expiry, the job still unhired.
        if (hold.state === "authorized" && hold.capture_before && Date.parse(hold.capture_before) - now <= RENEW_WITHIN_MS) {
          const oldPi = hold.payment_intent_id as string;
          if (Date.parse(hold.capture_before) <= now) {
            const pi = await deps.stripe.paymentIntents.retrieve(oldPi);
            if (pi.status === "canceled") {
              await failHold(deps, job, hold, "failed", "hold_expired", "the hold expired before anyone was hired");
              counts.failed_over++;
            }
            continue;
          }
          const allowed = offSessionAllowed(hold.amount_cents, job.category);
          if (!allowed.ok || !hold.payment_method_id) {
            await failHold(deps, job, hold, "needs_action", allowed.ok ? "no_saved_card" : allowed.why === "large" ? "on_session_required" : "taxed_on_session",
              "the hold is about to expire and can only be renewed with the poster");
            counts.failed_over++;
            continue;
          }
          const renewed = await placeOffSessionHold(deps.stripe, hold.job_id, hold, hold.amount_cents, `renew-${oldPi}`);
          if (!renewed.ok) {
            await failHold(deps, job, hold, renewed.state, renewed.code, renewed.message);
            counts.failed_over++;
            continue;
          }
          await recordAuthorized(db, hold.job_id, renewed.pi);
          // The new hold is recorded first, so a cancel that fails leaves the
          // old one to lapse on its own (never captured: nothing points at it).
          try {
            await deps.stripe.paymentIntents.cancel(oldPi, { cancellation_reason: "abandoned" }, { idempotencyKey: `card-hold-renewed-${oldPi}` });
          } catch (e) {
            defects.record(`job ${hold.job_id}: the renewed hold's old authorization ${oldPi} was not cancelled: ${caughtMessage(e).slice(0, 150)}`);
          }
          counts.renewed++;
        }
      } catch (e) {
        defects.record(`job ${hold.job_id}: ${caughtMessage(e).slice(0, 300)}`);
      }
    }
    return cronResult("card-hold-sweep", counts, defects.defects, corsHeaders);
  } catch (e) {
    return cronError("card-hold-sweep", caughtMessage(e), corsHeaders);
  }
});

// deno-lint-ignore no-explicit-any
async function recordAuthorized(db: any, jobId: string, pi: Stripe.PaymentIntent): Promise<void> {
  await updateHold(db, jobId, {
    state: "authorized", payment_intent_id: pi.id, amount_cents: pi.amount, capture_before: captureBeforeIso(pi),
    failure_code: null, failure_message: null,
  });
  const { error } = await db.from("jobs").update({ stripe_payment_intent_id: pi.id }).eq("id", jobId).eq("payment_status", "held");
  if (error) throw new Error(`job ${jobId}: the placed hold ${pi.id} was not recorded on the job: ${error.message}`);
}

/**
 * The Hire's accept (or a direct offer's) recorded while the Helpr's setup was
 * unfinished, and the Helpr is ready now: capture, then complete it through
 * the one completion the profiles trigger uses (which skipped it while the
 * card was only held).
 */
async function completePendingAccept(
  deps: { db: any; stripe: Stripe; mode: StripeMode },
  job: { id: string; status: string | null; helper_id: string | null },
  defects: ReturnType<typeof defectTracker>,
): Promise<boolean> {
  const { db } = deps;
  const { data: pending, error } = await db.from("job_accept_pending").select("helper_id").eq("job_id", job.id).maybeSingle();
  if (error) throw new Error(`job_accept_pending read failed: ${error.message}`);
  const helperId = (pending as { helper_id?: string } | null)?.helper_id;
  if (!helperId) return false;
  const { data: block, error: blockErr } = await db.rpc("helper_accept_block_reason", { p_user_id: helperId });
  if (blockErr) throw new Error(`helper_accept_block_reason failed for ${helperId}: ${blockErr.message}`);
  if (block != null) return false;
  const captured = await captureCardHold(deps, job.id);
  if (!captured.ok) {
    if (captured.reason === "retry") defects.record(`job ${job.id}: pending accept capture will retry: ${captured.detail}`);
    return false;
  }
  const direct = job.status === "open";
  const { data: done, error: doneErr } = direct
    ? await db.rpc("complete_direct_offer_accept", { p_job_id: job.id, p_helper: helperId })
    : await db.rpc("complete_job_accept", { p_job_id: job.id });
  if (doneErr) throw new Error(`job ${job.id}: captured, but the pending accept did not complete: ${doneErr.message}`);
  if (direct ? done == null : done !== true) {
    // Captured (the job is in escrow, as any funded job), and the offer moved
    // on meanwhile: the money is now exactly where an unhired funded job's is.
    defects.record(`job ${job.id}: captured for a pending accept that no longer completes; it is now an unhired funded job`);
    return false;
  }
  return true;
}

/**
 * A crew member's Confirm recorded on a held job while their setup was
 * unfinished (crew_confirm_pending), the member ready now: the first one
 * captures the card, and each confirms exactly as
 * complete_pending_crew_confirms_on_setup does (which skipped them while the
 * card was only held): the seat is confirmed, the member and the poster hear
 * it, the pending row goes.
 */
async function completePendingCrewConfirms(
  deps: { db: any; stripe: Stripe; mode: StripeMode },
  job: { id: string; title: string | null; customer_id: string | null },
  defects: ReturnType<typeof defectTracker>,
): Promise<boolean> {
  const { db } = deps;
  const { data: rows, error } = await db.from("crew_confirm_pending").select("slot_id, helper_id").eq("job_id", job.id);
  if (error) throw new Error(`crew_confirm_pending read failed: ${error.message}`);
  let any = false;
  for (const r of (rows ?? []) as Array<{ slot_id: string; helper_id: string }>) {
    const { data: block, error: blockErr } = await db.rpc("helper_accept_block_reason", { p_user_id: r.helper_id });
    if (blockErr) throw new Error(`helper_accept_block_reason failed for ${r.helper_id}: ${blockErr.message}`);
    if (block != null) continue;
    const captured = await captureCardHold(deps, job.id);
    if (!captured.ok) {
      if (captured.reason === "retry") defects.record(`job ${job.id}: crew confirm capture will retry: ${captured.detail}`);
      return any;
    }
    const { data: seat, error: seatErr } = await db
      .from("group_job_helpers")
      .update({ helper_confirmed_at: new Date().toISOString() })
      .eq("id", r.slot_id)
      .eq("helper_id", r.helper_id)
      .is("helper_confirmed_at", null)
      .select("id");
    if (seatErr) throw new Error(`job ${job.id}: captured, but crew seat ${r.slot_id} was not confirmed: ${seatErr.message}`);
    if ((seat ?? []).length > 0) {
      const { data: prof } = await db.from("profiles").select("full_name").eq("user_id", r.helper_id).maybeSingle();
      const name = (prof as { full_name?: string | null } | null)?.full_name?.trim().split(/\s+/)[0] || "Someone";
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
