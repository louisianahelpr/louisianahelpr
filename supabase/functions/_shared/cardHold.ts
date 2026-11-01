// seed-policy: pages for seed/test jobs too, on purpose: the alerts here are a card
// captured or held while the database says otherwise, money that moved whoever owns it.
//
// cardHold — the poster's card HOLD on a job (Q2399, owner 2026-10-25: "hold the
// poster's card when a job is posted; charge it only when someone is hired").
// Behind the switch card_hold_at_post. Migration 20261027185146_card_hold_at_post
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
// Copy names no fee but the one-time $2 setup fee (owner 2026-10-25); the amounts
// are the whole hold.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { isDefinitiveStripeRefusal } from "../_shared/stripeRefusal.ts";
import type { StripeMode } from "../_shared/stripeMode.ts";
import { CARD_HOLD_COPY } from "../_shared/cardHoldCopy.ts";
import { CARD_HOLD_PARTIAL_CAPTURE_API_VERSION, DAY_MS, HOUR_MS, offSessionAllowed, partialCaptureParams } from "../_shared/cardHoldPlan.ts";

export { CARD_HOLD_COPY };
export {
  CARD_HOLD_CHECKOUT_API_VERSION,
  RENEW_WITHIN_MS,
  holdCheckoutPaymentMethodOptions,
} from "../_shared/cardHoldPlan.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const CARD_HOLD_SWITCH = "card_hold_at_post";

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
  /** 'nobody_refund_pending' marks a refund for a closed job that began (refundCaptureForNobody). */
  failure_code: string | null;
  failure_message: string | null;
};

/** Every HoldRow column, read by readHold and the sweep alike (src/test/edge/card-hold.test.ts pins it to HoldRow). */
export const HOLD_COLUMNS =
  "job_id, stripe_mode, stripe_customer_id, payment_method_id, payment_intent_id, state, amount_cents, onboarding_fee_cents, onboarding_fee_claimed_at, capturing_from, capture_amount_cents, intent_metadata, capture_before, place_at, attempts, notified_state, failure_code, failure_message, updated_at";

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
  /** CMP-4: a capture for one Helpr's offer re-reads these after its claim (captureCardHold offerTo). */
  offered_to_helper_id?: string | null;
  direct_offer_status?: string | null;
};

export async function readJob(db: Db, jobId: string): Promise<HoldJob | null> {
  const { data, error } = await db
    .from("jobs")
    .select("id, customer_id, title, status, payment_status, helper_id, category, is_seed, stripe_payment_intent_id, offered_to_helper_id, direct_offer_status")
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
export async function notifyPosterOnce(db: Db, job: Pick<HoldJob, "id" | "customer_id" | "title">, hold: Pick<HoldRow, "notified_state" | "amount_cents"> & Partial<Pick<HoldRow, "onboarding_fee_cents" | "failure_code">>, state: HoldState): Promise<boolean> {
  // An ownerless job (the poster deleted their account) has nobody to tell.
  if (!job.customer_id || hold.notified_state === state) return true;
  const title = job.title ?? "your job";
  const feeCents = Number(hold.onboarding_fee_cents ?? 0);
  const copy = state === "authorized" ? { t: CARD_HOLD_COPY.heldTitle, m: CARD_HOLD_COPY.held(hold.amount_cents, feeCents) }
    : state === "scheduled" ? { t: CARD_HOLD_COPY.scheduledTitle, m: CARD_HOLD_COPY.scheduled(hold.amount_cents, feeCents) }
    : state === "failed" && String(hold.failure_code ?? "").startsWith(CAPTURE_REFUSED) ? { t: CARD_HOLD_COPY.captureRefusedTitle, m: CARD_HOLD_COPY.captureRefused(title) }
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
 * Stripe's definite no on a SAVED card (round 4, silent #2): a card error, or
 * an invalid request (the card detached, the customer deleted, no such
 * payment method), which no retry fixes. The renewal always read it so; the
 * placement and the charge at the hire now do too, so the poster is asked to
 * update their card instead of a defect every run. Null: not a definite no.
 */
function savedCardRefusal(e: unknown): { code: string; state: "failed" | "needs_action" } | null {
  const card = cardErrorCode(e);
  if (card) return { code: card, state: card === "authentication_required" ? "needs_action" : "failed" };
  const err = e as { type?: string; code?: string } | null;
  // isDefinitiveStripeRefusal: a 4xx answer, never a key still in use or a rate limit (which may yet move money).
  if ((err?.type === "StripeInvalidRequestError" || err?.type === "invalid_request_error") && isDefinitiveStripeRefusal(e)) {
    return { code: `invalid_request${err.code ? `_${err.code}` : ""}`.slice(0, 100), state: "needs_action" };
  }
  return null;
}

/** failure_code prefix: Stripe refused the capture itself, with the authorization still live. */
const CAPTURE_REFUSED = "capture_refused";

/**
 * Stripe's definite no to a CAPTURE of a hold still capturable: a card error or an
 * invalid request, which the same request can never get past. Null: not a definite no
 * (a timeout, a 5xx, a rate limit, a key in use), so it stays a retry. Without this a
 * refusal read as "still capturable, try again", for ever (job 02a6e1b5, 2026-10-30).
 */
function captureRefusal(e: unknown): string | null {
  const card = cardErrorCode(e);
  if (card) return `${CAPTURE_REFUSED}_card_${card}`.slice(0, 100);
  const err = e as { type?: string; code?: string } | null;
  const invalid = err?.type === "StripeInvalidRequestError" || err?.type === "invalid_request_error";
  return invalid && isDefinitiveStripeRefusal(e) ? `${CAPTURE_REFUSED}${err?.code ? `_${err.code}` : ""}`.slice(0, 100) : null;
}

/**
 * The one-time $2 setup fee rides inside a hold. It is CLAIMED on the profile
 * before the capture, so two holds captured at once never collect it twice:
 * the loser captures without it (partialCaptureParams: a smaller capture releases
 * the rest; nothing is refunded). The claim is recorded on the hold
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
/** Under Stripe's 24-hour idempotency-key window, with room for a sweep that runs late. */
const CHARGE_KEY_SAFE_MS = 20 * HOUR_MS;

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
/**
 * opts.offerTo (CMP-4 money review, lead 2026-11-01): the capture is FOR this
 * Helpr's pending direct offer (an instant booking's 2-hour capture, a Helpr's
 * own accept of a direct offer). After the claim the job is re-read, and an
 * offer no longer pending to them (the Helpr declined in the moment between)
 * gets the claim back with nothing charged. A decline that reads the hold
 * after this claim is refused (rpc_instant_book_decline locks the hold row and
 * requires 'authorized' or 'scheduled'), so the two never both win.
 */
export async function captureCardHold(deps: HoldDeps, jobId: string, opts: { resume?: boolean; offerTo?: string } = {}): Promise<CaptureResult> {
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
    let claim = db
      .from("job_card_holds")
      .update({ state: "capturing", capturing_from: hold.state, updated_at: new Date().toISOString() })
      .eq("job_id", jobId)
      .eq("state", hold.state);
    // ...and the authorization it was read with (round 4, money #5): a renewal that swapped it
    // meanwhile is never captured from this stale read (zero rows: "retry").
    claim = hold.payment_intent_id ? claim.eq("payment_intent_id", hold.payment_intent_id) : claim.is("payment_intent_id", null);
    const { data: claimed, error: claimErr } = await claim.select("job_id");
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
  // The offer this capture is for moved on after the claim (a decline): a fresh
  // claim sent nothing to Stripe yet, so it goes back and nothing is charged.
  if (opts.offerTo && hold.state !== "capturing" &&
      (fresh.offered_to_helper_id !== opts.offerTo || fresh.direct_offer_status !== "pending")) {
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
      // Under the hold's amount (the setup fee left out): the line items must match (cardHoldPlan).
      // Its own key: the parameters differ from any capture already sent for this attempt.
      const partial = amountCents < Number(hold.amount_cents);
      const pi = await stripe.paymentIntents.capture(piId, partial ? partialCaptureParams(amountCents) : { amount_to_capture: amountCents }, {
        idempotencyKey: `card-hold-capture-${piId}-a${hold.attempts}${partial ? "-partial" : ""}`,
        ...(partial ? { apiVersion: CARD_HOLD_PARTIAL_CAPTURE_API_VERSION } : {}),
      } as Stripe.RequestOptions);
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
      else if (now.status === "requires_capture") {
        const refused = captureRefusal(e);
        if (!refused) return notDefinite(why, true);
        failState = "failed"; failCode = refused; failMessage = why;
      }
      else { failState = "failed"; failCode = `hold_${now.status}`; failMessage = why; }
    }
  } else {
    // A SAVED card (a job far out whose hold is not placed yet): one charge now.
    const allowed = offSessionAllowed(amountCents, job.category);
    if (!allowed.ok) {
      failState = "needs_action";
      failCode = allowed.why === "large" ? "on_session_required" : "taxed_on_session";
      failMessage = allowed.why === "large" ? "a charge of $300 or more is confirmed on a Checkout page (Q210b)" : "a taxed category is charged on a Checkout page";
    } else if (hold.state === "capturing" && hold.payment_intent_id) {
      // A resumed claim whose charge Stripe already created (its id was saved
      // on the row before the job write): read THAT charge, never create a
      // second one (lh-silent-failure 2026-10-26 #2: an idempotency key lasts
      // about 24 hours, the saved id does not expire).
      let pi: Stripe.PaymentIntent;
      try {
        pi = await stripe.paymentIntents.retrieve(hold.payment_intent_id);
      } catch (readErr) {
        return notDefinite(`saved charge ${hold.payment_intent_id} unreadable: ${caughtMessage(readErr).slice(0, 150)}`, false);
      }
      if (pi.status === "succeeded") capturedPi = pi.id;
      else if (pi.status === "processing") return notDefinite("the charge is processing", false);
      else { failState = pi.status === "requires_action" ? "needs_action" : "failed"; failCode = `charge_${pi.status}`; failMessage = `the charge is ${pi.status}`; }
    } else {
      // Stripe keeps an idempotency key for 24 hours. A claim older than that whose charge nobody
      // recorded may have charged under it: re-sending the key then would charge AGAIN (round 4,
      // money #1). It throws every run (a defect, and the sweep's cron alert) for ops to check.
      if (hold.state === "capturing" && hold.updated_at && Date.now() - Date.parse(hold.updated_at) > CHARGE_KEY_SAFE_MS) {
        throw new Error(`job ${jobId}: an off-session charge claim (key card-hold-charge-${jobId}-a${hold.attempts}) is older than its idempotency key: check Stripe for that charge before anything is re-sent`);
      }
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
        if (pi.status === "succeeded" || pi.status === "processing") {
          // Money moved (or is moving): its id goes on the claimed row BEFORE
          // the job write, so a resume reads this charge instead of making
          // another, and a row left 'capturing' is closed by the already-in-
          // escrow check (lh-silent-failure 2026-10-26 #2/#3).
          try {
            await updateHold(db, jobId, { payment_intent_id: pi.id }, ["capturing"]);
          } catch (saveErr) {
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "critical",
              title: "Card charged at the hire but the charge was not recorded on its hold",
              message: "An off-session charge went through (or is processing) and its id could not be saved on job_card_holds. card-hold-sweep retries under the same idempotency key for about 24 hours; check Stripe for this charge if it does not clear.",
              fields: { job_id: jobId, payment_intent: pi.id, status: pi.status, db_error: caughtMessage(saveErr).slice(0, 200) },
              seed: job.is_seed === true,
            });
            throw saveErr;
          }
        }
        if (pi.status === "succeeded") capturedPi = pi.id;
        else if (pi.status === "processing") {
          // Kept on the claim (its id was saved just above), so the resume reads this payment.
          return notDefinite("the charge is processing", false);
        } else { failState = pi.status === "requires_action" ? "needs_action" : "failed"; failCode = `charge_${pi.status}`; failMessage = `the charge is ${pi.status}`; }
      } catch (e) {
        const refused = savedCardRefusal(e);
        // Not a definite no: the claim stays and the same key and amount are retried.
        if (!refused) return notDefinite(caughtMessage(e).slice(0, 300), false);
        failState = refused.state;
        failCode = refused.code;
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

  // Paged first, so nothing below can swallow it. A capture Stripe refused is logged (error_logs,
  // through the alert); a hold that simply expired is not news.
  if (from === "authorized" && failCode !== "hold_expired") {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: failCode.startsWith(`${CAPTURE_REFUSED}_card_`) ? "warning" : "critical",
      title: "Stripe refused a card hold's capture at the hire",
      message: "A Helpr's accept could not charge the poster's held card, and the same request can never succeed. Nobody was hired and nothing was charged: the hold is released and the poster is asked to pay again. Read the reason: anything but a card decline is a defect in the capture.",
      fields: { job_id: jobId, payment_intent: String(hold.payment_intent_id), code: failCode, amount_cents: String(amountCents), hold_cents: String(hold.amount_cents), why: failMessage.slice(0, 300) },
      seed: job.is_seed === true,
    });
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
const CLOSED_JOB_STATUSES = ["cancelled", "completed"];

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
  if (hold.capturing_from === "scheduled" && hold.payment_intent_id) {
    // An off-session charge whose id was saved before the job write (silent #2).
    const pi = await stripe.paymentIntents.retrieve(hold.payment_intent_id);
    if (pi.status === "succeeded") {
      await refundCaptureForNobody(deps, job, hold, pi.id);
      return { ok: false, reason: "not_held" };
    }
    if (pi.status === "processing") {
      throw new Error(`job ${job.id} is ${job.status} with an off-session charge ${pi.id} still processing: the next sweep reads it again`);
    }
    // The charge never went through: nothing to refund, the saved card is released as usual.
    await unclaimSetupFee(db, job.id, job.customer_id, hold.onboarding_fee_claimed_at);
    await updateHold(db, job.id, { state: "scheduled", payment_intent_id: null, capturing_from: null, capture_amount_cents: null, onboarding_fee_claimed_at: null }, ["capturing"]);
    return { ok: false, reason: "not_held" };
  }
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
  // job's money must still read held, or this refund already began
  // (its marker on the hold row, set before the job write). Money a hire
  // moved to escrow (then cancelled or split later) is never refunded here:
  // its row is closed as captured.
  const begun = hold.failure_code === "nobody_refund_pending";
  if (!begun) {
    if (job.payment_status === "failed") {
      // Never seen (a capture is claimed only from 'held', and nothing fails a hold under a
      // claim), and a 'failed' job may carry a reserved gift (round 4, money #3): ops decides.
      throw new Error(`job ${job.id} reads 'failed' with ${piId} captured for nobody: nothing refunded or marked; check the job's gift and refund by hand`);
    }
    if (job.payment_status !== "held") {
      await updateHold(db, job.id, { state: "captured", capturing_from: null }, ["capturing"]);
      return;
    }
    await updateHold(db, job.id, { failure_code: "nobody_refund_pending", failure_message: `refund of ${piId}: nobody was hired` }, ["capturing"]);
    const { data: marked, error: markErr } = await db.from("jobs").update({ payment_status: "cancelled", stripe_payment_intent_id: piId })
      .eq("id", job.id).eq("payment_status", "held").in("status", CLOSED_JOB_STATUSES).select("id");
    if (markErr) throw new Error(`job ${job.id}: its money was not marked before refunding ${piId}: ${markErr.message}`);
    if (!marked || marked.length === 0) {
      // The money moved in the moment between: not ours to refund.
      await updateHold(db, job.id, { failure_code: null, failure_message: null }, ["capturing"]);
      throw new Error(`job ${job.id}: its money left held while a refund of ${piId} was being decided; nothing refunded`);
    }
  }
  // own-mistake full refund (owner, 2026-10-14): the card was charged for a job
  // that closed with nobody hired (a capture racing the close), which the hold
  // model never allows (Q2399: charged only at a hire), so it goes back in
  // full, card fee included; the card fee rule does not apply to our errors.
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
  await takeFailedHoldOffListing(db, job.id);
  // A missed notice is re-sent by card-hold-sweep (failed / needs_action, notified_state behind).
  if (!(await notifyPosterOnce(db, job, { ...hold, failure_code: code }, state))) console.error(`[cardHold] job ${job.id}: the poster was not told their hold ${state}; card-hold-sweep re-sends it`);
}

/**
 * A failed hold's job leaves the listing ('held' -> 'failed'). Also re-run by
 * card-hold-sweep for a hold already failed whose job still reads 'held' (the
 * write failed after the row moved; round 4, silent #5).
 */
export async function takeFailedHoldOffListing(db: Db, jobId: string): Promise<void> {
  // stripe_session_id leaves with it, as a bounced bank payment's does
  // (paymentIntentPaymentFailed): the completed hold checkout would otherwise
  // make create-payment refuse the poster's "Finish paying" as in flight.
  // Zero rows is legitimate: the job already left 'held' (closed meanwhile).
  const { error } = await db.from("jobs").update({ payment_status: "failed", stripe_session_id: null })
    .eq("id", jobId).eq("payment_status", "held").in("status", LIVE_JOB_STATUSES);
  if (error) throw new Error(`job ${jobId} not taken off the listing after its card hold failed: ${error.message}`);
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
  // From 'held' ONLY (round 4, money #3): a 'failed' hold has no live authorization, and its job
  // may carry a gift reserved for a "Finish paying" checkout; it stays 'failed', so that
  // checkout's expiry gives the gift back (checkoutSessionExpired reads 'cancelled' as funded).
  const { error } = await db.from("jobs").update({ payment_status: "cancelled" })
    .eq("id", jobId).eq("payment_status", "held").or(pinned)
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
    const refused = savedCardRefusal(e);
    if (!refused) throw e;
    return { ok: false, state: refused.state, code: refused.code, message: caughtMessage(e).slice(0, 300) };
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
