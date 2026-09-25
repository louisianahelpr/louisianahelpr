/**
 * Unit tests for the `charge-recurring-visits` Supabase edge function — the
 * daily cron that funds the next visits of a recurring series by charging the
 * poster's saved card off-session, then creates the job row.
 *
 * This function moves REAL MONEY with nobody present, so the tests below are
 * organised around the four ways it can move it WRONGLY, each of which was live
 * in the source before this pass:
 *
 *   1. A dropped Supabase `error` on the `recurring_visit_releases` read. An
 *      errored read produced `data: null`, which collapsed to an empty Set,
 *      which is indistinguishable from "the helper released nothing" — so the
 *      poster was charged and a helper booked onto a date they had explicitly
 *      given up. Somebody drives to a house on a morning they said they could
 *      not work.
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
 * records with no selection at all, so a poster whose card was saved on another
 * record got "we couldn't charge you" and no visit.
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
// @mutate supabase/functions/charge-recurring-visits/index.ts | `recurring-visit:${parent.id}:${visitDate}`, | `recurring-visit:${parent.id}:${visitDate}:${Math.random()}`,
//   Q356: the cron books a standing helper nobody hired.
// @mutate supabase/functions/charge-recurring-visits/index.ts | if (!parent.helper_id \|\| parent.recurring_helper_id !== parent.helper_id) { | if (false) {
//   Q347: the cron books and charges across a block.
// @mutate supabase/functions/charge-recurring-visits/index.ts | if (blocked === true) { | if (false) {
//   Q347: an unknown block answer books anyway.
// @mutate supabase/functions/charge-recurring-visits/index.ts | if (blockErr) { | if (false) {
//   ME-014: tax charged on a visit never reaches Stripe Tax's filing reports.
// @mutate supabase/functions/charge-recurring-visits/index.ts |         if (taxCalculationId && taxCents > 0) { |         if (false) {
//   ME-014: the fee floor ignores the tax on the same charge.
// @mutate supabase/functions/charge-recurring-visits/index.ts | posterServiceFeeCents(budgetCents, feePercent, taxCents); | posterServiceFeeCents(budgetCents, feePercent, 0);
// Ended series: dropping the series_ended_on term funds a visit after the end.
// @mutate supabase/functions/charge-recurring-visits/index.ts | d <= horizon && (endedOn === null \|\| d <= endedOn) | d <= horizon
// @mutate supabase/functions/charge-recurring-visits/index.ts | Can't make it? Cancel this visit from My Jobs. | Can't make it? Release the date from My Jobs.
// Ended mid-run: a refunded series_ended refusal is reported as a defect (red run for a designed outcome).
// @mutate supabase/functions/charge-recurring-visits/index.ts |           if (seriesEndedMidRun) { |           if (false) {
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type TableResult } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const CRON_SECRET = "cron-secret";

const PARENT_ID = "series-1";
const HELPER_ID = "helper-1";
const POSTER_ID = "poster-1";
/** The visit these tests follow through its three-run funding window. */
const VISIT_DATE = "2026-09-04";
/** `recurring-visit:<series>:<date>` — the key whose reach is 24h, not 3 days. */
const CHARGE_KEY = `recurring-visit:${PARENT_ID}:${VISIT_DATE}`;

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
    date_needed: jobLocalDateISO(-23),
    recurrence_days: [5],
    recurrence_weeks: 4,
    recurring_helper_id: HELPER_ID,
    // The helper hired on visit one; the cron books recurring_helper_id only
    // when it IS this person (Q356).
    helper_id: HELPER_ID,
    status: "accepted",
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
    date_needed: jobLocalDateISO(-50),
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
}) {
  scenario.reads.jobs = {
    ...(opts.existing ?? { rows: [] }),
    selectOverrides: [
      { includes: "recurrence_days", result: opts.series },
      { includes: "stripe_payment_intent_id", result: opts.winner ?? { rows: [] } },
    ],
  };
}

/** The happy-path world: one due visit, no releases, a poster with one card. */
function seedHappyPath() {
  wireJobsReads({ series: { rows: [seriesParent()] } });
  scenario.reads.recurring_visit_releases = { rows: [] };
  scenario.reads.profiles = {
    rows: [{ email: "poster@example.com", subscription_tier: null, subscription_expires_at: null }],
  };
  // The booking notification inserts TWO rows and now checks that two came
  // back; the mock's default single-row answer would read as a half-delivery.
  scenario.writeSelectRows.notifications = [{ id: "n1" }, { id: "n2" }];
  // Poster and standing helper are not blocked (Q347).
  scenario.rpc.are_users_blocked = false;

  stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }] });
  stripeMock.paymentMethods.list.mockResolvedValue({ data: [{ id: "pm_1" }] });
  stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_day1", status: "succeeded" });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_1" });
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
async function runOn(fn: EdgeHarness, ymd: string, opts: { dryRun?: boolean } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${ymd}T06:00:00Z`));
  try {
    return await fn.fetch(
      fn.request({
        url: `https://edge.test/charge-recurring-visits${opts.dryRun ? "?dryRun=1" : ""}`,
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

  // ═══════════════════════════════════════════════════════════════════════
  // Finding 1 — the dropped `recurring_visit_releases` error
  // ═══════════════════════════════════════════════════════════════════════

  it("does not charge for a date the helper released", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    scenario.reads.recurring_visit_releases = { rows: [{ visit_date: VISIT_DATE }] };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(b.skippedReleased).toBe(1);
    expect(b.funded).toBe(0);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
  });

  it("skips the whole series when the releases read FAILS — never charges into an empty release set", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // The exact shape the bug needed: the read errors, so `data` is null. With
    // the error destructured away that collapsed to "nothing was released".
    scenario.reads.recurring_visit_releases = {
      error: { message: "connection reset by peer", code: "08006" },
    };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    // NO money moved, and no visit was booked onto a possibly-released date.
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(insertedVisits()).toHaveLength(0);
    expect(b.funded).toBe(0);

    // And the run says so, loudly enough for the cron sweep to page.
    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(reasons(b)).toContain("release read failed");
    expect(reasons(b)).toContain(PARENT_ID);
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
  // Finding 5 — one email, many Stripe customers
  // ═══════════════════════════════════════════════════════════════════════

  it("charges the customer record that actually holds the saved card, not an arbitrary one", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // Stripe returns newest-first, and a poster who has checked out more than
    // once holds several records on one email. Only the last has the card.
    stripeMock.customers.list.mockResolvedValue({
      data: [{ id: "cus_empty_new" }, { id: "cus_empty_old" }, { id: "cus_has_card" }],
    });
    stripeMock.paymentMethods.list.mockImplementation(
      async ({ customer }: { customer: string }) =>
        customer === "cus_has_card" ? { data: [{ id: "pm_real" }] } : { data: [] },
    );

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    // The old `limit: 1` took `cus_empty_new` and declined a poster whose card
    // was on file all along — the same bug that stopped a paying member
    // cancelling in `pro-customer-portal`.
    expect(b.funded).toBe(1);
    expect(b.declined).toBe(0);
    const charge = stripeMock.paymentIntents.create.mock.calls[0][0];
    expect(charge.customer).toBe("cus_has_card");
    expect(charge.payment_method).toBe("pm_real");
    // Every record has to be reachable for the scan to mean anything.
    expect(stripeMock.customers.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });

  it("still declines — and tells BOTH parties — when no customer record holds a card", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }, { id: "cus_2" }] });
    stripeMock.paymentMethods.list.mockResolvedValue({ data: [] });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(b.declined).toBe(1);
    expect(b.funded).toBe(0);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();

    // The helper is the one who has to physically GO somewhere.
    const notified = scenario.writes
      .filter((w) => w.table === "notifications" && w.op === "insert")
      .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]))
      .map((p) => (p as { user_id: string }).user_id);
    expect(notified).toContain(POSTER_ID);
    expect(notified).toContain(HELPER_ID);

    // A declined card is an OUTCOME, not a defect: it must never page.
    expect(res.status).toBe(200);
    expect(b.ok).toBe(true);
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
    stripeMock.paymentMethods.list.mockResolvedValue({ data: [] });
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

  it("skips (and reports) a series whose recurring_helper_id is not the helper hired on it", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // The Q356 attack shape: recurring_helper_id pointed at someone who never
    // applied, while the parent's hired helper is someone else.
    wireJobsReads({ series: { rows: [seriesParent({ recurring_helper_id: "stranger-9" })] } });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expectNothingBooked(b);
    expect(b.skippedUnhired).toBe(1);
    expect(res.status).toBe(500);
    expect(reasons(b)).toContain(`series ${PARENT_ID}: recurring_helper_id does not match the parent helper_id`);
  });

  it("skips a series whose parent has no hired helper at all", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ helper_id: null })] } });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expectNothingBooked(b);
    expect(b.skippedUnhired).toBe(1);
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

  it("still funds a visit ON the ended series' last date", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    wireJobsReads({ series: { rows: [seriesParent({ series_ended_on: VISIT_DATE })] } });

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.funded).toBe(1);
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect((insertedVisits()[0]?.payload as Record<string, unknown>).date_needed).toBe(VISIT_DATE);
  });

  it("a series ended after this run read it: the refused visit is refunded and the run stays green", async () => {
    const fn = await loadConfigured();
    seedHappyPath();
    // trg_series_visit_within_end's refusal, as PostgREST returns it.
    scenario.writeErrors.jobs = {
      message: "series_ended: the series ended on 2026-09-03; no visit on 2026-09-04",
      code: "23514",
    };

    const res = await runOn(fn, "2026-09-01");
    const b = await body(res);

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
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
      message: "series_ended: the series ended on 2026-09-03; no visit on 2026-09-04",
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
});
