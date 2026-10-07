// seed-policy: pages for seed/E2E jobs too, on purpose. Every alert here is money
// that moved (or failed to move) in Stripe while the DB says otherwise: a platform
// failure whoever owns the job. Seed-only noise is routed in the detectors, not
// here (docs/OPEN.md Q2).
// Daily cron: fund the next recurring visits by charging the poster's saved card.
//
// THIS IS THE HALF RECURRING NEVER HAD. The old `spawn-recurring-jobs` copied a
// job's descriptive fields onto a new open row and stopped — no payment, no
// helper — so every visit after the first was publicly appliable with nothing
// behind it. The rule here is the inverse and is absolute:
//
//     A VISIT IS CREATED ONLY ONCE ITS MONEY IS IN ESCROW.
//
// So the job row is inserted AFTER the PaymentIntent succeeds, never before. A
// failed charge produces no job, which means there is no such thing as an
// unfunded visit for a helper to walk into. That ordering is the whole design;
// do not "optimise" it by pre-creating the row.
//
// WHY OFF-SESSION IS SAFE HERE. The poster is not present. They authorised this
// at checkout by posting a series with a saved card (`setup_future_usage:
// "off_session"`), and the authority is bounded: `recurrence_weeks` is capped at
// 52 by a CHECK, `budget` is per-visit and fixed at post time, and the poster
// can cancel the series at any point. `auto-tip-charge` is the existing
// precedent for this shape of charge and this function follows it closely.
//
// WHY THE CHARGE IS A RAW PaymentIntent AND NOT A CHECKOUT SESSION. A Checkout
// Session needs the payer in a browser. That also means Stripe's `automatic_tax`
// is unavailable, so LA sales tax is computed here from `_shared/salesTax.ts` —
// the same module the Post-a-Task screen quotes from and the same module
// create-payment classifies line items with. Only assembly labor is taxable, so
// on nearly every series this term is exactly zero; when it is not, the number
// comes from Stripe's own `tax.calculations`, which is where the actual charge
// gets it too.
//
// WHAT ACTUALLY STOPS A VISIT BEING CHARGED TWICE — AND WHAT DOES NOT.
// The cron runs daily at 06:00 UTC (migration 20260823170000) and the funding
// window is FUND_LEAD_DAYS = 3, so a visit on date D is inside the window on
// exactly three consecutive runs: D-3, D-2 and D-1. Stripe idempotency keys
// live for 24 HOURS. Consecutive runs are 24 hours apart to the second, so the
// key from the D-3 run is expired — or expiring — by the D-2 run. Concretely:
//
//   same run / two overlapping runs   key is live  -> Stripe REPLAYS one intent
//   next day's run (24h later)        key is gone  -> Stripe MINTS a new charge
//
// So the Stripe key protects a visit only WITHIN a day. Across the three days
// the ONLY thing standing between a poster and a second charge is the
// pre-flight `existing` read below — which is why its error is now fatal to the
// series rather than being destructured away. An empty `existing` set caused by
// a transient read failure on day 2 used to mean: charge again (new key, new
// money), hit the unique index, and take the "no refund needed" branch whose
// reasoning only holds for the same-day case. That is the double-charge path;
// see the 23505 branch, which now proves whose intent it is holding before it
// decides.

import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts";
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { boundedFetch } from "../_shared/boundedFetch.ts";
// Separate `import type` line on purpose: src/test/edge/harness.ts rewrites
// this exact form when it bundles the function for vitest.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { seedBoundaryDropsRow } from "../_shared/seedBoundary.ts";
import {
  DEFAULT_TIER_FEE_PERCENT,
  getHelperFeePercent,
  helperCommissionDollars,
} from "../_shared/helperFees.ts";
import { posterFeePercentForTier, posterServiceFeeCents } from "../_shared/posterFees.ts";
import { THREE_D_SECURE_MIN_CENTS } from "../_shared/threeDSecure.ts";
import { isLaborTaxable, TAXABLE_LABOR_TAX_CODE } from "../_shared/salesTax.ts";
import { recurringVisitDates } from "../_shared/recurringSchedule.ts";
import { louisianaToday } from "../_shared/louisianaDate.ts";
import { cronResult, defectTracker } from "../_shared/cron-result.ts";
import { actualOrEstimatedFeeCents } from "../_shared/stripeFees.ts";
import { scanAll, scanAllIn, scanDefect } from "../_shared/paginate.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";

/**
 * The client type these helpers accept.
 *
 * NOT `ReturnType<typeof createClient>`: `createClient` is overloaded, and
 * `ReturnType` resolves the LAST overload — `SupabaseClient<unknown, ...>`,
 * whose row and payload types collapse to `never`. `createClient(url, key)`
 * actually returns `SupabaseClient<any, "public", "public", any, any>`, so the
 * annotation rejected the only client it is ever called with, and every
 * `.insert()`/`.update()` inside these helpers was checked against `never`.
 */
// deno-lint-ignore no-explicit-any
type AdminClient = SupabaseClient<any>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * How far ahead a visit is funded.
 *
 * Long enough that a declined card leaves the poster time to fix it before the
 * helper is expecting to work, short enough that the poster is not holding
 * escrow for a week of visits at once. Also bounds the blast radius of a series
 * the poster forgot about: at most this many days of charges are ever in
 * flight.
 */
const FUND_LEAD_DAYS = 3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Per-run ceiling on charges. See the note in the loop. */
const MAX_CHARGES_PER_RUN = 200;

/**
 * How far back a series parent can sit and still be worth scanning.
 *
 * `recurrence_weeks` is capped at 52 — by `jobs_recurrence_weeks_range` AND,
 * independently, by `recurringVisitDates`'s own
 * `Math.min(weeks, MAX_RECURRENCE_WEEKS)`. The second one matters: the CHECK
 * was added `NOT VALID` (20260820010000:59), so it does not speak for rows that
 * predate it, while the code-side clamp holds for every row there will ever be.
 * Either way the LAST visit of any series is at most `date_needed + 364` days
 * out, so a parent older than that has no visit left that can satisfy
 * `d > today` and can never fund anything again. 371 = 364 + a week of slack.
 *
 * Without this the filter set only ever GROWS: every series ever posted stays
 * matched forever, and an unbounded read is exactly what the 1000-row cap turns
 * into a silent half-scan. Bounding it keeps the scan finite as the table ages;
 * the paging below is what makes it correct in the meantime.
 */
const SERIES_LOOKBACK_DAYS = 371;

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The card this series may be charged on, read off the series' own checkout
 * (Q734). See the "Charge, then create" block in the run loop.
 *
 * - `card`: the checkout saved a card for off-session use. Stripe recorded the
 *   customer and the payment method on the PaymentIntent itself, so these are
 *   the card the poster authorised for THIS series, not a card found by email.
 * - `none`: there is no card the series may use (no checkout PaymentIntent, as
 *   when a gift card paid the whole first visit; or a checkout that did not ask
 *   to keep the card, as the gift-card difference checkout does; or Stripe
 *   says the PaymentIntent does not exist). The poster is told; nothing is
 *   charged.
 * - `test_object`: the stored PaymentIntent was minted under the Stripe TEST
 *   key and this is the LIVE key (Q891). No card the live key can charge, and
 *   no poster problem to email: the series is skipped with a structured log.
 * - `unknown`: Stripe did not answer. Never treated as "no card" (that would
 *   email the poster about a problem that is ours) and never as a card.
 */
type SeriesCard =
  | { kind: "card"; customerId: string; paymentMethodId: string }
  | { kind: "none"; reason: string }
  | { kind: "test_object"; paymentIntentId: string }
  | { kind: "unknown"; message: string };

async function seriesCard(stripe: Stripe, paymentIntentId: string | null): Promise<SeriesCard> {
  if (!paymentIntentId) return { kind: "none", reason: "no checkout payment on the series" };
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (e) {
    // Only Stripe's "no such PaymentIntent" is an answer about the poster's
    // card. Any other invalid request (a key-mode mismatch, a bad parameter)
    // is our error and must not email the poster a card problem.
    // BEFORE the resource_missing test below: Stripe answers a test-mode id
    // under the live key with that same code, and it is not a missing card.
    if (isTestObjectUnderLiveKey(e)) return { kind: "test_object", paymentIntentId };
    const err = e as { type?: unknown; code?: unknown } | null | undefined;
    if (err?.type === "StripeInvalidRequestError" && err?.code === "resource_missing") {
      return { kind: "none", reason: `checkout payment ${paymentIntentId} not found` };
    }
    return { kind: "unknown", message: e instanceof Error ? e.message : String(e) };
  }
  if (pi.setup_future_usage !== "off_session") {
    return { kind: "none", reason: `checkout payment ${paymentIntentId} did not save the card` };
  }
  const customerId = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
  const paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
  if (!customerId || !paymentMethodId) {
    return { kind: "none", reason: `checkout payment ${paymentIntentId} has no saved card to charge` };
  }
  return { kind: "card", customerId, paymentMethodId };
}

/** Attempts per visit charge. See `attemptVisitCharge`. */
const CHARGE_ATTEMPTS = 2;

/**
 * Stripe error types that mean, definitively, THAT NO MONEY MOVED.
 *
 * `StripeCardError` is the decline (including `authentication_required`, which
 * an off-session charge structurally cannot satisfy — it needs the poster
 * present). `StripeInvalidRequestError` means the request was rejected before
 * it could become a charge. Both are answers.
 *
 * Everything else — a connection reset, a socket timeout, a 5xx, an
 * idempotency request still in flight, or a raw non-Stripe throw with no `type`
 * at all — is NOT an answer. See `attemptVisitCharge`.
 */
const DEFINITIVE_CHARGE_FAILURES: ReadonlySet<string> = new Set([
  "StripeCardError",
  "StripeInvalidRequestError",
]);

function isDefinitiveChargeFailure(e: unknown): boolean {
  const type = (e as { type?: unknown } | null | undefined)?.type;
  return typeof type === "string" && DEFINITIVE_CHARGE_FAILURES.has(type);
}

/**
 * What a refund returns when Stripe's processing fee is withheld (Q415 (e),
 * Q407 (12)): the captured amount less the fee Stripe actually kept, read from
 * the charge's balance transaction. If that read fails, the card-rate estimate
 * on the amount charged is the floor, never zero. `knownCapturedCents` is what
 * this run knows was charged: an on-session intent is only a stub `{ id }`.
 * An amount that is still unknown throws, so the caller alerts instead of
 * sending Stripe (or the poster) NaN.
 */
async function refundLessStripeFeeCents(
  stripe: Stripe,
  intent: Stripe.PaymentIntent,
  knownCapturedCents: number,
): Promise<{ refundCents: number; capturedCents: number }> {
  let pi: Stripe.PaymentIntent = intent;
  try {
    pi = await stripe.paymentIntents.retrieve(intent.id, { expand: ["latest_charge.balance_transaction"] });
  } catch (e) {
    console.warn(`[charge-recurring-visits] fee read for ${intent.id} failed; withholding the card-rate estimate`, e);
  }
  const captured = pi?.amount_received || pi?.amount || intent.amount || knownCapturedCents;
  const refundCents = Math.max(0, captured - actualOrEstimatedFeeCents(pi, captured));
  if (!(Number.isFinite(captured) && captured > 0 && Number.isFinite(refundCents))) {
    throw new Error(`could not work out what ${intent.id} captured (${captured})`);
  }
  return { refundCents, capturedCents: captured };
}

/**
 * stripe.refunds.create, where an idempotency conflict on a PaymentIntent that
 * already carries a refund counts as done. The refund key is per intent, and a
 * later run can compute a different amount for the same intent (the fee read
 * failed once and succeeded the next time). Stripe then answers
 * idempotency_error although the money already went back; that must not raise
 * the "refund by hand" alert, whose reader would refund the withheld fee too.
 * Returns `alreadyRefunded: true` in that case: the amounts THIS run computed
 * are not what went back, and the earlier run already told the poster.
 */
async function createRefundOnce(
  stripe: Stripe,
  params: Stripe.RefundCreateParams,
  opts: { idempotencyKey: string },
): Promise<{ alreadyRefunded: boolean }> {
  try {
    await stripe.refunds.create(params, opts);
    return { alreadyRefunded: false };
  } catch (e) {
    const type = (e as { type?: string } | null)?.type;
    // Q750 (3): past the key's 24 hours, Stripe refuses a second full refund
    // of a charge with nothing left to refund as code `charge_already_refunded`
    // (docs.stripe.com/error-codes) rather than replaying the first. Same
    // proof as an idempotency conflict: done only if a live refund exists.
    const code = (e as { code?: string } | null)?.code;
    if (type !== "StripeIdempotencyError" && type !== "idempotency_error" && code !== "charge_already_refunded") throw e;
    const prior = await stripe.refunds.list({ payment_intent: String(params.payment_intent), limit: 100 });
    if (!prior.data.some((r: Stripe.Refund) => r.status !== "failed" && r.status !== "canceled")) throw e;
    return { alreadyRefunded: true };
  }
}

type ChargeOutcome =
  | { kind: "ok"; intent: Stripe.PaymentIntent }
  /** Stripe answered: no money moved. Safe to treat as a decline. */
  | { kind: "declined"; message: string }
  /** Stripe never answered. It may or may not hold this poster's money. */
  | { kind: "unknown"; message: string };

/**
 * Create the visit's PaymentIntent, distinguishing "declined" from "no answer".
 *
 * WHY THE DISTINCTION IS WORTH CODE. A thrown error used to be treated
 * uniformly as a decline, and for a card error that is right. For a NETWORK
 * fault it is a second, undetectable double-charge path, and it is the one the
 * 23505 index cannot catch:
 *
 *   1. the request reaches Stripe, the charge succeeds, the RESPONSE is lost;
 *   2. we call it a decline, create no job row, tell the poster it failed;
 *   3. tomorrow's run sees `alreadyThere` empty — correctly, there IS no row —
 *      and charges again on a key that expired overnight, so it is a genuinely
 *      new PaymentIntent;
 *   4. that one inserts fine. No unique violation, because the FIRST intent
 *      never had a row to collide with. Two real charges, one visit, and
 *      nothing anywhere is looking for the orphan.
 *
 * The first defence is a retry on the SAME idempotency key: while the key is
 * live, that is exactly what it is for — Stripe replays the original outcome,
 * so a lost response costs one extra request and nothing else, and a request
 * that never arrived is simply made. The second defence is that when even the
 * retry gives no answer we say so as a DEFECT and page, rather than filing it
 * as a routine decline and letting tomorrow charge over the top of it.
 *
 * The retry is immediate — no backoff. A deliberate limit: a cron with a wall
 * clock should not sleep, and the value here is in asking again at all, not in
 * asking later. `Stripe.maxNetworkRetries` is left alone so the attempt count
 * stays visible and countable at this level.
 */
async function attemptVisitCharge(
  stripe: Stripe,
  params: Stripe.PaymentIntentCreateParams,
  idempotencyKey: string,
): Promise<ChargeOutcome> {
  let last = "";
  for (let attempt = 1; attempt <= CHARGE_ATTEMPTS; attempt++) {
    try {
      return { kind: "ok", intent: await stripe.paymentIntents.create(params, { idempotencyKey }) };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      if (isDefinitiveChargeFailure(e)) return { kind: "declined", message: last };
      console.warn(
        `[charge-recurring-visits] charge attempt ${attempt}/${CHARGE_ATTEMPTS} gave no answer for ${idempotencyKey}: ${last}`,
      );
    }
  }
  return { kind: "unknown", message: last };
}

/**
 * Q1104: the charge key lives 24 hours and a date stays in the funding window
 * for three daily runs, so a charge that went out on day 1 and was never
 * booked (the run died between the charge and the visit insert, or Stripe never
 * answered: the UNKNOWN page) was charged AGAIN on day 2 under a brand-new
 * request. Before minting a charge the run now asks Stripe itself for a visit
 * charge already made for this (series, date, claim): it reads the payer's
 * PaymentIntents created inside the window (a strongly consistent list, not
 * Search) and matches the metadata the charge carries.
 *
 *   succeeded, nothing refunded -> adopt it (book the visit on it, no charge);
 *   processing                  -> still in flight: skip this run, a defect;
 *   anything else (declined, canceled, refunded) -> charge as before.
 *
 * A read that fails, or a page that does not fit, charges NOTHING this run (a
 * defect): the date is retried on the next run of its window, and a skipped
 * day costs nothing, where a guess could charge twice.
 */
type PriorVisitIntent =
  /**
   * Nothing to adopt. `refundedIds`: this claim's earlier charges that were
   * refunded (Q750 (2), owner 2026-10-05: a refunded date booked again is
   * charged FRESH, never on the refunded intent). Same-claim charges share one
   * idempotency key, and Stripe can replay a key for 24 hours or more, so a
   * re-charge on the old key could hand back the refunded intent as
   * `succeeded`. The key below changes with this count, and an intent that is
   * one of these is never booked.
   */
  | { kind: "none"; refundedIds?: string[] }
  | { kind: "adopt"; intent: Stripe.PaymentIntent }
  | { kind: "in_flight"; intentId: string }
  | { kind: "error"; message: string };

const PRIOR_VISIT_LOOKBACK_DAYS = FUND_LEAD_DAYS + 1;

async function priorVisitIntent(
  stripe: Stripe,
  customerId: string,
  parentId: string,
  visitDate: string,
  holdId: string,
): Promise<PriorVisitIntent> {
  let list: Stripe.ApiList<Stripe.PaymentIntent>;
  try {
    list = await stripe.paymentIntents.list({
      customer: customerId,
      created: { gte: Math.floor(Date.now() / 1000) - PRIOR_VISIT_LOOKBACK_DAYS * 86_400 },
      limit: 100,
      expand: ["data.latest_charge"],
    });
  } catch (e) {
    return { kind: "error", message: caughtMessage(e) };
  }
  if (!list || !Array.isArray(list.data)) return { kind: "error", message: "PaymentIntent list gave no data" };
  if (list.has_more) return { kind: "error", message: "more than 100 PaymentIntents for this payer inside the window" };
  const mine = list.data.filter((pi) =>
    pi.metadata?.type === "recurring_visit" &&
    pi.metadata?.parent_job_id === parentId &&
    pi.metadata?.visit_date === visitDate &&
    pi.metadata?.hold_id === holdId
  );
  const refundedIds: string[] = [];
  for (const pi of mine) {
    if (pi.status !== "succeeded") continue;
    const charge = pi.latest_charge as Stripe.Charge | string | null;
    // Without the expanded charge a refund cannot be ruled out: neither adopt
    // (it may be refunded) nor charge (it may be live).
    if (!charge || typeof charge !== "object") {
      return { kind: "error", message: `succeeded visit charge ${pi.id} came back without its charge` };
    }
    if (Number(charge.amount_refunded ?? 0) === 0) return { kind: "adopt", intent: pi };
    refundedIds.push(pi.id);
  }
  const inFlight = mine.find((pi) => pi.status === "processing");
  if (inFlight) return { kind: "in_flight", intentId: inFlight.id };
  // Newest refunded first: the charge key is derived from it (see the call site).
  const created = new Map(mine.map((pi) => [pi.id, Number(pi.created ?? 0)]));
  refundedIds.sort((a, b) => (created.get(b) ?? 0) - (created.get(a) ?? 0));
  return { kind: "none", refundedIds };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  // Q210(b): the stripe-webhook calls this with ?parentJobId=<series> right
  // after a payer pays a $300+ visit on-session, so the visit books at once
  // instead of at the next daily run. Only narrows the scan; every check
  // below still runs.
  const onlyParentId = new URL(req.url).searchParams.get("parentJobId");
  if (onlyParentId !== null && !UUID_RE.test(onlyParentId)) {
    return new Response(JSON.stringify({ error: "parentJobId must be a uuid" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    { global: { fetch: boundedFetch() } },
  );
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2025-08-27.basil",
  });

  const today = louisianaToday();
  const horizon = addDays(today, FUND_LEAD_DAYS);

  const results = {
    seriesConsidered: 0,
    funded: 0,
    skippedUnfilled: 0,
    skippedExisting: 0,
    skippedBlocked: 0,
    skippedEnded: 0,
    skippedBanned: 0,
    skippedChargeback: 0,
    declined: 0,
    // Q210(b): $300+ visits parked for the payer to pay on-session.
    awaitingPayment: 0,
    errors: 0,
    capped: false,
  };

  /**
   * Defect reasons for the cron envelope, kept in lockstep with
   * `results.errors` by the `fail()` helper below.
   *
   * `results.errors` alone was the status-code input, and it counted only the
   * failures that happen INSIDE a series. Two run-level defects could not be
   * expressed in it at all: a capped run (work deliberately dropped) and an
   * incomplete series scan (work never seen). Both answered `200 ok:true`.
   */
  const defects = defectTracker();
  /**
   * Record one defect. Always both counters — a reason without a count is
   * invisible to the status code, and a count without a reason is a 500 with
   * nothing in it for whoever gets paged.
   */
  const fail = (reason: string) => {
    results.errors++;
    defects.record(reason);
  };

  // Active series: a day-set and not cancelled. Each visit date is funded only
  // when a Helpr HOLDS it (series_visit_holds, 20260927012806): the Helpr hired
  // on a one-person series holds every date, a split series' Helprs hold the
  // dates they picked. A date nobody holds is never charged, because we never
  // charge for a visit nobody is committed to.
  //
  // PAGED, ORDERED AND COUNT-CHECKED. This is the one read here whose result
  // set has no natural bound — every filter on it is satisfied by more rows as
  // the table ages, and it carried neither an ORDER BY nor any paging. PostgREST
  // caps a read at `db-max-rows = 1000` AFTER the ORDER BY (measured against
  // prod 2026-09-01: `notifications?select=id&limit=5000` → `content-range:
  // 0-999/1675`, and `Range: 1000-1999` → `1000-1674/*`), so an unordered
  // unbounded read is not "the first 1000 series", it is "some 1000 series" —
  // and the rest are simply never funded, silently, on a run that reports
  // success. `_shared/paginate.ts` pages at 500 and compares what it read
  // against the server's own exact count.
  //
  // A SHORTFALL IS RECORDED, NOT THROWN. The funding window is three days wide
  // and never reopens: a visit whose window passes unfunded is gone, and the
  // helper standing on the doorstep is the one who finds out. Aborting the run
  // to protect the read would drop MORE visits than the incomplete read does.
  // So the rows that did come back are processed and the shortfall is a defect
  // — a 500 with a numeric reason, which is what pages someone.
  //
  // The `.in()` reads inside the loop are deliberately NOT paged: `due` holds
  // at most FUND_LEAD_DAYS dates for a single parent, so they are bounded by
  // construction and paging them would be noise.
  //
  // Same shape the postgrest client already handed back: `createClient(url,
  // key)` resolves to `SupabaseClient<any>`, so these rows were `any` before
  // this scan existed. Declaring them `unknown` here would not tighten
  // anything real — it would only force a cast onto every field read, which is
  // churn in a money path, not safety.
  // deno-lint-ignore no-explicit-any
  type SeriesRow = Record<string, any>;
  const seriesScan = await scanAll<SeriesRow>("recurring series", (countOpt) => {
    const q = supabase
      .from("jobs")
      .select(
        "id, customer_id, business_id, title, description, category, budget, start_time, location, parish, zip_code, latitude, longitude, estimated_hours, special_requirements, photos, is_flexible_schedule, date_needed, recurrence_days, recurrence_weeks, recurring_helper_id, helper_id, status, series_ended_on, payment_status, dispute_status, stripe_payment_intent_id",
        countOpt,
      )
      // Offset paging over an unordered result is sampling, not paging.
      .order("id", { ascending: true })
      .gte("date_needed", addDays(today, -SERIES_LOOKBACK_DAYS))
      .not("recurrence_days", "is", null)
      // NOT filtered on recurring_helper_id any more (20260927012806): who is
      // booked on a date is the date's HOLDER in series_visit_holds, and a
      // split series can have holders after its first Helpr has left. A series
      // nobody holds a date on has no holds and funds nothing.
      .is("parent_job_id", null)
      // A series whose poster deleted their account has customer_id NULL
      // (purge_user_data anonymises, it does not cancel). Nobody is left to
      // charge or to notify, so it is out of scope rather than a daily
      // "poster profile unreadable" defect.
      .not("customer_id", "is", null)
      // jobs.status is the `job_status` ENUM, and its ONLY members are: open,
      // accepted, in_progress, completed, cancelled, revision_requested,
      // disputed, pending_approval. This filter previously named 'expired',
      // which is not one of them, so Postgres rejected the whole read with
      // `invalid input value for enum job_status: "expired"`. That surfaced as
      // seriesErr -> HTTP 500 on every single daily run, so no recurring series
      // ever produced a second visit: the first visit funds at checkout and the
      // schedule then silently stops forever. Every value below is a real member
      // — if one is ever added here, check it against the enum first.
      //
      // 'cancelled' — the series is over, by the poster's own hand.
      //
      // 'disputed' — PAUSE, not stop (owner decision 2026-08-25). While a visit
      // is being contested we do not bill the poster for further visits; because
      // this is a filter and not a flag, charging resumes by itself the moment
      // the dispute resolves and the row leaves 'disputed'. No separate
      // resume path to forget to call.
      //
      // 'completed' deliberately stays IN scope — the parent row IS visit one, so
      // it flips to completed as soon as that visit is done while visits 2..N are
      // still owed. Excluding it would end every series after its first visit.
      .not("status", "in", "(cancelled,disputed)");
    // Q210(b): narrowed to one series when the webhook asks.
    return onlyParentId ? q.eq("id", onlyParentId) : q;
  });

  const seriesDefect = scanDefect("recurring series", seriesScan);
  if (seriesDefect) {
    console.error(`[charge-recurring-visits] ${seriesDefect}`);
    fail(seriesDefect);
  }
  const series = seriesScan.rows;

  // Q210(b) sweep: an on-session visit payment whose date has arrived is
  // settled here, because the loop below only looks at dates after today.
  //   pending -> expired (never paid; nothing to refund) and the payer is told.
  //   paid    -> funded when the visit's job row exists on that PaymentIntent,
  //              otherwise refunded: the payer paid for a visit that was
  //              never booked (series ended, holder left, insert refused).
  // Skipped on a dry run and on a webhook-narrowed run (the daily run owns it).
  if (!dryRun && !onlyParentId) {
    const { data: stale, error: staleErr } = await supabase
      .from("recurring_visit_payments")
      .select("id, parent_job_id, visit_date, status, payer_id, helper_id, amount_cents, stripe_payment_intent_id, stripe_session_id")
      .in("status", ["pending", "paid"])
      .lte("visit_date", today)
      .order("visit_date", { ascending: true })
      .limit(500);
    if (staleErr) {
      fail(`visit-payment sweep read failed: ${staleErr.message}`);
    }
    // A full page means more are waiting than one run settles: say so rather
    // than draining a backlog one day at a time in silence.
    if ((stale ?? []).length >= 500) {
      fail("visit-payment sweep read a full page of 500; the rest settle on later runs");
    }
    // Q750 (1)/(4): a series that is OVER (ended by end_recurring_series or a
    // ban, or its parent cancelled) can never book a future visit: the loop
    // below skips an ended series, never scans a cancelled one, and
    // trg_series_visit_within_end refuses the row. So its open rows are settled
    // now instead of on their date: a pending row is expired and its Checkout
    // closed, so it can no longer take money; a paid row is refunded under the
    // same cause rules the visit-date sweep applies (Q808). A series that is
    // only PAUSED (disputed, a ban or block on one Helpr, a date nobody holds
    // yet) is left alone: its visit may still be booked, and refunding it now
    // would re-park the date and ask the payer to pay, and lose a card fee,
    // twice. Whether a series is over is judged in code from its own row.
    //
    // Three reads, so the 500-row cap counts ONLY rows of a series that is
    // over (lh-money-escrow review of Q750: one capped read of every open
    // future row let live series crowd them out): (a) the parent of every
    // open future row, paged to the end (ids only); (b) those parents' end
    // state; (c) the open future rows of the parents that are over.
    // deno-lint-ignore no-explicit-any
    let seriesOverRows: Array<Record<string, any>> = [];
    const openParents = await scanAll<{ parent_job_id: string }>("open future visit payments", (countOpt) =>
      supabase
        .from("recurring_visit_payments")
        .select("parent_job_id", countOpt)
        .in("status", ["pending", "paid"])
        .gt("visit_date", today)
        .order("id", { ascending: true }));
    const openDefect = scanDefect("open future visit payments", openParents);
    if (openDefect) fail(`visit-payment sweep of future visits: ${openDefect}`);
    const parentIds = [...new Set(openParents.rows.map((r) => String(r.parent_job_id)))];
    const parents = await scanAllIn<{ id: string; status: string; series_ended_on: string | null }>(
      "series of open future visit payments",
      parentIds,
      (chunk, countOpt) =>
        supabase
          .from("jobs")
          .select("id, status, series_ended_on", countOpt)
          .in("id", chunk)
          .order("id", { ascending: true }),
    );
    const parentsDefect = scanDefect("series of open future visit payments", parents);
    if (parentsDefect) fail(`visit-payment sweep of future visits: ${parentsDefect}`);
    // A parent that was not read is not proof its series is over: left alone.
    const overParentIds = parents.rows
      .filter((p) => Boolean(p.series_ended_on) || p.status === "cancelled")
      .map((p) => String(p.id));
    if (overParentIds.length > 0) {
      const overScan = await scanAllIn<Record<string, unknown>>(
        "open future visit payments of series that are over",
        overParentIds,
        (chunk, countOpt) =>
          supabase
            .from("recurring_visit_payments")
            .select(
              "id, parent_job_id, visit_date, status, payer_id, helper_id, amount_cents, stripe_payment_intent_id, stripe_session_id, created_at",
              countOpt,
            )
            .in("parent_job_id", chunk)
            .in("status", ["pending", "paid"])
            .gt("visit_date", today)
            .order("id", { ascending: true }),
      );
      const overDefect = scanDefect("open future visit payments of series that are over", overScan);
      if (overDefect) fail(`visit-payment sweep of future visits: ${overDefect}`);
      // Each row settles on its own, so a prefix read before a fault is
      // still settled; what was not read waits for the next run.
      seriesOverRows = [...overScan.rows].sort((a, b) => String(a.visit_date).localeCompare(String(b.visit_date)));
      if (seriesOverRows.length > 500) {
        fail(`visit-payment sweep found ${seriesOverRows.length} future visits of series that are over; 500 settle this run, the rest on later runs`);
        seriesOverRows = seriesOverRows.slice(0, 500);
      }
    }
    const overIds = new Set(seriesOverRows.map((r) => String(r.id)));
    for (const row of [...(stale ?? []), ...seriesOverRows]) {
      if (row.status === "pending") {
        const { data: exp, error: expErr } = await supabase
          .from("recurring_visit_payments")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("status", "pending")
          .select("id");
        if (expErr) {
          fail(`visit payment ${row.id}: could not expire (${expErr.message})`);
          continue;
        }
        // Zero rows: the webhook marked it paid a moment ago. Tomorrow's sweep
        // settles it as a paid row.
        if (!exp || exp.length === 0) continue;
        // Close its Checkout so it can no longer be paid. Best effort: an
        // already expired/complete session refuses, and a payment that still
        // lands is refunded by the webhook (the row is no longer pending).
        if (row.stripe_session_id) {
          try {
            await stripe.checkout.sessions.expire(String(row.stripe_session_id));
          } catch (e) {
            console.warn(`[charge-recurring-visits] visit payment ${row.id}: Checkout not expired (${(e as Error).message})`);
          }
        }
        if (row.payer_id) {
          const link = "/posts";
          const { data: n, error: nErr } = await supabase.from("notifications").insert({
            user_id: row.payer_id,
            job_id: row.parent_job_id,
            title: "A visit wasn't booked",
            message: overIds.has(row.id)
              ? `The series ended, so the visit on ${row.visit_date} won't be booked and you weren't charged for it.`
              : `The visit on ${row.visit_date} wasn't paid in time, so it wasn't booked and you weren't charged.`,
            type: "job_updates",
            link,
          }).select("id");
          if (
            nErr || !n ||
            (n.length === 0 &&
              (await seedBoundaryDropsRow(supabase, { user_id: row.payer_id, job_id: row.parent_job_id, link })) !== true)
          ) {
            fail(`visit payment ${row.id}: payer was not told the visit expired (${nErr?.message ?? "zero rows"})`);
          }
        }
        continue;
      }

      // status === 'paid'
      const pi = String(row.stripe_payment_intent_id);
      const { data: booked, error: bookedErr } = await supabase
        .from("jobs")
        .select("id")
        .eq("parent_job_id", row.parent_job_id)
        .eq("date_needed", row.visit_date)
        .eq("stripe_payment_intent_id", pi)
        .limit(1);
      if (bookedErr) {
        fail(`visit payment ${row.id}: could not check whether its visit was booked (${bookedErr.message})`);
        continue;
      }
      if (booked && booked.length > 0) {
        (await settleVisitPayment(supabase, row.id, "funded", String(booked[0].id))).forEach(fail);
        continue;
      }
      // Q808 (owner, 2026-09-27): withhold the card fee on BOTH paths. A run
      // that skipped this paid visit BEFORE its charge re-read (the series had
      // ended, or the date changed hands) never tagged the intent, so the
      // cause is read from the rows themselves: an ended series, a date nobody
      // holds, or a date now held by a Helpr other than the one this payment
      // was charged for (row.helper_id) withholds the fee exactly as the
      // mid-run refusal does. A ban (end_series_for_banned_account) or an
      // account deletion (series_visit_holds FK ON DELETE CASCADE) removes the
      // holds, so those land here as an unheld date and withhold the fee too.
      // Any other unbooked paid visit (a chargeback stop, a block whose hold
      // still stands with the same Helpr) is refunded in full.
      // Unread, the cause is unknown: refund nothing this run, retry next.
      const [causeParent, causeHold] = await Promise.all([
        supabase.from("jobs").select("id, series_ended_on").eq("id", row.parent_job_id).maybeSingle(),
        supabase
          .from("series_visit_holds")
          .select("id, helper_id")
          .eq("parent_job_id", row.parent_job_id)
          .eq("visit_date", row.visit_date)
          .limit(1),
      ]);
      if (causeParent.error || causeHold.error) {
        fail(
          `visit payment ${row.id}: could not read why its visit was not booked (${causeParent.error?.message ?? causeHold.error?.message}); retried next run`,
        );
        continue;
      }
      const seriesEndedCause = Boolean((causeParent.data as { series_ended_on: string | null } | null)?.series_ended_on);
      const nowHolder = ((causeHold.data ?? []) as Array<{ helper_id: string | null }>)[0];
      const dateUnheldCause = !nowHolder || (row.helper_id != null && nowHolder.helper_id !== row.helper_id);
      let refundParams: Stripe.RefundCreateParams = { payment_intent: pi };
      let alreadyRefunded = false;
      try {
        // Q415 (e): the run that charged this intent may already have refunded
        // it less the card fee, and only failed to mark the row. A bare refund
        // here would return the rest, i.e. the fee the platform must not
        // absorb (Q407 (12)). The poster was told at that refund.
        // A refund that is neither that one nor the whole payment was made by
        // hand for less: say so, never settle it as refunded in silence.
        // A run that refused this visit because the series ended or the date
        // changed hands marked the intent before refunding it: that refund
        // withholds the card fee, and so does any retry of it here.
        const amountCents = Number(row.amount_cents);
        let piObj: Stripe.PaymentIntent;
        try {
          piObj = await stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge.balance_transaction"] });
        } catch (readErr) {
          if (isTestObjectUnderLiveKey(readErr)) {
            logTestObjectUnderLiveKey("charge-recurring-visits", { visit_payment_id: row.id, object: "payment_intent", id: pi });
            continue;
          }
          // Unread, it is unknown whether the fee is withheld: refund nothing
          // this run, and try again on the next.
          fail(`visit payment ${row.id}: could not read ${pi} (${(readErr as Error).message}); retried next run`);
          continue;
        }
        const withholdFee = piObj?.metadata?.refund_withhold_fee === "true" || seriesEndedCause || dateUnheldCause;
        const lessFeeCents = Math.max(0, amountCents - actualOrEstimatedFeeCents(piObj, amountCents));
        const owedCents = withholdFee ? lessFeeCents : amountCents;
        // Set before any other Stripe call, so a failure below alerts with
        // the amount actually owed, not "in full".
        if (withholdFee) {
          if (!Number.isFinite(owedCents)) throw new Error(`amount_cents ${row.amount_cents} is not a number`);
          refundParams = { payment_intent: pi, amount: owedCents, metadata: { fee_withheld: "true" } };
        }
        const prior = await stripe.refunds.list({ payment_intent: pi, limit: 100 });
        const live = prior.data.filter((r: Stripe.Refund) => r.status !== "failed" && r.status !== "canceled");
        if (live.length > 0) {
          const refunded = live.reduce((sum: number, r: Stripe.Refund) => sum + (r.amount ?? 0), 0);
          // A hand refund of what the alert said (the amount less the fee)
          // settles too; it carries no fee_withheld mark. That holds even on
          // an intent whose fee_withheld tag could not be written (the tag
          // and the refund can fail together): ops refunded the amount the
          // alert named, and paging them for the fee every day would be wrong.
          if (live.some((r: Stripe.Refund) => r.metadata?.fee_withheld === "true") || refunded >= lessFeeCents) {
            (await settleVisitPayment(supabase, row.id, "refunded", null)).forEach(fail);
            continue;
          }
          fail(`visit payment ${row.id}: ${pi} was refunded $${(refunded / 100).toFixed(2)} of $${(owedCents / 100).toFixed(2)} by hand; not settled`);
          await postSlackOpsAlert({
            kind: "custom",
            severity: "critical",
            title: "Paid recurring visit was never booked and is only partly refunded",
            message: `${pi} (visit on ${row.visit_date}) was refunded $${(refunded / 100).toFixed(2)} of the $${(owedCents / 100).toFixed(2)} owed${
              withholdFee ? " (the card fee is withheld)" : ""
            }, not by this function. Refund the rest by hand.`,
            fields: { payment_intent: pi, parent_job_id: String(row.parent_job_id), visit_date: String(row.visit_date) },
          });
          continue;
        }
        if (withholdFee) {
          if (owedCents !== 0) ({ alreadyRefunded } = await createRefundOnce(stripe, refundParams, { idempotencyKey: `recurring-visit-refund:${pi}` }));
        } else {
          ({ alreadyRefunded } = await createRefundOnce(stripe, refundParams, { idempotencyKey: `recurring-visit-refund:${pi}` }));
        }
      } catch (e) {
        fail(`visit payment ${row.id}: paid visit was never booked and the refund of ${pi} failed (${(e as Error).message})`);
        await postSlackOpsAlert({
          kind: "custom",
          severity: "critical",
          title: "Paid recurring visit was never booked and the refund failed",
          message: `The payer paid ${pi} on-session for the visit on ${row.visit_date}, the visit was never booked, and the refund did not go through. Refund ${pi} by hand: ${
            refundParams.amount === undefined ? "in full" : `$${(refundParams.amount / 100).toFixed(2)} (the card fee is withheld)`
          }.`,
          fields: { payment_intent: pi, parent_job_id: String(row.parent_job_id), visit_date: String(row.visit_date) },
        });
        continue;
      }
      (await settleVisitPayment(supabase, row.id, "refunded", null)).forEach(fail);
      if (row.payer_id && !alreadyRefunded) {
        const link = "/posts";
        const kept = refundParams.amount !== undefined;
        const { data: n, error: nErr } = await supabase.from("notifications").insert({
          user_id: row.payer_id,
          job_id: row.parent_job_id,
          title: kept ? "Your visit payment was refunded, less the card fee" : "Your visit payment was refunded",
          message: kept
            ? `The visit on ${row.visit_date} wasn't booked because the series ended or the date changed hands after it was paid. We refunded $${
              ((refundParams.amount ?? 0) / 100).toFixed(2)
            }; the card processor's fee of $${((Number(row.amount_cents) - (refundParams.amount ?? 0)) / 100).toFixed(2)} can't be returned.`
            : `The visit on ${row.visit_date} couldn't be booked, so we refunded what you paid for it.`,
          type: "job_updates",
          link,
        }).select("id");
        if (
          nErr || !n ||
          (n.length === 0 &&
            (await seedBoundaryDropsRow(supabase, { user_id: row.payer_id, job_id: row.parent_job_id, link })) !== true)
        ) {
          fail(`visit payment ${row.id}: payer was not told of the refund (${nErr?.message ?? "zero rows"})`);
        }
      }
    }
  }

  for (const parent of series) {
    // Already at the ceiling: every remaining series would do two pre-flight
    // reads only to re-enter the cap branch and break again. The defect is
    // already recorded (once), so there is nothing left to learn from them.
    if (results.capped) break;
    results.seriesConsidered++;
    try {
      const dates = recurringVisitDates(
        parent.date_needed as string,
        (parent.recurrence_days ?? []) as number[],
        Number(parent.recurrence_weeks ?? 0),
      );
      // Due = strictly after the parent's OWN visit date, strictly after today,
      // and within the lead window.
      //
      // The `d > parentDate` term is load-bearing. dates[0] IS the parent's
      // date_needed (recurringVisitDates starts at startDate), and the previous
      // comment here reasoned that term was unnecessary because "the first date
      // is the parent job itself and can never be > today for an active
      // series". That is false for the ordinary case of booking ahead: a series
      // whose first visit is 1-3 days out has dates[0] > today and inside the
      // horizon, so it was due. The duplicate guard below cannot catch it
      // either — it only matches rows WHERE parent_job_id = parent.id, and the
      // parent itself has parent_job_id NULL. The result would have been a
      // second, separately-charged job for a visit the poster already funded at
      // checkout.
      const parentDate = parent.date_needed as string;
      //
      // An ENDED series (end_recurring_series set `series_ended_on`) gets no new
      // visit at all, whatever the date. Not "nothing after the end date": the
      // end date is at or after the last created visit, so the only dates at or
      // before it with no visit are GAPS this cron failed to fund earlier (a
      // declined card, no saved card), and funding one after the end charged the
      // poster for a series they had just ended (money/authz review
      // 2026-09-25). trg_series_visit_within_end refuses any new visit of an
      // ended series too, so a run that read the series just before it ended is
      // refunded by the insert-failure branch below.
      if (parent.series_ended_on) {
        results.skippedEnded++;
        continue;
      }
      const due = dates.filter((d) => d > parentDate && d > today && d <= horizon);
      if (due.length === 0) continue;

      // ── A chargeback stops the series (money audit 2026-09-25, MEDIUM-7) ──
      // A poster who disputed a charge with their bank must not keep being
      // charged off-session for the next visits. The parent or any visit
      // under a chargeback skips the whole series; an unreadable answer skips
      // it too (fail closed) and is a defect.
      if (parent.payment_status === "chargeback" || parent.dispute_status === "stripe_chargeback") {
        results.skippedChargeback++;
        continue;
      }
      const chargebackRes = await supabase
        .from("jobs")
        .select("id, payment_status, dispute_status")
        .eq("parent_job_id", parent.id)
        .or("payment_status.eq.chargeback,dispute_status.eq.stripe_chargeback")
        .limit(1);
      if (chargebackRes.error) {
        console.error(`[charge-recurring-visits] chargeback check failed for series ${parent.id}; skipping the series`, chargebackRes.error);
        fail(`series ${parent.id}: chargeback check failed (${chargebackRes.error.message})`);
        continue;
      }
      if ((chargebackRes.data ?? []).length > 0) {
        results.skippedChargeback++;
        continue;
      }

      // ── The two pre-flight reads, and why their errors are FATAL ──────────
      //
      // Both of these used to be destructured as `{ data }`, throwing the
      // `error` away. On a transient fault each therefore came back as `null`,
      // collapsed to an EMPTY Set, and an empty Set is indistinguishable from
      // the honest answer:
      //
      //   `existing`  empty means "no visit has been created for this date".
      //               Wrong, and the day-2/day-3 runs are precisely when it is
      //               wrong — the Stripe idempotency key has expired by then
      //               (see the header), so a re-charge is a REAL second charge,
      //               not a replay. Then the unique index rejects the insert
      //               and the 23505 branch declines to refund. Poster charged
      //               twice, nobody told.
      //
      //   `holds`     who is booked on each date (series_visit_holds). It
      //               replaced the `recurring_visit_releases` read: a date
      //               nobody holds (never picked, or given up and not picked
      //               up) is not charged. An empty answer from a failed read
      //               would skip every date, which is safe for money but drops
      //               the series silently, so a failed read is a defect.
      //
      // Neither read has a safe default, so there is no "carry on carefully"
      // option — the only correct move on a failed read is to fund nothing for
      // this series this run and say so. A skipped series is recoverable: the
      // date stays inside FUND_LEAD_DAYS for up to two more daily runs. A
      // wrongly-charged visit is not.
      //
      //   `visitPayments` (Q210b) the live on-session payment rows for these
      //               dates. Empty from a failed read would mean "no row", and a
      //               $300+ visit with no row gets a SECOND pending row asked of
      //               the payer (refused by the unique index, but a paid row read
      //               as absent would also skip booking the money it holds).
      const [existingRes, holdsRes, visitPaymentsRes] = await Promise.all([
        supabase.from("jobs").select("date_needed").eq("parent_job_id", parent.id).in("date_needed", due),
        supabase
          .from("series_visit_holds")
          .select("id, visit_date, helper_id")
          .eq("parent_job_id", parent.id)
          .in("visit_date", due),
        supabase
          .from("recurring_visit_payments")
          .select("id, visit_date, status, budget_cents, fee_cents, tax_cents, amount_cents, fee_percent, tax_calculation_id, stripe_payment_intent_id")
          .eq("parent_job_id", parent.id)
          .in("visit_date", due)
          .in("status", ["pending", "paid"]),
      ]);
      if (existingRes.error) {
        console.error(
          `[charge-recurring-visits] existing-visit read failed for series ${parent.id}; skipping the series rather than risking a second charge`,
          existingRes.error,
        );
        fail(`series ${parent.id}: existing-visit read failed (${existingRes.error.message})`);
        continue;
      }
      if (holdsRes.error) {
        console.error(
          `[charge-recurring-visits] holds read failed for series ${parent.id}; skipping the series rather than booking the wrong Helpr`,
          holdsRes.error,
        );
        fail(`series ${parent.id}: holds read failed (${holdsRes.error.message})`);
        continue;
      }
      if (visitPaymentsRes.error) {
        console.error(
          `[charge-recurring-visits] visit-payment read failed for series ${parent.id}; skipping the series`,
          visitPaymentsRes.error,
        );
        fail(`series ${parent.id}: visit-payment read failed (${visitPaymentsRes.error.message})`);
        continue;
      }
      const visitPayments = new Map<string, VisitPaymentRow>();
      for (const r of (visitPaymentsRes.data ?? []) as VisitPaymentRow[]) visitPayments.set(r.visit_date, r);
      const alreadyThere = new Set(
        ((existingRes.data ?? []) as Array<{ date_needed: string }>).map((r) => r.date_needed),
      );
      const holders = new Map<string, { id: string; helper_id: string }>();
      for (const h of (holdsRes.data ?? []) as Array<{ id: string; visit_date: string; helper_id: string }>) {
        if (due.includes(h.visit_date)) holders.set(h.visit_date, { id: h.id, helper_id: h.helper_id });
      }

      // ── Q347 and the ban (review 2026-09-25): per HOLDER, not per series ──
      // A banned poster skips the whole series. A holder who is banned, or
      // blocked with the poster, skips only their dates. Nothing here charges,
      // books, applies or notifies. An unknown answer never books.
      const banned = await bannedAmong(supabase, [
        parent.customer_id as string,
        ...[...holders.values()].map((h) => h.helper_id),
      ]);
      if (banned.error) {
        console.error(`[charge-recurring-visits] ban check failed for series ${parent.id}; skipping the series`, banned.error);
        fail(`series ${parent.id}: ban check failed (${banned.error})`);
        continue;
      }
      if (banned.ids.has(parent.customer_id as string)) {
        console.warn(`[charge-recurring-visits] series ${parent.id}: the poster is suspended or banned; skipping (no charge, no visit)`);
        results.skippedBanned++;
        continue;
      }
      const blockedHolders = new Set<string>();
      let blockCheckFailed = false;
      for (const helperId of new Set([...holders.values()].map((h) => h.helper_id))) {
        const { data: blocked, error: blockErr } = await supabase.rpc("are_users_blocked", {
          _user_a: parent.customer_id,
          _user_b: helperId,
        });
        if (blockErr) {
          // No safe default: an unknown answer must not book a possibly-blocked
          // person. The window reopens tomorrow.
          console.error(`[charge-recurring-visits] block check failed for series ${parent.id}; skipping the series`, blockErr);
          fail(`series ${parent.id}: block check failed (${blockErr.message})`);
          blockCheckFailed = true;
          break;
        }
        if (blocked === true) blockedHolders.add(helperId);
      }
      if (blockCheckFailed) continue;

      for (const visitDate of due) {
        if (alreadyThere.has(visitDate)) { results.skippedExisting++; continue; }
        const hold = holders.get(visitDate);
        if (!hold) {
          // Nobody holds this date (never picked on a split series, or given
          // up and not picked up). We do NOT charge and do NOT post it: nobody
          // is committed to it, and funding a visit on the hope someone takes
          // it is how the poster ends up paying for work that never happened
          // (owner decision 5: an unfilled date is not charged).
          results.skippedUnfilled++;
          continue;
        }
        const holderId = hold.helper_id;
        if (banned.ids.has(holderId)) {
          console.warn(`[charge-recurring-visits] series ${parent.id} ${visitDate}: the Helpr holding it is suspended or banned; skipping`);
          results.skippedBanned++;
          continue;
        }
        if (blockedHolders.has(holderId)) {
          console.warn(`[charge-recurring-visits] series ${parent.id} ${visitDate}: poster and holder are blocked; skipping`);
          results.skippedBlocked++;
          continue;
        }
        if (results.funded >= MAX_CHARGES_PER_RUN) {
          // Never silently truncate a run that moves money. A capped run is
          // reported so it cannot be mistaken for a quiet day — and it is a
          // DEFECT, not an outcome: visits this run intended to fund were
          // deliberately dropped, and their three-day window does not reopen.
          // `capped: true` used to ride in the body while the status stayed
          // 200 ok:true, so the one signal saying "work was left on the floor"
          // was the one signal nothing was watching.
          //
          // Recorded once. The outer loop keeps walking so the remaining series
          // still produce accurate skippedExisting/skippedUnfilled counts, and
          // without this guard every subsequent series would record the same
          // reason again.
          if (!results.capped) {
            results.capped = true;
            fail(
              `run capped at MAX_CHARGES_PER_RUN=${MAX_CHARGES_PER_RUN}; remaining due visits were not funded this run`,
            );
          }
          break;
        }

        // ── Q210(b): $300+ visits are paid ON-SESSION, never off it ─────────
        // A pending row: the payer has been asked and has not paid yet. No
        // charge, no visit. A paid row: the payer paid through Checkout (3DS
        // could run), so the visit is booked on THAT PaymentIntent below, at
        // the amounts they were shown, and nothing is charged here.
        const visitPayment = visitPayments.get(visitDate);
        if (visitPayment?.status === "pending") {
          results.awaitingPayment++;
          continue;
        }
        const paidRow = visitPayment?.status === "paid" && visitPayment.stripe_payment_intent_id
          ? visitPayment
          : null;

        // ── What this visit costs ──────────────────────────────────────────
        const budgetCents = paidRow
          ? paidRow.budget_cents
          : Math.round(Number(parent.budget) * 100);

        const { data: posterProfile, error: posterErr } = await supabase
          .from("profiles")
          .select("email, subscription_tier, subscription_expires_at")
          .eq("user_id", parent.customer_id)
          .maybeSingle();
        if (posterErr || !posterProfile?.email) {
          console.error(`[charge-recurring-visits] poster read failed for series ${parent.id}`, posterErr);
          fail(`series ${parent.id}: poster profile unreadable (${posterErr?.message ?? "no email on file"})`);
          continue;
        }

        const feePercent = paidRow ? Number(paidRow.fee_percent) : posterFeePercentForTier(
          posterProfile.subscription_tier as string | null,
          posterProfile.subscription_expires_at as string | null,
        );
        // No urgent tip and no onboarding fee on a recurring visit: urgency is a
        // property of a one-off post, and onboarding is charged once per account
        // and was already paid on the first visit.

        // Sales tax. Louisiana is an enumerated-services state, so only the
        // `assembly` and `handyman` labor lines are taxable — every other
        // category is $0 and needs no rate at all.
        //
        // This used to read `parish_tax_rates` for EVERY series, taxable or
        // not. That table was retired on 2026-08-23 (owner decision: quote
        // Stripe's number, stop maintaining a second one — the two had already
        // diverged and quoted $0 on charges Stripe taxed at 10%). It no longer
        // exists, so that read returned an error and its fail-closed branch
        // skipped the visit "rather than charging untaxed" — forever, and even
        // for the exempt categories that were never going to be taxed at all.
        // Combined with the enum bug above, recurring could not have charged a
        // visit even once.
        //
        // Tax now comes from the same place the actual charge gets it: Stripe.
        // `tax.calculations` is the exact call `calculate-tax` makes for the
        // checkout quote, with the same labor tax_code, so the recurring visit
        // and the first visit are computed from identical inputs.
        let taxCents = paidRow ? paidRow.tax_cents : 0;
        // ME-014: kept so the calculation can be committed as a Stripe Tax
        // transaction once the visit exists (off-session PaymentIntents get no
        // automatic_tax, so nothing else ever reports this tax).
        let taxCalculationId: string | null = paidRow ? paidRow.tax_calculation_id : null;
        // A paid row carries the tax the payer was charged; no new calculation.
        if (!paidRow && isLaborTaxable(parent.category as string)) {
          try {
            const calc = await stripe.tax.calculations.create({
              currency: "usd",
              line_items: [{
                amount: budgetCents,
                reference: "labor",
                tax_behavior: "exclusive",
                tax_code: TAXABLE_LABOR_TAX_CODE,
              }],
              customer_details: {
                address: {
                  postal_code: (parent.zip_code as string) ?? "",
                  state: "LA",
                  country: "US",
                },
                address_source: "billing",
              },
            });
            taxCents = calc.tax_amount_exclusive ?? 0;
            taxCalculationId = calc.id ?? null;
          } catch (e) {
            // Still fail closed, but now only for the narrow taxable case —
            // charging untaxed would leave us owing Louisiana money we never
            // collected on a total the poster already sees as final.
            console.error(
              `[charge-recurring-visits] Stripe tax calculation failed for series ${parent.id} (${parent.category}); skipping rather than charging untaxed`,
              e,
            );
            fail(`series ${parent.id} ${visitDate}: Stripe tax calculation failed`);
            continue;
          }
        }

        // ME-014: the fee's Stripe-cost floor must cover the WHOLE charge,
        // tax included (posterFees.ts), so it is computed after the tax.
        const computedFeeCents = posterServiceFeeCents(budgetCents, feePercent, taxCents);
        const feeCents = paidRow ? paidRow.fee_cents : computedFeeCents;
        const totalCents = budgetCents + feeCents + taxCents;

        // $300 and up: park it for the payer to pay on-session (owner decision
        // 2026-09-27). An off-session charge cannot answer a 3D Secure
        // challenge, so it is never attempted at this size. Under $300 nothing
        // below changes.
        // Q1338 (lh-money-escrow review, 2026-10-05): the Q1104 earlier-charge
        // lookup used to run only AFTER this branch, so a visit an earlier run
        // charged off-session (while it still totalled under $300) and never
        // booked was parked here and the payer asked to pay it again. Ask
        // Stripe first; an earlier unbooked charge of this claim falls through
        // to the adopt path below (which books it, or pages on a mismatch) and
        // is never parked. An earlier charge made while the visit totalled
        // under $300 usually took a different amount, so in practice this is
        // the Q1337 mismatch page, every run, until a person books or refunds
        // it: never a second charge to the payer.
        let earlierChargeToAdopt = false;
        if (!paidRow && totalCents >= THREE_D_SECURE_MIN_CENTS && !dryRun) {
          const parkCard = await seriesCard(stripe, parent.stripe_payment_intent_id as string | null);
          if (parkCard.kind === "unknown") {
            fail(`series ${parent.id} ${visitDate}: could not read the series' saved card before parking (${parkCard.message}); nothing parked this run`);
            continue;
          }
          if (parkCard.kind === "card") {
            const parkPrior = await priorVisitIntent(stripe, parkCard.customerId, String(parent.id), visitDate, String(hold.id));
            if (parkPrior.kind === "error") {
              fail(`series ${parent.id} ${visitDate}: could not check Stripe for an earlier charge of this visit before parking (${parkPrior.message.slice(0, 160)}); nothing parked this run`);
              continue;
            }
            if (parkPrior.kind === "in_flight") {
              fail(`series ${parent.id} ${visitDate}: an earlier charge ${parkPrior.intentId} of this visit is still processing; nothing parked this run`);
              continue;
            }
            earlierChargeToAdopt = parkPrior.kind === "adopt";
          }
        }
        if (!paidRow && totalCents >= THREE_D_SECURE_MIN_CENTS && !earlierChargeToAdopt) {
          if (dryRun) {
            results.awaitingPayment++;
            continue;
          }
          const parked = await parkForOnSessionPayment(supabase, parent, {
            visitDate,
            holdId: hold.id,
            holderId,
            budgetCents,
            feeCents,
            taxCents,
            feePercent,
            taxCalculationId,
          });
          parked.failures.forEach(fail);
          if (parked.parked) results.awaitingPayment++;
          continue;
        }

        // The HELPER's commission, which is a different number in a different
        // column from the poster's service fee above. `create-payment` sets the
        // convention (index.ts:350-356) and the two are easy to transpose:
        //   platform_fee_percent -> the POSTER's tier percentage
        //   platform_fee_amount  -> the HELPER's commission, in dollars
        //   customer_fee_amount  -> the POSTER's service fee, in dollars
        //   helper_fee_percent   -> the HELPER's tier percentage
        // Writing the poster's fee into platform_fee_amount (and leaving
        // customer_fee_amount at its 0 default) does not mispay the helper —
        // release-payout overwrites platform_fee_amount at release — but it
        // makes the admin gross rollups, which read `budget +
        // customer_fee_amount + sales_tax_amount`, under-report every visit by
        // its whole service fee; and the cancellation refund reads
        // `customer_fee_amount ?? 0`, so it would hand back a fee that WAS
        // collected.
        // The fallback (profile-read failure only) is the FREE-tier rate, not
        // a literal and not the global setting. helperFees.ts picks free (12)
        // on purpose: an unrecognised or unreadable tier must never
        // under-charge the platform.
        //
        // This used to prefer `platform_settings.helper_fee_percent` and only
        // fall through to DEFAULT_TIER_FEE_PERCENT if that read failed — so in
        // the normal case it applied the stored 10 (the Pro rate) to a free
        // helper. A generated visit has no frozen per-job percent to prefer
        // (the row is being created here), so the free rate is the whole
        // chain. That read fed nothing else and is gone. Every path that
        // resolves a helper commission now falls back to the same number,
        // derived from DEFAULT_TIER_FEE_PERCENT rather than a literal.
        const helperFeePercent = await getHelperFeePercent(
          supabase as never,
          holderId,
          DEFAULT_TIER_FEE_PERCENT,
        );
        // Use the shared commission helper, not the unrounded
        // `(budget * pct) / 100` form. helperFees.ts documents why: the
        // unrounded variant carries sub-cent precision into the row and put
        // two payout paths a cent apart on thousands of (budget, tier) pairs.
        // This value is provisional — release-payout overwrites it with the
        // real commission — but it is what admin reporting and the helper's
        // estimate read until then, so it must round like money.
        const helperFeeAmount = helperCommissionDollars(
          budgetCents / 100,
          helperFeePercent,
        );

        if (dryRun) {
          console.log("[charge-recurring-visits] would charge", {
            series: parent.id, visitDate, totalCents,
          });
          results.funded++;
          continue;
        }

        // ── Charge, then create ────────────────────────────────────────────
        //
        // THE SERIES' OWN CARD, NOTHING ELSE (Q734, money audit 2026-09-25
        // MEDIUM-8). This used to scan every Stripe customer record on the
        // poster's EMAIL and charge the first card it found. One email owns
        // many customer records, so that card could be one the poster saved
        // for something else entirely, never authorised for this series; and a
        // series whose first visit a gift card funded (no saved card at all)
        // was charged on whatever card the scan turned up.
        //
        // The authority to charge off-session comes from ONE checkout: the
        // series' own, which create-payment opens with `setup_future_usage:
        // "off_session"` for every series (useJobSubmit forces the flag when
        // isRecurring). Its PaymentIntent is on the parent row
        // (`stripe_payment_intent_id`, server-owned: the webhook writes it),
        // and Stripe records on it the exact customer and card it saved. So
        // the charge uses that customer and that card, and nothing else. A
        // series whose checkout saved no card (a gift-card checkout never sets
        // setup_future_usage) gets the poster told, and no charge: they can pay
        // the visit on-session from the app (Q210(b)), which books it below.
        // Q210(b): a paid row already holds the money; no card is looked up.
        let customerId: string | undefined;
        let paymentMethodId: string | undefined;
        if (!paidRow) {
          const card = await seriesCard(stripe, parent.stripe_payment_intent_id as string | null);
          if (card.kind === "unknown") {
            // Stripe did not answer. Not the poster's problem and not a
            // decline: tomorrow's run asks again while the window is open.
            fail(`series ${parent.id} ${visitDate}: could not read the series' saved card (${card.message})`);
            continue;
          }
          if (card.kind === "test_object") {
            logTestObjectUnderLiveKey("charge-recurring-visits", { parent_job_id: parent.id, visit_date: visitDate, object: "payment_intent", id: card.paymentIntentId });
            continue;
          }
          if (card.kind === "none") {
            console.warn(`[charge-recurring-visits] series ${parent.id} has no saved card: ${card.reason}`);
            (await notifyPosterCardProblem(supabase, parent, holderId, visitDate, "no_saved_card")).forEach(fail);
            results.declined++;
            continue;
          }
          customerId = card.customerId;
          paymentMethodId = card.paymentMethodId;
        }

        // ── Re-read right before the charge (money audit LOW-10) ──────────
        // The series may have ended, or the date changed hands, since this run
        // read it. Charging and then refunding on the insert refusal loses the
        // Stripe fee, so ask again here. The DB trigger still refuses the
        // insert if either changes after this read (and the charge is
        // refunded); this only narrows that window.
        const [liveParent, liveHold] = await Promise.all([
          supabase.from("jobs").select("id, series_ended_on").eq("id", parent.id).maybeSingle(),
          supabase
            .from("series_visit_holds")
            .select("id, visit_date, helper_id")
            .eq("parent_job_id", parent.id)
            .eq("visit_date", visitDate)
            .maybeSingle(),
        ]);
        if (liveParent.error || liveHold.error || !liveParent.data) {
          fail(
            `series ${parent.id} ${visitDate}: pre-charge re-read failed (${liveParent.error?.message ?? liveHold.error?.message ?? "series row missing"})`,
          );
          continue;
        }
        if ((liveParent.data as { series_ended_on: string | null }).series_ended_on) {
          results.skippedEnded++;
          continue;
        }
        const nowHold = liveHold.data as { id: string; helper_id: string } | null;
        if (!nowHold || nowHold.id !== hold.id || nowHold.helper_id !== holderId) {
          results.skippedUnfilled++;
          continue;
        }

        // Q1104: a charge an earlier run made for this exact claim and never
        // booked is adopted, never charged again (see priorVisitIntent).
        const prior: PriorVisitIntent = paidRow
          ? { kind: "none" }
          : await priorVisitIntent(stripe, customerId as string, String(parent.id), visitDate, String(hold.id));
        if (prior.kind === "error") {
          fail(`series ${parent.id} ${visitDate}: could not check Stripe for an earlier charge of this visit (${prior.message.slice(0, 160)}); nothing charged this run`);
          continue;
        }
        if (prior.kind === "in_flight") {
          fail(`series ${parent.id} ${visitDate}: an earlier charge ${prior.intentId} of this visit is still processing; nothing charged this run`);
          continue;
        }
        // Q1338: a $300+ visit reaches here only to adopt an earlier charge.
        // If that charge is gone by now (refunded between the two reads), it
        // is never charged off-session: the next run parks it.
        if (!paidRow && totalCents >= THREE_D_SECURE_MIN_CENTS && prior.kind !== "adopt") {
          fail(`series ${parent.id} ${visitDate}: the earlier charge of this $300+ visit was no longer adoptable; nothing charged, the next run parks it`);
          continue;
        }
        if (prior.kind === "adopt") {
          // Q1337: the visit row below records THIS run's totals (budget, fee,
          // tax), so an adopted intent is booked only when it took exactly
          // that much. Between day 1 and today the fee tier, the tax rate or
          // the series' budget can move; booking a 112.00 intent as a 115.00
          // visit would refund, pay out and report money that was never
          // charged. A mismatch charges nothing (the earlier intent already
          // holds money) and books nothing: a person decides, so it pages.
          const adoptedAmount = Number(prior.intent.amount);
          const adoptedCurrency = String(prior.intent.currency ?? "").toLowerCase();
          if (adoptedAmount !== totalCents || adoptedCurrency !== "usd") {
            await postSlackOpsAlert({
              kind: "custom",
              severity: "critical",
              title: "Recurring visit: earlier charge does not match this visit",
              message:
                `An earlier unbooked charge ${prior.intent.id} for this visit took ${adoptedAmount} ${adoptedCurrency || "(no currency)"}, but the visit now totals ${totalCents} usd. Nothing was charged or booked; decide by hand whether to book it on that charge or refund it.`,
              fields: {
                parentJobId: String(parent.id),
                visitDate,
                paymentIntent: prior.intent.id,
                adoptedAmountCents: String(adoptedAmount),
                expectedAmountCents: String(totalCents),
              },
            });
            fail(
              `series ${parent.id} ${visitDate}: earlier charge ${prior.intent.id} took ${adoptedAmount} ${adoptedCurrency || "(no currency)"}, this visit totals ${totalCents} usd; nothing charged or booked`,
            );
            // Both sides learn the date is not booked (the Helpr must not head
            // out); the page above is also an open ops-ledger item until cleared.
            (await notifyPosterCardProblem(supabase, parent, holderId, visitDate, "adopted_amount_mismatch", "held"))
              .forEach(fail);
            continue;
          }
          console.warn(`[charge-recurring-visits] ${parent.id} ${visitDate}: adopting earlier unbooked charge ${prior.intent.id} instead of charging again`);
        }
        // Q750 (2), owner 2026-10-05: CHARGE FRESH. A refunded charge of this
        // same claim (an insert that failed and was refunded) shares the plain
        // key, and Stripe may still replay it (keys live at least 24 hours),
        // handing back the REFUNDED intent as `succeeded`; the visit would be
        // booked on money already returned. After a refund the key carries
        // the newest refunded intent's id: new for each refund, the same for
        // two overlapping runs of one day (they read the same list).
        const refundedOfClaim = prior.kind === "none" ? prior.refundedIds ?? [] : [];
        const chargeKey = refundedOfClaim.length > 0
          ? `recurring-visit:${parent.id}:${visitDate}:${hold.id}:after-${refundedOfClaim[0]}`
          : `recurring-visit:${parent.id}:${visitDate}:${hold.id}`;

        // ONE call site, but up to TWO attempts on the SAME key — see
        // `attemptVisitCharge`. A network fault here is not a decline.
        // Q210(b): a visit the payer paid on-session books on that intent.
        const outcome: ChargeOutcome = paidRow
          ? {
            kind: "ok",
            intent: { id: paidRow.stripe_payment_intent_id, status: "succeeded" } as Stripe.PaymentIntent,
          }
          : prior.kind === "adopt"
          ? { kind: "ok", intent: prior.intent }
          : await attemptVisitCharge(
          stripe,
          {
                amount: totalCents,
            currency: "usd",
            customer: customerId,
            payment_method: paymentMethodId,
            off_session: true,
            confirm: true,
            description: `Helpr recurring visit — ${parent.title} on ${visitDate}`,
            // No transfer_data: this is ESCROW. The money sits on the platform
            // until the visit is completed and `create-payment action=release`
            // transfers it, exactly like a one-off job.
            metadata: {
              type: "recurring_visit",
              parent_job_id: String(parent.id),
              visit_date: visitDate,
              customer_id: String(parent.customer_id),
              helper_id: String(holderId),
              hold_id: String(hold.id),
            },
          },
          // Keyed on (series, date, CLAIM). The hold id is one per claim of
          // the date (20260927012806): a date given up after a refunded charge
          // and re-claimed within 24h gets a NEW charge, never Stripe's replay
          // of the refunded intent (which reports `succeeded`).
          //
          // ITS REACH IS 24 HOURS, NOT THE FUNDING WINDOW. A Stripe-level
          // retry, an overlapping cron run or a manual re-trigger WITHIN A DAY
          // replays this exact PaymentIntent and cannot mint a second charge.
          // The next daily run is 24h later — at or past the key's expiry — so
          // on days 2 and 3 of the same visit's window Stripe treats an
          // identical request as brand new and charges again. The key is
          // deliberately still stable rather than per-run: same-day protection
          // is worth having, and cross-day protection comes from the `existing`
          // pre-flight read plus the `jobs_one_visit_per_series_date` index,
          // whose 23505 branch below now proves which intent backs the
          // surviving row before it decides whether a refund is owed.
          // After a refund of this claim the key moves on (chargeKey, Q750 (2)).
          chargeKey,
        );

        if (outcome.kind !== "ok") {
          console.error(
            `[charge-recurring-visits] charge ${outcome.kind} ${parent.id} ${visitDate}: ${outcome.message}`,
          );
          // The operative fact is the same either way and it is TRUE either way:
          // this date is not booked, so the helper must not head out for it. It
          // is the ops side that differs.
          (await notifyPosterCardProblem(supabase, parent, holderId, visitDate, outcome.message.slice(0, 120)))
            .forEach(fail);
          results.declined++;

          if (outcome.kind === "unknown") {
            // Not a decline. Stripe never told us whether it took the money, and
            // this is the ONE failure whose cost compounds: with no job row, the
            // next daily run finds `alreadyThere` empty and re-charges — and by
            // then the idempotency key has expired, so that is a second REAL
            // charge with no 23505 to catch it (the first intent never got a
            // row). Two charges, one visit, nothing that ever notices.
            await postSlackOpsAlert({
              kind: "custom",
              severity: "critical",
              title: "Recurring visit charge outcome UNKNOWN",
              message:
                `Stripe did not answer for ${CHARGE_ATTEMPTS} attempts on one idempotency key, so a PaymentIntent may be holding this poster's money with no visit behind it. Check Stripe for key ${chargeKey} BEFORE tomorrow's run, which will charge again on a fresh key.`,
              fields: {
                parentJobId: String(parent.id),
                visitDate,
                customer: customerId,
                amountCents: String(totalCents),
                error: outcome.message,
              },
            });
            fail(
              `series ${parent.id} ${visitDate}: charge outcome unknown after ${CHARGE_ATTEMPTS} attempts — a PaymentIntent may be holding money with no visit`,
            );
          }
          continue;
        }
        const intent = outcome.intent;

        // Q750 (2): never book on a refunded intent, whatever the key replayed.
        if (refundedOfClaim.includes(intent.id)) {
          await postSlackOpsAlert({
            kind: "custom",
            severity: "critical",
            title: "Recurring visit charge came back as an already-refunded intent",
            message:
              `Charging this visit returned PaymentIntent ${intent.id}, which was already refunded. Nothing was booked. Check the series by hand.`,
            fields: { parentJobId: String(parent.id), visitDate, intent: intent.id, key: chargeKey },
          });
          fail(`series ${parent.id} ${visitDate}: charge returned already-refunded intent ${intent.id}; nothing booked`);
          (await notifyPosterCardProblem(supabase, parent, holderId, visitDate, "refunded_intent_replayed", "held"))
            .forEach(fail);
          continue;
        }

        if (intent.status !== "succeeded") {
          (await notifyPosterCardProblem(supabase, parent, holderId, visitDate, `intent_${intent.status}`)).forEach(fail);
          results.declined++;
          continue;
        }

        // Q750 review (lh-money-escrow 2026-10-05, finding 2): the refunded
        // list above was read BEFORE the charge. An overlapping run can refund
        // the very intent this run adopted or had replayed in between, so ask
        // Stripe now, right before booking: any refund that is not failed or
        // canceled (pending included) means the money is going back, and the
        // visit is not booked on it. An unreadable answer books nothing either:
        // the intent stays held and the next run of the window adopts it.
        if (!paidRow) {
          let liveRefunds: Stripe.Refund[] | null = null;
          let readErr = "refund list gave no data";
          try {
            const r = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
            if (r && Array.isArray(r.data)) liveRefunds = r.data;
          } catch (e) {
            readErr = caughtMessage(e);
          }
          if (liveRefunds === null) {
            // Paged like the UNKNOWN charge: on the window's last run nothing
            // after this would ever look at the held intent again.
            await postSlackOpsAlert({
              kind: "custom",
              severity: "critical",
              title: "Recurring visit charge held: its refund state could not be read",
              message:
                `PaymentIntent ${intent.id} holds this visit's money, but Stripe did not say whether it carries a refund, so the visit was NOT booked. The next run of the window retries; if this was the last, check the intent by hand. Do not refund until checked.`,
              fields: { parentJobId: String(parent.id), visitDate, intent: intent.id, error: readErr.slice(0, 200) },
            });
            fail(`series ${parent.id} ${visitDate}: could not confirm ${intent.id} carries no refund before booking (${readErr.slice(0, 160)}); nothing booked, retried next run`);
            (await notifyPosterCardProblem(supabase, parent, holderId, visitDate, "refund_state_unread", "held"))
              .forEach(fail);
            continue;
          }
          if (liveRefunds.some((r) => r.status !== "failed" && r.status !== "canceled")) {
            await postSlackOpsAlert({
              kind: "custom",
              severity: "critical",
              title: "Recurring visit charge was refunded before it could be booked",
              message:
                `PaymentIntent ${intent.id} carries a refund, so this visit was NOT booked on it. Check the series by hand: the poster may need to pay again.`,
              fields: { parentJobId: String(parent.id), visitDate, intent: intent.id },
            });
            fail(`series ${parent.id} ${visitDate}: intent ${intent.id} carries a refund; nothing booked`);
            (await notifyPosterCardProblem(supabase, parent, holderId, visitDate, "intent_refunded_before_booking", "held"))
              .forEach(fail);
            continue;
          }
        }

        // Money is in. NOW the visit exists.
        const { data: child, error: childErr } = await supabase
          .from("jobs")
          .insert({
            customer_id: parent.customer_id,
            business_id: parent.business_id,
            title: parent.title,
            description: parent.description,
            category: parent.category,
            // budgetCents is parent.budget in cents, or the budget the payer
            // paid on-session for a Q210(b) visit.
            budget: budgetCents / 100,
            date_needed: visitDate,
            start_time: parent.start_time,
            location: parent.location,
            parish: parent.parish,
            zip_code: parent.zip_code,
            latitude: parent.latitude,
            longitude: parent.longitude,
            estimated_hours: parent.estimated_hours,
            special_requirements: parent.special_requirements,
            photos: parent.photos,
            is_flexible_schedule: parent.is_flexible_schedule,
            parent_job_id: parent.id,
            // The date's HOLDER (trg_series_visit_within_end refuses anyone
            // else). Not 'open' — this visit is not up for grabs, which is the
            // entire point of booking a series. Its payout follows helper_id.
            helper_id: holderId,
            status: "accepted",
            helper_confirmed_at: new Date().toISOString(),
            payment_status: "escrow",
            stripe_payment_intent_id: intent.id,
            platform_fee_percent: feePercent,
            platform_fee_amount: helperFeeAmount,
            customer_fee_amount: feeCents / 100,
            helper_fee_percent: helperFeePercent,
            // Derived from the amount Stripe actually calculated rather than a
            // rate we looked up ourselves — that second source of truth is the
            // one that was retired. Rounded to 4dp so a rate like 9.95% stores
            // as 9.95 and not a repeating float.
            sales_tax_rate: taxCents > 0 && budgetCents > 0
              ? Math.round((taxCents / budgetCents) * 1_000_000) / 10_000
              : 0,
            sales_tax_amount: taxCents / 100,
            // A recurring visit is never a one-time template itself.
            is_recurring: false,
            is_urgent: false,
            urgent_fee: 0,
          })
          .select("id")
          .single();

        if (childErr || !child) {
          // ── 23505: ASK WHOSE MONEY IS UNDER THE SURVIVING ROW. ────────────
          //
          // `jobs_one_visit_per_series_date` (migration 20260831200113) makes
          // (parent_job_id, date_needed) unique, which turns two colliding
          // inserts into one winner and one 23505 instead of two job rows
          // sharing a single PaymentIntent — two rows that would each release a
          // payout out of one escrow.
          //
          // The loser lands HERE, and the generic branch below refunds
          // `intent.id`. Whether that refund is right or catastrophic depends
          // entirely on a fact this code used to ASSUME:
          //
          //   SAME DAY (two overlapping runs). Both hold the same idempotency
          //   key, so Stripe handed both the SAME PaymentIntent — the one
          //   backing the winner's row. Refunding it strips the money out from
          //   under a live booked visit, leaving `payment_status='escrow'` over
          //   a refunded intent and a helper who is never paid. Must NOT refund.
          //
          //   NEXT DAY (the window is three runs wide; the key lives 24h). The
          //   key is gone, so `intent` is a SECOND, REAL charge that backs
          //   nothing. "No refund needed" here leaves the poster charged twice
          //   for one visit, permanently, with no alert. Must refund.
          //
          // The two are indistinguishable from the error alone. So read the
          // surviving row and compare its `stripe_payment_intent_id` against
          // the intent in hand. That is the whole question, and it has a
          // definite answer.
          //
          // WHEN THE ANSWER CANNOT BE READ, DO NOT REFUND. An unreadable row
          // means we cannot rule out that this intent IS the live escrow, and
          // the two mistakes are not symmetric: a stranded duplicate charge is
          // money sitting in one place that a human can refund, while a
          // wrongly-refunded escrow is a visit that will be worked and never
          // paid. Fail toward the recoverable one, and page.
          if (childErr?.code === "23505") {
            const { data: winner, error: winnerErr } = await supabase
              .from("jobs")
              .select("id, stripe_payment_intent_id")
              .eq("parent_job_id", parent.id)
              .eq("date_needed", visitDate)
              .maybeSingle();

            if (!winnerErr && winner && winner.stripe_payment_intent_id === intent.id) {
              // Same-day race. Nothing was lost: the winner charged the poster
              // once and created the visit, on this very intent. Count it as
              // already present, exactly as the pre-flight `alreadyThere` check
              // would have done had it seen the winner's row.
              console.log(
                `[charge-recurring-visits] visit ${parent.id} ${visitDate} was created by a concurrent run on this same PaymentIntent; skipping (no refund — it backs that row).`,
              );
              if (paidRow) {
                (await settleVisitPayment(supabase, paidRow.id, "funded", String(winner.id))).forEach(fail);
              }
              results.skippedExisting++;
              continue;
            }

            if (!winnerErr && winner) {
              // A different intent funds the surviving visit, so the charge in
              // hand is a duplicate this run should never have made. Give it
              // back now, while it is still attributable.
              console.error(
                `[charge-recurring-visits] duplicate charge ${intent.id} for ${parent.id} ${visitDate}: visit ${winner.id} is already funded by ${String(winner.stripe_payment_intent_id)}. Refunding the duplicate.`,
              );
              try {
                await stripe.refunds.create(
                  { payment_intent: intent.id },
                  { idempotencyKey: `recurring-visit-refund:${intent.id}` },
                );
                fail(
                  `series ${parent.id} ${visitDate}: duplicate charge ${intent.id} refunded (visit already funded by ${String(winner.stripe_payment_intent_id)})`,
                );
                if (paidRow) {
                  (await settleVisitPayment(supabase, paidRow.id, "refunded", null)).forEach(fail);
                }
              } catch (refundErr) {
                await postSlackOpsAlert({
                  kind: "custom",
                  severity: "critical",
                  title: "Recurring visit double-charged and the refund failed",
                  message:
                    `PaymentIntent ${intent.id} is a SECOND charge for a visit already funded by another intent, and the refund did not go through. Refund ${intent.id} by hand.`,
                  fields: {
                    parentJobId: String(parent.id),
                    visitDate,
                    duplicateIntent: intent.id,
                    fundedBy: String(winner.stripe_payment_intent_id),
                    error: String(refundErr),
                  },
                });
                fail(`series ${parent.id} ${visitDate}: duplicate charge ${intent.id} could not be refunded`);
              }
              continue;
            }

            // Could not establish which intent funds the surviving row.
            await postSlackOpsAlert({
              kind: "custom",
              severity: "critical",
              title: "Recurring visit hit the uniqueness index and its funding could not be verified",
              message:
                `A visit for this date already exists, but the row could not be read, so we cannot tell whether PaymentIntent ${intent.id} is that visit's escrow or a duplicate charge. NOT refunded — refunding a live escrow would leave a booked helper unpaid. Check the intent by hand.`,
              fields: {
                parentJobId: String(parent.id),
                visitDate,
                intent: intent.id,
                error: winnerErr ? winnerErr.message : "no row returned",
              },
            });
            fail(
              `series ${parent.id} ${visitDate}: 23505 with unverifiable funding for intent ${intent.id} — not refunded, needs a human`,
            );
            continue;
          }

          // The charge went through and the row did not. Refund immediately —
          // holding a poster's money for a visit that does not exist is the
          // worst outcome available here, and it is silent unless we act.
          console.error(`[charge-recurring-visits] insert failed after charge ${intent.id}`, childErr);
          // trg_series_visit_within_end refused the row: the series was ended
          // (end_recurring_series) after this run read it. Once the refund
          // below goes through that is the designed outcome, not a defect.
          const seriesEndedMidRun = String(childErr?.message ?? "").startsWith("series_ended:");
          // trg_series_visit_within_end: the date changed hands (given up or
          // taken over) after this run read it. Refunded below, then a skip.
          const holderChangedMidRun = String(childErr?.message ?? "").startsWith("series_date_unheld:");
          // Q415 (e) (owner, 2026-09-27): a charge the PLATFORM got wrong (an
          // insert that simply failed) comes back in full. A series that
          // ended, or a date that changed hands, between charge and insert is
          // the parties' doing, so Stripe's processing fee is withheld: the
          // platform never absorbs a fee (Q407 (12)).
          const refundParams: Stripe.RefundCreateParams = { payment_intent: intent.id };
          let capturedCents = paidRow ? paidRow.amount_cents : totalCents;
          let alreadyRefunded = false;
          try {
            if (seriesEndedMidRun || holderChangedMidRun) {
              // Tell the stale-visit sweep why, before any refund request: if
              // this refund fails, the sweep retries it and must withhold the
              // fee too. Best effort: a refund that goes through carries its
              // own fee_withheld mark below.
              try {
                await stripe.paymentIntents.update(intent.id, { metadata: { refund_withhold_fee: "true" } });
              } catch (e) {
                console.warn(`[charge-recurring-visits] could not mark ${intent.id} as fee-withheld`, e);
              }
              const split = await refundLessStripeFeeCents(stripe, intent, capturedCents);
              refundParams.amount = split.refundCents;
              capturedCents = split.capturedCents;
              // The sweep's mark that this partial refund is the whole of it.
              refundParams.metadata = { fee_withheld: "true" };
            }
            // A charge no bigger than its fee leaves nothing to return. Stripe
            // refuses a $0 refund, and that refusal would raise the "refund by
            // hand" alert below for money that is correctly kept.
            if (refundParams.amount !== 0) ({ alreadyRefunded } = await createRefundOnce(
              stripe,
              refundParams,
              // Keyed on the INTENT, not on (series, date). Those are not the
              // same key across days: the window spans three runs and the
              // charge key expires after 24h, so one (series, date) can produce
              // more than one PaymentIntent. A (series, date) refund key would
              // then replay the FIRST refund's response for a completely
              // different intent — reporting a refund that never happened on
              // money still held. One key per intent is idempotent for the
              // retry it is actually protecting against and cannot collide.
              { idempotencyKey: `recurring-visit-refund:${intent.id}` },
            ));
          } catch (refundErr) {
            await postSlackOpsAlert({
              kind: "custom",
              severity: "critical",
              title: "Recurring visit charged but not created, and the refund failed",
              message: `PaymentIntent ${intent.id} is holding a poster's money for a visit that was never created. Refund by hand: ${
                refundParams.amount === undefined ? "in full" : `$${(refundParams.amount / 100).toFixed(2)} (the card fee is withheld)`
              }.`,
              fields: { parentJobId: String(parent.id), visitDate, intent: intent.id, error: String(refundErr) },
            });
            fail(
              `series ${parent.id} ${visitDate}: visit insert failed after charge ${intent.id} (${childErr?.message ?? "no row returned"})`,
            );
            continue;
          }
          // Q210(b): the on-session payment was given back; its row says so.
          if (paidRow) {
            (await settleVisitPayment(supabase, paidRow.id, "refunded", null)).forEach(fail);
          }
          // Q415 (e): money was kept, so the poster is told how much came back
          // and why the rest did not. A silent partial refund reads as theft.
          if (refundParams.amount !== undefined && !alreadyRefunded && parent.customer_id) {
            const refundedCents = refundParams.amount;
            const withheldCents = capturedCents - refundedCents;
            const link = "/posts";
            const { data: n, error: nErr } = await supabase.from("notifications").insert({
              user_id: parent.customer_id,
              job_id: parent.id,
              title: "Your visit charge was refunded, less the card fee",
              message: `The visit on ${visitDate} wasn't booked because ${
                seriesEndedMidRun ? "the series ended" : "the date changed hands"
              } after it was charged. We refunded $${(refundedCents / 100).toFixed(2)}; the card processor's fee of $${
                (withheldCents / 100).toFixed(2)
              } can't be returned.`,
              type: "job_updates",
              link,
            }).select("id");
            if (
              nErr || !n ||
              (n.length === 0 &&
                (await seedBoundaryDropsRow(supabase, { user_id: String(parent.customer_id), job_id: String(parent.id), link })) !== true)
            ) {
              fail(`series ${parent.id} ${visitDate}: poster was not told of the fee-withheld refund (${nErr?.message ?? "zero rows"})`);
            }
          }
          if (seriesEndedMidRun) {
            console.log(
              `[charge-recurring-visits] series ${parent.id} ended before ${visitDate} was booked; charge ${intent.id} refunded.`,
            );
            results.skippedEnded++;
            continue;
          }
          if (holderChangedMidRun) {
            console.log(
              `[charge-recurring-visits] ${visitDate} on series ${parent.id} changed hands before it was booked; charge ${intent.id} refunded.`,
            );
            results.skippedUnfilled++;
            continue;
          }
          fail(
            `series ${parent.id} ${visitDate}: visit insert failed after charge ${intent.id} (${childErr?.message ?? "no row returned"})`,
          );
          continue;
        }

        // Q210(b): the on-session payment now backs a visit.
        if (paidRow) {
          (await settleVisitPayment(supabase, paidRow.id, "funded", String(child.id))).forEach(fail);
        }

        // ME-014: the charge stands and the visit exists, so the tax collected
        // on it is owed. Commit it to Stripe Tax's filing reports. Idempotent on
        // the intent; a failure is a defect (calculations expire ~90 days).
        if (taxCalculationId && taxCents > 0) {
          try {
            await stripe.tax.transactions.createFromCalculation(
              { calculation: taxCalculationId, reference: intent.id },
              { idempotencyKey: `recurring-visit-tax:${intent.id}` },
            );
          } catch (e) {
            fail(
              `series ${parent.id} ${visitDate}: tax transaction not recorded for ${intent.id} (calculation ${taxCalculationId}): ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }

        // The helper needs an application row for the same reason a direct
        // offer does: earnings, reviews and the completion flow all join
        // through it. ON CONFLICT because a helper who happened to apply
        // separately must not collide with the unique (job_id, helper_id).
        // The error was being dropped here, on the row the comment above calls
        // load-bearing. Without an `applications` row the helper's Activity tab
        // never lists the visit (`fetchAppliedActivity` reads jobs THROUGH their
        // applications), so the helper is booked and charged-for but the job is
        // invisible to them — and the money is already in escrow, so nothing
        // downstream ever notices. Refunding is wrong (the visit is real and the
        // helper is committed); the correct outcome is a loud, actionable defect
        // on a run that otherwise reports `ok: true`.
        //
        // `.select("id")` because a null `error` is not evidence the row
        // landed — `applications.id` is a real column (verified against prod
        // 2026-09-01: `applications?select=id` → 200). A zero-row result is
        // the same defect as an error and is handled by the same branch.
        const { data: appRows, error: appErr } = await supabase.from("applications").upsert(
          { job_id: child.id, helper_id: holderId, status: "accepted", message: null },
          { onConflict: "job_id,helper_id" },
        ).select("id");
        if (appErr || !appRows || appRows.length === 0) {
          console.error(
            `[charge-recurring-visits] application row failed for visit ${child.id} (series ${parent.id}, ${visitDate})`,
            appErr ?? "upsert matched zero rows",
          );
          fail(
            `series ${parent.id} ${visitDate}: visit ${child.id} has no application row (${appErr?.message ?? "upsert returned zero rows"})`,
          );
          await postSlackOpsAlert({
            kind: "custom",
            severity: "critical",
            title: "Recurring visit created without its application row",
            message:
              "The visit is funded and assigned, but the helper has no application row — it will not appear in their Activity tab and the completion flow cannot resolve it. Insert the row by hand.",
            fields: {
              parentJobId: String(parent.id),
              visitJobId: String(child.id),
              helperId: String(holderId),
              visitDate,
              error: appErr?.message ?? "upsert returned zero rows",
            },
          });
        }

        const bookingRows = [
          {
            user_id: holderId,
            job_id: child.id,
            title: "Your next visit is booked",
            message: `"${parent.title}" on ${visitDate} is confirmed and paid. Can't make it? Cancel this visit from My Jobs.`,
            type: "job_updates",
            // THIS visit, not the My Jobs default bucket — a confirmed booking
            // is `scheduled`, and /jobs opens on "Needs you".
            link: `/jobs?job=${child.id}`,
          },
          {
            user_id: parent.customer_id,
            job_id: child.id,
            title: "Next visit funded",
            message: `"${parent.title}" on ${visitDate} is booked and held in escrow.`,
            type: "job_updates",
            link: `/posts?job=${child.id}`,
          },
        ];
        // Q158: a seed (test) series never notifies a REAL party. The
        // notifications BEFORE INSERT trigger (Q137) drops that row, so a seed
        // series with one real party inserts only the seed party's row BY DESIGN — which the
        // count below read as a failed write and paged Slack for, every night.
        // Ask the trigger's own question first (same function, same
        // user_id / job_id / link) and expect only the rows it allows. A check
        // that cannot answer is a defect in its own right: it is counted, and
        // the row is still offered to the trigger, which decides.
        const toSend: typeof bookingRows = [];
        let expected = 0;
        for (const row of bookingRows) {
          const { data: crossesSeed, error: seedErr } = await supabase.rpc(
            "notification_crosses_seed_boundary",
            { p_recipient: row.user_id, p_job_id: row.job_id, p_link: row.link },
          );
          if (seedErr || typeof crossesSeed !== "boolean") {
            fail(
              `series ${parent.id} ${visitDate}: seed boundary check failed for visit ${child.id} (${seedErr?.message ?? "no boolean answer"})`,
            );
            toSend.push(row);
            continue;
          }
          if (crossesSeed === true) {
            console.log(
              `[charge-recurring-visits] visit ${child.id}: not notifying ${row.user_id} (seed series, real recipient; Q137)`,
            );
            continue;
          }
          toSend.push(row);
          expected++;
        }

        // `.select("id")` for the same reason as the application row above:
        // `notifications.id` exists (verified against prod 2026-09-01), and a
        // silently-zero-row insert is the exact failure this notification is
        // here to prevent — a booked date nobody was told about.
        if (toSend.length > 0) {
          const { data: notifyRows, error: notifyErr } = await supabase.from("notifications").insert(toSend).select("id");
          // Not fatal to the VISIT — it exists and is funded either way — but the
          // whole reason the helper's copy was added is that a booked date they
          // are not told about is a date they do not show up for. A silently
          // dropped insert reproduces exactly that. It was logged and then left
          // out of every counter, so the run still answered `200 ok:true` and the
          // console line was the only trace. It is a failed DB write on a money
          // path: a defect, and it is now counted like one.
          if (notifyErr || !notifyRows || notifyRows.length < expected) {
            console.error(
              `[charge-recurring-visits] booking notifications failed for visit ${child.id} (series ${parent.id}, ${visitDate})`,
              notifyErr ?? `inserted ${notifyRows?.length ?? 0} of ${expected} rows`,
            );
            fail(
              `series ${parent.id} ${visitDate}: booking notifications not delivered for visit ${child.id} (${notifyErr?.message ?? `inserted ${notifyRows?.length ?? 0} of ${expected}`})`,
            );
          }
        }

        results.funded++;
      }
    } catch (e) {
      console.error(`[charge-recurring-visits] series ${parent.id} failed`, e);
      fail(`series ${parent.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (defects.count > 0 || results.declined > 0) {
    await postSlackOpsAlert({
      kind: "custom",
      severity: defects.count > 0 ? "warning" : "info",
      title: "Recurring visit funding had failures",
      message: "Some recurring visits were not funded — declined cards produce no visit, so those posters have a gap in their schedule.",
      fields: {
        ...results,
        capped: results.capped ? "yes" : "no",
        defects: defects.count,
        firstDefect: defects.reasons[0] ?? "",
      },
    });
  }

  // The defect tracker, not `results.errors`, decides the status code.
  //
  // `results.errors` already excluded declines — this function separated the
  // two from the start — so it was defects-only in the sense cron-result means.
  // What it could not express were the two RUN-level defects: a capped run and
  // an incomplete series scan. Both dropped work and both used to answer
  // `200 ok:true`, which is precisely the shape `_shared/cron-result.ts` exists
  // to stop. `fail()` keeps the two in step, and the reasons ride along so the
  // sweep's alert says WHICH visit and WHY, not just "500".
  //
  // A declined card is still not a defect and still must never page: it is an
  // outcome, it will "fail" the same way tomorrow, and it has its own counter.
  return cronResult(
    "charge-recurring-visits",
    {
      dryRun,
      today,
      horizon,
      ...results,
      // The scan's own numbers, so a shortfall is legible as a measured fact
      // rather than an inference: "read 1000 of 1675" is actionable.
      seriesScanned: seriesScan.rows.length,
      seriesTotal: seriesScan.total,
      seriesScanComplete: seriesScan.complete,
    },
    defects.defects,
    corsHeaders,
  );
});

/**
 * Which of `ids` are suspended or banned RIGHT NOW: the same predicate as
 * public.is_caller_banned() (a temp ban counts until auto_suspended_until).
 * `error` is set when the answer cannot be read; the caller fails closed.
 */
async function bannedAmong(
  supabase: AdminClient,
  ids: string[],
): Promise<{ ids: Set<string>; error: string | null }> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return { ids: new Set(), error: null };
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, ban_status, auto_suspended_until")
    .in("user_id", wanted);
  if (error) return { ids: new Set(), error: error.message };
  const now = Date.now();
  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ user_id: string; ban_status: string | null; auto_suspended_until: string | null }>) {
    const status = row.ban_status ?? "";
    if (!["banned", "temp_banned", "permanently_banned"].includes(status)) continue;
    if (status === "temp_banned" && row.auto_suspended_until && Date.parse(row.auto_suspended_until) <= now) continue;
    out.add(row.user_id);
  }
  return { ids: out, error: null };
}

/**
 * A declined card means no visit. Say so while there is still time to fix it —
 * FUND_LEAD_DAYS is chosen so this notification lands before the helper would
 * have turned up.
 *
 * BOTH SIDES GET TOLD. This used to notify only the poster, and the asymmetry
 * had a physical cost: the standing helper's whole reason for holding a series
 * is that the date is theirs and they do not have to check. When the card
 * declined, the visit was silently never created — no job row, no
 * notification, nothing on their schedule that changed — so the first thing
 * they learned about it was standing on a doorstep at 8am. The helper is the
 * one person in this transaction who has to physically GO somewhere, and they
 * were the one person not informed.
 *
 * The helper's copy deliberately does not say "your poster's card was
 * declined": that is the poster's private billing detail, and the helper only
 * needs the operative fact — this date is not booked, do not go, and it may
 * come back if the poster fixes it (the next daily run re-tries any date still
 * inside FUND_LEAD_DAYS).
 *
 * RETURNS ITS OWN FAILURES. A decline is an OUTCOME and must never page — it
 * has its own counter and it will "fail" the same way tomorrow. But a
 * notification INSERT that does not land is a defect, and it is the defect that
 * matters most on this path: the entire purpose of these two rows is that
 * neither party discovers the gap by turning up. Both writes used to be
 * console.error and nothing else, on a run answering `ok: true`. The reasons
 * are handed back so the caller records them without conflating them with the
 * decline itself.
 */
async function notifyPosterCardProblem(
  supabase: AdminClient,
  parent: Record<string, unknown>,
  holderId: string | null,
  visitDate: string,
  reason: string,
  /**
   * "held": money for this visit is held but it could not be booked safely
   * (Q1337 / Q750 review): the poster's card did nothing wrong, so they are
   * told the visit is being checked, not to update their card.
   */
  cause: "card" | "held" = "card",
): Promise<string[]> {
  console.warn(`[charge-recurring-visits] no visit for ${parent.id} on ${visitDate}: ${reason}`);
  const failures: string[] = [];

  // `.select("id")` on both inserts: a null `error` is not evidence the row
  // landed, and `notifications.id` is a real column (verified against prod
  // 2026-09-01: `notifications?select=id` → 200).
  // `job_id: parent.id` is the SUBJECT (Q139): the Q137 seed boundary reads it,
  // so a seed series never notifies a real party. A zero-row insert it dropped
  // BY DESIGN is not a failure (same rule as the booking rows above, Q158).
  const posterLink = cause === "held" ? "/posts" : "/profile?tab=payment";
  const { data: posterRows, error } = await supabase.from("notifications").insert({
    user_id: parent.customer_id,
    job_id: parent.id,
    title: cause === "held" ? "Your next visit isn't booked yet" : "We couldn't charge for your next visit",
    message: cause === "held"
      ? `"${parent.title}" on ${visitDate} isn't booked yet: we're checking the payment for it by hand. You won't be charged twice, and we'll let you know when it's sorted.`
      : `"${parent.title}" on ${visitDate} wasn't booked because the payment didn't go through. Update your card and we'll pick the series back up.`,
    type: "job_updates",
    link: posterLink,
  }).select("id");
  if (
    error || !posterRows ||
    (posterRows.length === 0 &&
      (await seedBoundaryDropsRow(supabase, {
        user_id: parent.customer_id as string,
        job_id: parent.id as string,
        link: posterLink,
      })) !== true)
  ) {
    console.error("[charge-recurring-visits] poster notification failed", error ?? "zero rows");
    failures.push(
      `series ${parent.id} ${visitDate}: poster was not told the charge failed (${error?.message ?? "insert returned zero rows"})`,
    );
  }

  // The Helpr who HOLDS this date (series_visit_holds) is the one who would
  // have gone; the cron only reaches a charge for a held date, so this is
  // belt-and-braces.
  const helperId = holderId;
  if (!helperId) return failures;
  const { data: helperRows, error: helperErr } = await supabase.from("notifications").insert({
    user_id: helperId,
    job_id: parent.id,
    title: "Your next visit isn't booked",
    message: `"${parent.title}" on ${visitDate} couldn't be set up, so it's not on your schedule — please don't head out for it. We'll let you know if it gets booked.`,
    type: "job_updates",
    // The series parent — there is no child job for a visit that was never
    // created. If the helper has no card for it, Activity leaves the view on
    // its default rather than pinning an empty bucket.
    link: `/jobs?job=${parent.id}`,
  }).select("id");
  if (
    helperErr || !helperRows ||
    (helperRows.length === 0 &&
      (await seedBoundaryDropsRow(supabase, { user_id: helperId, job_id: parent.id as string, link: `/jobs?job=${parent.id}` })) !== true)
  ) {
    console.error("[charge-recurring-visits] helper notification failed", helperErr ?? "zero rows");
    failures.push(
      `series ${parent.id} ${visitDate}: standing Helpr was not told the visit is unbooked (${helperErr?.message ?? "insert returned zero rows"})`,
    );
  }

  return failures;
}

// ── Q210(b): on-session payment for $300+ visits ─────────────────────────────

type VisitPaymentRow = {
  id: string;
  visit_date: string;
  status: string;
  budget_cents: number;
  fee_cents: number;
  tax_cents: number;
  amount_cents: number;
  fee_percent: number | string;
  tax_calculation_id: string | null;
  stripe_payment_intent_id: string | null;
};

/** paid -> funded/refunded. Conditional on 'paid' so two runs cannot both settle. */
async function settleVisitPayment(
  supabase: AdminClient,
  id: string,
  status: "funded" | "refunded",
  childJobId: string | null,
): Promise<string[]> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (childJobId) patch.child_job_id = childJobId;
  const { data, error } = await supabase
    .from("recurring_visit_payments")
    .update(patch)
    .eq("id", id)
    .eq("status", "paid")
    .select("id");
  if (error || !data || data.length === 0) {
    return [`visit payment ${id}: could not mark ${status} (${error?.message ?? "zero rows"})`];
  }
  return [];
}

/**
 * A visit costing THREE_D_SECURE_MIN_CENTS or more is never charged off-session
 * (owner, 2026-09-27): 3DS needs the payer present. Park it as a pending
 * payment and tell the payer to pay it on-session.
 */
async function parkForOnSessionPayment(
  supabase: AdminClient,
  parent: Record<string, unknown>,
  v: {
    visitDate: string;
    holdId: string;
    holderId: string | null;
    budgetCents: number;
    feeCents: number;
    taxCents: number;
    feePercent: number;
    taxCalculationId: string | null;
  },
): Promise<{ parked: boolean; failures: string[] }> {
  const failures: string[] = [];
  const amountCents = v.budgetCents + v.feeCents + v.taxCents;
  const { data, error } = await supabase.from("recurring_visit_payments").insert({
    parent_job_id: parent.id,
    visit_date: v.visitDate,
    hold_id: v.holdId,
    payer_id: parent.customer_id,
    helper_id: v.holderId,
    budget_cents: v.budgetCents,
    fee_cents: v.feeCents,
    tax_cents: v.taxCents,
    amount_cents: amountCents,
    fee_percent: v.feePercent,
    tax_calculation_id: v.taxCalculationId,
    status: "pending",
  }).select("id");
  if (error) {
    // A live row already exists for this date: another run parked it first.
    if ((error as { code?: string }).code === "23505") return { parked: true, failures };
    failures.push(`series ${parent.id} ${v.visitDate}: could not park $300+ visit for on-session payment (${error.message})`);
    return { parked: false, failures };
  }
  if (!data || data.length === 0) {
    failures.push(`series ${parent.id} ${v.visitDate}: parking the $300+ visit returned zero rows`);
    return { parked: false, failures };
  }

  const dollars = (amountCents / 100).toFixed(2);
  const { data: rows, error: nErr } = await supabase.from("notifications").insert({
    user_id: parent.customer_id,
    job_id: parent.id,
    title: "Tap to pay for your next visit",
    message: `"${parent.title}" on ${v.visitDate} is $${dollars}. Payments this size need you to confirm them, so tap to pay and we'll book the visit.`,
    type: "job_updates",
    link: "/posts",
  }).select("id");
  if (
    nErr || !rows ||
    (rows.length === 0 &&
      (await seedBoundaryDropsRow(supabase, {
        user_id: parent.customer_id as string,
        job_id: parent.id as string,
        link: "/posts",
      })) !== true)
  ) {
    failures.push(`series ${parent.id} ${v.visitDate}: payer was not told to pay the visit (${nErr?.message ?? "zero rows"})`);
  }
  return { parked: true, failures };
}
