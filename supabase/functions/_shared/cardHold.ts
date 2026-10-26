// seed-policy: pages for seed/test jobs too, on purpose: the alerts here are a card
// captured or held while the database says otherwise, money that moved whoever owns it.
//
// cardHold — the poster's card HOLD on a job (Q2399, owner 2026-10-25: "hold the
// poster's card when a job is posted; charge it only when someone is hired").
// Behind the switch card_hold_at_post. Migration 20261026001019_card_hold_at_post
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
 * The card is saved off-session too (lh-money-escrow review #6a): a hold that
 * nears its expiry is renewed on it, and a series charges later visits to it
 * (charge-recurring-visits seriesCard). `threeDS` is threeDSecureOptions(total)
 * (Q202: from $300 the hosted page runs 3D Secure).
 */
export function holdCheckoutPaymentMethodOptions(
  threeDS: { card?: Record<string, unknown> } | undefined,
): { card: Record<string, unknown>; link: { capture_method: "manual"; setup_future_usage: "off_session" } } {
  return {
    card: { ...(threeDS?.card ?? {}), capture_method: "manual", setup_future_usage: "off_session" },
    link: { capture_method: "manual", setup_future_usage: "off_session" },
  };
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

export type HoldState = "authorized" | "scheduled" | "capturing" | "needs_action" | "failed" | "captured" | "released";

export type HoldRow = {
  job_id: string;
  stripe_mode: StripeMode;
  stripe_customer_id: string | null;
  payment_method_id: string | null;
  payment_intent_id: string | null;
  state: HoldState;
  amount_cents: number;
  onboarding_fee_cents: number;
  onboarding_fee_claimed_at: string | null;
  capturing_from: string | null;
  capture_amount_cents: number | null;
  updated_at?: string | null;
  intent_metadata: Record<string, string> | null;
  capture_before: string | null;
  place_at: string | null;
  attempts: number;
  notified_state: string | null;
};

const HOLD_COLUMNS =
  "job_id, stripe_mode, stripe_customer_id, payment_method_id, payment_intent_id, state, amount_cents, onboarding_fee_cents, onboarding_fee_claimed_at, capturing_from, capture_amount_cents, intent_metadata, capture_before, place_at, attempts, notified_state, updated_at";

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
  stripe_payment_intent_id?: string | null;
};

export async function readJob(db: Db, jobId: string): Promise<HoldJob | null> {
  const { data, error } = await db
    .from("jobs")
    .select("id, customer_id, title, status, payment_status, helper_id, category, is_seed, stripe_payment_intent_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`job read failed for card hold ${jobId}: ${error.message}`);
  return (data as HoldJob | null) ?? null;
}

/**
 * Move a hold. `fromStates` pins the state it was read in (lh-silent-failure
 * review #4): a capture and the sweep racing on one hold never overwrite each
 * other. Zero rows THROWS (the hold moved meanwhile, or is gone).
 */
export async function updateHold(db: Db, jobId: string, patch: Record<string, unknown>, fromStates?: HoldState[]): Promise<void> {
  let q = db
    .from("job_card_holds")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("job_id", jobId);
  if (fromStates) q = q.in("state", fromStates);
  const { data, error } = await q.select("job_id");
  if (error) throw new Error(`job_card_holds update failed for job ${jobId}: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`job_card_holds update matched 0 rows for job ${jobId}${fromStates ? ` (expected state ${fromStates.join("/")})` : ""}`);
  }
}

/**
 * The poster hears each state once (job_card_holds.notified_state). Never
 * throws (the hold already moved); answers whether the poster has been told,
 * so a caller that cannot retry records the miss (lh-silent-failure review #2)
 * and card-hold-sweep re-sends a missed one.
 */
export async function notifyPosterOnce(db: Db, job: Pick<HoldJob, "id" | "customer_id" | "title">, hold: Pick<HoldRow, "notified_state" | "amount_cents">, state: HoldState): Promise<boolean> {
  // An ownerless job (the poster deleted their account) has nobody to tell.
  if (!job.customer_id || hold.notified_state === state) return true;
  const title = job.title ?? "your job";
  const copy = state === "authorized" ? { t: CARD_HOLD_COPY.heldTitle, m: CARD_HOLD_COPY.held(hold.amount_cents) }
    : state === "scheduled" ? { t: CARD_HOLD_COPY.scheduledTitle, m: CARD_HOLD_COPY.scheduled(hold.amount_cents) }
    : state === "released" ? { t: CARD_HOLD_COPY.releasedTitle, m: CARD_HOLD_COPY.released(title) }
    : state === "failed" ? { t: CARD_HOLD_COPY.failedTitle, m: CARD_HOLD_COPY.failed(title) }
    : state === "needs_action" ? { t: CARD_HOLD_COPY.confirmTitle, m: CARD_HOLD_COPY.confirm(title) }
    : null;
  if (!copy) return true;
  const landed = await insertNotifications(db, {
    user_id: job.customer_id, job_id: job.id, title: copy.t, message: copy.m, type: "financial_alerts", link: `/posts?job=${job.id}`,
  });
  if (!landed) {
    console.error(`[cardHold] poster notice '${state}' for job ${job.id} was not written`);
    return false;
  }
  const { data: marked, error } = await db.from("job_card_holds").update({ notified_state: state }).eq("job_id", job.id).select("job_id");
  if (error || !marked || marked.length === 0) {
    // The notice landed; only the once-marker did not, so a later re-send can repeat it once.
    console.error(`[cardHold] notified_state write for job ${job.id} ${error ? `failed: ${error.message}` : "matched 0 rows"}`);
  }
  return true;
}

/** The Helpr the hire is waiting on hears why (never throws). */
export async function notifyHelprWaiting(db: Db, helperId: string | null | undefined, job: Pick<HoldJob, "id" | "title">): Promise<void> {
  if (!helperId) return;
  // Once a day per Helpr and job: every Accept tap that finds the payment not
  // ready used to send it again (round 2, silent #9). A failed read sends it.
  const { data: sent, error: sentErr } = await db.from("notifications").select("id")
    .eq("user_id", helperId).eq("job_id", job.id).eq("title", CARD_HOLD_COPY.helprWaitingTitle)
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString()).limit(1);
  if (sentErr) console.error(`[cardHold] Helpr waiting notice check for job ${job.id} failed: ${sentErr.message}`);
  else if ((sent ?? []).length > 0) return;
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
 * is refunded). The claim is recorded on the hold
 * (onboarding_fee_claimed_at) and KEPT across a retry whose outcome Stripe did
 * not answer: the retry captures the same amount under the same key, never a
 * second charge (lh-silent-failure review #3). It is given back only on a
 * definite no (unclaimSetupFee).
 */
async function claimSetupFee(db: Db, jobId: string, posterId: string | null, hold: HoldRow): Promise<{ claimed: boolean; at: string | null }> {
  const feeCents = Number(hold.onboarding_fee_cents ?? 0);
  if (!posterId || !(feeCents > 0)) return { claimed: false, at: null };
  if (hold.onboarding_fee_claimed_at) return { claimed: true, at: hold.onboarding_fee_claimed_at };
  const at = new Date().toISOString();
  const { data, error } = await db
    .from("profiles")
    .update({ onboarding_fee_paid: true, onboarding_fee_charged_at: at })
    .eq("user_id", posterId)
    .eq("onboarding_fee_paid", false)
    .select("user_id");
  if (error) throw new Error(`setup fee claim failed for ${posterId}: ${error.message}`);
  if ((data ?? []).length === 0) return { claimed: false, at: null };
  try {
    await updateHold(db, jobId, { onboarding_fee_claimed_at: at });
  } catch (e) {
    // The profile says paid but the hold does not carry the claim: put the
    // profile back, or the $2 would never be collected (round 2, silent #8).
    const { error: backErr } = await db.from("profiles").update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
      .eq("user_id", posterId).eq("onboarding_fee_charged_at", at);
    if (backErr) console.error(`[cardHold] setup fee claim for ${posterId} not put back after the hold write failed: ${backErr.message}`);
    throw e;
  }
  return { claimed: true, at };
}

/** A definite no: the claim this hold made is given back (matched on its own time), so the fee is owed again. */
async function unclaimSetupFee(db: Db, jobId: string, posterId: string | null, at: string | null): Promise<void> {
  if (!posterId || !at) return;
  // Zero rows is legitimate: the poster's fee was since collected another way.
  const { error } = await db
    .from("profiles")
    .update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
    .eq("user_id", posterId)
    .eq("onboarding_fee_charged_at", at);
  if (error) throw new Error(`setup fee claim put back failed for ${posterId}: ${error.message}`);
  await updateHold(db, jobId, { onboarding_fee_claimed_at: null });
}

export type CaptureResult =
  /** The card is charged and the job is in escrow (already, or now). */
  | { ok: true; already: boolean }
  /** The poster has to pay or confirm on a Checkout page; they were told. */
  | { ok: false; reason: "poster_must_pay" }
  /** Stripe did not answer definitely, or another capture holds the claim: try again. */
  | { ok: false; reason: "retry"; detail: string }
  /** The job is not on a card hold (unpaid, closed, gone). */
  | { ok: false; reason: "not_held" };

export type HoldDeps = { db: Db; stripe: Stripe; mode: StripeMode };

/** Job statuses a hold's money may land on: every status but the closed two (completed, cancelled). */
export const LIVE_JOB_STATUSES = ["open", "accepted", "in_progress", "revision_requested", "disputed", "pending_approval"];

/** A claim older than this is a capture that died mid-way: card-hold-sweep resumes it. */
export const STALE_CAPTURE_MS = 2 * 60 * 1000;

/**
 * THE HIRE: charge the poster's held (or saved) card for this job and move it
 * to escrow, so the accept that follows completes on captured money. Called by
 * create-payment capture_hold (the Helpr's Accept / Confirm, after the hire's
 * own gates passed) and by card-hold-sweep (a pending accept whose Helpr
 * finished setup; a stale claim, `resume`).
 *
 * The hold ROW is claimed first (state 'capturing', lh-money-escrow review
 * #1): of two captures at once, one finds nothing to claim and charges
 * nothing. The claim fixes the ONE amount (the $2 setup fee in or out, decided
 * once) and the idempotency key is the job/attempt only, so a retry or a
 * resume asks Stripe for the same charge and Stripe answers the first one
 * again. An outcome Stripe did not answer leaves the claim for the sweep.
 */
export async function captureCardHold(deps: HoldDeps, jobId: string, opts: { resume?: boolean } = {}): Promise<CaptureResult> {
  const { db, stripe, mode } = deps;
  const job = await readJob(db, jobId);
  if (!job) return { ok: false, reason: "not_held" };
  if (["escrow", "payout_pending", "released"].includes(String(job.payment_status))) {
    // A capture that moved the job to escrow and then failed to mark its own
    // row: the row is closed here, or a later cancel of this HIRED job would
    // find it 'capturing' (round 3 #1).
    const row = await readHold(db, jobId);
    if (row?.state === "capturing" && row.payment_intent_id && job.stripe_payment_intent_id === row.payment_intent_id) {
      await updateHold(db, jobId, { state: "captured", capturing_from: null }, ["capturing"]);
    }
    return { ok: true, already: true };
  }
  // A closed job is never charged, even before the sweep releases it (review #3).
  if (CLOSED_JOB_STATUSES.includes(String(job.status))) {
    // A claim left 'capturing' on a job that closed (a capture racing the
    // poster's cancel or the expiry): settled here, never left open forever
    // (lh-money-escrow + lh-silent-failure round 2, #1/#2).
    const stale = await readHold(db, jobId);
    if (stale && stale.state === "capturing" && opts.resume) return settleClaimOnClosedJob(deps, job, stale);
    return { ok: false, reason: "not_held" };
  }
  const hold = await readHold(db, jobId);
  if (job.payment_status === "failed" && hold) return { ok: false, reason: "poster_must_pay" };
  if (job.payment_status !== "held" || !hold) return { ok: false, reason: "not_held" };
  if (hold.stripe_mode !== mode) {
    // Never judge a hold from the wrong Stripe account: a 404 there is not a decline.
    throw new Error(`card hold for job ${jobId} is ${hold.stripe_mode}-mode, this request is ${mode}`);
  }

  // ── The claim ──
  let from: "authorized" | "scheduled";
  let amountCents: number;
  let feeIncluded: boolean;
  let feeAt: string | null;
  if (hold.state === "authorized" || hold.state === "scheduled") {
    const { data: claimed, error: claimErr } = await db
      .from("job_card_holds")
      .update({ state: "capturing", capturing_from: hold.state, updated_at: new Date().toISOString() })
      .eq("job_id", jobId)
      .eq("state", hold.state)
      .select("job_id");
    if (claimErr) throw new Error(`card hold claim failed for job ${jobId}: ${claimErr.message}`);
    if (!claimed || claimed.length === 0) return { ok: false, reason: "retry", detail: "another capture of this hold is in progress" };
    from = hold.state;
    if (hold.capture_amount_cents != null && hold.capture_amount_cents > 0) {
      // An earlier attempt decided it (and Stripe may already hold that request): the same amount.
      amountCents = Number(hold.capture_amount_cents);
      feeAt = hold.onboarding_fee_claimed_at;
      feeIncluded = !!feeAt;
    } else {
      const fee = await claimSetupFee(db, jobId, job.customer_id, hold);
      const feeCents = Number(hold.onboarding_fee_cents ?? 0);
      feeAt = fee.at;
      feeIncluded = feeCents > 0 && fee.claimed;
      amountCents = Number(hold.amount_cents) - (feeCents > 0 && !fee.claimed ? feeCents : 0);
      await updateHold(db, jobId, { capture_amount_cents: amountCents }, ["capturing"]);
    }
  } else if (hold.state === "capturing") {
    if (!opts.resume) return { ok: false, reason: "retry", detail: "a capture of this hold is in progress" };
    if (!hold.capturing_from || !(Number(hold.capture_amount_cents) > 0)) {
      // Claimed but nothing decided, so nothing was sent to Stripe: give the claim back.
      await updateHold(db, jobId, { state: hold.capturing_from ?? "authorized" }, ["capturing"]);
      return { ok: false, reason: "retry", detail: "a stale claim with no amount was put back" };
    }
    from = hold.capturing_from as "authorized" | "scheduled";
    amountCents = Number(hold.capture_amount_cents);
    feeAt = hold.onboarding_fee_claimed_at;
    feeIncluded = !!feeAt;
  } else {
    return { ok: false, reason: "poster_must_pay" };
  }

  // The job is read AGAIN after the claim: a poster's cancel (or the expiry)
  // that closed it in the moment between gets the claim back and nothing is
  // charged. A cancel that reads the hold after this claim refuses
  // (create-payment cancel_escrow, auto-expire-jobs), so the two never both win.
  const fresh = await readJob(db, jobId);
  if (!fresh || CLOSED_JOB_STATUSES.includes(String(fresh.status))) {
    // A resumed claim may already have reached Stripe: read it there first.
    if (hold.state === "capturing" && fresh) return settleClaimOnClosedJob(deps, fresh, await readHold(db, jobId) ?? hold);
    // A fresh claim sent nothing to Stripe yet: it simply goes back.
    await unclaimSetupFee(db, jobId, job.customer_id, feeAt);
    await updateHold(db, jobId, { state: from, capturing_from: null, capture_amount_cents: null, onboarding_fee_claimed_at: null }, ["capturing"]);
    return { ok: false, reason: "not_held" };
  }

  let capturedPi: string | null = null;
  let failState: "failed" | "needs_action" | null = null;
  let failCode = "";
  let failMessage = "";
  /** Stripe did not say no: the claim stays (an unknown outcome) or goes back (nothing moved). */
  const notDefinite = async (detail: string, nothingMoved: boolean): Promise<CaptureResult> => {
    if (nothingMoved) await updateHold(db, jobId, { state: from }, ["capturing"]);
    return { ok: false, reason: "retry", detail };
  };

  if (from === "authorized") {
    const piId = hold.payment_intent_id as string;
    try {
      const pi = await stripe.paymentIntents.capture(piId, { amount_to_capture: amountCents }, {
        idempotencyKey: `card-hold-capture-${piId}-a${hold.attempts}`,
      });
      if (pi.status === "succeeded") capturedPi = pi.id;
      else { failState = "failed"; failCode = `capture_left_${pi.status}`; failMessage = `capture left the payment ${pi.status}`; }
    } catch (e) {
      const why = caughtMessage(e).slice(0, 300);
      let now: Stripe.PaymentIntent | null = null;
      try {
        now = await stripe.paymentIntents.retrieve(piId);
      } catch (readErr) {
        return notDefinite(`${why}; state unreadable: ${caughtMessage(readErr).slice(0, 150)}`, false);
      }
      if (now.status === "succeeded") capturedPi = now.id;
      else if (now.status === "canceled") { failState = "failed"; failCode = "hold_expired"; failMessage = `the hold is gone (${now.cancellation_reason ?? "canceled"}): ${why}`; }
      else if (now.status === "requires_capture") return notDefinite(why, true);
      else { failState = "failed"; failCode = `hold_${now.status}`; failMessage = why; }
    }
  } else {
    // A SAVED card (a job far out whose hold is not placed yet): one charge now.
    const allowed = offSessionAllowed(amountCents, job.category);
    if (!allowed.ok) {
      failState = "needs_action";
      failCode = allowed.why === "large" ? "on_session_required" : "taxed_on_session";
      failMessage = allowed.why === "large" ? "a charge of $300 or more is confirmed on a Checkout page (Q210b)" : "a taxed category is charged on a Checkout page";
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
            onboarding_fee_charged: feeIncluded ? "true" : "false" },
        }, { idempotencyKey: `card-hold-charge-${jobId}-a${hold.attempts}` });
        if (pi.status === "succeeded") capturedPi = pi.id;
        else if (pi.status === "processing") return notDefinite("the charge is processing", false);
        else { failState = pi.status === "requires_action" ? "needs_action" : "failed"; failCode = `charge_${pi.status}`; failMessage = `the charge is ${pi.status}`; }
      } catch (e) {
        const code = cardErrorCode(e);
        // Not a definite no: the claim stays and the same key and amount are retried.
        if (!code) return notDefinite(caughtMessage(e).slice(0, 300), false);
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
        ...(feeIncluded ? { onboarding_fee_amount: Number(hold.onboarding_fee_cents) / 100 } : {}),
      })
      .eq("id", jobId)
      .eq("payment_status", "held")
      // A job closed in the moment between is never funded (race class): zero rows pages below.
      .in("status", LIVE_JOB_STATUSES)
      .select("id");
    if (!moveErr && (!moved || moved.length === 0)) {
      const now = await readJob(db, jobId);
      if (now && CLOSED_JOB_STATUSES.includes(String(now.status))) {
        // Charged for a job that closed in the same moment: nobody was hired,
        // so the poster gets every cent back now (round 2, money #1).
        await refundCaptureForNobody(deps, now, { ...hold, failure_code: null, onboarding_fee_claimed_at: feeAt }, capturedPi);
        return { ok: false, reason: "not_held" };
      }
    }
    if (moveErr || !moved || moved.length === 0) {
      // Captured money the row does not show. Paged BEFORE the re-read, so a
      // failing read never swallows the page (lh-silent-failure review #7).
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Card hold captured but the job did not move to escrow",
        message: "The poster's card was charged at the hire, but jobs.payment_status did not leave 'held'. The hold stays claimed and card-hold-sweep retries the move (Stripe answers the same capture again); if it does not clear, set the job to escrow by hand.",
        fields: { job_id: jobId, payment_intent: capturedPi, db_error: moveErr?.message ?? "matched 0 rows" },
        seed: job.is_seed === true,
      });
      throw new Error(`card hold captured for job ${jobId} (${capturedPi}) but the escrow move failed: ${moveErr?.message ?? "matched 0 rows"}`);
    }
    await updateHold(db, jobId, { state: "captured", payment_intent_id: capturedPi, attempts: Number(hold.attempts) + 1 }, ["capturing"]);
    return { ok: true, already: false };
  }

  // A definite no: the fee claim goes back, so the fee is owed again.
  await unclaimSetupFee(db, jobId, job.customer_id, feeAt);
  const after = await readJob(db, jobId);
  if (after && CLOSED_JOB_STATUSES.includes(String(after.status))) {
    // The job closed meanwhile: never "pay again" on a cancelled job (round 2,
    // money #6). The hold is marked unusable; card-hold-sweep releases it and
    // tells the poster they were not charged.
    await updateHold(db, jobId, { state: "failed", failure_code: failCode.slice(0, 100), failure_message: failMessage.slice(0, 500), capturing_from: null, capture_amount_cents: null }, ["capturing"]);
    return { ok: false, reason: "not_held" };
  }
  await failHold(deps, job, { ...hold, state: from }, failState ?? "failed", failCode, failMessage, "capturing");
  return { ok: false, reason: "poster_must_pay" };
}

/** A job that can never be hired again: its hold is released, never charged. */
export const CLOSED_JOB_STATUSES = ["cancelled", "completed"];

/**
 * A capture claim left on a job that has closed (the capture died, or raced
 * the poster's cancel or the expiry). Stripe is read: money it captured is
 * refunded in full at once (nobody was hired); a hold it still has goes back
 * to 'authorized' so the sweep's release cancels it and tells the poster. An
 * off-session charge whose outcome nobody recorded cannot be read back from
 * here: it throws every run (a defect) until ops checks it by hand.
 */
async function settleClaimOnClosedJob(deps: HoldDeps, job: HoldJob, hold: HoldRow): Promise<CaptureResult> {
  const { db, stripe } = deps;
  if (hold.capturing_from === "authorized" && hold.payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(hold.payment_intent_id);
    if (pi.status === "succeeded") {
      await refundCaptureForNobody(deps, job, hold, pi.id);
      return { ok: false, reason: "not_held" };
    }
    await unclaimSetupFee(db, job.id, job.customer_id, hold.onboarding_fee_claimed_at);
    await updateHold(db, job.id, { state: "authorized", capturing_from: null, capture_amount_cents: null, onboarding_fee_claimed_at: null }, ["capturing"]);
    return { ok: false, reason: "not_held" };
  }
  if (!(Number(hold.capture_amount_cents) > 0)) {
    // Nothing was ever sent to Stripe: the claim simply goes back.
    await unclaimSetupFee(db, job.id, job.customer_id, hold.onboarding_fee_claimed_at);
    await updateHold(db, job.id, { state: hold.capturing_from ?? "scheduled", capturing_from: null, capture_amount_cents: null, onboarding_fee_claimed_at: null }, ["capturing"]);
    return { ok: false, reason: "not_held" };
  }
  throw new Error(`job ${job.id} is ${job.status} with an off-session charge claim (attempt ${hold.attempts}, key card-hold-charge-${job.id}-a${hold.attempts}) nobody recorded: check Stripe for that charge and refund it if it went through`);
}

/**
 * Money captured for a job that closed in the same moment (nobody hired) goes
 * back in full, at once. The job's money points at the payment, so the
 * charge.refunded webhook marks it refunded and tells the poster; ops hears
 * it happened. A refund Stripe does not confirm throws, and the claim stays
 * for the next sweep (the same idempotency key answers the same refund).
 */
async function refundCaptureForNobody(deps: HoldDeps, job: HoldJob, hold: HoldRow, piId: string): Promise<void> {
  const { db, stripe } = deps;
  // ONLY money that is still this hold's and nobody's hire (round 3 #1): the
  // job's money must still read held/failed, or this refund already began
  // (its marker on the hold row, set before the job write). Money a hire
  // moved to escrow (then cancelled or split later) is never refunded here:
  // its row is closed as captured.
  const begun = hold.failure_code === "nobody_refund_pending";
  if (!begun) {
    if (!["held", "failed"].includes(String(job.payment_status))) {
      await updateHold(db, job.id, { state: "captured", capturing_from: null }, ["capturing"]);
      return;
    }
    await updateHold(db, job.id, { failure_code: "nobody_refund_pending", failure_message: `refund of ${piId}: nobody was hired` }, ["capturing"]);
    const { data: marked, error: markErr } = await db.from("jobs").update({ payment_status: "cancelled", stripe_payment_intent_id: piId })
      .eq("id", job.id).in("payment_status", ["held", "failed"]).in("status", CLOSED_JOB_STATUSES).select("id");
    if (markErr) throw new Error(`job ${job.id}: its money was not marked before refunding ${piId}: ${markErr.message}`);
    if (!marked || marked.length === 0) {
      // The money moved in the moment between: not ours to refund.
      await updateHold(db, job.id, { failure_code: null, failure_message: null }, ["capturing"]);
      throw new Error(`job ${job.id}: its money left held/failed while a refund of ${piId} was being decided; nothing refunded`);
    }
  }
  await stripe.refunds.create(
    { payment_intent: piId, reason: "requested_by_customer", metadata: { job_id: job.id, card_hold: "1", why: "captured_for_a_closed_job" } },
    { idempotencyKey: `card-hold-nobody-refund-${piId}` },
  );
  // The $2 setup fee came back with the refund: it is owed again (round 3 #2).
  await unclaimSetupFee(db, job.id, job.customer_id, hold.onboarding_fee_claimed_at);
  // The refund webhook tells the poster; "not charged" would not be true, so it is never sent.
  await updateHold(db, job.id, { state: "released", notified_state: "released", capturing_from: null, failure_code: null, failure_message: null }, ["capturing"]);
  await postSlackOpsAlert({
    kind: "custom",
    severity: "warning",
    title: "A card hold was captured for a job that closed at the same moment: refunded in full",
    message: "A Helpr's accept captured the poster's held card while the job was being cancelled or expiring. Nobody was hired, so the payment was refunded in full at once (Stripe keeps its card fee). No action needed unless this repeats.",
    fields: { job_id: job.id, payment_intent: piId },
    seed: job.is_seed === true,
  });
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
  /** The state the row is in now, when it is not hold.state (a capture's claim). */
  rowState: HoldState = hold.state,
): Promise<void> {
  const { db, stripe } = deps;
  if (hold.state === "authorized" && hold.payment_intent_id) {
    try {
      await stripe.paymentIntents.cancel(hold.payment_intent_id, {}, { idempotencyKey: `card-hold-drop-${hold.payment_intent_id}` });
    } catch (e) {
      // Unreadable is not dropped (lh-silent-failure review #5): throw, so
      // nobody is asked to pay again over a hold that may still be live.
      const now = await stripe.paymentIntents.retrieve(hold.payment_intent_id);
      if (now.status !== "canceled") {
        throw new Error(`card hold ${hold.payment_intent_id} on job ${job.id} could not be dropped (${now.status}): ${caughtMessage(e)}`);
      }
    }
  }
  await updateHold(db, job.id, { state, failure_code: code.slice(0, 100), failure_message: message.slice(0, 500), attempts: Number(hold.attempts) + 1, capturing_from: null, capture_amount_cents: null }, [rowState]);
  // stripe_session_id leaves with it, as a bounced bank payment's does
  // (paymentIntentPaymentFailed): the completed hold checkout would otherwise
  // make create-payment refuse the poster's "Finish paying" as in flight.
  // Zero rows is legitimate: the job already left 'held' (closed meanwhile).
  const { error } = await db.from("jobs").update({ payment_status: "failed", stripe_session_id: null })
    .eq("id", job.id).eq("payment_status", "held").in("status", LIVE_JOB_STATUSES);
  if (error) throw new Error(`job ${job.id} not taken off the listing after its card hold failed: ${error.message}`);
  // A missed notice is re-sent by card-hold-sweep (failed / needs_action, notified_state behind).
  if (!(await notifyPosterOnce(db, job, hold, state))) console.error(`[cardHold] job ${job.id}: the poster was not told their hold ${state}; card-hold-sweep re-sends it`);
}

export type ReleaseResult = "released" | "released_untold" | "already_gone" | "captured";

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
  // Never released from under a capture in flight: the sweep comes back to it.
  if (hold.state === "capturing") throw new Error(`card hold for job ${jobId} is being captured; not released`);
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
  // The job's money first (lh-silent-failure review #9): a write that fails
  // throws with the hold still open, so the next run retries all of it. Zero
  // rows is legitimate: an earlier run already marked it.
  // Only while the job's money is THIS hold (lh-money-escrow review #9): a job
  // re-paid by bank after a failed hold carries that payment, which is not
  // ours to mark cancelled.
  const pinned = hold.payment_intent_id
    ? `stripe_payment_intent_id.is.null,stripe_payment_intent_id.eq.${hold.payment_intent_id}`
    : "stripe_payment_intent_id.is.null";
  const { error } = await db.from("jobs").update({ payment_status: "cancelled" })
    .eq("id", jobId).in("payment_status", ["held", "failed"]).or(pinned)
    // Only a CLOSED job's hold is released this way (race class).
    .in("status", ["cancelled", "completed"]);
  if (error) throw new Error(`job ${jobId} money not marked cancelled after its hold was released: ${error.message}`);
  // The hold leaves the open states only once the poster has been told, so a
  // missed "not charged" notice is retried by the next sweep (the cancel above
  // is idempotent).
  if (!(await notifyPosterOnce(db, job, hold, "released"))) return "released_untold";
  await updateHold(db, jobId, { state: "released" }, [hold.state]);
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

/**
 * The authorization's expiry: the charge's
 * payment_method_details.card.capture_before (seconds), as ISO. When the
 * charge carries none (a Link charge may not: not measured), the SHORTEST
 * window the hold can have (Stripe's validity table) is assumed, so renewal is
 * never silently off (lh-silent-failure review #12): 7 days placed with the
 * poster present, 4 days 18 hours off-session (Visa).
 */
export function captureBeforeIso(pi: Stripe.PaymentIntent | null | undefined, offSession = false): string {
  const charge = pi?.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge as Stripe.Charge : null;
  const sec = (charge?.payment_method_details as { card?: { capture_before?: number } } | null | undefined)?.card?.capture_before;
  if (typeof sec === "number" && Number.isFinite(sec)) return new Date(sec * 1000).toISOString();
  const createdMs = typeof pi?.created === "number" ? pi.created * 1000 : Date.now();
  return new Date(createdMs + (offSession ? 4 * DAY_MS + 18 * HOUR_MS : 7 * DAY_MS)).toISOString();
}
