// seed-policy: pages for seed/test jobs too, on purpose: the alerts here are a card
// captured or held while the database says otherwise, money that moved whoever owns it.
//
// cardHold — the poster's card HOLD on a job (Q2399, owner 2026-10-25: "hold the
// poster's card when a job is posted; charge it only when someone is hired").
// Behind the switch card_hold_at_post. Migration 20261025202148_card_hold_at_post
// holds the model: a held job is payment_status 'held' (listed, never funded),
// its hold is one public.job_card_holds row, and no hire can complete on it.
//
// Imports are spelled ../_shared/ (as shopHolds.ts does) so the edge test
// harness, which walks this module, mocks the alerting ones.
//
// One copy of every Stripe move on a hold, used by create-payment (the Helpr's
// accept = the hire, the poster's cancel), stripe-webhook (the hold is placed)
// and card-hold-sweep (place, renew, release, complete pending accepts):
//   capture  at the hire: the held amount is captured, the job moves to escrow,
//            and from there every path runs exactly as before;
//   charge   at the hire on a card only SAVED (a job far out): one off-session
//            charge, captured at once;
//   place    the hold for a job far out, about 4 days before its start;
//   release  nobody was hired: the authorization is cancelled (no refund, no
//            fee) and the poster is told their card was not charged.
// What happened is read from the PaymentIntent's state, never the error text,
// and only a definite answer from Stripe fails a hold: a timeout leaves it as
// it was for the next try. A supabase error THROWS (the caller answers "try
// again" / records a cron defect), so money that moved is never unrecorded.
//
// Copy names no fee (owner 2026-10-25: members see no fee but the one-time $2
// setup fee); the amounts are the whole hold.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { jobLocalStartMs } from "../_shared/cancellationFee.ts";
import { isLaborTaxable } from "../_shared/salesTax.ts";
import { THREE_D_SECURE_MIN_CENTS } from "../_shared/threeDSecure.ts";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import type { StripeMode } from "../_shared/stripeMode.ts";
import { CARD_HOLD_COPY } from "../_shared/cardHoldCopy.ts";

export { CARD_HOLD_COPY };

// deno-lint-ignore no-explicit-any
type Db = any;

export const CARD_HOLD_SWITCH = "card_hold_at_post";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/**
 * A job starting within 6 days is held at posting: a card authorization made
 * with the poster present lasts 7 days on every brand (Stripe, "Place a hold
 * on a payment method", validity table), so the hold outlives the listing.
 */
export const HOLD_AT_POST_WITHIN_MS = 6 * DAY_MS;
/**
 * A job further out saves the card and the hold is placed 4 days before the
 * start. The hold is then off-session, and Visa's off-session window is
 * 4 days 18 hours (same table), the shortest of the brands.
 */
export const PLACE_BEFORE_START_MS = 4 * DAY_MS;
/** An authorization this close to its capture_before is renewed (or the poster asked) by the sweep. */
export const RENEW_WITHIN_MS = 12 * HOUR_MS;
/**
 * Checkout takes payment_method_options[card|link].capture_method from this
 * API version (Stripe changelog 2025-09-30.clover, "capture method for
 * specific payment methods with the Checkout Sessions API"); the rest of the
 * code pins 2025-08-27.basil. Sent on the hold checkout's create call only.
 */
export const CARD_HOLD_CHECKOUT_API_VERSION = "2025-09-30.clover";

export type HoldPlan = { kind: "hold_now" } | { kind: "schedule"; placeAt: Date };

/** Hold at posting, or save the card and hold it 4 days before the job's start (America/Chicago). */
export function holdPlanFor(dateNeeded: string | null | undefined, startTime: string | null | undefined, nowMs: number = Date.now()): HoldPlan {
  const start = dateNeeded ? jobLocalStartMs(dateNeeded, startTime ?? null) : NaN;
  if (!Number.isFinite(start) || start - nowMs <= HOLD_AT_POST_WITHIN_MS) return { kind: "hold_now" };
  return { kind: "schedule", placeAt: new Date(start - PLACE_BEFORE_START_MS) };
}

/**
 * Checkout's payment_method_options for a hold: card and Link are held; ACH
 * (us_bank_account) carries no capture_method because a bank debit cannot be
 * held (Stripe), so a poster paying by bank is charged at posting, as today.
 * `threeDS` is threeDSecureOptions(total) (Q202: from $300 the hosted page
 * runs 3D Secure).
 */
export function holdCheckoutPaymentMethodOptions(
  threeDS: { card?: Record<string, unknown> } | undefined,
): { card: Record<string, unknown>; link: { capture_method: "manual" } } {
  return { card: { ...(threeDS?.card ?? {}), capture_method: "manual" }, link: { capture_method: "manual" } };
}

/**
 * May the hold (or the charge at the hire) on a SAVED card go through without
 * the poster? Not from $300 (Q210(b): a large charge is on-session, with 3D
 * Secure), and not on a taxed category: its sales tax is computed only by
 * Checkout from the poster's address, and a later refund reads the tax off the
 * Checkout Session (refundAmount.checkoutChargeTaxCents), which an off-session
 * payment has none of. Either way the poster confirms on a Checkout page.
 */
export function offSessionAllowed(amountCents: number, category: string | null | undefined): { ok: true } | { ok: false; why: "large" | "taxed" } {
  if (!(amountCents < THREE_D_SECURE_MIN_CENTS)) return { ok: false, why: "large" };
  if (isLaborTaxable(category ?? null)) return { ok: false, why: "taxed" };
  return { ok: true };
}

export type HoldState = "authorized" | "scheduled" | "needs_action" | "failed" | "captured" | "released";

export type HoldRow = {
  job_id: string;
  stripe_mode: StripeMode;
  stripe_customer_id: string | null;
  payment_method_id: string | null;
  payment_intent_id: string | null;
  state: HoldState;
  amount_cents: number;
  onboarding_fee_cents: number;
  intent_metadata: Record<string, string> | null;
  capture_before: string | null;
  place_at: string | null;
  attempts: number;
  notified_state: string | null;
};

const HOLD_COLUMNS =
  "job_id, stripe_mode, stripe_customer_id, payment_method_id, payment_intent_id, state, amount_cents, onboarding_fee_cents, intent_metadata, capture_before, place_at, attempts, notified_state";

export async function readHold(db: Db, jobId: string): Promise<HoldRow | null> {
  const { data, error } = await db.from("job_card_holds").select(HOLD_COLUMNS).eq("job_id", jobId).maybeSingle();
  if (error) throw new Error(`job_card_holds read failed for job ${jobId}: ${error.message}`);
  return (data as HoldRow | null) ?? null;
}

export type HoldJob = {
  id: string;
  customer_id: string | null;
  title: string | null;
  status: string | null;
  payment_status: string | null;
  helper_id: string | null;
  category: string | null;
  is_seed: boolean | null;
};

export async function readJob(db: Db, jobId: string): Promise<HoldJob | null> {
  const { data, error } = await db
    .from("jobs")
    .select("id, customer_id, title, status, payment_status, helper_id, category, is_seed")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`job read failed for card hold ${jobId}: ${error.message}`);
  return (data as HoldJob | null) ?? null;
}

export async function updateHold(db: Db, jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await db
    .from("job_card_holds")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .select("job_id");
  if (error) throw new Error(`job_card_holds update failed for job ${jobId}: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`job_card_holds update matched 0 rows for job ${jobId}`);
}

/** The poster hears each state once (job_card_holds.notified_state). Never throws: the hold already moved. */
export async function notifyPosterOnce(db: Db, job: Pick<HoldJob, "id" | "customer_id" | "title">, hold: Pick<HoldRow, "notified_state" | "amount_cents">, state: HoldState): Promise<void> {
  if (!job.customer_id || hold.notified_state === state) return;
  const title = job.title ?? "your job";
  const copy = state === "authorized" ? { t: CARD_HOLD_COPY.heldTitle, m: CARD_HOLD_COPY.held(hold.amount_cents) }
    : state === "scheduled" ? { t: CARD_HOLD_COPY.scheduledTitle, m: CARD_HOLD_COPY.scheduled(hold.amount_cents) }
    : state === "released" ? { t: CARD_HOLD_COPY.releasedTitle, m: CARD_HOLD_COPY.released(title) }
    : state === "failed" ? { t: CARD_HOLD_COPY.failedTitle, m: CARD_HOLD_COPY.failed(title) }
    : state === "needs_action" ? { t: CARD_HOLD_COPY.confirmTitle, m: CARD_HOLD_COPY.confirm(title) }
    : null;
  if (!copy) return;
  const landed = await insertNotifications(db, {
    user_id: job.customer_id, job_id: job.id, title: copy.t, message: copy.m, type: "financial_alerts", link: `/posts?job=${job.id}`,
  });
  if (!landed) {
    console.error(`[cardHold] poster notice '${state}' for job ${job.id} was not written`);
    return;
  }
  const { error } = await db.from("job_card_holds").update({ notified_state: state }).eq("job_id", job.id);
  if (error) console.error(`[cardHold] notified_state write failed for job ${job.id}: ${error.message}`);
}

/** The Helpr the hire is waiting on hears why (never throws). */
export async function notifyHelprWaiting(db: Db, helperId: string | null | undefined, job: Pick<HoldJob, "id" | "title">): Promise<void> {
  if (!helperId) return;
  const landed = await insertNotifications(db, {
    user_id: helperId, job_id: job.id, title: CARD_HOLD_COPY.helprWaitingTitle,
    message: CARD_HOLD_COPY.helprWaiting(job.title ?? "The job"), type: "job_updates", link: `/jobs?job=${job.id}`,
  });
  if (!landed) console.error(`[cardHold] Helpr waiting notice for job ${job.id} was not written`);
}

/** Card errors that are Stripe's definite no (the hold cannot be used): decline, expired, auth needed. */
function cardErrorCode(e: unknown): string | null {
  const err = e as { type?: string; code?: string; raw?: { code?: string } } | null;
  if (err?.type === "StripeCardError" || err?.type === "card_error") return err.code ?? err.raw?.code ?? "card_declined";
  return null;
}

/**
 * The one-time $2 setup fee rides inside a hold. It is CLAIMED on the profile
 * before the capture, so two holds captured at once never collect it twice:
 * the loser captures without it (a smaller capture releases the rest; nothing
 * is refunded).
 */
async function claimSetupFee(db: Db, posterId: string | null, feeCents: number): Promise<{ claimed: boolean; at: string | null }> {
  if (!posterId || !(feeCents > 0)) return { claimed: false, at: null };
  const at = new Date().toISOString();
  const { data, error } = await db
    .from("profiles")
    .update({ onboarding_fee_paid: true, onboarding_fee_charged_at: at })
    .eq("user_id", posterId)
    .eq("onboarding_fee_paid", false)
    .select("user_id");
  if (error) throw new Error(`setup fee claim failed for ${posterId}: ${error.message}`);
  return { claimed: (data ?? []).length > 0, at };
}

async function unclaimSetupFee(db: Db, posterId: string | null, at: string | null): Promise<void> {
  if (!posterId || !at) return;
  const { error } = await db
    .from("profiles")
    .update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
    .eq("user_id", posterId)
    .eq("onboarding_fee_charged_at", at);
  if (error) throw new Error(`setup fee claim put back failed for ${posterId}: ${error.message}`);
}

export type CaptureResult =
  /** The card is charged and the job is in escrow (already, or now). */
  | { ok: true; already: boolean }
  /** The poster has to pay or confirm on a Checkout page; they were told. */
  | { ok: false; reason: "poster_must_pay" }
  /** Stripe did not answer definitely: nothing changed, try again. */
  | { ok: false; reason: "retry"; detail: string }
  /** The job is not on a card hold (unpaid, closed, gone). */
  | { ok: false; reason: "not_held" };

export type HoldDeps = { db: Db; stripe: Stripe; mode: StripeMode };

/**
 * THE HIRE: charge the poster's held (or saved) card for this job and move it
 * to escrow, so the accept that follows completes on captured money. Called by
 * create-payment capture_hold (the Helpr's Accept / Confirm) and by
 * card-hold-sweep (a pending accept whose Helpr finished setup).
 */
export async function captureCardHold(deps: HoldDeps, jobId: string): Promise<CaptureResult> {
  const { db, stripe, mode } = deps;
  const job = await readJob(db, jobId);
  if (!job) return { ok: false, reason: "not_held" };
  if (["escrow", "payout_pending", "released"].includes(String(job.payment_status))) return { ok: true, already: true };
  const hold = await readHold(db, jobId);
  if (job.payment_status === "failed" && hold) return { ok: false, reason: "poster_must_pay" };
  if (job.payment_status !== "held" || !hold) return { ok: false, reason: "not_held" };
  if (hold.stripe_mode !== mode) {
    // Never judge a hold from the wrong Stripe account: a 404 there is not a decline.
    throw new Error(`card hold for job ${jobId} is ${hold.stripe_mode}-mode, this request is ${mode}`);
  }
  if (hold.state !== "authorized" && hold.state !== "scheduled") return { ok: false, reason: "poster_must_pay" };

  const fee = await claimSetupFee(db, job.customer_id, Number(hold.onboarding_fee_cents ?? 0));
  const amountCents = Number(hold.amount_cents) - (Number(hold.onboarding_fee_cents ?? 0) > 0 && !fee.claimed ? Number(hold.onboarding_fee_cents) : 0);
  let capturedPi: string | null = null;
  let failState: "failed" | "needs_action" | null = null;
  let failCode = "";
  let failMessage = "";

  if (hold.state === "authorized") {
    const piId = hold.payment_intent_id as string;
    try {
      const pi = await stripe.paymentIntents.capture(piId, { amount_to_capture: amountCents }, {
        idempotencyKey: `card-hold-capture-${piId}-${amountCents}-a${hold.attempts}`,
      });
      if (pi.status === "succeeded") capturedPi = pi.id;
      else { failState = "failed"; failCode = `capture_left_${pi.status}`; failMessage = `capture left the payment ${pi.status}`; }
    } catch (e) {
      const why = caughtMessage(e).slice(0, 300);
      let now: Stripe.PaymentIntent | null = null;
      try {
        now = await stripe.paymentIntents.retrieve(piId);
      } catch (readErr) {
        await unclaimSetupFee(db, job.customer_id, fee.claimed ? fee.at : null);
        return { ok: false, reason: "retry", detail: `${why}; state unreadable: ${caughtMessage(readErr).slice(0, 150)}` };
      }
      if (now.status === "succeeded") capturedPi = now.id;
      else if (now.status === "canceled") { failState = "failed"; failCode = "hold_expired"; failMessage = `the hold is gone (${now.cancellation_reason ?? "canceled"}): ${why}`; }
      else if (now.status === "requires_capture") {
        // Still capturable: Stripe did not say no. Nothing moved; try again.
        await unclaimSetupFee(db, job.customer_id, fee.claimed ? fee.at : null);
        return { ok: false, reason: "retry", detail: why };
      } else { failState = "failed"; failCode = `hold_${now.status}`; failMessage = why; }
    }
  } else {
    // A SAVED card (a job far out whose hold is not placed yet): one charge now.
    const allowed = offSessionAllowed(amountCents, job.category);
    if (!allowed.ok) {
      failState = "needs_action";
      failCode = allowed.why === "large" ? "on_session_required" : "taxed_on_session";
      failMessage = allowed.why === "large" ? "a charge of $300 or more is confirmed by the poster (Q210b)" : "a taxed category is charged on a Checkout page";
    } else {
      try {
        const pi = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: "usd",
          customer: hold.stripe_customer_id ?? undefined,
          payment_method: hold.payment_method_id ?? undefined,
          off_session: true,
          confirm: true,
          metadata: { ...(hold.intent_metadata ?? {}), job_id: jobId, card_hold: "1", card_hold_off_session: "1",
            onboarding_fee_charged: fee.claimed ? "true" : "false" },
        }, { idempotencyKey: `card-hold-charge-${jobId}-${amountCents}-a${hold.attempts}` });
        if (pi.status === "succeeded") capturedPi = pi.id;
        else if (pi.status === "processing") {
          await unclaimSetupFee(db, job.customer_id, fee.claimed ? fee.at : null);
          return { ok: false, reason: "retry", detail: "the charge is processing" };
        } else { failState = pi.status === "requires_action" ? "needs_action" : "failed"; failCode = `charge_${pi.status}`; failMessage = `the charge is ${pi.status}`; }
      } catch (e) {
        const code = cardErrorCode(e);
        if (!code) {
          await unclaimSetupFee(db, job.customer_id, fee.claimed ? fee.at : null);
          return { ok: false, reason: "retry", detail: caughtMessage(e).slice(0, 300) };
        }
        failState = code === "authentication_required" ? "needs_action" : "failed";
        failCode = code;
        failMessage = caughtMessage(e).slice(0, 300);
      }
    }
  }

  if (capturedPi) {
    const { data: moved, error: moveErr } = await db
      .from("jobs")
      .update({
        payment_status: "escrow",
        stripe_payment_intent_id: capturedPi,
        ...(fee.claimed ? { onboarding_fee_amount: Number(hold.onboarding_fee_cents) / 100 } : {}),
      })
      .eq("id", jobId)
      .eq("payment_status", "held")
      .select("id");
    if (moveErr || !moved || moved.length === 0) {
      const now = await readJob(db, jobId);
      if (!moveErr && now && now.payment_status === "escrow") {
        await updateHold(db, jobId, { state: "captured", payment_intent_id: capturedPi });
        return { ok: true, already: true };
      }
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Card hold captured but the job did not move to escrow",
        message: "The poster's card was charged at the hire, but jobs.payment_status did not leave 'held'. The next accept retries the move (the capture is idempotent); if it does not, set the job to escrow by hand.",
        fields: { job_id: jobId, payment_intent: capturedPi, payment_status: String(now?.payment_status ?? "gone"), db_error: moveErr?.message ?? "matched 0 rows" },
        seed: job.is_seed === true,
      });
      throw new Error(`card hold captured for job ${jobId} (${capturedPi}) but the escrow move failed: ${moveErr?.message ?? "matched 0 rows"}`);
    }
    await updateHold(db, jobId, { state: "captured", payment_intent_id: capturedPi, attempts: Number(hold.attempts) + 1 });
    return { ok: true, already: false };
  }

  await unclaimSetupFee(db, job.customer_id, fee.claimed ? fee.at : null);
  await failHold(deps, job, hold, failState ?? "failed", failCode, failMessage);
  return { ok: false, reason: "poster_must_pay" };
}

/**
 * The hold cannot be used: the job leaves the listing (payment_status
 * 'failed': nobody can be hired, the poster's "Finish paying" re-mints a
 * checkout exactly as for any failed payment) and the poster is told once.
 * A still-live authorization is cancelled first, so it never lingers on the
 * poster's card and the re-mint finds no PaymentIntent in flight.
 */
export async function failHold(
  deps: HoldDeps, job: HoldJob, hold: HoldRow, state: "failed" | "needs_action", code: string, message: string,
): Promise<void> {
  const { db, stripe } = deps;
  if (hold.state === "authorized" && hold.payment_intent_id) {
    try {
      await stripe.paymentIntents.cancel(hold.payment_intent_id, {}, { idempotencyKey: `card-hold-drop-${hold.payment_intent_id}` });
    } catch (e) {
      const now = await stripe.paymentIntents.retrieve(hold.payment_intent_id).catch(() => null);
      if (now && now.status !== "canceled") {
        throw new Error(`card hold ${hold.payment_intent_id} on job ${job.id} could not be dropped (${now.status}): ${caughtMessage(e)}`);
      }
    }
  }
  await updateHold(db, job.id, { state, failure_code: code.slice(0, 100), failure_message: message.slice(0, 500), attempts: Number(hold.attempts) + 1 });
  // stripe_session_id leaves with it, as a bounced bank payment's does
  // (paymentIntentPaymentFailed): the completed hold checkout would otherwise
  // make create-payment refuse the poster's "Finish paying" as in flight.
  const { error } = await db.from("jobs").update({ payment_status: "failed", stripe_session_id: null }).eq("id", job.id).eq("payment_status", "held");
  if (error) throw new Error(`job ${job.id} not taken off the listing after its card hold failed: ${error.message}`);
  await notifyPosterOnce(db, job, hold, state);
}

export type ReleaseResult = "released" | "already_gone" | "captured";

/**
 * NOBODY HIRED: cancel the authorization (a dropped hold costs nothing and
 * creates no refund) or drop the saved-card schedule, mark the job's money
 * 'cancelled', and tell the poster their card was not charged. The job itself
 * is already cancelled by its caller (the poster's cancel, the expiry sweep).
 */
export async function releaseCardHold(deps: HoldDeps, jobId: string): Promise<ReleaseResult> {
  const { db, stripe, mode } = deps;
  const job = await readJob(db, jobId);
  const hold = await readHold(db, jobId);
  if (!job || !hold) return "already_gone";
  if (hold.state === "captured") return "captured";
  if (hold.state === "released") return "already_gone";
  if (hold.stripe_mode !== mode) throw new Error(`card hold for job ${jobId} is ${hold.stripe_mode}-mode, this request is ${mode}`);
  if (hold.state === "authorized" && hold.payment_intent_id) {
    const piId = hold.payment_intent_id;
    try {
      await stripe.paymentIntents.cancel(piId, { cancellation_reason: "abandoned" }, { idempotencyKey: `card-hold-release-${piId}` });
    } catch (e) {
      const now = await stripe.paymentIntents.retrieve(piId);
      if (now.status === "succeeded") {
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "A released card hold had been captured",
          message: "Nobody was hired, so the poster's card hold was being released, but Stripe says it was captured. The job was left as it is: check who captured it and refund the poster.",
          fields: { job_id: jobId, payment_intent: piId, job_status: String(job.status), payment_status: String(job.payment_status) },
          seed: job.is_seed === true,
        });
        return "captured";
      }
      if (now.status !== "canceled") throw new Error(`card hold ${piId} on job ${jobId} was not released (${now.status}): ${caughtMessage(e)}`);
    }
  }
  await updateHold(db, jobId, { state: "released" });
  const { error } = await db.from("jobs").update({ payment_status: "cancelled" }).eq("id", jobId).in("payment_status", ["held", "failed"]);
  if (error) throw new Error(`job ${jobId} money not marked cancelled after its hold was released: ${error.message}`);
  await notifyPosterOnce(db, job, hold, "released");
  return "released";
}

/**
 * A hold on a SAVED card, off-session, captured later (place a scheduled hold,
 * renew one near its expiry). Returns the PaymentIntent, or the state the hold
 * must take when Stripe says no; throws on an answer that is not definite.
 */
export async function placeOffSessionHold(
  stripe: Stripe, jobId: string, hold: HoldRow, amountCents: number, keySuffix: string,
): Promise<{ ok: true; pi: Stripe.PaymentIntent } | { ok: false; state: "failed" | "needs_action"; code: string; message: string }> {
  try {
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: hold.stripe_customer_id ?? undefined,
      payment_method: hold.payment_method_id ?? undefined,
      off_session: true,
      confirm: true,
      capture_method: "manual",
      expand: ["latest_charge"],
      metadata: { ...(hold.intent_metadata ?? {}), job_id: jobId, card_hold: "1", card_hold_off_session: "1" },
    }, { idempotencyKey: `card-hold-place-${jobId}-${keySuffix}` });
    if (pi.status === "requires_capture") return { ok: true, pi };
    return { ok: false, state: pi.status === "requires_action" ? "needs_action" : "failed", code: `hold_${pi.status}`, message: `the hold is ${pi.status}` };
  } catch (e) {
    const code = cardErrorCode(e);
    if (!code) throw e;
    return { ok: false, state: code === "authentication_required" ? "needs_action" : "failed", code, message: caughtMessage(e).slice(0, 300) };
  }
}

/** The authorization's expiry: the charge's payment_method_details.card.capture_before (seconds), as ISO. */
export function captureBeforeIso(pi: Stripe.PaymentIntent | null | undefined): string | null {
  const charge = pi?.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge as Stripe.Charge : null;
  const sec = (charge?.payment_method_details as { card?: { capture_before?: number } } | null | undefined)?.card?.capture_before;
  return typeof sec === "number" && Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null;
}
