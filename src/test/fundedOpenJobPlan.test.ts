/**
 * Q100 — the funded open job fixture's reuse / refresh / retire decisions.
 *
 * `e2e/prod-audit/fundedOpenJob.ts` pays a real Stripe TEST checkout as
 * poster-e2e only when `planFundedOpenJob` says so. A wrong plan either pays
 * every run (money churn, the five-open-job cap), hands the specs a job the
 * helper already applied to (every apply test then fails on "Already
 * applied"), or lets a fixture age past its date, where auto-expire-jobs
 * cancels it WITHOUT a refund — an orphaned escrow. Each case below pins one.
 *
 * The second half is the wiring: every prod-audit spec whose skip names the
 * missing funded job must call ensureFundedOpenJob in its setup, so the
 * "no fixture" skip (UNJUSTIFIED in prod-audit run 35844514386, 10 of its 15)
 * cannot come back by a new spec forgetting the fixture.
 *
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | else if (opts.appliedJobIds.has(r.id)) retire | else if (opts.appliedJobIds.has(r.id) && false) retire
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | else if (runway < MIN_RUNWAY_DAYS) retire | else if (runway < 0) retire
 * @mutate e2e/prod-audit/deep-links.spec.ts | const funded = await unlessLivePay(() => ensureFundedOpenJob(request, browser, poster, helper)); | const funded = { value: null, livePay: null };
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  ACCEPTED_FIXTURE_TITLE,
  FUNDED_FIXTURE_TITLE,
  LIVE_PAY_SKIP,
  MIN_RUNWAY_DAYS,
  PRE_LIVE_WHY,
  planAcceptedJob,
  planFundedOpenJob,
  type FixtureRow,
  type StripeMode,
} from "../../e2e/prod-audit/fundedOpenJobPlan";

// A fixed era well in the past (jobDayFixtureTimezone: a present-era job
// day is a time bomb). Only the gaps matter: +30, +4 and +7 days.
const TODAY = "2020-01-15";
let n = 0;
const row = (over: Partial<FixtureRow> = {}): FixtureRow => ({
  id: `job-${++n}`,
  title: `${FUNDED_FIXTURE_TITLE}: hang two shelves`,
  status: "open",
  payment_status: "escrow",
  helper_id: null,
  date_needed: "2020-02-14",
  created_at: `2020-01-${String(1 + (n % 14)).padStart(2, "0")}T00:00:00Z`,
  ...over,
});
const plan = (rows: FixtureRow[], applied: string[] = []) =>
  planFundedOpenJob(rows, { today: TODAY, appliedJobIds: new Set(applied) });

describe("planFundedOpenJob", () => {
  it("REUSES a valid funded fixture instead of paying again (idempotent across runs)", () => {
    const r = row();
    const p = plan([r]);
    expect(p).toEqual({ reuse: r, pay: null, retire: [] });
    // Running the plan again on the same state gives the same answer.
    expect(plan([r])).toEqual(p);
  });

  it("pays a NEW job when poster-e2e has none", () => {
    expect(plan([])).toEqual({ reuse: null, pay: "new", retire: [] });
  });

  it("REFRESHES a fixture inside the runway: retires it through cancel_escrow and pays a new one", () => {
    const old = row({ date_needed: "2020-01-19" });
    const p = plan([old]);
    expect(p.reuse).toBeNull();
    expect(p.pay).toBe("new");
    expect(p.retire.map((x) => x.row.id)).toEqual([old.id]);
    expect(p.retire[0].why).toMatch(/runway/);
  });

  it("keeps a fixture with exactly MIN_RUNWAY_DAYS left", () => {
    const edge = row({ date_needed: "2020-01-22" });
    expect(MIN_RUNWAY_DAYS).toBe(7);
    expect(plan([edge]).reuse).toBe(edge);
  });

  it("retires a fixture helper-e2e has applied to, rather than handing the apply tests a used job", () => {
    const used = row();
    const p = plan([used], [used.id]);
    expect(p.reuse).toBeNull();
    expect(p.retire.map((x) => x.row.id)).toEqual([used.id]);
    expect(p.pay).toBe("new");
  });

  it("keeps the NEWEST of two funded fixtures and retires the duplicate", () => {
    const older = row({ created_at: "2026-09-01T00:00:00Z" });
    const newer = row({ created_at: "2026-09-20T00:00:00Z" });
    const p = plan([older, newer]);
    expect(p.reuse).toBe(newer);
    expect(p.retire.map((x) => x.row.id)).toEqual([older.id]);
  });

  it("finishes a refund stuck in 'cancelling' instead of reusing it", () => {
    const stuck = row({ payment_status: "cancelling" });
    const p = plan([stuck]);
    expect(p.reuse).toBeNull();
    expect(p.retire.map((x) => x.row.id)).toEqual([stuck.id]);
  });

  it("re-pays an unpaid fixture a failed run left, rather than minting another", () => {
    const unpaid = row({ payment_status: "unpaid" });
    expect(plan([unpaid])).toEqual({ reuse: null, pay: unpaid, retire: [] });
    const abandoned = row({ payment_status: "abandoned" });
    expect(plan([abandoned]).pay).toBe(abandoned);
  });

  it("ignores rows that are not this fixture: other titles, hired, or not open", () => {
    const other = row({ title: "Deep clean a 3-bed before move-in" });
    const hired = row({ helper_id: "h" });
    const closed = row({ status: "cancelled" });
    expect(plan([other, hired, closed])).toEqual({ reuse: null, pay: "new", retire: [] });
  });
});

/*
 * Stripe went LIVE on prod 2026-09-27. Owner decision that day: nightly
 * journeys skip pay steps in live mode (no 4242 on a live checkout). And the
 * fixtures a TEST key funded before the switch (36eebad4 "Prod audit accepted
 * fixture", 9 more open+escrow from 09-19..09-23) cannot be refunded with the
 * live key: cancel_escrow answered 500 "No such payment_intent ... a similar
 * object exists in test mode, but a live mode key was used" on every run.
 */
describe("Stripe LIVE: no pay step, and pre-live test-mode fixtures are left alone", () => {
  const planIn = (mode: StripeMode, rows: FixtureRow[]) =>
    planFundedOpenJob(rows, { today: TODAY, appliedJobIds: new Set(), mode });
  const preLive = (over: Partial<FixtureRow> = {}) => row({ stripe_session_id: "cs_test_a1B2c3", ...over });

  it("live mode never plans a payment: the would-be pay becomes the justified skip naming the owner decision", () => {
    const p = planIn("live", []);
    expect(p.pay).toBeNull();
    expect(p.skip).toBe(LIVE_PAY_SKIP);
    expect(LIVE_PAY_SKIP).toMatch(/owner decision 2026-09-27/);
    expect(LIVE_PAY_SKIP).toMatch(/nightly skips pay steps in live mode/);
    expect(planIn("live", [row({ payment_status: "unpaid" })]).pay).toBeNull();
  });

  it("test mode still pays (the skip is live-only)", () => {
    expect(planIn("test", []).pay).toBe("new");
    expect(planIn("test", []).skip).toBeUndefined();
  });

  it("a pre-live cs_test_ fixture is neither reused nor retired in live mode, and is logged as such", () => {
    const stuck = preLive({ payment_status: "cancelling" });
    const escrowed = preLive();
    const short = preLive({ date_needed: "2020-01-19" });
    const p = planIn("live", [stuck, escrowed, short]);
    expect(p.reuse).toBeNull();
    expect(p.retire).toEqual([]);
    expect(p.preLive?.map((x) => x.row.id).sort()).toEqual([stuck.id, escrowed.id, short.id].sort());
    expect(p.preLive?.[0].why).toBe(PRE_LIVE_WHY);
    expect(PRE_LIVE_WHY).toBe("pre-live test-mode fixture, not refundable with the live key");
  });

  it("an UNKNOWN mode is treated as live for pre-live rows (never cancel_escrow a cs_test_ row blind)", () => {
    const stuck = preLive({ payment_status: "cancelling" });
    expect(planIn("unknown", [stuck]).retire).toEqual([]);
  });

  it("in test mode a cs_test_ fixture is an ordinary fixture: reused / retired as before", () => {
    const stuck = preLive({ payment_status: "cancelling" });
    expect(planIn("test", [stuck]).retire.map((x) => x.row.id)).toEqual([stuck.id]);
  });

  it("planAcceptedJob: the pre-live accepted fixture (36eebad4 shape) is not retired in live mode, and nothing is paid", () => {
    const fixture = row({
      id: "36eebad4-723c-4205-b0ee-c38052bd6533",
      title: `${ACCEPTED_FIXTURE_TITLE}: fix a sticking screen door`,
      payment_status: "cancelling",
      date_needed: "2020-01-17",
      stripe_session_id: "cs_test_b1XyZ",
    });
    const p = planAcceptedJob([fixture], { today: TODAY, helperId: "h", applications: new Map(), mode: "live" });
    expect(p.retire).toEqual([]);
    expect(p.preLive?.map((x) => x.row.id)).toEqual([fixture.id]);
    expect(p.kind).toBe("skip");
    // The same row in test mode is still retired (the pre-fix behaviour, kept where it is right).
    const t = planAcceptedJob([fixture], { today: TODAY, helperId: "h", applications: new Map(), mode: "test" });
    expect(t.retire.map((x) => x.row.id)).toEqual([fixture.id]);
  });
});

describe("every prod-audit spec that needs the funded open job sets it up", () => {
  const dir = resolve(__dirname, "../../e2e/prod-audit");
  const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.ts"));
  // Code only: a skip message or a comment naming the fixture is what we look for, the call is what we require.
  const needers = specs.filter((f) => /\bfx\.openJob\b|\bf\.openJob\b|\["openJob",/.test(readFileSync(join(dir, f), "utf8")));

  it("finds the specs that read openJob (inventory floor)", () => {
    expect(needers.length).toBeGreaterThan(2);
  });

  it.each(needers)("%s calls ensureFundedOpenJob before resolving fixtures", (f) => {
    const code = blankComments(readFileSync(join(dir, f), "utf8"));
    // Q865: the call sits inside unlessLivePay so a live-pay skip cannot take the whole file.
    const ensure = code.search(/await (?:unlessLivePay\(\(\) => )?ensureFundedOpenJob\(/);
    const resolveAt = code.search(/fx = await resolveFixtures\(/);
    expect(ensure, `${f} reads openJob but never calls ensureFundedOpenJob`).toBeGreaterThan(-1);
    expect(ensure, `${f} resolves fixtures before the funded job exists`).toBeLessThan(resolveAt);
  });
});
