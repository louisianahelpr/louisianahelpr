// seed-policy: pages for seed/E2E jobs too, on purpose: a card held for a job the
// database does not show held is money in flight whoever owns the job.
//
// Q2399 (owner 2026-10-25): a job checkout opened by create-payment with the
// card_hold_at_post switch on (session metadata card_hold "1") HOLDS the
// poster's card instead of charging it. This settles that checkout:
//   * payment mode, PaymentIntent requires_capture (card or Link): the job is
//     payment_status 'held' (listed, never funded: migration
//     20261027185146), one job_card_holds row 'authorized' with the charge's
//     capture_before, the Helpr fan-out, and the poster hears "Your card is on
//     hold for $X. You're only charged when you hire someone." The one-time
//     setup fee is NOT settled here: it is collected at the capture.
//   * setup mode (a job more than 6 days out): the card is saved, the job is
//     'held', the row is 'scheduled' for 4 days before the start.
//   * anything else (a bank payment, which cannot be held, processing or
//     succeeded) returns false: the ordinary job path settles it as today.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { insertNotifications } from "../../_shared/insertNotifications.ts";
import { effectiveSalesTaxRate, jobEscrowTaxableBaseCents } from "../../_shared/salesTax.ts";
import { CARD_HOLD_COPY, LIVE_JOB_STATUSES, captureBeforeIso, notifyPosterOnce, readHold } from "../../_shared/cardHold.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";

export function isCardHoldSession(session: Stripe.Checkout.Session): boolean {
  return (session.metadata as Record<string, string> | null)?.card_hold === "1";
}

/** The states a job is promoted to 'held' from (the webhook's own unfunded set). */
const UNFUNDED_OR = "payment_status.is.null,payment_status.in.(unpaid,failed,abandoned)";

function intOf(v: unknown): number {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** True when this checkout was a card hold and is now settled; false: the ordinary job path takes it. */
export async function settleCardHoldCheckout(
  session: Stripe.Checkout.Session,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<boolean> {
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const jobId = meta.job_id;
  if (!jobId) {
    logStep("WARNING: card-hold checkout with no job_id", { sessionId: session.id });
    return true;
  }
  const mode = session.livemode ? "live" : "test";
  const onboardingCents = meta.onboarding_fee_charged === "true" ? intOf(meta.onboarding_fee_cents) : 0;

  if (session.mode === "setup") {
    const siId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
    if (!siId) throw new Error(`card-hold setup checkout ${session.id} has no SetupIntent`);
    const si = await stripe.setupIntents.retrieve(siId);
    const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id ?? null;
    const customer = typeof si.customer === "string" ? si.customer : si.customer?.id ?? null;
    if (si.status !== "succeeded" || !pm) {
      // No card saved: the job stays unpaid, and its completed session is
      // cleared so the poster's "Finish paying" is not refused as in flight
      // (lh-silent-failure review #17). Zero rows is legitimate (moved on).
      const { error: clearErr } = await supabase.from("jobs").update({ stripe_session_id: null })
        .eq("id", jobId).eq("stripe_session_id", session.id).or(UNFUNDED_OR);
      if (clearErr) throw new Error(`card-hold setup: session ${session.id} not cleared on job ${jobId}: ${clearErr.message}`);
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: "A card-hold setup checkout completed without a saved card",
        message: "The poster finished the save-card page but Stripe has no saved card for it. The job stays unpaid and the poster can pay again.",
        fields: { session_id: session.id, job_id: jobId, setup_intent: siId, status: String(si.status) },
      });
      return true;
    }
    const amountCents = intOf(meta.hold_amount_cents);
    const placeAt = meta.hold_place_at && !Number.isNaN(Date.parse(meta.hold_place_at)) ? meta.hold_place_at : null;
    if (!(amountCents > 0) || !placeAt) throw new Error(`card-hold setup checkout ${session.id} carries no hold amount/place_at`);
    let intentMeta: Record<string, string> = {};
    try {
      intentMeta = JSON.parse(meta.card_hold_intent ?? "{}") as Record<string, string>;
    } catch {
      // The PaymentIntent placed later still carries job_id and card_hold; only the fee-model echo is lost.
      logStep("WARNING: card-hold setup checkout's intent metadata is not JSON", { sessionId: session.id });
    }
    const { data: moved, error: moveErr } = await supabase
      .from("jobs")
      .update({ payment_status: "held" })
      .eq("id", jobId)
      .eq("stripe_session_id", session.id)
      .or(UNFUNDED_OR)
      .in("status", LIVE_JOB_STATUSES)
      .select("id, customer_id, title");
    if (moveErr) throw new Error(`card-hold setup: job ${jobId} not marked held: ${moveErr.message}`);
    let target = moved as Array<{ id: string; customer_id: string | null; title: string | null }> | null;
    if (!target || target.length === 0) {
      // A retry after a first run that marked the job held and then failed to
      // write the hold row: the job is THIS session's and held, with no row.
      // The row is written now, or the job would sit held with nothing to
      // capture or release (round 2, silent #4).
      const { data: mine, error: mineErr } = await supabase.from("jobs").select("id, customer_id, title")
        .eq("id", jobId).eq("stripe_session_id", session.id).eq("payment_status", "held").in("status", LIVE_JOB_STATUSES);
      if (mineErr) throw new Error(`card-hold setup: job ${jobId} re-read failed: ${mineErr.message}`);
      const existing = (mine ?? []).length > 0 ? await readHold(supabase, jobId) : null;
      if ((mine ?? []).length > 0 && !existing) {
        target = mine as Array<{ id: string; customer_id: string | null; title: string | null }>;
      } else {
        // A saved card moves no money: a job closed or re-checked-out meanwhile keeps nothing.
        logStep("Card-hold setup checkout for a job no longer waiting on it; nothing held", { jobId, sessionId: session.id });
        return true;
      }
    }
    const { error: holdErr } = await supabase.from("job_card_holds").upsert({
      job_id: jobId, stripe_mode: mode, stripe_customer_id: customer, payment_method_id: pm, payment_intent_id: null,
      state: "scheduled", amount_cents: amountCents, onboarding_fee_cents: onboardingCents, intent_metadata: intentMeta,
      capture_before: null, place_at: placeAt, failure_code: null, failure_message: null, notified_state: null,
      capturing_from: null, capture_amount_cents: null, onboarding_fee_claimed_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "job_id" });
    if (holdErr) throw new Error(`card-hold setup: hold row for job ${jobId} not written: ${holdErr.message}`);
    const hold = await readHold(supabase, jobId);
    await notifyPosterOnce(supabase, target[0], hold ?? { notified_state: null, amount_cents: amountCents }, "scheduled");
    await fanOut(supabase, jobId, logStep);
    logStep("Card saved for a later hold", { jobId, placeAt });
    return true;
  }

  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!piId) throw new Error(`card-hold checkout ${session.id} has no PaymentIntent`);
  const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] });
  if (pi.status !== "requires_capture") {
    // Only a BANK payment (which cannot be held) takes today's path. A card
    // or Link payment in any other state (a redelivery after the capture or
    // the release) would re-run today's setup-fee settlement on a hold
    // (lh-silent-failure review #10): logged and paged instead.
    const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge as Stripe.Charge : null;
    const used = charge?.payment_method_details?.type ?? (Array.isArray(pi.payment_method_types) && pi.payment_method_types.length === 1 ? pi.payment_method_types[0] : null);
    if (used === "us_bank_account" || pi.status === "processing") return false;
    // A redelivery ONLY when the job already carries this payment (the hold
    // was recorded, then captured or released). A card payment captured at
    // checkout that no job records (Checkout did not hold it) is a charge
    // like any other: today's path settles it, never a log line with the
    // poster charged and the job unpaid (round 2, silent #1).
    const { data: carrier, error: carrierErr } = await supabase.from("jobs").select("id").eq("id", jobId).eq("stripe_payment_intent_id", pi.id).maybeSingle();
    if (carrierErr) throw new Error(`card-hold: job ${jobId} read failed while checking ${pi.id}: ${carrierErr.message}`);
    // ... and a hold row for it: a job that carries the payment with no hold row
    // is today's path part-done (a captured-at-checkout payment whose settle
    // threw), which its retry finishes (round 3 #5).
    const heldRow = carrier ? await readHold(supabase, jobId) : null;
    if (carrier && heldRow?.payment_intent_id !== pi.id && pi.status === "succeeded") return false;
    if (!carrier && pi.status === "succeeded") {
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: "A card-hold checkout charged the card instead of holding it",
        message: "Stripe captured a hold checkout's card payment at checkout. The job is settled as an ordinary paid job (funded now, refunded minus the card fee if nobody is hired). If this repeats, card holds are not working: turn card_hold_at_post off.",
        fields: { session_id: session.id, job_id: jobId, payment_intent: pi.id, method: String(used ?? "unknown") },
      });
      return false;
    }
    logStep("Card-hold checkout redelivered after its hold moved; nothing re-settled", { jobId, pi: pi.id, status: pi.status, method: used });
    if (pi.status !== "succeeded" && pi.status !== "canceled") {
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: "A card-hold checkout completed in an unexpected state",
        message: "A hold checkout completed but its payment is neither held, captured, released nor a bank payment. Nothing was recorded; check the payment by hand.",
        fields: { session_id: session.id, job_id: jobId, payment_intent: pi.id, status: pi.status, method: String(used ?? "unknown") },
      });
    }
    return true;
  }

  const taxCents = typeof session.total_details?.amount_tax === "number" ? session.total_details.amount_tax : null;
  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select("id, budget, category, customer_fee_amount, poster_fee_flat_cents, is_urgent, urgent_fee, helper_id, helper_confirmed_at, title, customer_id, offered_to_helper_id, direct_offer_status, stripe_payment_intent_id, payment_status")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr) throw new Error(`card-hold: job ${jobId} read failed: ${jobErr.message}`);
  const update: Record<string, unknown> = { payment_status: "held", stripe_payment_intent_id: pi.id };
  if (taxCents !== null && jobRow) {
    update.sales_tax_amount = taxCents / 100;
    const base = jobEscrowTaxableBaseCents(jobRow);
    if (base > 0) update.sales_tax_rate = effectiveSalesTaxRate(taxCents, base);
    else if (taxCents === 0) update.sales_tax_rate = 0;
  }
  const { data: moved, error: moveErr } = await supabase
    .from("jobs")
    .update(update)
    .eq("id", jobId)
    // a redelivery of this same hold re-writes; nothing else moves a job to held
    .or(`${UNFUNDED_OR},and(stripe_payment_intent_id.eq.${pi.id},payment_status.eq.held)`)
    .in("status", LIVE_JOB_STATUSES)
    .select("id, customer_id, title, helper_id, helper_confirmed_at");
  if (moveErr) {
    await postSlackOpsAlert({
      kind: "custom",
      severity: "critical",
      title: "Card hold placed but the job was not marked held",
      message: "A poster's card is held for a job whose row could not be updated. Stripe will retry once the database recovers.",
      fields: { session_id: session.id, job_id: jobId, payment_intent: pi.id, db_error: moveErr.message },
    });
    throw new Error(`card-hold: job ${jobId} not marked held (PI ${pi.id}): ${moveErr.message}`);
  }
  if (!moved || moved.length === 0) {
    // Funded another way, closed, or gone: this hold is dropped, which costs
    // the poster nothing (no refund, no fee), and ops hears why it happened.
    await stripe.paymentIntents.cancel(pi.id, { cancellation_reason: "duplicate" }, { idempotencyKey: `card-hold-duplicate-${pi.id}` })
      .catch(async (e: unknown) => {
        const now = await stripe.paymentIntents.retrieve(pi.id);
        if (now.status !== "canceled") throw e;
      });
    await postSlackOpsAlert({
      kind: "custom",
      severity: "warning",
      title: "A card hold on a job that was not waiting for one was dropped",
      message: "A hold checkout completed for a job that was already funded, closed or gone. The hold was cancelled, so the poster was not charged. Find how a second checkout was open (Q1419).",
      fields: { session_id: session.id, job_id: jobId, payment_intent: pi.id },
    });
    return true;
  }
  // A re-pay of a hold that had failed (not a redelivery of this same hold):
  // the Helprs the offer names are told they can accept now, once.
  const prior = await readHold(supabase, jobId);
  const was = jobRow as { stripe_payment_intent_id?: string | null; payment_status?: string | null } | null;
  if (prior && prior.payment_intent_id === pi.id && was?.stripe_payment_intent_id === pi.id && was?.payment_status === "held") {
    // A redelivery of THIS hold: the row is already written (and may carry a
    // capture claim right now); writing it again would wipe that claim and
    // re-send "your card is on hold" (round 2, silent #7).
    logStep("Card-hold checkout redelivered; hold already recorded", { jobId, pi: pi.id, state: prior.state });
    return true;
  }
  const repaid = !!prior && prior.payment_intent_id !== pi.id && (prior.state === "failed" || prior.state === "needs_action");
  const { error: holdErr } = await supabase.from("job_card_holds").upsert({
    job_id: jobId, stripe_mode: mode,
    stripe_customer_id: typeof pi.customer === "string" ? pi.customer : pi.customer?.id ?? null,
    payment_method_id: typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id ?? null,
    payment_intent_id: pi.id, state: "authorized", amount_cents: pi.amount, onboarding_fee_cents: onboardingCents,
    intent_metadata: (pi.metadata ?? {}) as Record<string, string>, capture_before: captureBeforeIso(pi), place_at: null,
    failure_code: null, failure_message: null, notified_state: null, updated_at: new Date().toISOString(),
    capturing_from: null, capture_amount_cents: null, onboarding_fee_claimed_at: null,
  }, { onConflict: "job_id" });
  if (holdErr) throw new Error(`card-hold: hold row for job ${jobId} (PI ${pi.id}) not written: ${holdErr.message}`);
  const job = moved[0] as { id: string; customer_id: string | null; title: string | null; helper_id: string | null; helper_confirmed_at: string | null };
  const hold = await readHold(supabase, jobId);
  await notifyPosterOnce(supabase, job, hold ?? { notified_state: null, amount_cents: pi.amount }, "authorized");
  // A poster paying again while an offer is out (the hold had failed): every
  // Helpr that offer names can accept now: the Hire's Helpr, a direct offer's,
  // a crew's unconfirmed members (lh-silent-failure review #11).
  const waiting = new Set<string>();
  if (job.helper_id && !job.helper_confirmed_at) waiting.add(job.helper_id);
  const direct = jobRow as { offered_to_helper_id?: string | null; direct_offer_status?: string | null } | null;
  if (direct?.offered_to_helper_id && direct.direct_offer_status === "pending") waiting.add(direct.offered_to_helper_id);
  const { data: seats, error: seatsErr } = await supabase.from("group_job_helpers").select("helper_id").eq("job_id", jobId).is("helper_confirmed_at", null);
  if (seatsErr) logStep("WARN: crew seats not read for the 'you can accept now' notice", { jobId, error: seatsErr.message });
  for (const r of (seats ?? []) as Array<{ helper_id: string | null }>) if (r.helper_id) waiting.add(r.helper_id);
  if (waiting.size > 0 && repaid) {
    // Each row carries its job_id, so a seed job's notice stays with seed accounts (seedNeverNotifiesReal).
    const readyRows = [...waiting].map((uid) => ({
      user_id: uid, job_id: jobId, title: CARD_HOLD_COPY.helprReadyTitle,
      message: CARD_HOLD_COPY.helprReady(job.title ?? "the job"), type: "job_updates", link: `/jobs?job=${jobId}`,
    }));
    const landed = await insertNotifications(supabase, readyRows);
    if (!landed) logStep("WARN: Helpr 'you can accept now' notice not written", { jobId, count: waiting.size });
  }
  await fanOut(supabase, jobId, logStep);
  logStep("Card held for a job; charged at the hire", { jobId, pi: pi.id, amount: pi.amount });
  return true;
}

/** Same best-effort match fan-out the ordinary funding path triggers (never fails the hold). */
// deno-lint-ignore no-explicit-any
async function fanOut(supabase: any, jobId: string, logStep: WebhookContext["logStep"]): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("instant-job-match", {
      body: { jobId },
      headers: { Authorization: `Bearer ${(Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!}` },
    });
    if (error) logStep("WARN: instant-job-match failed after a card hold", { jobId, error: error.message });
  } catch (e) {
    logStep("WARN: instant-job-match threw after a card hold", { jobId, error: caughtMessage(e) });
  }
}
