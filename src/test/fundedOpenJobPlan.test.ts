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
 * @mutate e2e/prod-audit/deep-links.spec.ts | const funded = await ensureFundedOpenJob(request, browser, poster, helper); | const funded = { log: [] as string[] };
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  FUNDED_FIXTURE_TITLE,
  MIN_RUNWAY_DAYS,
  planFundedOpenJob,
  type FixtureRow,
} from "../../e2e/prod-audit/fundedOpenJobPlan";

const TODAY = "2026-09-23";
let n = 0;
const row = (over: Partial<FixtureRow> = {}): FixtureRow => ({
  id: `job-${++n}`,
  title: `${FUNDED_FIXTURE_TITLE}: hang two shelves`,
  status: "open",
  payment_status: "escrow",
  helper_id: null,
  date_needed: "2026-10-23",
  created_at: `2026-09-${String(10 + n).padStart(2, "0")}T00:00:00Z`,
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
    const old = row({ date_needed: "2026-09-27" });
    const p = plan([old]);
    expect(p.reuse).toBeNull();
    expect(p.pay).toBe("new");
    expect(p.retire.map((x) => x.row.id)).toEqual([old.id]);
    expect(p.retire[0].why).toMatch(/runway/);
  });

  it("keeps a fixture with exactly MIN_RUNWAY_DAYS left", () => {
    const edge = row({ date_needed: "2026-09-30" });
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
    const ensure = code.search(/await ensureFundedOpenJob\(/);
    const resolveAt = code.search(/fx = await resolveFixtures\(/);
    expect(ensure, `${f} reads openJob but never calls ensureFundedOpenJob`).toBeGreaterThan(-1);
    expect(ensure, `${f} resolves fixtures before the funded job exists`).toBeLessThan(resolveAt);
  });
});
