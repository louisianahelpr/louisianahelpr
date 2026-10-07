/**
 * Unit tests for the `charge-recurring-visits` Supabase edge function — the
 * daily cron that funds the next visits of a recurring series by charging the
 * poster's saved card off-session, then creates the job row.
 *
 * Q210(b): a visit of $300 or more is never charged off-session; it is parked
 * for the payer to pay on-session. Each mutation below restores the old
 * behaviour and must turn this file red.
 * @mutate supabase/functions/charge-recurring-visits/index.ts | if (!paidRow && totalCents >= THREE_D_SECURE_MIN_CENTS && prior.kind !== "adopt") { | if (false) {
 * @mutate supabase/functions/charge-recurring-visits/index.ts | if (visitPayment?.status === "pending") { | if (false) {
 *
 * This function moves REAL MONEY with nobody present, so the tests below are
 * organised around the four ways it can move it WRONGLY, each of which was live
 * in the source before this pass:
 *
 *   1. A dropped Supabase `error` on a pre-flight read. An errored read
 *      produced `data: null`, which collapsed to an empty Set. It was the
 *      `recurring_visit_releases` read; since 20260927012806 the per-date
 *      HOLDER comes from `series_visit_holds` (a date nobody holds is not
 *      charged), and a failed holds read skips the series as a defect.
 *
 *   2. An unbounded, unordered series scan. PostgREST caps a read at
 *      `db-max-rows = 1000` AFTER the ORDER BY (measured against prod
 *      2026-09-01: `notifications?select=id&limit=5000` →
 *      `content-range: 0-999/1675`), so an unordered unbounded read is "some
 *      1000 series" and the rest are never funded, silently.
 *
 *   3. The 24-hour life of a Stripe idempotency key versus a THREE-RUN funding
 *      window. A visit sits inside `FUND_LEAD_DAYS = 3` for three daily runs;
 *      the key that makes the charge idempotent expires after one day. So the
 *      "23505 means we already hold the winner's PaymentIntent, don't refund"
 *      reasoning holds only within a day, and across days it left a poster
 *      charged twice with no refund and no alert.
 *
 *   4. `capped: true` riding in the body of a `200 ok:true` response — the one
 *      signal that says "visits this run meant to fund were dropped, and their
 *      window does not reopen" was the one signal nothing was watching.
 *
 * Plus the arbitrary-Stripe-customer bug two sibling lanes found elsewhere:
 * `customers.list({ limit: 1 })` picked one of a poster's several customer
 * records with no selection at all. Q734 removed the email lookup altogether:
 * the card is the one the series' own checkout saved, read off its
 * PaymentIntent, or none (and the poster is told).
 *
 * Runs the REAL function source through the edge harness — no reimplementation.
 *
 * ── The calendar these tests live in ──────────────────────────────────────
 * Series parent `date_needed = 2026-08-28` (a Friday), `recurrence_days = [5]`,
 * `recurrence_weeks = 4`, so the series runs 08-28, 09-04, 09-11, 09-18.
 * `FUND_LEAD_DAYS = 3` puts the 09-04 visit in the window on exactly three
 * runs — 09-01, 09-02 and 09-03 — and out of it on 09-04 (`d > today` fails).
 * That is the three-day window finding 3 is about.
 */
//
// Registered mutations - each turns this guard RED on its own:
//   A per-call idempotency key means the retry after a no-answer failure is a
//   SECOND real charge instead of Stripe replaying the first.
// @mutate supabase/functions/charge-recurring-visits/index.ts | : `recurring-visit:${parent.id}:${visitDate}:${hold.id}`; | : `recurring-visit:${parent.id}:${visitDate}:${hold.id}:${Math.random()}`;
//   20260927012806: the cron charges a date nobody holds / books someone other than its holder.
// @mutate supabase/functions/charge-recurring-visits/index.ts |         if (!hold) { |         if (false && !hold) {
// @mutate supabase/functions/charge-recurring-visits/index.ts | payout follows helper_id.\n            helper_id: holderId, | payout follows helper_id.\n            helper_id: parent.recurring_helper_id,
// @mutate supabase/functions/charge-recurring-visits/index.ts |       if (holdsRes.error) { |       if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |           : `recurring-visit:${parent.id}:${visitDate}:${hold.id}`; |           : `recurring-visit:${parent.id}:${visitDate}`;
//   Money audit 2026-09-25: chargeback, pre-charge re-read, holder changed mid-run.
// @mutate supabase/functions/charge-recurring-visits/index.ts |       if ((chargebackRes.data ?? []).length > 0) { |       if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |       if (parent.payment_status === "chargeback" \|\| parent.dispute_status === "stripe_chargeback") { |       if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |         if ((liveParent.data as { series_ended_on: string \| null }).series_ended_on) { |         if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |         if (!nowHold \|\| nowHold.id !== hold.id \|\| nowHold.helper_id !== holderId) { |         if (!nowHold) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |           if (holderChangedMidRun) { |           if (false) {
//   Q347: the cron books and charges across a block.
// @mutate supabase/functions/charge-recurring-visits/index.ts |         if (blocked === true) blockedHolders.add(helperId); |         if (false) blockedHolders.add(helperId);
//   Review 2026-09-25: the cron charges a banned poster / books a banned Helpr.
// @mutate supabase/functions/charge-recurring-visits/index.ts |       if (banned.ids.has(parent.customer_id as string)) { |       if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |         if (banned.ids.has(holderId)) { |         if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |       if (banned.error) { |       if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |     if (status === "temp_banned" && row.auto_suspended_until && Date.parse(row.auto_suspended_until) <= now) continue; |     if (false) continue;
//   Q347: an unknown block answer books anyway.
// @mutate supabase/functions/charge-recurring-visits/index.ts | if (blockErr) { | if (false) {
//   ME-014: tax charged on a visit never reaches Stripe Tax's filing reports.
// @mutate supabase/functions/charge-recurring-visits/index.ts |         if (taxCalculationId && taxCents > 0) { |         if (false) {
//   ME-014: the fee floor ignores the tax on the same charge.
// @mutate supabase/functions/charge-recurring-visits/index.ts | posterServiceFeeCents(budgetCents, feePercent, taxCents); | posterServiceFeeCents(budgetCents, feePercent, 0);
// Ended series: dropping the ended check funds a gap (or any date) after the series ended.
// @mutate supabase/functions/charge-recurring-visits/index.ts |       if (parent.series_ended_on) { |       if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts | Can't make it? Cancel this visit from My Jobs. | Can't make it? Release the date from My Jobs.
// Q415 (e): the mid-run refunds withhold Stripe's fee; a platform failure does not.
// @mutate supabase/functions/charge-recurring-visits/index.ts |             if (seriesEndedMidRun \|\| holderChangedMidRun) { |             if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |             if (seriesEndedMidRun \|\| holderChangedMidRun) { |             if (true) {
// @mutate supabase/functions/charge-recurring-visits/index.ts | const refundCents = Math.max(0, captured - actualOrEstimatedFeeCents(pi, captured)); | const refundCents = captured;
// @mutate supabase/functions/charge-recurring-visits/index.ts |             if (refundParams.amount !== 0) ({ alreadyRefunded } = await createRefundOnce( |             ({ alreadyRefunded } = await createRefundOnce(
// @mutate supabase/functions/charge-recurring-visits/index.ts |     if (!prior.data.some((r: Stripe.Refund) => r.status !== "failed" && r.status !== "canceled")) throw e; |     return;
// @mutate supabase/functions/charge-recurring-visits/index.ts |     if (type !== "StripeIdempotencyError" && type !== "idempotency_error" && code !== "charge_already_refunded") throw e; |     throw e;
// Q750 (3): Stripe's "charge_already_refunded" (past the 24h key) is a failed refund again.
// @mutate supabase/functions/charge-recurring-visits/index.ts |  && code !== "charge_already_refunded") throw e; | ) throw e;
// @mutate supabase/functions/charge-recurring-visits/index.ts | if (refundParams.amount !== undefined && !alreadyRefunded && parent.customer_id) { | if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts | if (refundParams.amount !== undefined && !alreadyRefunded && parent.customer_id) { | if (refundParams.amount !== undefined && parent.customer_id) {
// @mutate supabase/functions/charge-recurring-visits/index.ts | let capturedCents = paidRow ? paidRow.amount_cents : totalCents; | let capturedCents = NaN;
// @mutate supabase/functions/charge-recurring-visits/index.ts |   if (!(Number.isFinite(captured) && captured > 0 && Number.isFinite(refundCents))) { |   if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |               refundParams.metadata = { fee_withheld: "true" }; |               refundParams.metadata = undefined;
// @mutate supabase/functions/charge-recurring-visits/index.ts | We refunded $${(refundedCents / 100).toFixed(2)} | We refunded $${(intent.amount / 100).toFixed(2)}
// @mutate supabase/functions/charge-recurring-visits/index.ts |               fail(`series ${parent.id} ${visitDate}: poster was not told of the fee-withheld refund | console.log(`series ${parent.id} ${visitDate}: poster was not told of the fee-withheld refund
// @mutate supabase/functions/charge-recurring-visits/index.ts |         if (live.length > 0) { |         if (false) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |  \|\| refunded >= lessFeeCents) { |  \|\| true) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |  \|\| refunded >= lessFeeCents) { |  \|\| refunded >= owedCents) {
// @mutate supabase/functions/charge-recurring-visits/index.ts |           refundParams = { payment_intent: pi, amount: owedCents, metadata: { fee_withheld: "true" } };\n        }\n        const prior |         }\n        const prior
// @mutate supabase/functions/charge-recurring-visits/index.ts | const withholdFee = piObj?.metadata?.refund_withhold_fee === "true" \|\| seriesEndedCause \|\| dateUnheldCause; | const withholdFee = false;
// @mutate supabase/functions/charge-recurring-visits/index.ts | const withholdFee = piObj?.metadata?.refund_withhold_fee === "true" \|\| | const withholdFee =
// @mutate supabase/functions/charge-recurring-visits/index.ts | const owedCents = withholdFee ? lessFeeCents : amountCents; | const owedCents = amountCents;
// @mutate supabase/functions/charge-recurring-visits/index.ts | await stripe.paymentIntents.update(intent.id, { metadata: { refund_withhold_fee: "true" } }); | void 0;
// @mutate supabase/functions/charge-recurring-visits/index.ts | Refund ${pi} by hand: ${\n            refundParams.amount === undefined ? | Refund ${pi} by hand: ${\n            refundParams.amount !== undefined ?
// @mutate supabase/functions/charge-recurring-visits/index.ts | const kept = refundParams.amount !== undefined; | const kept = false;
// @mutate supabase/functions/charge-recurring-visits/index.ts |           continue;\n        }\n        const withholdFee | \n        }\n        const withholdFee
// @mutate supabase/functions/charge-recurring-visits/index.ts | const live = prior.data.filter((r: Stripe.Refund) => r.status !== "failed" && r.status !== "canceled"); | const live = prior.data;
// Ended mid-run: a refunded series_ended refusal is reported as a defect (red run for a designed outcome).
// @mutate supabase/functions/charge-recurring-visits/index.ts |           if (seriesEndedMidRun) { |           if (false) {
// Q808: a pre-read skip of a paid visit (ended series / unheld date) refunds in full again.
// @mutate supabase/functions/charge-recurring-visits/index.ts | === "true" \|\| seriesEndedCause \|\| dateUnheldCause; | === "true" \|\| dateUnheldCause;
// @mutate supabase/functions/charge-recurring-visits/index.ts | === "true" \|\| seriesEndedCause \|\| dateUnheldCause; | === "true" \|\| seriesEndedCause;
// Q808 review: a date that changed hands to ANOTHER Helpr refunds in full again.
// @mutate supabase/functions/charge-recurring-visits/index.ts | !nowHolder \|\| (row.helper_id != null && nowHolder.helper_id !== row.helper_id); | !nowHolder;
// Q808 review: the same Helpr still holding the date withholds the fee.
// @mutate supabase/functions/charge-recurring-visits/index.ts | nowHolder.helper_id !== row.helper_id); | nowHolder.helper_id === row.helper_id);
// Q808: an unreadable cause is guessed instead of retried.
// @mutate supabase/functions/charge-recurring-visits/index.ts |       if (causeParent.error \|\| causeHold.error) { |       if (false) {
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type TableResult } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import { testModeUnderLiveKey, captureTestModeSkips } from "../helpers/testModeUnderLiveKey";

const CRON_SECRET = "cron-secret";

const PARENT_ID = "series-1";
const HELPER_ID = "helper-1";
const POSTER_ID = "poster-1";
/** The visit these tests follow through its three-run funding window. */
const VISIT_DATE = "2026-09-04";
/** The instant most runs pin the clock to (runOn(fn, "2026-09-01")). */
const RUN_NOW = new Date("2026-09-01T06:00:00Z");
/** The claim of VISIT_DATE by HELPER_ID (series_visit_holds.id). */
const HOLD_ID = "hold-1";
/** `recurring-visit:<series>:<date>:<claim>` — the key whose reach is 24h, not 3 days. */
const CHARGE_KEY = `recurring-visit:${PARENT_ID}:${VISIT_DATE}:${HOLD_ID}`;

/**
 * The series' own checkout PaymentIntent (Q734): the one place the run may take
 * the card from. `jobs.stripe_payment_intent_id` on the parent.
 */
const SERIES_PI = "pi_series_checkout";
/** What Stripe says about SERIES_PI: a checkout that saved the card off-session. */
function seriesCheckoutIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: SERIES_PI,
    status: "succeeded",
    setup_future_usage: "off_session",
    customer: "cus_1",
    payment_method: "pm_1",
    ...overrides,
  };
}
/** `paymentIntents.retrieve` for SERIES_PI. */
const seriesPiRetrieve = vi.fn();
/** `paymentIntents.retrieve` for every other intent (the refund paths). */
const otherPiRetrieve = vi.fn();

/** A series parent that has exactly one due visit inside the window. */
function seriesParent(overrides: Record<string, unknown> = {}) {
  return {
    id: PARENT_ID,
    customer_id: POSTER_ID,
    business_id: null,
    title: "Weekly clean",
    description: "Kitchen and baths",
    // NOT a taxable category (see `_shared/salesTax.ts`): `stripe.tax`
    // is not part of the Stripe double, and the taxable branch is a separate
    // concern from everything under test here.
    category: "cleaning",
    budget: 100,
    start_time: "09:00:00",
    location: "123 Oak St",
    parish: "Orleans",
    zip_code: "70112",
    latitude: 29.95,
    longitude: -90.07,
    estimated_hours: 2,
    special_requirements: null,
    photos: null,
    is_flexible_schedule: false,
    // Relative to the pinned run date (2026-09-01), never the real clock: the
    // runs below freeze time there, so a real-clock offset aged into the
    // horizon and the whole file went red on 2026-09-27.
    date_needed: jobLocalDateISO(-23, RUN_NOW),
    recurrence_days: [5],
    recurrence_weeks: 4,
    recurring_helper_id: HELPER_ID,
    // The helper hired on visit one; the cron books recurring_helper_id only
    // when it IS this person (Q356).
    helper_id: HELPER_ID,
    status: "accepted",
    stripe_payment_intent_id: SERIES_PI,
    ...overrides,
  };
}

/**
 * A series whose every visit is in the past, so it is counted but never
 * charged. Used to bulk out the scan without firing 750 PaymentIntents.
 */
function inertSeries(id: string) {
  return seriesParent({
    id,
    date_needed: jobLocalDateISO(-50, RUN_NOW),
    recurrence_days: [6],
    recurrence_weeks: 1,
  });
}

/**
 * Wire `scenario.reads.jobs` for the THREE different reads this function makes
 * against `jobs`, which the mock can only tell apart by their column lists:
 *
 *   series scan     `... recurrence_days ...`        the paged parent scan
 *   winner lookup   `id, stripe_payment_intent_id`   the 23505 disambiguator
 *   existing visits `date_needed`                    the pre-flight duplicate guard
 *
 * Order matters — the first `includes` that appears in the column list wins,
 * and the series select also contains `date_needed`.
 */
function wireJobsReads(opts: {
  series: TableResult;
  existing?: TableResult;
  winner?: TableResult;
  chargeback?: TableResult;
  live?: TableResult;
  /** Q750: the end state of the series that have open future visit payments. */
  over?: TableResult;
}) {
  const firstSeries = (opts.series.rows ?? [])[0] as Record<string, unknown> | undefined;
  scenario.reads.jobs = {
    ...(opts.existing ?? { rows: [] }),
    selectOverrides: [
      { includes: "recurrence_days", result: opts.series },
      // After the series scan, whose column list also ends "…helper_id, status, series_ended_on…".
      { includes: "id, status, series_ended_on", result: opts.over ?? { rows: [] } },
      { includes: "stripe_payment_intent_id", result: opts.winner ?? { rows: [] } },
      // The chargeback check on the series' visits.
      { includes: "dispute_status", result: opts.chargeback ?? { rows: [] } },
      // The pre-charge re-read of the parent (money audit LOW-10).
      {
        includes: "id, series_ended_on",
        result: opts.live ?? { rows: [{ id: firstSeries?.id ?? PARENT_ID, series_ended_on: firstSeries?.series_ended_on ?? null }] },
      },
    ],
  };
}

/** Who holds which date (series_visit_holds). Default: HELPER_ID holds VISIT_DATE. */
function wireHolds(rows: Array<{ id: string; visit_date: string; helper_id: string }> | { error: { message: string; code: string } }) {
  scenario.reads.series_visit_holds = Array.isArray(rows) ? { rows } : rows;
}

/** The happy-path world: one due visit, no releases, a poster with one card. */
function seedHappyPath() {
  wireJobsReads({ series: { rows: [seriesParent()] } });
  wireHolds([{ id: HOLD_ID, visit_date: VISIT_DATE, helper_id: HELPER_ID }]);
  scenario.reads.profiles = {
    rows: [{ email: "poster@example.com", subscription_tier: null, subscription_expires_at: null }],
  };
  // The booking notification inserts TWO rows and now checks that two came
  // back; the mock's default single-row answer would read as a half-delivery.
  scenario.writeSelectRows.notifications = [{ id: "n1" }, { id: "n2" }];
  // Poster and standing helper are not blocked (Q347).
  scenario.rpc.are_users_blocked = false;

  seriesPiRetrieve.mockReset();
  otherPiRetrieve.mockReset();
  seriesPiRetrieve.mockResolvedValue(seriesCheckoutIntent());
  stripeMock.paymentIntents.retrieve.mockImplementation((id: string, ...rest: unknown[]) =>
    id === SERIES_PI ? seriesPiRetrieve(id, ...rest) : otherPiRetrieve(id, ...rest),
  );
  stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_day1", status: "succeeded" });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_1" });
  // The pre-booking refund check (Q750 review): the charge carries no refund.
  stripeMock.refunds.list.mockResolvedValue({ data: [] });
}

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SECRET_KEY: "sb_secret_test",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("charge-recurring-visits");
}

/**
 * Drive the function as the cron would, with the clock pinned to `ymd`.
 *
 * The clock is faked only AROUND the request: `loadEdgeFunction` cache-busts its
 * dynamic import with `Date.now()`, so a frozen clock there would hand every
 * load the same module URL, skip re-evaluation, and leave `serve()` uncalled.
 */
async function runOn(fn: EdgeHarness, ymd: string, opts: { dryRun?: boolean; at?: string; parentJobId?: string } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(opts.at ?? `${ymd}T06:00:00Z`));
  try {
    return await fn.fetch(
      fn.request({
        url: `https://edge.test/charge-recurring-visits${opts.dryRun ? "?dryRun=1" : opts.parentJobId ? `?parentJobId=${opts.parentJobId}` : ""}`,
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
  } finally {
    vi.useRealTimers();
  }
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

function reasons(b: Record<string, unknown>): string {
  return ((b.defectReasons as string[] | undefined) ?? []).join(" | ");
}

/** Every job row this run inserted. */
function insertedVisits() {
  return scenario.writes.filter((w) => w.table === "jobs" && w.op === "insert");
}

describe("charge-recurring-visits edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Baseline — a correct run is unchanged
  // ═══════════════════════════════════════════════════════════════════════

  it("funds the one due visit: charges once, then creates the job in escrow", async () => {
    const fn = await loadConfigured();
    seedHappyPath();

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.ok).toBe(true);
    expect(b.fn).toBe("charge-recurring-visits");
    expect(b.seriesConsidered).toBe(1);
    expect(b.funded).toBe(1);
    expect(b.declined).toBe(0);
    expect(b.errors).toBe(0);

    // ONE charge, for the total the poster's tier produces, keyed on the visit.
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [charge, chargeOpts] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(charge.off_session).toBe(true);
    expect(charge.confirm).toBe(true);
    expect(charge.metadata).toMatchObject({
      type: "recurring_visit",
      parent_job_id: PARENT_ID,
      visit_date: VISIT_DATE,
    });
    // No transfer_data — this is escrow, released later like any other job.
    expect(charge.transfer_data).toBeUndefined();
    expect(chargeOpts.idempotencyKey).toBe(CHARGE_KEY);

    // The row exists only because the money did.
    const visit = insertedVisits()[0]?.payload as Record<string, unknown>;
    expect(visit.parent_job_id).toBe(PARENT_ID);
    expect(visit.date_needed).toBe(VISIT_DATE);
    expect(visit.helper_id).toBe(HELPER_ID);
    expect(visit.status).toBe("accepted");
    expect(visit.payment_status).toBe("escrow");
    expect(visit.stripe_payment_intent_id).toBe("pi_day1");
    expect(visit.is_recurring).toBe(false);

    // Nothing was refunded on a clean run.
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  // Q1203: the cron's "today" was the UTC date. The schedule (06:00Z) never
  // shows it, but a manual or retried run in a Chicago evening does: from 19:00
  // CDT the UTC date is tomorrow's, so tomorrow's visit read as "not after today"
  // and was never funded. A Wednesday series, run at 20:00 CDT on Tuesday.
  it("Q1203: a run at 20:00 CDT funds TOMORROW's visit (the UTC date is already tomorrow)", async () => {
    const fn = await loadConfigured();
    wireJobsReads({ series: { rows: [seriesParent({ recurrence_days: [3] })] } });
    wireHolds([{ id: "hold-wed", visit_date: "2026-09-02", helper_id: HELPER_ID }]);
    scenario.reads.profiles = {
      rows: [{ email: "poster@example.com", subscription_tier: null, subscription_expires_at: null }],
    };
    scenario.writeSelectRows.notifications = [{ id: "n1" }, { id: "n2" }];
    scenario.rpc.are_users_blocked = false;
    seriesPiRetrieve.mockReset();
    seriesPiRetrieve.mockResolvedValue(seriesCheckoutIntent());
    stripeMock.paymentIntents.retrieve.mockImplementation((id: string, ...rest: unknown[]) =>
      id === SERIES_PI ? seriesPiRetrieve(id, ...rest) : otherPiRetrieve(id, ...rest),
    );
    stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_wed", status: "succeeded" });

    // 2026-09-02T01:00Z is 20:00 CDT on Tuesday Sep 1.
    const res = await runOn(fn, "2026-09-01", { at: "2026-09-02T01:00:00Z" });
    const b = await body(res);

    expect(b.funded).toBe(1);
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect((insertedVisits()[0]?.payload as Record<string, unknown>).date_needed).toBe("2026-09-02");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Finding 1, now per HOLDER (20260927012806): a date nobody holds is not charged
  // ═══════════════════════════════════════════════════════════════════════

  it("does not charge for a date nobody holds (never picked, or given up and not picked up)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireHolds([]);

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(b.skippedUnfilled).toBe(1);
    expect(b.funded).toBe(0);
    expect(b.errors).toBe(0);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
  });

  it("books and pays the date's HOLDER, not the series' first Helpr", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // A split series: the first hired Helpr is HELPER_ID, the date is held by another.
    wireHolds([{ id: "hold-9", visit_date: VISIT_DATE, helper_id: "helper-2" }]);

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(b.funded).toBe(1);
    const [charge, opts] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(charge.metadata.helper_id).toBe("helper-2");
    expect(opts.idempotencyKey).toBe(`recurring-visit:${PARENT_ID}:${VISIT_DATE}:hold-9`);
    expect((insertedVisits()[0]?.payload as Record<string, unknown>).helper_id).toBe("helper-2");
    const app = scenario.writes.find((w) => w.table === "applications");
    expect((app?.payload as Record<string, unknown>).helper_id).toBe("helper-2");
    const notes = scenario.writes.filter((w) => w.table === "notifications").flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload])) as Array<Record<string, unknown>>;
    expect(notes.map((n) => n.user_id)).toContain("helper-2");
    expect(notes.map((n) => n.user_id)).not.toContain(HELPER_ID);
  });

  it("skips the whole series when the holds read FAILS — a defect, never a guess", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireHolds({ error: { message: "connection reset by peer", code: "08006" } });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
    expect(b.funded).toBe(0);
    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(reasons(b)).toContain("holds read failed");
    expect(reasons(b)).toContain(PARENT_ID);
  });

  it("a chargeback on the parent or on any visit stops the series (money audit MEDIUM-7)", async () => {
    for (const setup of ["parent", "visit"] as const) {
      resetStripeMock();
      resetSupabaseMock();
      const fn = await loadConfigured();
      seedHappyPath();
      if (setup === "parent") {
        wireJobsReads({ series: { rows: [seriesParent({ dispute_status: "stripe_chargeback" })] } });
      } else {
        wireJobsReads({ series: { rows: [seriesParent()] }, chargeback: { rows: [{ id: "visit-0", payment_status: "chargeback" }] } });
      }
      const res = await runOn(fn, "2026-09-01");
      const b = await body(res);
      expect(b.skippedChargeback).toBe(1);
      expect(b.funded).toBe(0);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    }
  });

  it("re-reads right before charging: ended or changed hands since the scan means no charge (money audit LOW-10)", async () => {
    for (const change of ["ended", "handed"] as const) {
      resetStripeMock();
      resetSupabaseMock();
      const fn = await loadConfigured();
      seedHappyPath();
      if (change === "ended") {
        wireJobsReads({ series: { rows: [seriesParent()] }, live: { rows: [{ id: PARENT_ID, series_ended_on: "2026-09-01" }] } });
      } else {
        // The scan saw hold-1; by the charge the date was given up and re-claimed.
        scenario.reads.series_visit_holds = {
          rows: [{ id: HOLD_ID, visit_date: VISIT_DATE, helper_id: HELPER_ID }],
          selectOverrides: [],
        };
        const orig = scenario.reads.series_visit_holds;
        let n = 0;
        scenario.reads.series_visit_holds = new Proxy(orig, {
          get(t, k) {
            if (k === "rows") return n++ === 0 ? orig.rows : [{ id: "hold-2", visit_date: VISIT_DATE, helper_id: "helper-2" }];
            return Reflect.get(t, k);
          },
        });
      }
      const res = await runOn(fn, "2026-09-01");
      const b = await body(res);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(b.funded).toBe(0);
      expect(change === "ended" ? b.skippedEnded : b.skippedUnfilled).toBe(1);
    }
  });

  it("a date that changed hands after the charge: the refused insert is refunded, and it is not a defect", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.writeErrors.jobs = {
      message: `series_date_unheld: ${PARENT_ID} on ${VISIT_DATE} is not held by this Helpr`,
      code: "23514",
    };

    // Q415 (e): withheld is the fee Stripe actually kept on this charge.
    otherPiRetrieve.mockResolvedValue({
      id: "pi_day1", amount: 10000, amount_received: 10000,
      latest_charge: { balance_transaction: { fee: 320 } },
    });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_day1", amount: 9680, metadata: { fee_withheld: "true" } });
    // Q415 (e) review: marked before the refund, so a sweep retry withholds the fee too.
    expect(stripeMock.paymentIntents.update).toHaveBeenCalledWith("pi_day1", { metadata: { refund_withhold_fee: "true" } });
    expect(stripeMock.paymentIntents.update.mock.invocationCallOrder[0]).toBeLessThan(stripeMock.refunds.create.mock.invocationCallOrder[0]);
    expect(res.status).toBe(200);
    expect(b.skippedUnfilled).toBe(1);
    expect(b.errors).toBe(0);
    // Q415 (e): the poster is told what came back and what was kept.
    const notice = scenario.writes
      .filter((w) => w.table === "notifications")
      .map((w) => w.payload as { user_id: string; message: string })
      .find((p) => p.user_id === POSTER_ID);
    expect(notice?.message).toContain("We refunded $96.80");
    expect(notice?.message).toContain("fee of $3.20");
    expect(notice?.message).toContain("the date changed hands");
  });

  it("Q415 (e): a fee-withheld refund the poster is not told about is a defect", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.writeErrors.jobs = {
      message: `series_ended: ${PARENT_ID} ended before ${VISIT_DATE}`,
      code: "23514",
    };
    scenario.writeErrors.notifications = { message: "permission denied", code: "42501" };
    otherPiRetrieve.mockResolvedValue({
      id: "pi_day1", amount: 10000, amount_received: 10000,
      latest_charge: { balance_transaction: { fee: 320 } },
    });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect(JSON.stringify(b)).toContain("poster was not told of the fee-withheld refund");
  });

  it("Q415 (e): a charge no bigger than its fee is kept, with no $0 refund sent to Stripe", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.writeErrors.jobs = {
      message: `series_date_unheld: ${PARENT_ID} on ${VISIT_DATE} is not held by this Helpr`,
      code: "23514",
    };
    otherPiRetrieve.mockResolvedValue({
      id: "pi_day1", amount: 30, amount_received: 30,
      latest_charge: { balance_transaction: { fee: 30 } },
    });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical")).toEqual([]);
    expect(b.skippedUnfilled).toBe(1);
    expect(b.errors).toBe(0);
  });

  it("Q415 (e): an idempotency conflict on an intent that is already refunded is not a failed refund", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.writeErrors.jobs = {
      message: `series_date_unheld: ${PARENT_ID} on ${VISIT_DATE} is not held by this Helpr`,
      code: "23514",
    };
    otherPiRetrieve.mockResolvedValue({
      id: "pi_day1", amount: 10000, amount_received: 10000,
      latest_charge: { balance_transaction: { fee: 320 } },
    });
    stripeMock.refunds.create.mockRejectedValue(Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError" }));
    // First read: the pre-booking check (no refund yet). Then the refund an
    // earlier overlapping attempt made after the insert was refused.
    stripeMock.refunds.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValue({ data: [{ id: "re_prior", status: "succeeded", amount: 9710 }] });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.refunds.list).toHaveBeenCalledWith({ payment_intent: "pi_day1", limit: 100 });
    // The earlier run already told the poster what went back; this run's figures are not it.
    expect(scenario.writes.filter((w) => w.table === "notifications" && JSON.stringify(w.payload).includes("We refunded"))).toEqual([]);
    expect(slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical")).toEqual([]);
    expect(b.skippedUnfilled).toBe(1);
    expect(b.errors).toBe(0);
  });

  it("Q415 (e): an idempotency conflict with NO refund on the intent is still a failed refund", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.writeErrors.jobs = {
      message: `series_date_unheld: ${PARENT_ID} on ${VISIT_DATE} is not held by this Helpr`,
      code: "23514",
    };
    stripeMock.refunds.create.mockRejectedValue(Object.assign(new Error("idempotency"), { type: "StripeIdempotencyError" }));

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical")).toHaveLength(1);
    expect(b.errors).toBe(1);
  });

  it("skips the series when the existing-visit read FAILS — an empty set must not read as 'no visit yet'", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({
      series: { rows: [seriesParent()] },
      existing: { error: { message: "statement timeout", code: "57014" } },
    });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("existing-visit read failed");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Finding 2 — the cap-vulnerable series scan
  // ═══════════════════════════════════════════════════════════════════════

  it("pages the series scan past one page instead of reading only the first", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // 750 rows = two pages at `_shared/paginate.ts`'s PAGE_SIZE of 500.
    const many = Array.from({ length: 750 }, (_, i) => inertSeries(`inert-${i}`));
    wireJobsReads({ series: { rows: many, count: 750 } });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(b.seriesConsidered).toBe(750);
    expect(b.seriesScanned).toBe(750);
    expect(b.seriesTotal).toBe(750);
    expect(b.seriesScanComplete).toBe(true);
    expect(res.status).toBe(200);
  });

  it("records a DEFECT — and still funds what it read — when the scan comes back short", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // The shape a real cap produces: the server hands back a page and its own
    // COUNT(*) says far more exist. `count` is NOT subject to `db-max-rows`,
    // which is exactly why paginate.ts uses it as the independent second
    // opinion. 1675 is the live number measured on prod's `notifications`.
    const page = [seriesParent(), ...Array.from({ length: 499 }, (_, i) => inertSeries(`inert-${i}`))];
    wireJobsReads({ series: { rows: page, count: 1675 } });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    // NOT aborted. The funding window is three days wide and never reopens, so
    // refusing to run would drop more visits than the short read does.
    expect(b.funded).toBe(1);
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);

    // And the shortfall is a numeric, actionable defect — not a quiet 200.
    expect(res.status).toBe(500);
    expect(b.seriesScanComplete).toBe(false);
    expect(reasons(b)).toContain("read 500 of 1675");
  });

  // NOT COVERED HERE, deliberately: the third completeness failure — the
  // server withholding an exact count, which `scanAll` also treats as
  // incomplete — cannot be expressed through this Supabase double. Its
  // `resolveValue` computes `t.count ?? rows.length` for a paged read, so a
  // scenario cannot say "no count came back" without changing the mock's
  // semantics for every other lane using it. That branch is covered directly at
  // the module level in `paginate.test.ts` ("no exact count" / "countOpt").

  // ═══════════════════════════════════════════════════════════════════════
  // Finding 3 — the three-run window vs. the 24-hour idempotency key
  // ═══════════════════════════════════════════════════════════════════════

  it("day 1 charges, day 2 and day 3 send Stripe NOTHING — the DB row is what dedupes across days", async () => {
    // ── Day 1 (2026-09-01): the visit is due and unfunded.
    const day1 = await loadConfigured();
    seedHappyPath();
    const res1 = await runOn(day1, "2026-09-01");
    const b1 = await body(res1);

    expect(b1.funded).toBe(1);
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.paymentIntents.create.mock.calls[0][1].idempotencyKey).toBe(CHARGE_KEY);

    // ── Day 2 (2026-09-02): the same visit is STILL inside the window, but the
    // row day 1 created is now visible to the pre-flight read.
    resetStripeMock();
    resetSupabaseMock();
    const day2 = await loadConfigured();
    seedHappyPath();
    wireJobsReads({
      series: { rows: [seriesParent()] },
      existing: { rows: [{ date_needed: VISIT_DATE }] },
    });
    const res2 = await runOn(day2, "2026-09-02");
    const b2 = await body(res2);

    expect(b2.skippedExisting).toBe(1);
    expect(b2.funded).toBe(0);
    // The load-bearing assertion: Stripe is never asked. The idempotency key
    // would be past its 24h life by now and would MINT a second charge, so the
    // only thing standing here is the read above — which is why its error is
    // fatal (see the test two blocks up).
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(res2.status).toBe(200);

    // ── Day 3 (2026-09-03): last run the visit is in the window at all.
    resetStripeMock();
    resetSupabaseMock();
    const day3 = await loadConfigured();
    seedHappyPath();
    wireJobsReads({
      series: { rows: [seriesParent()] },
      existing: { rows: [{ date_needed: VISIT_DATE }] },
    });
    const res3 = await runOn(day3, "2026-09-03");
    const b3 = await body(res3);

    expect(b3.skippedExisting).toBe(1);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();

    // ── Day 4 (2026-09-04) — the visit's own day. Out of the window entirely
    // (`d > today` fails), so it is not even considered.
    resetStripeMock();
    resetSupabaseMock();
    const day4 = await loadConfigured();
    seedHappyPath();
    const res4 = await runOn(day4, "2026-09-04");
    const b4 = await body(res4);
    expect(b4.funded).toBe(0);
    expect(b4.skippedExisting).toBe(0);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("23505 on the SAME PaymentIntent is a same-day race: skipped, never refunded", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({
      series: { rows: [seriesParent()] },
      // The winner row is backed by the very intent this run is holding —
      // which is what an idempotency-key replay inside 24h produces.
      winner: { rows: [{ id: "visit-1", stripe_payment_intent_id: "pi_day1" }] },
    });
    scenario.writeErrors.jobs = { message: "duplicate key value", code: "23505" };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    // Refunding here would strip the escrow out from under a live booked visit
    // and leave a helper who works and is never paid.
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(b.skippedExisting).toBe(1);
    expect(res.status).toBe(200);
  });

  it("23505 on a DIFFERENT PaymentIntent is a cross-day double charge: refunded and reported", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_day2", status: "succeeded" });
    wireJobsReads({
      series: { rows: [seriesParent()] },
      // The visit is already funded — by day 1's intent, not this one. This is
      // exactly what the expired key produces on day 2.
      winner: { rows: [{ id: "visit-1", stripe_payment_intent_id: "pi_day1" }] },
    });
    scenario.writeErrors.jobs = { message: "duplicate key value", code: "23505" };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    // The duplicate goes back, keyed on the INTENT so it cannot collide with a
    // refund of some other intent for the same (series, date).
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    const [refund, refundOpts] = stripeMock.refunds.create.mock.calls[0];
    expect(refund.payment_intent).toBe("pi_day2");
    expect(refundOpts.idempotencyKey).toBe("recurring-visit-refund:pi_day2");

    // A poster charged twice is never a quiet success, even once it is fixed.
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("duplicate charge pi_day2 refunded");
    // And it is NOT miscounted as a visit that was already there.
    expect(b.skippedExisting).toBe(0);
  });

  it("23505 with an unreadable winner row refuses to refund and pages instead", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({
      series: { rows: [seriesParent()] },
      winner: { error: { message: "statement timeout", code: "57014" } },
    });
    scenario.writeErrors.jobs = { message: "duplicate key value", code: "23505" };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    // The two mistakes are not symmetric: a stranded duplicate charge is money
    // a human can refund; a wrongly-refunded escrow is work done for free.
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("unverifiable funding");
    expect(slackAlerts).toHaveLength(2); // the critical alert + the run summary
    const critical = slackAlerts.find(
      (a) => (a as { severity?: string }).severity === "critical",
    ) as { title: string } | undefined;
    expect(critical?.title).toContain("funding could not be verified");
  });

  it("refunds a charge whose visit row failed to insert, keyed on the intent", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.writeErrors.jobs = { message: "null value in column violates not-null", code: "23502" };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][1].idempotencyKey).toBe(
      "recurring-visit-refund:pi_day1",
    );
    // Q415 (e): the platform's own failure refunds IN FULL (no amount).
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_day1" });
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("visit insert failed after charge");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Finding 4 — a capped run is dropped work, not a quiet day
  // ═══════════════════════════════════════════════════════════════════════

  it("counts a capped run as a DEFECT so it cannot answer 200 ok:true", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // 201 fundable series against MAX_CHARGES_PER_RUN = 200. Driven in dryRun
    // so the cap branch is reached without 200 round trips through the Stripe
    // double — the branch under test is the counting, not the charging.
    const series = Array.from({ length: 201 }, (_, i) => seriesParent({ id: `series-${i}` }));
    wireJobsReads({ series: { rows: series } });

    const res = await runOn(fn, "2026-09-01", { dryRun: true });
    const b = await body(res);

    expect(b.capped).toBe(true);
    expect(b.funded).toBe(200);
    // Before this pass `capped: true` rode along inside a 200 ok:true body.
    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(reasons(b)).toContain("capped at MAX_CHARGES_PER_RUN=200");
    // Recorded ONCE, not once per remaining series.
    expect(
      ((b.defectReasons as string[]) ?? []).filter((r) => r.includes("capped")),
    ).toHaveLength(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // "Declined" and "no answer" are different facts
  //
  // Found by the review pass, and it is the SECOND double-charge path — the
  // one the unique index cannot catch, because the orphaned intent never gets
  // a row to collide with. A lost response used to be filed as a routine
  // decline; tomorrow's run then charged again on an expired key.
  // ═══════════════════════════════════════════════════════════════════════

  it("treats a card decline as a decline: one attempt, no page", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    const declined = Object.assign(new Error("Your card was declined."), {
      type: "StripeCardError",
      code: "card_declined",
    });
    stripeMock.paymentIntents.create.mockRejectedValue(declined);

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    // Stripe ANSWERED. Asking again would only re-read the same answer.
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect(b.declined).toBe(1);
    expect(res.status).toBe(200);
    expect(slackAlerts.some((a) => (a as { severity?: string }).severity === "critical")).toBe(false);
  });

  it("retries a no-answer failure on the SAME key and funds the visit when the replay lands", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.create
      .mockRejectedValueOnce(new Error("error sending request: connection closed"))
      .mockResolvedValueOnce({ id: "pi_day1", status: "succeeded" });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(2);
    // Both attempts carry the SAME idempotency key — that is what makes the
    // retry free: Stripe replays the first outcome instead of charging twice.
    const keys = stripeMock.paymentIntents.create.mock.calls.map((c) => c[1].idempotencyKey);
    expect(keys).toEqual([CHARGE_KEY, CHARGE_KEY]);
    expect(b.funded).toBe(1);
    expect(res.status).toBe(200);
  });

  it("pages when Stripe never answers — the intent may be holding money with no visit", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.create.mockRejectedValue(new Error("request timed out"));

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(2);
    expect(insertedVisits()).toHaveLength(0);
    // NOT a routine decline: tomorrow's run would charge again on a fresh key,
    // and there would be no 23505 to catch it.
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("charge outcome unknown");
    const critical = slackAlerts.find(
      (a) => (a as { title?: string }).title === "Recurring visit charge outcome UNKNOWN",
    ) as { fields?: Record<string, string> } | undefined;
    expect(critical).toBeDefined();
    expect(critical?.fields?.visitDate).toBe(VISIT_DATE);
    expect(critical?.fields?.amountCents).toBe("11200");
    // The helper is still told not to head out — that fact is true either way.
    const notified = scenario.writes
      .filter((w) => w.table === "notifications" && w.op === "insert")
      .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]))
      .map((p) => (p as { user_id: string }).user_id);
    expect(notified).toContain(HELPER_ID);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Q1104 — the 24h charge key does not span the 3-day funding window
  // ═══════════════════════════════════════════════════════════════════════
  // Day 1 charged and never booked (the run died before the insert, or Stripe
  // never answered); day 2's request is new to Stripe and charged again. The
  // run now asks Stripe for this claim's earlier visit charge first.
  const visitMeta = (over: Record<string, string> = {}) => ({
    type: "recurring_visit", parent_job_id: PARENT_ID, visit_date: VISIT_DATE, hold_id: HOLD_ID, ...over,
  });
  const priorIntent = (over: Record<string, unknown> = {}) => ({
    // A Stripe PaymentIntent, not a recurring_visit_payments row: its status is
    // built by a call so the fixture-schema scan (which grades row literals by
    // their distinctive columns) does not read it as that table's status.
    id: "pi_day1_unbooked", status: String("succeeded"), amount: 11200, currency: "usd", metadata: visitMeta(),
    latest_charge: { id: "ch_day1", amount_refunded: 0 }, ...over,
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |           : prior.kind === "adopt"\n          ? { kind: "ok", intent: prior.intent }\n          : await attemptVisitCharge( |           : await attemptVisitCharge(
  it("Q1104: an earlier UNBOOKED charge of this claim is adopted on the next day, never charged again", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.list.mockResolvedValue({ data: [priorIntent()], has_more: false });
    const res = await runOn(fn, "2026-09-02");
    const b = await body(res);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect((insertedVisits()[0]?.payload as Record<string, unknown>)?.stripe_payment_intent_id).toBe("pi_day1_unbooked");
    expect(b.funded).toBe(1);
    // Read from the payer's own intents, inside the window, with the charge expanded.
    const [params] = stripeMock.paymentIntents.list.mock.calls[0];
    expect(params).toMatchObject({ customer: expect.any(String), limit: 100, expand: ["data.latest_charge"] });
    expect(params.created.gte).toBeGreaterThan(Math.floor(Date.parse("2026-09-02T06:00:00Z") / 1000) - 5 * 86_400);
  });

  // Q1337: the visit row records THIS run's totals, so an adopted intent that
  // took a different amount (the tier, tax rate or budget moved since day 1)
  // must never be booked as if it took this one, and must never be charged
  // again either: it pages, and books nothing.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           if (adoptedAmount !== totalCents \|\| adoptedCurrency !== "usd") { |           if (false) {
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           if (adoptedAmount !== totalCents \|\| adoptedCurrency !== "usd") { |           if (adoptedCurrency !== "usd") {
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           if (adoptedAmount !== totalCents \|\| adoptedCurrency !== "usd") { |           if (adoptedAmount !== totalCents) {
  // @mutate supabase/functions/charge-recurring-visits/index.ts |             (await notifyPosterCardProblem(supabase, parent, holderId, visitDate, "adopted_amount_mismatch", "held")) |             ([] as string[])
  // @mutate supabase/functions/charge-recurring-visits/index.ts |     message: cause === "held"\n      ? |     message: false\n      ?
  it("Q1337: an adopted earlier charge whose amount or currency differs from this visit is neither booked nor charged again; it pages", async () => {
    for (const over of [{ amount: 10900 }, { amount: 11200, currency: "cad" }]) {
      resetStripeMock(); resetSupabaseMock(); resetSharedMocks();
      const fn = await loadConfigured();
      seedHappyPath();
      stripeMock.paymentIntents.list.mockResolvedValue({ data: [priorIntent(over)], has_more: false });
      const res = await runOn(fn, "2026-09-02");
      const b = await body(res);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(insertedVisits()).toHaveLength(0);
      expect(res.status).toBe(500);
      expect(reasons(b)).toContain("earlier charge pi_day1_unbooked took");
      const page = slackAlerts.find(
        (a) => (a as { title?: string }).title === "Recurring visit: earlier charge does not match this visit",
      ) as { severity?: string; fields?: Record<string, string> } | undefined;
      expect(page?.severity).toBe("critical");
      expect(page?.fields?.expectedAmountCents).toBe("11200");
      expect(page?.fields?.paymentIntent).toBe("pi_day1_unbooked");
      // Both sides are told the date is not booked; the poster is not told
      // their card failed (it did not).
      const told = scenario.writes
        .filter((w) => w.table === "notifications" && w.op === "insert")
        .map((w) => w.payload as Record<string, unknown>);
      expect(told.map((n) => n.user_id).sort()).toEqual([HELPER_ID, POSTER_ID].sort());
      expect(JSON.stringify(told)).toContain("isn't booked yet");
      expect(JSON.stringify(told)).not.toContain("Update your card");
    }
  });

  // Q750 review (lh-money-escrow 2026-10-05, finding 2): an overlapping run can
  // refund the intent this run is about to book; Stripe is asked right before
  // the insert, and a refund (pending included) or an unreadable answer books nothing.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           if (liveRefunds.some((r) => r.status !== "failed" && r.status !== "canceled")) { |           if (false) {
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           if (liveRefunds === null) { |           if (false) {
  it("Q750 review: an intent refunded (even pending) between the lookup and the insert is never booked; an unreadable refund state books nothing", async () => {
    for (const refundRead of ["pending", "succeeded", "throws"] as const) {
      resetStripeMock(); resetSupabaseMock(); resetSharedMocks();
      const fn = await loadConfigured();
      seedHappyPath();
      stripeMock.paymentIntents.list.mockResolvedValue({ data: [priorIntent()], has_more: false });
      if (refundRead === "throws") stripeMock.refunds.list.mockRejectedValue(new Error("timed out"));
      else stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_x", status: refundRead, amount: 11200 }] });
      const res = await runOn(fn, "2026-09-02");
      const b = await body(res);
      expect(insertedVisits(), refundRead).toHaveLength(0);
      expect(stripeMock.paymentIntents.create, refundRead).not.toHaveBeenCalled();
      expect(res.status, refundRead).toBe(500);
      expect(reasons(b), refundRead).toContain(refundRead === "throws" ? "could not confirm pi_day1_unbooked carries no refund" : "pi_day1_unbooked carries a refund");
      const told = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");
      expect(told.length, refundRead).toBe(2);
      // A person is asked to look either way (re-review LOW 1).
      expect(slackAlerts.some((a) => (a as { severity?: string }).severity === "critical"), refundRead).toBe(true);
    }
  });

  it("Q750 review: a refund that FAILED or was CANCELED does not stop the booking", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.list.mockResolvedValue({ data: [priorIntent()], has_more: false });
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_f", status: "failed" }, { id: "re_c", status: "canceled" }] });
    await runOn(fn, "2026-09-02");
    expect((insertedVisits()[0]?.payload as Record<string, unknown>)?.stripe_payment_intent_id).toBe("pi_day1_unbooked");
  });

  // Q750 (2), owner 2026-10-05: CHARGE FRESH. A refunded earlier charge of the
  // SAME claim shares the plain key, which Stripe can still replay; the re-charge
  // moves to a new key, and a replayed refunded intent is never booked.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |         const chargeKey = refundedOfClaim.length > 0 |         const chargeKey = false
  // @mutate supabase/functions/charge-recurring-visits/index.ts |     refundedIds.push(pi.id); |     void 0;
  it("Q750 (2): after a refunded charge of the SAME claim the visit is charged FRESH on a new key", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.list.mockResolvedValue({ data: [
      priorIntent({ id: "pi_refunded_old", created: 100, latest_charge: { id: "ch_o", amount_refunded: 11200 } }),
      priorIntent({ id: "pi_refunded_new", created: 200, latest_charge: { id: "ch_n", amount_refunded: 11200 } }),
    ], has_more: false });
    await runOn(fn, "2026-09-02");
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [, opts] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(opts.idempotencyKey).toBe(`recurring-visit:${PARENT_ID}:${VISIT_DATE}:${HOLD_ID}:after-pi_refunded_new`);
    expect((insertedVisits()[0]?.payload as Record<string, unknown>)?.stripe_payment_intent_id).toBe("pi_day1");
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |         if (refundedOfClaim.includes(intent.id)) { |         if (false) {
  it("Q750 (2): a charge that comes back as the already-refunded intent is never booked; it pages", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.list.mockResolvedValue({ data: [
      priorIntent({ id: "pi_refunded", latest_charge: { id: "ch_r", amount_refunded: 11200 } }),
    ], has_more: false });
    // Stripe replays the refunded intent (still `succeeded`).
    stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_refunded", status: "succeeded" });
    const res = await runOn(fn, "2026-09-02");
    const b = await body(res);
    expect(insertedVisits()).toHaveLength(0);
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("already-refunded intent pi_refunded");
    expect(slackAlerts.some(
      (a) => (a as { title?: string }).title === "Recurring visit charge came back as an already-refunded intent",
    )).toBe(true);
    const told = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");
    expect(told).toHaveLength(2);
  });

  // With no earlier refund the key is the plain claim key (same-day replay protection).
  it("Q750 (2): with no refunded charge of the claim the key stays the plain claim key", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.list.mockResolvedValue({ data: [], has_more: false });
    await runOn(fn, "2026-09-02");
    const [, opts] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(opts.idempotencyKey).toBe(`recurring-visit:${PARENT_ID}:${VISIT_DATE}:${HOLD_ID}`);
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |     if (Number(charge.amount_refunded ?? 0) === 0) return { kind: "adopt", intent: pi }; |     return { kind: "adopt", intent: pi };
  // @mutate supabase/functions/charge-recurring-visits/index.ts |     pi.metadata?.hold_id === holdId | true
  it("Q1104: a REFUNDED earlier charge, or one for another claim, is never adopted", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.list.mockResolvedValue({ data: [
      priorIntent({ id: "pi_refunded", latest_charge: { id: "ch_r", amount_refunded: 11200 } }),
      priorIntent({ id: "pi_old_claim", metadata: visitMeta({ hold_id: "hold-old" }) }),
    ], has_more: false });
    await runOn(fn, "2026-09-02");
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect((insertedVisits()[0]?.payload as Record<string, unknown>)?.stripe_payment_intent_id).toBe("pi_day1");
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |         if (prior.kind === "error") { |         if (false) {
  it("Q1104: Stripe not answering about earlier charges charges NOTHING this run (a defect, retried next run)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.list.mockRejectedValue(new Error("request timed out"));
    const res = await runOn(fn, "2026-09-02");
    const b = await body(res);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("could not check Stripe for an earlier charge");
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |   if (list.has_more) return { kind: "error", message: "more than 100 PaymentIntents for this payer inside the window" }; |   void 0;
  // @mutate supabase/functions/charge-recurring-visits/index.ts |         if (prior.kind === "in_flight") { |         if (false) {
  it("Q1104: an earlier charge still processing, or a list that does not fit one page, charges nothing", async () => {
    let fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.list.mockResolvedValue({ data: [priorIntent({ status: "processing" })], has_more: false });
    let b = await body(await runOn(fn, "2026-09-02"));
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(reasons(b)).toContain("still processing");

    resetStripeMock(); resetSupabaseMock(); resetSharedMocks();
    fn = await loadConfigured();
    seedHappyPath();
    stripeMock.paymentIntents.list.mockResolvedValue({ data: [], has_more: true });
    b = await body(await runOn(fn, "2026-09-02"));
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(reasons(b)).toContain("more than 100 PaymentIntents");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Finding 5 / Q734 — the series' own card, never a card found by email
  // ═══════════════════════════════════════════════════════════════════════

  // @mutate supabase/functions/charge-recurring-visits/index.ts |   if (pi.setup_future_usage !== "off_session") { |   if (false) {
  // @mutate supabase/functions/charge-recurring-visits/index.ts |   if (!paymentIntentId) return { kind: "none", reason: "no checkout payment on the series" }; |   if (!paymentIntentId) return { kind: "card", customerId: "cus_1", paymentMethodId: "pm_1" };
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           customerId = card.customerId; |           customerId = "cus_1";
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           paymentMethodId = card.paymentMethodId; |           paymentMethodId = "pm_1";
  it("charges the card the series' own checkout saved, never a card found on the poster's email (Q734)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // One email, several customer records, a card on each: the old scan took
    // the first record with any card. The series' checkout saved pm_series on
    // cus_series, and that is the only card this poster authorised for it.
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_other" }, { id: "cus_series" }] });
    stripeMock.paymentMethods.list.mockResolvedValue({ data: [{ id: "pm_other" }] });
    seriesPiRetrieve.mockResolvedValue(seriesCheckoutIntent({ customer: "cus_series", payment_method: "pm_series" }));

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(b.funded).toBe(1);
    expect(seriesPiRetrieve).toHaveBeenCalledWith(SERIES_PI);
    const charge = stripeMock.paymentIntents.create.mock.calls[0][0];
    expect(charge.customer).toBe("cus_series");
    expect(charge.payment_method).toBe("pm_series");
    expect(stripeMock.customers.list).not.toHaveBeenCalled();
    expect(stripeMock.paymentMethods.list).not.toHaveBeenCalled();
  });

  it("a series with no saved card (gift-card checkout) is never charged: both parties are told (Q734)", async () => {
    for (const variant of ["no checkout payment", "checkout did not save the card", "intent not found"] as const) {
      resetStripeMock();
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      seedHappyPath();
      // A card IS on file under the poster's email; it was never authorised
      // for this series, so it must not be charged.
      stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }] });
      stripeMock.paymentMethods.list.mockResolvedValue({ data: [{ id: "pm_1" }] });
      if (variant === "no checkout payment") {
        wireJobsReads({ series: { rows: [seriesParent({ stripe_payment_intent_id: null })] } });
      } else if (variant === "checkout did not save the card") {
        // The gift-card difference checkout: paid, but no setup_future_usage.
        seriesPiRetrieve.mockResolvedValue(seriesCheckoutIntent({ setup_future_usage: null }));
      } else {
        seriesPiRetrieve.mockRejectedValue(
          Object.assign(new Error("No such payment_intent"), { type: "StripeInvalidRequestError", code: "resource_missing" }),
        );
      }

      const res = await runOn(fn, "2026-09-01");
      const b = await body(res);

      expect(b.declined, variant).toBe(1);
      expect(b.funded, variant).toBe(0);
      expect(stripeMock.paymentIntents.create, variant).not.toHaveBeenCalled();
      const notified = scenario.writes
        .filter((w) => w.table === "notifications" && w.op === "insert")
        .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]))
        .map((p) => (p as { user_id: string }).user_id);
      expect(notified, variant).toContain(POSTER_ID);
      expect(notified, variant).toContain(HELPER_ID);
      // No card is an OUTCOME, not a defect: it must never page.
      expect(res.status, variant).toBe(200);
      expect(b.ok, variant).toBe(true);
    }
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |         if (card.kind === "unknown") { |         if (false) {
  // @mutate supabase/functions/charge-recurring-visits/index.ts | if (err?.type === "StripeInvalidRequestError" && err?.code === "resource_missing") { | if (true) {
  // @mutate supabase/functions/charge-recurring-visits/index.ts | if (err?.type === "StripeInvalidRequestError" && err?.code === "resource_missing") { | if (err?.type === "StripeInvalidRequestError") {
  it("Stripe not answering about the series' card is a defect, never a charge and never a 'no card' email (Q734)", async () => {
    // The second case: Stripe rejected OUR request for a reason other than
    // "no such PaymentIntent" (e.g. a test-mode PI read with the live key).
    // That is our error, not the poster's card.
    const failures = [
      new Error("socket hang up"),
      Object.assign(new Error("No such payment_intent; a similar object exists in test mode"), {
        type: "StripeInvalidRequestError",
        code: "resource_missing_other_mode",
      }),
    ];
    for (const failure of failures) {
      resetStripeMock();
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      seedHappyPath();
      seriesPiRetrieve.mockRejectedValue(failure);

      const res = await runOn(fn, "2026-09-01");
      const b = await body(res);

      expect(stripeMock.paymentIntents.create, failure.message).not.toHaveBeenCalled();
      expect(b.declined, failure.message).toBe(0);
      expect(res.status, failure.message).toBe(500);
      expect(reasons(b), failure.message).toContain("could not read the series' saved card");
      expect(scenario.writes.filter((w) => w.table === "notifications"), failure.message).toHaveLength(0);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // "A null error does NOT mean the write happened"
  // ═══════════════════════════════════════════════════════════════════════

  it("proves the application row landed rather than trusting a null error", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // The upsert matches zero rows: no error, no row, and — before this pass —
    // no signal at all. Without an `applications` row the helper's Activity tab
    // never lists the visit, while the money is already in escrow.
    scenario.writeSelectRows.applications = [];

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    const upsert = scenario.writes.find((w) => w.table === "applications");
    expect(upsert?.selectCols).toBe("id");
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("no application row");
    const critical = slackAlerts.find(
      (a) => (a as { title?: string }).title?.includes("without its application row"),
    );
    expect(critical).toBeDefined();
    // The visit itself is real and stays — refunding it would be wrong.
    expect(b.funded).toBe(1);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("counts an undelivered booking notification as a defect", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.writeErrors.notifications = { message: "column \"link\" does not exist", code: "PGRST204" };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    // A booked date the helper is not told about is a date they do not show up
    // for. This used to be a console.error on a run answering 200 ok:true.
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("booking notifications not delivered");
    expect(b.funded).toBe(1);
  });

  // Q158: the Q137 trigger drops a seed series' row to a REAL party by design,
  // so a single row back is the rule working, not a failed write. Before the fix
  // this scenario answered 500 ("inserted" fewer than both) and paged Slack every night.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           if (crossesSeed === true) {\n            console.log( |           if (crossesSeed === "never") {\n            console.log(
  // @mutate supabase/functions/charge-recurring-visits/index.ts | notifyRows.length < expected) { | notifyRows.length < bookingRows.length) {
  it("a seed series with a REAL party: the trigger's drop is expected, not a defect (Q158)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // The poster is real, the series is seed: the boundary says the poster's
    // row crosses it, and the trigger would return only the helper's row.
    scenario.rpc.notification_crosses_seed_boundary = (a?: unknown) =>
      (a as { p_recipient?: string }).p_recipient === POSTER_ID;
    scenario.writeSelectRows.notifications = [{ id: "n1" }];

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    const asked = (scenario.rpcCalls ?? []).filter((c) => c.name === "notification_crosses_seed_boundary");
    expect(asked.map((c) => (c.args as { p_recipient: string }).p_recipient).sort()).toEqual([HELPER_ID, POSTER_ID].sort());
    for (const c of asked) expect((c.args as { p_job_id: unknown }).p_job_id).toBeTruthy();
    const insert = scenario.writes.find((w) => w.table === "notifications");
    const rows = insert?.payload as Array<{ user_id: string }>;
    expect(rows.map((r) => r.user_id)).toEqual([HELPER_ID]);
    expect(res.status).toBe(200);
    expect(reasons(b)).not.toContain("booking notifications not delivered");
    expect(slackAlerts.find((a) => (a as { title?: string }).title === "Recurring visit funding had failures")).toBeUndefined();
    expect(b.funded).toBe(1);
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |           if (seedErr \|\| typeof crossesSeed !== "boolean") { |           if (false) {
  it("a seed-boundary check that cannot answer is counted as a defect (Q158)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.rpcErrors = { notification_crosses_seed_boundary: { message: "function does not exist", code: "PGRST202" } };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("seed boundary check failed");
    // The rows are still offered to the trigger, which decides.
    expect(scenario.writes.find((w) => w.table === "notifications")).toBeDefined();
    expect(b.funded).toBe(1);
  });

  it("records a defect when the poster/helper decline notice itself fails to write", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    seriesPiRetrieve.mockResolvedValue(seriesCheckoutIntent({ setup_future_usage: null }));
    scenario.writeErrors.notifications = { message: "permission denied", code: "42501" };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    // The decline stays an outcome; the two writes that failed are the defects.
    expect(b.declined).toBe(1);
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("poster was not told");
    expect(reasons(b)).toContain("standing Helpr was not told");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Cron plumbing
  // ═══════════════════════════════════════════════════════════════════════

  it("rejects an unauthenticated caller before reading anything", async () => {
    const fn = await loadConfigured();
    seedHappyPath();

    const res = await fn.fetch(fn.request({ url: "https://edge.test/charge-recurring-visits" }));

    expect(res.status).toBe(401);
    expect(scenario.writes).toHaveLength(0);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Q356 / Q347 — the standing helper must be the one hired, and not blocked
  // ═══════════════════════════════════════════════════════════════════════

  /** Nothing this run may do for a refused series: no charge, no job, no application, no notification. */
  function expectNothingBooked(b: Record<string, unknown>) {
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
    expect(scenario.writes.filter((w) => w.table === "applications")).toHaveLength(0);
    expect(scenario.writes.filter((w) => w.table === "notifications")).toHaveLength(0);
    expect(b.funded).toBe(0);
  }

  it("checks the poster/helper block pair on a normal run", async () => {
    const fn = await loadConfigured();
    seedHappyPath();

    await runOn(fn, "2026-09-01");

    const call = scenario.rpcCalls?.find((c) => c.name === "are_users_blocked");
    expect(call?.args).toEqual({ _user_a: POSTER_ID, _user_b: HELPER_ID });
  });

  it("books nobody when the series' recurring_helper_id points at a stranger but no hold names them (Q356 moved to the holds)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // The Q356 attack shape: recurring_helper_id pointed at someone who never
    // applied. Holds are written only by definer RPCs, so the stranger holds
    // nothing and nothing is booked for them.
    wireJobsReads({ series: { rows: [seriesParent({ recurring_helper_id: "stranger-9" })] } });
    wireHolds([]);

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expectNothingBooked(b);
    expect(b.skippedUnfilled).toBe(1);
  });

  it("skips a series across a block: no charge, no booking, not a defect", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.rpc.are_users_blocked = true;

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expectNothingBooked(b);
    expect(b.skippedBlocked).toBe(1);
    expect(res.status).toBe(200);
  });

  it("skips a series whose poster or standing Helpr is banned: no charge, no booking, not a defect (review 2026-09-25)", async () => {
    for (const who of [POSTER_ID, HELPER_ID]) {
      resetStripeMock();
      resetSupabaseMock();
      const fn = await loadConfigured();
      seedHappyPath();
      scenario.reads.profiles = {
        ...scenario.reads.profiles,
        selectOverrides: [
          { includes: "ban_status", result: { rows: [{ user_id: who, ban_status: "permanently_banned", auto_suspended_until: null }] } },
        ],
      };

      const res = await runOn(fn, "2026-09-01");
      const b = await body(res);

      expectNothingBooked(b);
      expect(b.skippedBanned).toBe(1);
      expect(res.status).toBe(200);
    }
  });

  it("a LAPSED temp ban does not skip the series", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.reads.profiles = {
      ...scenario.reads.profiles,
      selectOverrides: [
        { includes: "ban_status", result: { rows: [{ user_id: HELPER_ID, ban_status: "temp_banned", auto_suspended_until: "2026-08-01T00:00:00Z" }] } },
      ],
    };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(b.funded).toBe(1);
    expect(b.skippedBanned).toBe(0);
  });

  it("skips the series when the ban check itself fails — an unknown answer never books", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.reads.profiles = {
      ...scenario.reads.profiles,
      selectOverrides: [{ includes: "ban_status", result: { error: { message: "connection reset", code: "08006" } } }],
    };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expectNothingBooked(b);
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("ban check failed");
  });

  it("skips the series when the block check itself fails — an unknown answer never books", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.rpcErrors = { are_users_blocked: { message: "connection reset", code: "08006" } };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expectNothingBooked(b);
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("block check failed");
  });

  it("dry run reports what it would charge and touches neither Stripe nor the database", async () => {
    const fn = await loadConfigured();
    seedHappyPath();

    const res = await runOn(fn, "2026-09-01", { dryRun: true });
    const b = await body(res);

    expect(b.dryRun).toBe(true);
    expect(b.funded).toBe(1);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |             sales_tax_rate: effectiveSalesTaxRate(taxCents, budgetCents), |             sales_tax_rate: Math.round((taxCents / budgetCents) * 1_000_000) / 10_000,
  it("ME-014: a taxable visit commits its tax calculation, and the fee floor covers the tax", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ category: "assembly", budget: 2 })] } });
    stripeMock.tax.calculations.create.mockResolvedValue({ id: "taxcalc_1", tax_amount_exclusive: 20 });
    stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_1" });

    const b = await body(await runOn(fn, "2026-09-01"));
    expect(b.funded).toBe(1);
    expect(stripeMock.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(1);
    const [args, opts] = stripeMock.tax.transactions.createFromCalculation.mock.calls[0];
    expect(args).toEqual({ calculation: "taxcalc_1", reference: "pi_day1" });
    expect(opts.idempotencyKey).toBe("recurring-visit-tax:pi_day1");

    // $2 labor + $0.20 tax: the Stripe-cost floor binds, and is computed on $2.20.
    const { posterServiceFeeCents, posterFeePercentForTier } = await import("../../../supabase/functions/_shared/posterFees.ts");
    const pct = posterFeePercentForTier(null, null);
    const [charge] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(posterServiceFeeCents(200, pct, 20)).not.toBe(posterServiceFeeCents(200, pct, 0));
    expect(charge.amount).toBe(200 + 20 + posterServiceFeeCents(200, pct, 20));
    // The visit row's rate is a FRACTION (20 / 200 = 0.1): the CHECK
    // ck_jobs_sales_tax_rate_range admits 0..1, and the percent (10) it wrote
    // would have failed this insert after the charge.
    expect((insertedVisits()[0].payload as Record<string, unknown>).sales_tax_rate).toBe(0.1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Ended series — end_recurring_series sets series_ended_on
  // ═══════════════════════════════════════════════════════════════════════

  it("funds nothing after an ENDED series' last date: no charge, no visit, not a defect", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // Ended the day before the one due visit.
    wireJobsReads({ series: { rows: [seriesParent({ series_ended_on: "2026-09-03" })] } });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.ok).toBe(true);
    expect(b.seriesConsidered).toBe(1);
    expect(b.funded).toBe(0);
    expect(b.errors).toBe(0);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
  });

  it("funds NOTHING for an ended series, even a gap dated on or before its end (review 2026-09-25)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // The end date is at or after the last created visit, so VISIT_DATE with no
    // visit is a gap the cron failed to fund earlier. Ending must stop it too.
    wireJobsReads({ series: { rows: [seriesParent({ series_ended_on: VISIT_DATE })] } });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.funded).toBe(0);
    expect(b.skippedEnded).toBe(1);
    expect(b.errors).toBe(0);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    // Skipped before any work for the series, not caught by the pre-charge re-read.
    expect(seriesPiRetrieve).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
  });

  it("a series ended after this run read it: the refused visit is refunded and the run stays green", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // trg_series_visit_within_end's refusal, as PostgREST returns it.
    scenario.writeErrors.jobs = {
      message: "series_ended: the series ended on 2026-09-03; no new visit (2026-09-04)",
      code: "23514",
    };
    // Q415 (e): the fee read fails, so the card-rate estimate on the intent in
    // hand is withheld (2.9% + 30c of $100 = $3.20), never a full refund.
    stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_day1", status: "succeeded", amount: 10000 });
    otherPiRetrieve.mockRejectedValue(new Error("network"));

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_day1", amount: 9680, metadata: { fee_withheld: "true" } });
    expect(stripeMock.refunds.create.mock.calls[0][1].idempotencyKey).toBe("recurring-visit-refund:pi_day1");
    expect(res.status).toBe(200);
    expect(b.errors).toBe(0);
    expect(b.skippedEnded).toBe(1);
    expect(b.funded).toBe(0);
  });

  it("a series ended mid-run whose refund FAILS is still a defect", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.writeErrors.jobs = {
      message: "series_ended: the series ended on 2026-09-03; no new visit (2026-09-04)",
      code: "23514",
    };
    stripeMock.refunds.create.mockRejectedValue(new Error("stripe down"));

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(reasons(b)).toContain("visit insert failed after charge");
  });

  it("the booking notification names the Helpr's real way out (no per-date release control exists)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();

    await runOn(fn, "2026-09-01");
    const notes = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");
    const text = JSON.stringify(notes.map((n) => n.payload));
    expect(text).toContain("Cancel this visit from My Jobs");
    expect(text).not.toMatch(/Release the date/i);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Q210(b): $300+ visits are paid ON-SESSION (owner, 2026-09-27)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Pre-flight rows (column list has budget_cents), the Q750 future-visit read
   * (embeds the parent as `series:jobs`), and sweep rows (payer_id).
   */
  function wireVisitPayments(opts: {
    preflight?: TableResult;
    sweep?: TableResult;
    /** Q750 (c): open future rows of the series that are over (select has created_at). */
    ahead?: TableResult;
    /** Q750 (a): parents of every open future row (select is parent_job_id alone). Default: ahead's parents. */
    openParents?: TableResult;
  }) {
    const derived = { rows: (opts.ahead?.rows ?? []).map((r) => ({ parent_job_id: r.parent_job_id })) };
    scenario.reads.recurring_visit_payments = {
      ...(opts.openParents ?? derived),
      selectOverrides: [
        { includes: "budget_cents", result: opts.preflight ?? { rows: [] } },
        { includes: "created_at", result: opts.ahead ?? { rows: [] } },
        { includes: "payer_id", result: opts.sweep ?? { rows: [] } },
      ],
    };
  }

  function visitPaymentWrites(op: "insert" | "update") {
    return scenario.writes.filter((w) => w.table === "recurring_visit_payments" && w.op === op);
  }

  it("a $300 visit is NOT charged off-session: it is parked pending and the payer is asked to pay", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
    wireVisitPayments({});

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.awaitingPayment).toBe(1);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);

    const parked = visitPaymentWrites("insert");
    expect(parked).toHaveLength(1);
    const row = parked[0].payload as Record<string, unknown>;
    expect(row).toMatchObject({
      parent_job_id: PARENT_ID,
      visit_date: VISIT_DATE,
      hold_id: HOLD_ID,
      payer_id: POSTER_ID,
      helper_id: HELPER_ID,
      budget_cents: 30000,
      status: "pending",
    });
    expect(row.amount_cents as number).toBeGreaterThanOrEqual(30000);
    expect(row.amount_cents).toBe(
      (row.budget_cents as number) + (row.fee_cents as number) + (row.tax_cents as number),
    );

    const asks = scenario.writes.filter(
      (w) => w.table === "notifications" && w.op === "insert" &&
        JSON.stringify(w.payload).includes("Tap to pay for your next visit"),
    );
    expect(asks).toHaveLength(1);
    expect((asks[0].payload as Record<string, unknown>).user_id).toBe(POSTER_ID);
  });

  // Q1338 (lh-money-escrow review, 2026-10-05): the earlier-charge lookup ran
  // only after the $300 park, so an earlier run's unbooked off-session charge
  // of this visit was parked and the payer asked to pay it a second time.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |             earlierChargeToAdopt = parkPrior.kind === "adopt"; |             earlierChargeToAdopt = false;
  // @mutate supabase/functions/charge-recurring-visits/index.ts |             if (parkPrior.kind === "in_flight") { |             if (false) {
  // @mutate supabase/functions/charge-recurring-visits/index.ts |         if (!paidRow && totalCents >= THREE_D_SECURE_MIN_CENTS && prior.kind !== "adopt") { |         if (false) {
  describe("Q1338: a $300+ visit with an earlier unbooked charge is adopted, never parked", () => {
    async function parkedAmount(): Promise<number> {
      const fn = await loadConfigured();
      seedHappyPath();
      wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
      wireVisitPayments({});
      await runOn(fn, "2026-09-01");
      const amount = (visitPaymentWrites("insert")[0].payload as Record<string, unknown>).amount_cents as number;
      resetStripeMock(); resetSupabaseMock(); resetSharedMocks();
      return amount;
    }
    const earlier = (over: Record<string, unknown> = {}) => ({
      id: "pi_offsession_unbooked", status: String("succeeded"), amount: 0, currency: "usd",
      metadata: { type: "recurring_visit", parent_job_id: PARENT_ID, visit_date: VISIT_DATE, hold_id: HOLD_ID },
      latest_charge: { id: "ch_earlier", amount_refunded: 0 }, ...over,
    });

    it("books the visit on the earlier charge: no park, no ask to pay, no new charge", async () => {
      const total = await parkedAmount();
      expect(total).toBeGreaterThanOrEqual(30000);
      const fn = await loadConfigured();
      seedHappyPath();
      wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
      wireVisitPayments({});
      stripeMock.paymentIntents.list.mockResolvedValue({ data: [earlier({ amount: total })], has_more: false });
      const b = await body(await runOn(fn, "2026-09-01"));
      expect(visitPaymentWrites("insert")).toHaveLength(0);
      expect(b.awaitingPayment).toBe(0);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect((insertedVisits()[0]?.payload as Record<string, unknown>)?.stripe_payment_intent_id).toBe("pi_offsession_unbooked");
    });

    it("an earlier charge still processing parks nothing and charges nothing this run", async () => {
      const fn = await loadConfigured();
      seedHappyPath();
      wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
      wireVisitPayments({});
      stripeMock.paymentIntents.list.mockResolvedValue({ data: [earlier({ status: String("processing"), latest_charge: null })], has_more: false });
      const b = await body(await runOn(fn, "2026-09-01"));
      expect(visitPaymentWrites("insert")).toHaveLength(0);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(insertedVisits()).toHaveLength(0);
      expect(reasons(b)).toContain("still processing; nothing parked");
    });

    it("an earlier charge that stops being adoptable between the two lookups charges nothing off-session", async () => {
      const fn = await loadConfigured();
      seedHappyPath();
      wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
      wireVisitPayments({});
      stripeMock.paymentIntents.list
        .mockResolvedValueOnce({ data: [earlier({ amount: 31000 })], has_more: false })
        .mockResolvedValueOnce({ data: [earlier({ amount: 31000, latest_charge: { id: "ch_r", amount_refunded: 31000 } })], has_more: false });
      const b = await body(await runOn(fn, "2026-09-01"));
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(insertedVisits()).toHaveLength(0);
      expect(visitPaymentWrites("insert")).toHaveLength(0);
      expect(reasons(b)).toContain("no longer adoptable");
    });

    it("a refunded earlier charge is not adopted: the visit is parked as before", async () => {
      const fn = await loadConfigured();
      seedHappyPath();
      wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
      wireVisitPayments({});
      stripeMock.paymentIntents.list.mockResolvedValue({ data: [earlier({ amount: 31000, latest_charge: { id: "ch_r", amount_refunded: 31000 } })], has_more: false });
      const b = await body(await runOn(fn, "2026-09-01"));
      expect(b.awaitingPayment).toBe(1);
      expect(visitPaymentWrites("insert")).toHaveLength(1);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    });
  });

  it("a visit under $300 is still charged off-session exactly as before", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ budget: 250 })] } });
    wireVisitPayments({});

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.paymentIntents.create.mock.calls[0][0].amount).toBeLessThan(30000);
    expect(b.awaitingPayment).toBe(0);
    expect(visitPaymentWrites("insert")).toHaveLength(0);
    expect(insertedVisits()).toHaveLength(1);
  });

  it("a visit still waiting on the payer is neither charged nor re-parked", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
    wireVisitPayments({ preflight: { rows: [{ id: "vp-1", visit_date: VISIT_DATE, status: "pending" }] } });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(b.awaitingPayment).toBe(1);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(visitPaymentWrites("insert")).toHaveLength(0);
    expect(insertedVisits()).toHaveLength(0);
  });

  it("a visit paid on-session is booked on the payer's PaymentIntent with no new charge, then marked funded", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
    wireVisitPayments({
      preflight: {
        rows: [{
          id: "vp-1",
          visit_date: VISIT_DATE,
          status: "paid",
          budget_cents: 30000,
          fee_cents: 1500,
          tax_cents: 0,
          amount_cents: 31500,
          fee_percent: 5,
          tax_calculation_id: null,
          stripe_payment_intent_id: "pi_onsession",
        }],
      },
    });

    await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    const visits = insertedVisits();
    expect(visits).toHaveLength(1);
    const visit = visits[0].payload as Record<string, unknown>;
    expect(visit.stripe_payment_intent_id).toBe("pi_onsession");
    expect(visit.budget).toBe(300);
    const funded = visitPaymentWrites("update").find(
      (w) => (w.payload as Record<string, unknown>).status === "funded",
    );
    expect(funded).toBeTruthy();
    expect(funded!.filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: "status", value: "paid" })]),
    );
  });

  // ── Q1266 (1): a Checkout paid just before Louisiana midnight ─────────────
  // The webhook's narrowed run can start after midnight, when today IS the
  // visit date; it used to skip today and leave the paid visit to the sweep,
  // which refunds it. It now books a PAID row for today, and charges nothing.
  // @mutate supabase/functions/charge-recurring-visits/index.ts | (d > today \|\| (onlyParentId !== null && d === today)) | d > today
  const NARROWED = "00000000-0000-4000-8000-000000001266";
  const paidToday = {
    id: "vp-today", visit_date: VISIT_DATE, status: "paid", budget_cents: 30000, fee_cents: 1500, tax_cents: 0,
    amount_cents: 31500, fee_percent: 5, tax_calculation_id: null, stripe_payment_intent_id: "pi_late",
  };
  it("Q1266 (1): the narrowed run books a visit PAID on-session whose date is today", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
    wireVisitPayments({ preflight: { rows: [paidToday] } });

    await body(await runOn(fn, VISIT_DATE, { at: `${VISIT_DATE}T06:00:00Z`, parentJobId: NARROWED }));

    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    const visits = insertedVisits();
    expect(visits).toHaveLength(1);
    expect((visits[0].payload as Record<string, unknown>).stripe_payment_intent_id).toBe("pi_late");
  });

  it("Q1266 (1) control: the narrowed run never CHARGES for today (a pending row is left alone)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
    wireVisitPayments({ preflight: { rows: [{ ...paidToday, status: "pending", stripe_payment_intent_id: null }] } });

    await body(await runOn(fn, VISIT_DATE, { at: `${VISIT_DATE}T06:00:00Z`, parentJobId: NARROWED }));

    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
  });

  it("a failed visit-payment read skips the series instead of charging it", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
    wireVisitPayments({ preflight: { error: { message: "boom", code: "XX000" } } });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(reasons(b)).toContain("visit-payment read failed");
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
  });

  it("the sweep expires an unpaid visit on its date and refunds a paid one that was never booked", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({
      sweep: {
        rows: [
          { id: "vp-late", parent_job_id: PARENT_ID, visit_date: "2026-09-01", status: "pending", payer_id: POSTER_ID, stripe_payment_intent_id: null, stripe_session_id: "cs_late" },
          { id: "vp-orphan", parent_job_id: PARENT_ID, visit_date: "2026-09-01", status: "paid", payer_id: POSTER_ID, stripe_payment_intent_id: "pi_orphan" },
        ],
      },
    });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];

    await body(await runOn(fn, "2026-09-01"));

    const statuses = visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status);
    expect(statuses).toEqual(expect.arrayContaining(["expired", "refunded"]));
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_orphan" },
      { idempotencyKey: "recurring-visit-refund:pi_orphan" },
    );
    // Review item 1B: the expired visit's Checkout link is closed too, so it can no longer take money.
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_late");
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("Q415 (e): the sweep never refunds an intent that already carries a refund (it would return the withheld fee)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({
      sweep: {
        rows: [
          { id: "vp-orphan", parent_job_id: PARENT_ID, visit_date: "2026-09-01", status: "paid", payer_id: POSTER_ID, stripe_payment_intent_id: "pi_orphan" },
        ],
      },
    });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_prior", status: "succeeded", amount: 9680, metadata: { fee_withheld: "true" } }] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    const statuses = visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status);
    expect(statuses).toEqual(["refunded"]);
    expect(b.errors).toBe(0);
  });

  const orphan = { id: "vp-orphan", parent_job_id: PARENT_ID, visit_date: "2026-09-01", status: "paid", payer_id: POSTER_ID, amount_cents: 10000, stripe_payment_intent_id: "pi_orphan" };

  it("Q415 (e): the sweep settles an intent refunded in full by hand", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_a", status: "succeeded", amount: 6000 }, { id: "re_b", status: "pending", amount: 4000 }] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["refunded"]);
    expect(b.errors).toBe(0);
  });

  it("Q415 (e): the sweep never settles an intent only PART refunded by hand; it pages instead", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_hand", status: "succeeded", amount: 2500 }] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(visitPaymentWrites("update")).toEqual([]);
    const pages = slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical");
    expect(pages).toHaveLength(1);
    expect(JSON.stringify(pages[0])).toContain("$25.00 of the $100.00 owed");
    expect(b.errors).toBe(1);
  });

  const taggedIntent = {
    id: "pi_orphan", amount: 10000, metadata: { refund_withhold_fee: "true" },
    latest_charge: { balance_transaction: { fee: 320 } },
  };

  it("Q415 (e) review: a hand refund of the amount less the fee, on an intent marked fee-withheld, settles", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    otherPiRetrieve.mockResolvedValue(taggedIntent);
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_hand", status: "succeeded", amount: 9680 }] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["refunded"]);
    expect(slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical")).toHaveLength(0);
    expect(b.errors).toBe(0);
  });

  it("Q415 (e) review: an intent marked fee-withheld with no refund yet is refunded less the fee, and the payer is told so", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    otherPiRetrieve.mockResolvedValue(taggedIntent);
    stripeMock.refunds.list.mockResolvedValue({ data: [] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_orphan", amount: 9680, metadata: { fee_withheld: "true" } });
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["refunded"]);
    expect(JSON.stringify(scenario.writes.filter((w) => w.table === "notifications"))).toContain("less the card fee");
    expect(b.errors).toBe(0);
  });

  // ── Q808 (owner, 2026-09-27): the fee is withheld on BOTH paths ──────────
  // A paid visit skipped BEFORE the charge re-read (series ended, date no
  // longer held) never had its intent tagged; the sweep reads the cause.
  const untaggedIntent = { ...taggedIntent, metadata: {} };

  it("Q808: a paid visit of an ENDED series, skipped before the charge re-read (intent untagged), is refunded less the fee", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, live: { rows: [{ id: PARENT_ID, series_ended_on: "2026-08-30" }] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    otherPiRetrieve.mockResolvedValue(untaggedIntent);
    stripeMock.refunds.list.mockResolvedValue({ data: [] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_orphan", amount: 9680, metadata: { fee_withheld: "true" } });
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["refunded"]);
    expect(JSON.stringify(scenario.writes.filter((w) => w.table === "notifications"))).toContain("less the card fee");
    expect(b.errors).toBe(0);
  });

  it("Q808: a paid visit whose date nobody holds any more (intent untagged) is refunded less the fee", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireHolds([]);
    wireVisitPayments({ sweep: { rows: [orphan] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    otherPiRetrieve.mockResolvedValue(untaggedIntent);
    stripeMock.refunds.list.mockResolvedValue({ data: [] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_orphan", amount: 9680, metadata: { fee_withheld: "true" } });
    expect(b.errors).toBe(0);
  });

  it("Q808 review: a paid visit whose date is now held by ANOTHER Helpr (changed hands, intent untagged) is refunded less the fee", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireHolds([{ id: "hold-other", visit_date: "2026-09-01", helper_id: "helper-2" }]);
    wireVisitPayments({ sweep: { rows: [{ ...orphan, helper_id: HELPER_ID }] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    otherPiRetrieve.mockResolvedValue(untaggedIntent);
    stripeMock.refunds.list.mockResolvedValue({ data: [] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_orphan", amount: 9680, metadata: { fee_withheld: "true" } });
    expect(b.errors).toBe(0);
  });

  // Q1246 (3): a CANCELLED parent is over like an ended series, so its paid,
  // unbooked visit is refunded less the fee even while the hold still stands.
  // @mutate supabase/functions/charge-recurring-visits/index.ts | const seriesEndedCause = Boolean(causeParentRow?.series_ended_on) \|\| causeParentRow?.status === "cancelled"; | const seriesEndedCause = Boolean(causeParentRow?.series_ended_on);
  it("Q1246 (3): a paid visit of a CANCELLED parent (series_ended_on unset, hold still standing) is refunded less the fee", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, live: { rows: [{ id: PARENT_ID, series_ended_on: null, status: "cancelled" }] } });
    wireHolds([{ id: "hold-same", visit_date: "2026-09-01", helper_id: HELPER_ID }]);
    wireVisitPayments({ sweep: { rows: [{ ...orphan, helper_id: HELPER_ID }] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    otherPiRetrieve.mockResolvedValue(untaggedIntent);
    stripeMock.refunds.list.mockResolvedValue({ data: [] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_orphan", amount: 9680, metadata: { fee_withheld: "true" } });
    expect(b.errors).toBe(0);
  });

  it("Q808 control: a paid, unbooked visit of a live series whose date is still held by the SAME Helpr is refunded IN FULL", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireHolds([{ id: "hold-same", visit_date: "2026-09-01", helper_id: HELPER_ID }]);
    wireVisitPayments({ sweep: { rows: [{ ...orphan, helper_id: HELPER_ID }] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    otherPiRetrieve.mockResolvedValue(untaggedIntent);
    stripeMock.refunds.list.mockResolvedValue({ data: [] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_orphan" });
    expect(JSON.stringify(scenario.writes.filter((w) => w.table === "notifications"))).not.toContain("less the card fee");
    expect(b.errors).toBe(0);
  });

  it("Q808: an unreadable cause (hold read fails) refunds nothing this run and is a defect", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireHolds({ error: { message: "boom", code: "XX000" } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    otherPiRetrieve.mockResolvedValue(untaggedIntent);
    stripeMock.refunds.list.mockResolvedValue({ data: [] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(visitPaymentWrites("update")).toEqual([]);
    expect(reasons(b)).toContain("could not read why its visit was not booked");
  });

  it("Q415 (e) review: a failed refund of a fee-withheld intent tells ops the withheld amount, not 'in full'", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    otherPiRetrieve.mockResolvedValue(taggedIntent);
    stripeMock.refunds.list.mockResolvedValue({ data: [] });
    stripeMock.refunds.create.mockRejectedValue(new Error("card_declined"));

    const b = await body(await runOn(fn, "2026-09-01"));

    const pages = slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical");
    expect(pages).toHaveLength(1);
    expect(JSON.stringify(pages[0])).toContain("$96.80 (the card fee is withheld)");
    expect(visitPaymentWrites("update")).toEqual([]);
    expect(b.errors).toBe(1);
  });

  // ── Q1250 (decided 2026-10-07, money lane): seed series are swept, and page ─
  // A seed (is_seed) series' visit payments are settled by both sweeps exactly
  // like a real one's: a pending row left alone would offer its payer "Pay"
  // forever, and a paid row is real money under the live key. Its payer is
  // told through the Q137 seed boundary (a seed payer is; a real recipient's
  // row is dropped by the trigger). Its money alerts PAGE, untagged: each
  // names a real PaymentIntent that needs a hand refund. A test-mode intent
  // under the live key is classified and skipped (Q891), so a seed fixture
  // never pages for that.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           title: "Paid recurring visit was never booked and the refund failed", |           seed: true, title: "Paid recurring visit was never booked and the refund failed",
  it("Q1250: a SEED series' visit payments are swept like a real one's, and a failed refund pages untagged", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // The sweeps read no is_seed at all (that is the decision), so a seed
    // series' rows are these same rows: what is pinned is how they settle.
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({
      sweep: {
        rows: [
          { id: "vp-seed-late", parent_job_id: PARENT_ID, visit_date: "2026-09-01", status: "pending", payer_id: POSTER_ID, stripe_payment_intent_id: null, stripe_session_id: null },
          orphan,
        ],
      },
    });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    stripeMock.refunds.list.mockResolvedValue({ data: [] });
    stripeMock.refunds.create.mockRejectedValue(new Error("card_declined"));

    await body(await runOn(fn, "2026-09-01"));

    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["expired"]);
    expect(JSON.stringify(scenario.writes.filter((w) => w.table === "notifications"))).toContain("wasn't paid in time");
    const pages = slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical");
    expect(pages).toHaveLength(1);
    expect((pages[0] as { seed?: boolean }).seed).not.toBe(true);
  });

  it("Q415 (e) re-review: a hand refund of the amount less the fee settles even when the fee-withheld tag was never written", async () => {
    // The tag write and the mid-run refund can fail together (one Stripe
    // outage); ops then refund what the alert named, and must not be paged
    // daily for the fee.
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    otherPiRetrieve.mockResolvedValue({ ...taggedIntent, metadata: {} });
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_hand", status: "succeeded", amount: 9680 }] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["refunded"]);
    expect(slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical")).toHaveLength(0);
    expect(b.errors).toBe(0);
  });

  it("Q415 (e) re-review: a failed refund list on a fee-withheld intent tells ops the withheld amount, not 'in full'", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    otherPiRetrieve.mockResolvedValue(taggedIntent);
    stripeMock.refunds.list.mockRejectedValue(new Error("stripe down"));

    const b = await body(await runOn(fn, "2026-09-01"));

    const pages = slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical");
    expect(pages).toHaveLength(1);
    expect(JSON.stringify(pages[0])).toContain("$96.80 (the card fee is withheld)");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(visitPaymentWrites("update")).toEqual([]);
    expect(b.errors).toBe(1);
  });

  it("Q415 (e) review: a failed refund of an unmarked intent tells ops to refund in full", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    stripeMock.refunds.list.mockResolvedValue({ data: [] });
    stripeMock.refunds.create.mockRejectedValue(new Error("card_declined"));

    await body(await runOn(fn, "2026-09-01"));

    const pages = slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical");
    expect(pages).toHaveLength(1);
    expect(JSON.stringify(pages[0])).toContain("in full");
  });

  it("Q415 (e) review: an unreadable intent is neither refunded nor settled this run", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    otherPiRetrieve.mockRejectedValue(new Error("network"));

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(visitPaymentWrites("update")).toEqual([]);
    expect(b.errors).toBe(1);
  });

  it("Q415 (e): a FAILED or CANCELED earlier refund does not count; the sweep refunds in full", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_f", status: "failed", amount: 10000 }, { id: "re_c", status: "canceled", amount: 10000 }] });

    const b = await body(await runOn(fn, "2026-09-01"));

    // Q809 (2): a key that cannot replay the failed refund (Stripe keeps the
    // plain key's response for a day, failed refund included).
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_orphan" },
      { idempotencyKey: "recurring-visit-refund:pi_orphan:after-re_f" },
    );
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["refunded"]);
    expect(b.errors).toBe(0);
  });

  // Q809 (2) @mutate supabase/functions/charge-recurring-visits/index.ts |         const sweepRefundKey = deadRefunds.length > 0 |         const sweepRefundKey = false
  it("Q809 (2): with no failed refund the sweep keeps the plain per-intent key", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    stripeMock.refunds.list.mockResolvedValue({ data: [] });
    await runOn(fn, "2026-09-01");
    expect(stripeMock.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: "recurring-visit-refund:pi_orphan" });
  });

  // Q809 (review): inside its ~24h key window Stripe REPLAYS the original
  // refund, including one that has since FAILED. createRefundOnce took any
  // answer as done, so the row was settled 'refunded' on money still held.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |   if (created?.status === "failed" \|\| created?.status === "canceled") { |   if (false) {
  it("Q809: a refund Stripe answers as 'failed' (a replay) is never settled as refunded; ops is told to refund by hand", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    stripeMock.refunds.list.mockResolvedValue({ data: [] });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_replayed", status: "failed", failure_reason: "expired_or_canceled_card" });
    await runOn(fn, "2026-09-01");
    expect(visitPaymentWrites("update")).toHaveLength(0);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /refund failed/.test(a.title))).toBe(true);
  });

  // Q809 (4): a booked visit that was RESCHEDULED has date_needed != the
  // payment's visit_date; matched by date it read as never booked and was
  // refunded while the Helpr still came. Matched on its own PaymentIntent.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |         .eq("parent_job_id", row.parent_job_id)\n        .eq("stripe_payment_intent_id", pi)\n        .limit(1); |         .eq("parent_job_id", row.parent_job_id)\n        .eq("date_needed", row.visit_date)\n        .eq("stripe_payment_intent_id", pi)\n        .limit(1);
  it("Q809 (4): the sweep finds a paid visit's booking by its PaymentIntent, never by its (movable) date", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, existing: { rows: [{ id: "visit-moved" }] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    await runOn(fn, "2026-09-01");
    const bookedRead = scenario.readQueries.find((q) => q.table === "jobs" && q.cols === "id" && q.filters.some((f) => f.column === "stripe_payment_intent_id"));
    expect(bookedRead, JSON.stringify(scenario.readQueries.filter((q) => q.table === "jobs"))).toBeDefined();
    expect(bookedRead!.filters.some((f) => f.column === "date_needed")).toBe(false);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["funded"]);
  });

  // Q809 (3): a payment no bigger than the card fee returns nothing: the
  // payer is never told "refunded" for $0.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |             ? ((refundParams.amount ?? 0) > 0 ? "Your visit payment was refunded, less the card fee" : "Your visit payment couldn't be refunded") |             ? "Your visit payment was refunded, less the card fee"
  it("Q809 (3): a fee-withheld visit whose fee eats the whole payment is not announced as refunded", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ sweep: { rows: [orphan] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    otherPiRetrieve.mockResolvedValue({ ...taggedIntent, latest_charge: { balance_transaction: { fee: 10000 } } });
    stripeMock.refunds.list.mockResolvedValue({ data: [] });
    await runOn(fn, "2026-09-01");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    const told = JSON.stringify(scenario.writes.filter((w) => w.table === "notifications"));
    expect(told).toContain("couldn't be refunded");
    expect(told).not.toContain("We refunded $0.00");
  });

  it("Q415 (e): an idempotency conflict whose only prior refund FAILED is still a failed refund", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.writeErrors.jobs = {
      message: `series_date_unheld: ${PARENT_ID} on ${VISIT_DATE} is not held by this Helpr`,
      code: "23514",
    };
    stripeMock.refunds.create.mockRejectedValue(Object.assign(new Error("idempotency"), { type: "StripeIdempotencyError" }));
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_f", status: "failed", amount: 9680 }] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical")).toHaveLength(1);
    expect(b.errors).toBe(1);
  });

  // An on-session visit's intent is a stub { id }: the amount comes from the visit-payment row.
  function paidOnSession() {
    wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
    wireVisitPayments({
      preflight: {
        rows: [{
          id: "vp-1", visit_date: VISIT_DATE, status: "paid", budget_cents: 30000, fee_cents: 1500, tax_cents: 0,
          amount_cents: 31500, fee_percent: 5, tax_calculation_id: null, stripe_payment_intent_id: "pi_onsession",
        }],
      },
    });
    scenario.writeErrors.jobs = {
      message: "series_ended: the series ended on 2026-09-03; no new visit (2026-09-04)",
      code: "23514",
    };
  }

  it("Q415 (e): an on-session visit refused as ended, fee read fails: the fee is estimated on the row's amount, never NaN", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    paidOnSession();
    otherPiRetrieve.mockRejectedValue(new Error("network"));

    const b = await body(await runOn(fn, "2026-09-01"));

    // 2.9% + 30c of $315 = $9.44 withheld.
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_onsession", amount: 30556, metadata: { fee_withheld: "true" } });
    const notes = scenario.writes.filter((w) => w.table === "notifications" && JSON.stringify(w.payload).includes("We refunded"));
    expect(JSON.stringify(notes)).toContain("We refunded $305.56");
    expect(JSON.stringify(notes)).not.toContain("NaN");
    expect(b.skippedEnded).toBe(1);
  });

  it("Q415 (e): a charged amount nobody can read is paged, never sent to Stripe as NaN", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    paidOnSession();
    wireVisitPayments({
      preflight: {
        rows: [{
          id: "vp-1", visit_date: VISIT_DATE, status: "paid", budget_cents: 30000, fee_cents: 1500, tax_cents: 0,
          amount_cents: null, fee_percent: 5, tax_calculation_id: null, stripe_payment_intent_id: "pi_onsession",
        }],
      },
    });
    otherPiRetrieve.mockRejectedValue(new Error("network"));

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical")).toHaveLength(1);
    expect(b.errors).toBe(1);
  });

  it("Q415 (e): an on-session visit refused as ended, fee read works: Stripe's real fee is withheld", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    paidOnSession();
    otherPiRetrieve.mockResolvedValue({
      id: "pi_onsession", amount: 31500, amount_received: 31500,
      latest_charge: { balance_transaction: { fee: 944 } },
    });

    await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_onsession", amount: 30556, metadata: { fee_withheld: "true" } });
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toContain("refunded");
  });

  // ── Q750 (3): Stripe's answer to a refund that already happened ──────────
  // Past the key's 24h a second full refund is refused with code
  // `charge_already_refunded` (docs.stripe.com/error-codes), not replayed.
  it("Q750 (3): a refund Stripe answers 'charge_already_refunded', with a live refund on the intent, is done — no page", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    paidOnSession();
    otherPiRetrieve.mockResolvedValue({ id: "pi_onsession", amount: 31500, amount_received: 31500, latest_charge: { balance_transaction: { fee: 944 } } });
    stripeMock.refunds.create.mockRejectedValue(
      Object.assign(new Error("Charge ch_1 has already been refunded."), { type: "StripeInvalidRequestError", code: "charge_already_refunded" }),
    );
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_prior", status: "succeeded", amount: 30556, metadata: { fee_withheld: "true" } }] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical")).toHaveLength(0);
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toContain("refunded");
    expect(b.errors).toBe(0);
  });

  it("Q750 (3): 'charge_already_refunded' with no live refund on the intent is still a failed refund (paged)", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    paidOnSession();
    otherPiRetrieve.mockResolvedValue({ id: "pi_onsession", amount: 31500, amount_received: 31500, latest_charge: { balance_transaction: { fee: 944 } } });
    stripeMock.refunds.create.mockRejectedValue(
      Object.assign(new Error("Charge ch_1 has already been refunded."), { type: "StripeInvalidRequestError", code: "charge_already_refunded" }),
    );
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_f", status: "canceled", amount: 30556 }] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(slackAlerts.filter((a) => (a as { severity?: string }).severity === "critical")).toHaveLength(1);
    expect(b.errors).toBe(1);
  });

  // ── Q750 (1)/(4): a series that is OVER settles its future visits now ────
  // On main a paid visit of an ended series sat held until its date, and a
  // pending one kept a payable Checkout open until its date. Over or not is
  // read from the parent (jobs: id, status, series_ended_on), and only the
  // over parents' rows are read and capped (lh-money-escrow review).
  const OVER_ID = "series-over";
  const ENDED_PARENT = { id: PARENT_ID, status: "accepted", series_ended_on: "2026-08-31" };
  const aheadPaid = {
    id: "vp-ahead", parent_job_id: PARENT_ID, visit_date: VISIT_DATE, status: "paid", payer_id: POSTER_ID,
    helper_id: HELPER_ID, amount_cents: 10000, stripe_payment_intent_id: "pi_ahead", stripe_session_id: "cs_ahead",
  };
  const aheadPending = { ...aheadPaid, id: "vp-ahead-pending", status: "pending", stripe_payment_intent_id: null };
  /** The (c) read: open future rows of the series that are over. */
  const overRowsQuery = () =>
    scenario.readQueries.filter((r) => r.table === "recurring_visit_payments" && r.cols.includes("created_at"));

  it("Q750 (1): a PAID future visit of an ENDED series is refunded now (less the fee, Q808), and the date is not re-parked", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({
      series: { rows: [seriesParent({ budget: 300, series_ended_on: "2026-08-31" })] },
      live: { rows: [{ id: PARENT_ID, series_ended_on: "2026-08-31" }] },
      over: { rows: [ENDED_PARENT] },
    });
    wireVisitPayments({ ahead: { rows: [aheadPaid] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    otherPiRetrieve.mockResolvedValue({ id: "pi_ahead", amount: 10000, metadata: {}, latest_charge: { balance_transaction: { fee: 320 } } });
    stripeMock.refunds.list.mockResolvedValue({ data: [] });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_ahead", amount: 9680, metadata: { fee_withheld: "true" } });
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["refunded"]);
    // Q750 (2): an ended series never re-parks the refunded date.
    expect(visitPaymentWrites("insert")).toHaveLength(0);
    expect(b.skippedEnded).toBe(1);
    expect(b.errors).toBe(0);
  });

  // Review of Q750 (lh-money-escrow, 2026-10-03): the booked check must still
  // run first. If it stopped matching, the payer would be refunded on a
  // PaymentIntent the booked child's escrow still pays the Helpr from.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |       if (booked && booked.length > 0) { |       if (false) {
  it("Q750 (1) review: a PAID future visit of an ENDED series that is already BOOKED on that intent is marked funded, never refunded", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({
      series: { rows: [] },
      // The booked-child lookup (`jobs.select("id")` by parent, date and intent).
      existing: { rows: [{ id: "child-1" }] },
      live: { rows: [{ id: PARENT_ID, series_ended_on: "2026-08-31" }] },
      over: { rows: [ENDED_PARENT] },
    });
    wireVisitPayments({ ahead: { rows: [aheadPaid] } });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    const writes = visitPaymentWrites("update").map((w) => w.payload as Record<string, unknown>);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ status: "funded", child_job_id: "child-1" });
    const booked = scenario.readQueries.find((r) => r.table === "jobs" && r.cols === "id");
    expect(booked?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "stripe_payment_intent_id", value: "pi_ahead" }),
    ]));
    expect(b.errors).toBe(0);
  });

  it("Q750 (4): a PENDING future visit of an ENDED series is expired and its Checkout closed, so it can no longer take money", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, over: { rows: [ENDED_PARENT] } });
    wireVisitPayments({ ahead: { rows: [aheadPending] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];

    const b = await body(await runOn(fn, "2026-09-01"));

    const expired = visitPaymentWrites("update");
    expect(expired.map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["expired"]);
    expect(expired[0].filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "status", value: "pending" })]));
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_ahead");
    const told = JSON.stringify(scenario.writes.filter((w) => w.table === "notifications"));
    expect(told).toContain("The series ended");
    expect(told).not.toContain("wasn't paid in time");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(b.errors).toBe(0);
  });

  it("Q750 (4): a PENDING future visit of a series whose parent was CANCELLED is expired and its Checkout closed", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, over: { rows: [{ id: PARENT_ID, status: "cancelled", series_ended_on: null }] } });
    wireVisitPayments({ ahead: { rows: [aheadPending] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];

    await body(await runOn(fn, "2026-09-01"));

    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["expired"]);
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_ahead");
  });

  // ── Q1247 (c): the Checkout closes BEFORE the row is expired ──────────────
  // On main the row was flipped to expired first and its Checkout closed
  // after: a Checkout completed in between was refunded in full by the
  // webhook (the row was no longer pending), while this sweep had already
  // told the payer "you weren't charged".
  // @mutate supabase/functions/charge-recurring-visits/index.ts |               if (s?.status === "complete") { |               if (false) {
  // @mutate supabase/functions/charge-recurring-visits/index.ts |             if (!closed) { |             if (false) {
  it("Q1247 (c): the visit's Checkout is closed before its row is expired", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, over: { rows: [ENDED_PARENT] } });
    wireVisitPayments({ ahead: { rows: [aheadPending] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    let rowWritesAtClose = -1;
    stripeMock.checkout.sessions.expire.mockImplementation(async () => {
      rowWritesAtClose = visitPaymentWrites("update").length;
      return { status: "expired" };
    });

    await body(await runOn(fn, "2026-09-01"));

    expect(rowWritesAtClose).toBe(0);
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["expired"]);
  });

  it("Q1247 (c): a Checkout completed mid-sweep is left for the webhook; the payer is never told they weren't charged", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, over: { rows: [ENDED_PARENT] } });
    wireVisitPayments({ ahead: { rows: [aheadPending] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    stripeMock.checkout.sessions.expire.mockRejectedValue(new Error("Only Checkout Sessions with a status in [\"open\"] can be expired."));
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_ahead", status: "complete" });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(visitPaymentWrites("update")).toHaveLength(0);
    expect(JSON.stringify(scenario.writes.filter((w) => w.table === "notifications"))).not.toContain("weren't charged");
    expect(b.errors).toBe(0);
  });

  it("Q1247 (c) review: a visit-date row whose Checkout was paid but never settled pages (money captured, nothing booked)", async () => {
    // @mutate supabase/functions/charge-recurring-visits/index.ts |                 if (!overIds.has(String(row.id))) { |                 if (false) {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({
      sweep: { rows: [{ id: "vp-late", parent_job_id: PARENT_ID, visit_date: "2026-09-01", status: "pending", payer_id: POSTER_ID, stripe_payment_intent_id: null, stripe_session_id: "cs_late" }] },
    });
    stripeMock.checkout.sessions.expire.mockRejectedValue(new Error("Only Checkout Sessions with a status in [\"open\"] can be expired."));
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_late", status: "complete" });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(visitPaymentWrites("update")).toHaveLength(0);
    expect(reasons(b)).toContain("the webhook never settled it");
  });

  it("Q1247 (c): a Checkout that could not be closed and still reads open is not expired this run, and says so", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, over: { rows: [ENDED_PARENT] } });
    wireVisitPayments({ ahead: { rows: [aheadPending] } });
    stripeMock.checkout.sessions.expire.mockRejectedValue(new Error("stripe 503"));
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_ahead", status: "open" });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(visitPaymentWrites("update")).toHaveLength(0);
    expect(reasons(b)).toContain("could not be closed");
  });

  it("Q1247 (c): a Checkout Stripe already expired is closed: the row is expired and the payer told", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, over: { rows: [ENDED_PARENT] } });
    wireVisitPayments({ ahead: { rows: [aheadPending] } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    stripeMock.checkout.sessions.expire.mockRejectedValue(new Error("Only Checkout Sessions with a status in [\"open\"] can be expired."));
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_ahead", status: "expired" });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["expired"]);
    expect(JSON.stringify(scenario.writes.filter((w) => w.table === "notifications"))).toContain("The series ended");
    expect(b.errors).toBe(0);
  });

  it("Q750 (1) control: future visits of a LIVE, merely PAUSED (disputed) or unread series are left alone, and their rows are never read", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({
      series: { rows: [] },
      over: {
        rows: [
          { id: PARENT_ID, status: "accepted", series_ended_on: null },
          { id: "series-disputed", status: "disputed", series_ended_on: null },
          // "series-unread" has an open row but no parent came back.
        ],
      },
    });
    wireVisitPayments({
      openParents: { rows: [{ parent_job_id: PARENT_ID }, { parent_job_id: "series-disputed" }, { parent_job_id: "series-unread" }] },
      // Would be settled if it were ever asked for.
      ahead: { rows: [aheadPaid, aheadPending] },
    });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(overRowsQuery()).toHaveLength(0);
    expect(visitPaymentWrites("update")).toEqual([]);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(b.errors).toBe(0);
  });

  // Q750 (1), owner 2026-10-05: KEEP HOLDING. A paid visit of a series that is
  // only PAUSED (the holder banned, the pair blocked, the date unheld, a
  // chargeback stop) is neither refunded nor marked: if the series resumes the
  // visit happens; if it ends, the over-series sweep refunds it; if its date
  // passes unbooked, the stale sweep does.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           results.skippedBanned++;\n          continue;\n        }\n        if (blockedHolders.has(holderId)) { |           await stripe.refunds.create({ payment_intent: String(visitPayments.get(visitDate)?.stripe_payment_intent_id) });\n          results.skippedBanned++;\n          continue;\n        }\n        if (blockedHolders.has(holderId)) {
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           results.skippedBlocked++;\n          continue; |           await stripe.refunds.create({ payment_intent: String(visitPayments.get(visitDate)?.stripe_payment_intent_id) });\n          results.skippedBlocked++;\n          continue;
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           // (owner decision 5: an unfilled date is not charged).\n          results.skippedUnfilled++; |           // (owner decision 5: an unfilled date is not charged).\n          await stripe.refunds.create({ payment_intent: String(visitPayments.get(visitDate)?.stripe_payment_intent_id) });\n          results.skippedUnfilled++;
  it("Q750 (1): a PAID visit of a merely PAUSED series (holder banned, blocked, date unheld, chargeback stop) keeps being held", async () => {
    const paid = {
      id: "vp-paid", visit_date: VISIT_DATE, status: "paid", budget_cents: 30000, fee_cents: 1500, tax_cents: 0,
      amount_cents: 31500, fee_percent: 5, tax_calculation_id: null, stripe_payment_intent_id: "pi_onsession",
    };
    for (const pause of ["banned", "blocked", "unheld", "chargeback"] as const) {
      resetStripeMock(); resetSupabaseMock(); resetSharedMocks();
      const fn = await loadConfigured();
      seedHappyPath();
      wireJobsReads({
        series: { rows: [seriesParent({ budget: 300 })] },
        chargeback: pause === "chargeback" ? { rows: [{ id: "visit-0", payment_status: "chargeback" }] } : undefined,
      });
      wireVisitPayments({ preflight: { rows: [paid] } });
      if (pause === "banned") {
        scenario.reads.profiles = {
          ...scenario.reads.profiles,
          selectOverrides: [
            { includes: "ban_status", result: { rows: [{ user_id: HELPER_ID, ban_status: "permanently_banned", auto_suspended_until: null }] } },
          ],
        };
      }
      if (pause === "blocked") scenario.rpc.are_users_blocked = true;
      if (pause === "unheld") wireHolds([]);

      const b = await body(await runOn(fn, "2026-09-01"));

      expect(stripeMock.refunds.create, pause).not.toHaveBeenCalled();
      expect(visitPaymentWrites("update"), pause).toEqual([]);
      expect(insertedVisits(), pause).toHaveLength(0);
      expect(stripeMock.paymentIntents.create, pause).not.toHaveBeenCalled();
      expect(b.errors, pause).toBe(0);
    }
  });

  // Q750 (2), owner 2026-10-05: CHARGE FRESH, on-session. A date whose paid
  // visit was refunded is parked as a NEW pending row (a new Checkout, a new
  // intent); the refunded row's intent is never booked.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |         const paidRow = visitPayment?.status === "paid" && visitPayment.stripe_payment_intent_id |         const paidRow = visitPayment?.stripe_payment_intent_id
  // @mutate supabase/functions/charge-recurring-visits/index.ts |           .in("visit_date", due)\n          .in("status", ["pending", "paid"]), |           .in("visit_date", due),
  it("Q750 (2): a date whose paid visit was REFUNDED is re-parked as a new payment, never booked on the refunded intent", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ budget: 300 })] } });
    wireVisitPayments({
      preflight: {
        rows: [{
          id: "vp-refunded", visit_date: VISIT_DATE, status: "refunded", budget_cents: 30000, fee_cents: 1500, tax_cents: 0,
          amount_cents: 31500, fee_percent: 5, tax_calculation_id: null, stripe_payment_intent_id: "pi_was_refunded",
        }],
      },
    });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(insertedVisits()).toHaveLength(0);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    const parked = visitPaymentWrites("insert");
    expect(parked).toHaveLength(1);
    expect((parked[0].payload as Record<string, unknown>).status).toBe("pending");
    expect(b.awaitingPayment).toBe(1);
    // Only live rows are read: a refunded one never stands in for a payment.
    const pre = scenario.readQueries.find((r) => r.table === "recurring_visit_payments" && r.cols.includes("budget_cents"));
    expect(pre?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "in", column: "status", value: ["pending", "paid"] }),
    ]));
  });

  // Review of Q750 (lh-money-escrow, 2026-10-03): the 500 cap used to count
  // EVERY open future row, so a busy day of live series crowded out the rows
  // of a series that had ended. Now only the over parents' rows are read.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |             .in("parent_job_id", chunk) |             .in("parent_job_id", parentIds)
  // @mutate supabase/functions/charge-recurring-visits/index.ts |       .filter((p) => Boolean(p.series_ended_on) \|\| p.status === "cancelled") |       .filter(() => true)
  // Each half of "over" on its own (re-review 2026-10-04): an ended series that
  // is not cancelled (this test), and a cancelled one (the test above).
  // @mutate supabase/functions/charge-recurring-visits/index.ts |       .filter((p) => Boolean(p.series_ended_on) \|\| p.status === "cancelled") |       .filter((p) => p.status === "cancelled")
  // @mutate supabase/functions/charge-recurring-visits/index.ts |       .filter((p) => Boolean(p.series_ended_on) \|\| p.status === "cancelled") |       .filter((p) => Boolean(p.series_ended_on))
  // (c) reads only rows dated after today; today's and older rows are the stale sweep's.
  // @mutate supabase/functions/charge-recurring-visits/index.ts |             .gt("visit_date", today)\n            .order("id", { ascending: true }),\n      );\n      const overDefect |             .order("id", { ascending: true }),\n      );\n      const overDefect
  it("Q750 (1) review: 600 open rows of live series do not crowd out an ended series; only its rows are read", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    const liveParents = Array.from({ length: 600 }, (_, i) => ({ parent_job_id: `live-${String(i).padStart(3, "0")}` }));
    wireJobsReads({
      series: { rows: [] },
      over: {
        rows: [
          ...liveParents.map((p) => ({ id: p.parent_job_id, status: "accepted", series_ended_on: null })),
          { id: OVER_ID, status: "accepted", series_ended_on: "2026-08-31" },
        ],
      },
    });
    wireVisitPayments({
      openParents: { rows: [...liveParents, { parent_job_id: OVER_ID }] },
      ahead: { rows: [{ ...aheadPending, parent_job_id: OVER_ID }] },
    });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];

    const b = await body(await runOn(fn, "2026-09-01"));

    const reads = overRowsQuery();
    expect(reads).toHaveLength(1);
    expect(reads[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "in", column: "parent_job_id", value: [OVER_ID] }),
      expect.objectContaining({ op: "gt", column: "visit_date", value: "2026-09-01" }),
      expect.objectContaining({ op: "in", column: "status", value: ["pending", "paid"] }),
    ]));
    expect(visitPaymentWrites("update").map((w) => (w.payload as Record<string, unknown>).status)).toEqual(["expired"]);
    expect(reasons(b)).not.toMatch(/500|later runs/);
    expect(b.errors).toBe(0);
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |       if (seriesOverRows.length > 500) { |       if (false) {
  it("Q750 (1) review: more than 500 open rows of series that are over settles 500 this run and says so", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, over: { rows: [ENDED_PARENT] } });
    const many = Array.from({ length: 501 }, (_, i) => ({ ...aheadPending, id: `vp-${i}`, stripe_session_id: null }));
    wireVisitPayments({ openParents: { rows: [{ parent_job_id: PARENT_ID }] }, ahead: { rows: many } });
    scenario.writeSelectRows.notifications = [{ id: "n1" }];

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(visitPaymentWrites("update")).toHaveLength(500);
    expect(reasons(b)).toContain("501 future visits of series that are over; 500 settle this run");
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |     if (openDefect) fail( |     if (false) fail(
  it("Q750 (1): the future-visit parent read asks only for open rows dated after today, and a failed read is a defect", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] } });
    wireVisitPayments({ openParents: { error: { message: "boom", code: "XX000" } } });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(reasons(b)).toContain("visit-payment sweep of future visits: open future visit payments read failed: boom");
    const q = scenario.readQueries.find((r) => r.table === "recurring_visit_payments" && r.cols === "parent_job_id");
    expect(q?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "gt", column: "visit_date", value: "2026-09-01" }),
      expect.objectContaining({ op: "in", column: "status", value: ["pending", "paid"] }),
    ]));
    expect(overRowsQuery()).toHaveLength(0);
  });

  // @mutate supabase/functions/charge-recurring-visits/index.ts |     if (parentsDefect) fail( |     if (false) fail(
  it("Q750 (1): an unreadable parent end state is a defect, and no parent that was not read is treated as over", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [] }, over: { error: { message: "boom", code: "XX000" } } });
    wireVisitPayments({ ahead: { rows: [aheadPaid] } });

    const b = await body(await runOn(fn, "2026-09-01"));

    expect(reasons(b)).toContain("series of open future visit payments");
    expect(overRowsQuery()).toHaveLength(0);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Q891: a Stripe id minted under the TEST key, read under the LIVE key
  // ═══════════════════════════════════════════════════════════════════════
  //
  // A series funded before prod went live (2026-09-27) holds a test-mode
  // PaymentIntent. The live key answers "No such payment_intent: ...; a similar
  // object exists in test mode, but a live mode key was used" with code
  // resource_missing, the SAME code as a genuinely missing intent. No real money
  // is behind it: never a charge, never a "no saved card" email to the poster,
  // never a defect, never a refund. ONE structured log line, and the run stays 200.
  // Controls (any other error still fails closed) already exist above: "Stripe
  // not answering about the series' card is a defect ..." and "Q415 (e) review:
  // an unreadable intent is neither refunded nor settled this run".
  describe("Q891: a test-mode Stripe id read under the live key", () => {
    let skips: ReturnType<typeof captureTestModeSkips>;
    beforeEach(() => {
      skips = captureTestModeSkips();
    });
    afterEach(() => {
      skips.restore();
    });

    function expectNoMoneyNoPage(res: Response, b: Record<string, unknown>) {
      expect(res.status).toBe(200);
      expect(reasons(b)).toBe("");
      expect(b.errors).toBe(0);
      expect(slackAlerts).toHaveLength(0);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(insertedVisits()).toHaveLength(0);
      expect(scenario.writes.filter((w) => w.table === "notifications")).toHaveLength(0);
    }

    // @mutate supabase/functions/charge-recurring-visits/index.ts | logTestObjectUnderLiveKey("charge-recurring-visits", { parent_job_id: parent.id, visit_date: visitDate, object: "payment_intent", id: card.paymentIntentId }); |
    // @mutate supabase/functions/charge-recurring-visits/index.ts | if (isTestObjectUnderLiveKey(e)) return { kind: "test_object", paymentIntentId }; |
    it("a series whose saved-card intent is a test-mode object: no charge, no poster email, no defect", async () => {
      const fn = await loadConfigured();
      seedHappyPath();
      seriesPiRetrieve.mockRejectedValue(testModeUnderLiveKey("payment_intent", SERIES_PI));

      const res = await runOn(fn, "2026-09-01");
      const b = await body(res);

      expectNoMoneyNoPage(res, b);
      // Not a "no saved card" decline either: that path emails the poster.
      expect(b.declined).toBe(0);
      expect(b.funded).toBe(0);
      expect(skips.lines()).toEqual([
        expect.objectContaining({
          event: "stripe_test_object_under_live_key",
          fn: "charge-recurring-visits",
          object: "payment_intent",
          id: SERIES_PI,
          parent_job_id: PARENT_ID,
          visit_date: VISIT_DATE,
        }),
      ]);
    });

    // @mutate supabase/functions/charge-recurring-visits/index.ts | logTestObjectUnderLiveKey("charge-recurring-visits", { visit_payment_id: row.id, object: "payment_intent", id: pi }); | throw readErr;
    it("a paid, never-booked visit whose intent is a test-mode object: no refund, no row flip, no defect", async () => {
      const fn = await loadConfigured();
      seedHappyPath();
      wireJobsReads({ series: { rows: [] } });
      wireVisitPayments({ sweep: { rows: [{ ...orphan, stripe_payment_intent_id: "pi_test_old" }] } });
      otherPiRetrieve.mockRejectedValue(testModeUnderLiveKey("payment_intent", "pi_test_old"));

      const res = await runOn(fn, "2026-09-01");
      const b = await body(res);

      expectNoMoneyNoPage(res, b);
      expect(stripeMock.refunds.list).not.toHaveBeenCalled();
      // The row is left as it is: nothing was refunded, so it is never marked refunded.
      expect(visitPaymentWrites("update")).toEqual([]);
      expect(skips.lines()).toEqual([
        expect.objectContaining({
          event: "stripe_test_object_under_live_key",
          fn: "charge-recurring-visits",
          object: "payment_intent",
          id: "pi_test_old",
          visit_payment_id: "vp-orphan",
        }),
      ]);
    });
  });
});
