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

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
// Separate `import type` line on purpose: src/test/edge/harness.ts rewrites
// this exact form when it bundles the function for vitest.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import {
  DEFAULT_TIER_FEE_PERCENT,
  getHelperFeePercent,
  helperCommissionDollars,
} from "../_shared/helperFees.ts";
import { posterFeePercentForTier, posterServiceFeeCents } from "../_shared/posterFees.ts";
import { isLaborTaxable } from "../_shared/salesTax.ts";
import { recurringVisitDates } from "../_shared/recurringSchedule.ts";
import { cronResult, defectTracker } from "../_shared/cron-result.ts";
import { scanAll, scanDefect } from "../_shared/paginate.ts";

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

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Stripe customer records scanned per poster, and how many card lookups run at
 * once.
 *
 * One email can own many customer records (Stripe does not treat the address as
 * a key and this app resolves by email at every entry point), and only one of
 * them holds the card — so the scan below has to be able to reach the far end
 * of the list. But the lookups are network calls inside a loop that already
 * runs up to MAX_CHARGES_PER_RUN times, and a hundred SEQUENTIAL round-trips is
 * how a run walks into the platform's wall-clock limit. A killed invocation
 * answers nothing at all: no status, no `defects`, nothing for the sweep to
 * page on — the one failure shape this file exists to eliminate.
 *
 * So they go out in parallel batches instead: ten at a time, stopping at the
 * first batch containing a card. Worst case is 10 round-trips of latency
 * instead of 100, the batch size keeps it well clear of Stripe's rate limit,
 * and the winner is still the first record IN LIST ORDER, so the choice stays
 * deterministic.
 */
const MAX_CUSTOMER_RECORDS = 100;
const CUSTOMER_LOOKUP_BATCH = 10;

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
  );
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2025-08-27.basil",
  });

  const today = todayUtc();
  const horizon = addDays(today, FUND_LEAD_DAYS);

  const results = {
    seriesConsidered: 0,
    funded: 0,
    skippedReleased: 0,
    skippedExisting: 0,
    declined: 0,
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

  // Active series: a day-set, a standing helper, and not cancelled. No standing
  // helper means nobody has accepted the first visit yet — there is nothing to
  // fund, because we never charge for a visit nobody is committed to.
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
  const seriesScan = await scanAll<SeriesRow>("recurring series", (countOpt) =>
    supabase
      .from("jobs")
      .select(
        "id, customer_id, business_id, title, description, category, budget, start_time, location, parish, zip_code, latitude, longitude, estimated_hours, special_requirements, photos, is_flexible_schedule, date_needed, recurrence_days, recurrence_weeks, recurring_helper_id, status",
        countOpt,
      )
      // Offset paging over an unordered result is sampling, not paging.
      .order("id", { ascending: true })
      .gte("date_needed", addDays(today, -SERIES_LOOKBACK_DAYS))
      .not("recurrence_days", "is", null)
      .not("recurring_helper_id", "is", null)
      .is("parent_job_id", null)
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
      .not("status", "in", "(cancelled,disputed)"));

  const seriesDefect = scanDefect("recurring series", seriesScan);
  if (seriesDefect) {
    console.error(`[charge-recurring-visits] ${seriesDefect}`);
    fail(seriesDefect);
  }
  const series = seriesScan.rows;

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
      const due = dates.filter((d) => d > parentDate && d > today && d <= horizon);
      if (due.length === 0) continue;

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
      //   `released`  empty means "the helper gave up no dates". Wrong, and the
      //               cost is physical: the poster is charged and a helper is
      //               booked onto a date they explicitly released. Somebody
      //               drives to a house on a morning they said they could not
      //               work.
      //
      // Neither read has a safe default, so there is no "carry on carefully"
      // option — the only correct move on a failed read is to fund nothing for
      // this series this run and say so. A skipped series is recoverable: the
      // date stays inside FUND_LEAD_DAYS for up to two more daily runs. A
      // wrongly-charged visit is not.
      const [existingRes, releasedRes] = await Promise.all([
        supabase.from("jobs").select("date_needed").eq("parent_job_id", parent.id).in("date_needed", due),
        supabase
          .from("recurring_visit_releases")
          .select("visit_date")
          .eq("parent_job_id", parent.id)
          .in("visit_date", due),
      ]);
      if (existingRes.error) {
        console.error(
          `[charge-recurring-visits] existing-visit read failed for series ${parent.id}; skipping the series rather than risking a second charge`,
          existingRes.error,
        );
        fail(`series ${parent.id}: existing-visit read failed (${existingRes.error.message})`);
        continue;
      }
      if (releasedRes.error) {
        console.error(
          `[charge-recurring-visits] release read failed for series ${parent.id}; skipping the series rather than booking a released date`,
          releasedRes.error,
        );
        fail(`series ${parent.id}: release read failed (${releasedRes.error.message})`);
        continue;
      }
      const alreadyThere = new Set(
        ((existingRes.data ?? []) as Array<{ date_needed: string }>).map((r) => r.date_needed),
      );
      const releasedDates = new Set(
        ((releasedRes.data ?? []) as Array<{ visit_date: string }>).map((r) => r.visit_date),
      );

      for (const visitDate of due) {
        if (alreadyThere.has(visitDate)) { results.skippedExisting++; continue; }
        if (releasedDates.has(visitDate)) {
          // The standing helper gave this date up. We do NOT charge and do NOT
          // post it: nobody is committed to it, and funding a visit on the hope
          // a stranger takes it is how the poster ends up paying for work that
          // never happened. The poster was told when it was released.
          results.skippedReleased++;
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
          // still produce accurate skippedExisting/skippedReleased counts, and
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

        // ── What this visit costs ──────────────────────────────────────────
        const budgetCents = Math.round(Number(parent.budget) * 100);

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

        const feePercent = posterFeePercentForTier(
          posterProfile.subscription_tier as string | null,
          posterProfile.subscription_expires_at as string | null,
        );
        // No urgent tip and no onboarding fee on a recurring visit: urgency is a
        // property of a one-off post, and onboarding is charged once per account
        // and was already paid on the first visit.
        const feeCents = posterServiceFeeCents(budgetCents, feePercent, 0);

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
        let taxCents = 0;
        if (isLaborTaxable(parent.category as string)) {
          try {
            const calc = await stripe.tax.calculations.create({
              currency: "usd",
              line_items: [{
                amount: budgetCents,
                reference: "labor",
                tax_behavior: "exclusive",
                tax_code: "txcd_20030000",
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

        const totalCents = budgetCents + feeCents + taxCents;

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
          parent.recurring_helper_id as string,
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
          Number(parent.budget),
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
        // ONE EMAIL, MANY STRIPE CUSTOMERS. Stripe does not treat the email as
        // a key: every checkout that did not explicitly reuse an existing
        // customer mints a new record, and this app resolves the customer by
        // email at every entry point rather than storing a
        // `stripe_customer_id`. So a poster who has checked out more than once
        // routinely holds several customer records on one address, and only
        // one of them carries the saved card.
        //
        // `customers.list({ limit: 1 })` picked ONE of those records with no
        // selection at all (the list is newest-first, so it favoured the most
        // recent — very often the empty one). When that record had no card the
        // run reported `no_saved_card`, told the poster their payment had a
        // problem, and did not create the visit — for a poster whose card was
        // saved and fine, on another record, all along. The same bug in
        // `pro-customer-portal` meant a paying member could not reach the
        // billing portal to cancel.
        //
        // So: scan the records and pick the one that actually HOLDS a card.
        // With a single customer record — the common case — this is byte-for-
        // byte the old behaviour: the same card on the same customer, or the
        // same `no_saved_card` decline. It only differs where the old code was
        // wrong.
        const customers = await stripe.customers.list({
          email: posterProfile.email as string,
          limit: MAX_CUSTOMER_RECORDS,
        });
        let customerId: string | undefined;
        let paymentMethodId: string | undefined;
        // Batched, not one-at-a-time — see MAX_CUSTOMER_RECORDS. The winner is
        // still the first record in list order, so this is only faster, never
        // a different card.
        for (let i = 0; i < customers.data.length && !customerId; i += CUSTOMER_LOOKUP_BATCH) {
          const batch = customers.data.slice(i, i + CUSTOMER_LOOKUP_BATCH);
          const cards: Array<string | undefined> = await Promise.all(
            batch.map(async (candidate: { id: string }) => {
              const methods = await stripe.paymentMethods.list({
                customer: candidate.id,
                type: "card",
                limit: 1,
              });
              return methods.data[0]?.id as string | undefined;
            }),
          );
          const hit = cards.findIndex((id: string | undefined) => !!id);
          if (hit >= 0) {
            customerId = batch[hit].id;
            paymentMethodId = cards[hit];
          }
        }

        if (!customerId || !paymentMethodId) {
          (await notifyPosterCardProblem(supabase, parent, visitDate, "no_saved_card")).forEach(fail);
          results.declined++;
          continue;
        }

        // ONE call site, but up to TWO attempts on the SAME key — see
        // `attemptVisitCharge`. A network fault here is not a decline.
        const outcome = await attemptVisitCharge(
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
              helper_id: String(parent.recurring_helper_id),
            },
          },
          // Keyed on (series, date) — the natural unique key for a visit.
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
          `recurring-visit:${parent.id}:${visitDate}`,
        );

        if (outcome.kind !== "ok") {
          console.error(
            `[charge-recurring-visits] charge ${outcome.kind} ${parent.id} ${visitDate}: ${outcome.message}`,
          );
          // The operative fact is the same either way and it is TRUE either way:
          // this date is not booked, so the helper must not head out for it. It
          // is the ops side that differs.
          (await notifyPosterCardProblem(supabase, parent, visitDate, outcome.message.slice(0, 120)))
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
                `Stripe did not answer for ${CHARGE_ATTEMPTS} attempts on one idempotency key, so a PaymentIntent may be holding this poster's money with no visit behind it. Check Stripe for key ${`recurring-visit:${parent.id}:${visitDate}`} BEFORE tomorrow's run, which will charge again on a fresh key.`,
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

        if (intent.status !== "succeeded") {
          (await notifyPosterCardProblem(supabase, parent, visitDate, `intent_${intent.status}`)).forEach(fail);
          results.declined++;
          continue;
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
            budget: parent.budget,
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
            // The standing helper holds it. Not 'open' — this visit is not up
            // for grabs, which is the entire point of booking a series.
            helper_id: parent.recurring_helper_id,
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
          try {
            await stripe.refunds.create(
              { payment_intent: intent.id },
              // Keyed on the INTENT, not on (series, date). Those are not the
              // same key across days: the window spans three runs and the
              // charge key expires after 24h, so one (series, date) can produce
              // more than one PaymentIntent. A (series, date) refund key would
              // then replay the FIRST refund's response for a completely
              // different intent — reporting a refund that never happened on
              // money still held. One key per intent is idempotent for the
              // retry it is actually protecting against and cannot collide.
              { idempotencyKey: `recurring-visit-refund:${intent.id}` },
            );
          } catch (refundErr) {
            await postSlackOpsAlert({
              kind: "custom",
              severity: "critical",
              title: "Recurring visit charged but not created, and the refund failed",
              message: `PaymentIntent ${intent.id} is holding a poster's money for a visit that was never created. Refund by hand.`,
              fields: { parentJobId: String(parent.id), visitDate, intent: intent.id, error: String(refundErr) },
            });
          }
          fail(
            `series ${parent.id} ${visitDate}: visit insert failed after charge ${intent.id} (${childErr?.message ?? "no row returned"})`,
          );
          continue;
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
          { job_id: child.id, helper_id: parent.recurring_helper_id, status: "accepted", message: null },
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
              helperId: String(parent.recurring_helper_id),
              visitDate,
              error: appErr?.message ?? "upsert returned zero rows",
            },
          });
        }

        // `.select("id")` for the same reason as the application row above:
        // `notifications.id` exists (verified against prod 2026-09-01), and a
        // silently-zero-row insert is the exact failure this notification is
        // here to prevent — a booked date nobody was told about.
        const { data: notifyRows, error: notifyErr } = await supabase.from("notifications").insert([
          {
            user_id: parent.recurring_helper_id,
            title: "Your next visit is booked",
            message: `"${parent.title}" on ${visitDate} is confirmed and paid. Can't make it? Release the date from My Jobs.`,
            type: "job_updates",
            // THIS visit, not the My Jobs default bucket — a confirmed booking
            // is `scheduled`, and /my-jobs opens on "Needs you".
            link: `/my-jobs?job=${child.id}`,
          },
          {
            user_id: parent.customer_id,
            title: "Next visit funded",
            message: `"${parent.title}" on ${visitDate} is booked and held in escrow.`,
            type: "job_updates",
            link: `/my-posts?job=${child.id}`,
          },
        ]).select("id");
        // Not fatal to the VISIT — it exists and is funded either way — but the
        // whole reason the helper's copy was added is that a booked date they
        // are not told about is a date they do not show up for. A silently
        // dropped insert reproduces exactly that. It was logged and then left
        // out of every counter, so the run still answered `200 ok:true` and the
        // console line was the only trace. It is a failed DB write on a money
        // path: a defect, and it is now counted like one.
        if (notifyErr || !notifyRows || notifyRows.length < 2) {
          console.error(
            `[charge-recurring-visits] booking notifications failed for visit ${child.id} (series ${parent.id}, ${visitDate})`,
            notifyErr ?? `inserted ${notifyRows?.length ?? 0} of 2 rows`,
          );
          fail(
            `series ${parent.id} ${visitDate}: booking notifications not delivered for visit ${child.id} (${notifyErr?.message ?? `inserted ${notifyRows?.length ?? 0} of 2`})`,
          );
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
  visitDate: string,
  reason: string,
): Promise<string[]> {
  console.warn(`[charge-recurring-visits] no visit for ${parent.id} on ${visitDate}: ${reason}`);
  const failures: string[] = [];

  // `.select("id")` on both inserts: a null `error` is not evidence the row
  // landed, and `notifications.id` is a real column (verified against prod
  // 2026-09-01: `notifications?select=id` → 200).
  const { data: posterRows, error } = await supabase.from("notifications").insert({
    user_id: parent.customer_id,
    title: "We couldn't charge for your next visit",
    message: `"${parent.title}" on ${visitDate} wasn't booked because the payment didn't go through. Update your card and we'll pick the series back up.`,
    type: "job_updates",
    link: "/profile?tab=payment",
  }).select("id");
  if (error || !posterRows || posterRows.length === 0) {
    console.error("[charge-recurring-visits] poster notification failed", error ?? "zero rows");
    failures.push(
      `series ${parent.id} ${visitDate}: poster was not told the charge failed (${error?.message ?? "insert returned zero rows"})`,
    );
  }

  // The standing helper is only known once the series has one. A parent with a
  // null `recurring_helper_id` is never selected by this cron at all
  // (`.not("recurring_helper_id", "is", null)`), so this is belt-and-braces.
  const helperId = parent.recurring_helper_id as string | null | undefined;
  if (!helperId) return failures;
  const { data: helperRows, error: helperErr } = await supabase.from("notifications").insert({
    user_id: helperId,
    title: "Your next visit isn't booked",
    message: `"${parent.title}" on ${visitDate} couldn't be set up, so it's not on your schedule — please don't head out for it. We'll let you know if it gets booked.`,
    type: "job_updates",
    // The series parent — there is no child job for a visit that was never
    // created. If the helper has no card for it, Activity leaves the view on
    // its default rather than pinning an empty bucket.
    link: `/my-jobs?job=${parent.id}`,
  }).select("id");
  if (helperErr || !helperRows || helperRows.length === 0) {
    console.error("[charge-recurring-visits] helper notification failed", helperErr ?? "zero rows");
    failures.push(
      `series ${parent.id} ${visitDate}: standing helper was not told the visit is unbooked (${helperErr?.message ?? "insert returned zero rows"})`,
    );
  }

  return failures;
}
