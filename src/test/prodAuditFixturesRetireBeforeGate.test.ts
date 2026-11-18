/**
 * Q1779 — leaked prod-audit fixtures are retired BEFORE the open-job budget
 * gate counts them, and teardown always runs.
 *
 * prod-audit run 44194466954 (2026-11-17 10:54 PM) failed its first gate:
 * "test account poster-e2e is accumulating open jobs (Q1779): 4 count toward
 * the 5-open-job cap, budget 3". Read-only SQL on 2026-11-18 found the leak:
 * three open, card-HELD (Q2399, job_card_holds state 'scheduled', test mode,
 * no PaymentIntent) cs_test_ fixtures on poster-e2e:
 *   2ca0738c "Prod audit applicant fixture" (2026-11-05)
 *   e9808d5a "Prod audit funded fixture"    (2026-11-07)
 *   9267001a "Prod audit funded fixture"    (2026-11-14)
 * plus the SEED kitchen job (escrow, a seed, kept).
 *
 * Three causes, each pinned here:
 *  1. Every fresh process starts with Stripe mode "unknown", and a cs_test_
 *     row was never retired in that mode (planFundedOpenJob held it, and
 *     retireFundedJob's isPreLive check left it untouched). A HELD card is
 *     released, never refunded, and create-payment picks the key from the
 *     parties, so that hold was never needed for held rows.
 *  2. ensureFundedOpenJob counted the budget BEFORE retiring anything, so once
 *     over budget no run could ever reach its own retire step.
 *  3. messy-input's afterAll retired the applicant fixture only when
 *     ensureFundedApplicantJob had RETURNED; a beforeAll that died after
 *     fund() left the held fixture open for good.
 *
 * Retiring uses the same path as before (create-payment cancel_escrow as
 * poster-e2e). Its held branch notifies only the poster (notifyPosterOnce), and
 * releaseCardHold's one Slack alert carries `seed`, which goes to the daily
 * digest, never to the owner (slack-alerts.ts).
 *
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | return mode === "unknown" && /^cs_test_/.test(row.stripe_session_id ?? "") && !releasesWithoutMoney(row); | return mode === "unknown" && /^cs_test_/.test(row.stripe_session_id ?? "");
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | export const STALE_APPLICANT_FIXTURE_MS = 6 * 3_600_000; | export const STALE_APPLICANT_FIXTURE_MS = 60 * 24 * 3_600_000;
 * @mutate e2e/prod-audit/fundedOpenJob.ts | if (!releasesWithoutMoney(before) && isPreLive(before, stripeMode)) return | if (isPreLive(before, stripeMode)) return
 * @mutate e2e/prod-audit/fundedOpenJob.ts | for (const { row, why } of plan.retire) log.push(`before the gate: ${await retireFundedJob(api, poster, row.id)} — ${why}`); | void plan.retire;
 * @mutate e2e/prod-audit/fundedOpenJob.ts | for (const line of await retireApplicantFixtures(api, poster, helper, { staleOnly: true })) log.push(`stale applicant fixture: ${line}`); | void retireApplicantFixtures;
 * @mutate e2e/prod-audit/messy-input.spec.ts | if (applicantMintTried \|\| runtime.applicantJob) { | if (runtime.applicantJob) {
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  POSTER_OPEN_JOB_BUDGET,
  STALE_APPLICANT_FIXTURE_MS,
  capCountedOpenJobs,
  openJobBudgetProblem,
  planFundedOpenJob,
  staleApplicantFixtures,
  type FixtureRow,
} from "../../e2e/prod-audit/fundedOpenJobPlan";
import { APPLICANT_FIXTURE_TITLE } from "../../e2e/prod-audit/fundedApplicantJob";

const REPO = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(REPO, p), "utf8"));

// The measured state (read-only SQL, 2026-11-18): every open row of poster-e2e.
const fx = (id: string, title: string, payment_status: string, created_at: string, date_needed: string, sess = "cs_test_x"): FixtureRow => ({
  id, title, status: "open", payment_status, helper_id: null, date_needed, created_at, stripe_session_id: sess,
});
const KITCHEN = fx("13025164", "SEED Deep clean a kitchen", "escrow", "2026-10-11T01:54:45Z", "2026-12-05", "");
const APPLICANT = fx("2ca0738c", "Prod audit applicant fixture", "held", "2026-11-05T09:03:28Z", "2026-12-05");
const FUNDED_OLD = fx("e9808d5a", "Prod audit funded fixture", "held", "2026-11-07T16:40:12Z", "2026-12-07");
const FUNDED_NEW = fx("9267001a", "Prod audit funded fixture", "held", "2026-11-14T07:05:34Z", "2026-12-14");
const ABANDONED = fx("04cb786c", "Prod audit accepted fixture", "abandoned", "2026-11-18T03:05:37Z", "2026-12-17", "");
const INCIDENT = [KITCHEN, APPLICANT, FUNDED_OLD, FUNDED_NEW, ABANDONED];
const NOW = Date.parse("2026-11-18T12:00:00Z");

describe("Q1779: leaked held fixtures are retired before the gate (prod-audit 44194466954)", () => {
  it("the measured state is over budget, naming the three leaked fixtures", () => {
    const msg = openJobBudgetProblem(INCIDENT);
    expect(msg).not.toBeNull();
    for (const id of ["2ca0738c", "e9808d5a", "9267001a"]) expect(msg).toContain(id);
  });

  it("a fresh run (Stripe mode unknown) RETIRES a held cs_test_ duplicate and reuses the newest", () => {
    const p = planFundedOpenJob([FUNDED_OLD, FUNDED_NEW], { today: "2026-11-18", appliedJobIds: new Set(), mode: "unknown" });
    expect(p.reuse?.id).toBe("9267001a");
    expect(p.pay).toBeNull();
    expect(p.retire.map((x) => x.row.id)).toEqual(["e9808d5a"]);
    expect(p.preLive ?? []).toEqual([]);
  });

  it("an escrow (charged) cs_test_ duplicate is still never retired blind in an unknown mode", () => {
    const a = { ...FUNDED_OLD, payment_status: "escrow" };
    const b = { ...FUNDED_NEW, payment_status: "escrow" };
    const p = planFundedOpenJob([a, b], { today: "2026-11-18", appliedJobIds: new Set(), mode: "unknown" });
    expect(p.retire).toEqual([]);
    expect(p.preLive?.map((x) => x.row.id)).toEqual([a.id]);
  });

  it("only a STALE applicant fixture is swept by a run that did not mint it", () => {
    expect(STALE_APPLICANT_FIXTURE_MS).toBeGreaterThanOrEqual(2 * 3_600_000); // past any 55-minute leg
    expect(STALE_APPLICANT_FIXTURE_MS).toBeLessThanOrEqual(24 * 3_600_000); // a leak is gone by the next day
    const fresh = { ...APPLICANT, id: "fresh", created_at: new Date(NOW - 30 * 60_000).toISOString() };
    const stale = staleApplicantFixtures([APPLICANT, fresh, FUNDED_OLD], APPLICANT_FIXTURE_TITLE, NOW);
    expect(stale.map((r) => r.id)).toEqual(["2ca0738c"]);
  });

  it("replaying the incident: after the pre-gate retires, the next run is within budget", () => {
    const plan = planFundedOpenJob([FUNDED_OLD, FUNDED_NEW], { today: "2026-11-18", appliedJobIds: new Set(), mode: "unknown" });
    const gone = new Set([...plan.retire.map((x) => x.row.id), ...staleApplicantFixtures(INCIDENT, APPLICANT_FIXTURE_TITLE, NOW).map((r) => r.id)]);
    const left = INCIDENT.filter((r) => !gone.has(r.id));
    expect(capCountedOpenJobs(left).map((r) => r.id).sort()).toEqual(["13025164", "9267001a"]);
    expect(capCountedOpenJobs(left).length).toBeLessThanOrEqual(POSTER_OPEN_JOB_BUDGET);
    expect(openJobBudgetProblem(left)).toBeNull();
  });

  it("ensureFundedOpenJob retires (stale applicant fixtures, then the plan) before the gate, and gates before reusing or minting", () => {
    const src = read("e2e/prod-audit/fundedOpenJob.ts");
    const fn = src.slice(src.indexOf("export async function ensureFundedOpenJob("));
    expect(fn.length).toBeGreaterThan(500);
    const at = (re: RegExp) => fn.search(re);
    const stale = at(/retireApplicantFixtures\(api, poster, helper, \{ staleOnly: true \}\)\)\s*log\.push/);
    const retire = at(/of plan\.retire\) log\.push\(`before the gate: \$\{await retireFundedJob\(/);
    const gate = at(/if \(overBudget\) throw new Error/);
    const reuse = at(/if \(plan\.reuse\)/);
    const mint = at(/createFixtureRow\(api, poster\)/);
    for (const n of [stale, retire, gate, reuse, mint]) expect(n).toBeGreaterThan(0);
    expect(stale).toBeLessThan(gate);
    expect(retire).toBeLessThan(gate);
    expect(gate).toBeLessThan(reuse);
    expect(gate).toBeLessThan(mint);
  });

  it("retireFundedJob never leaves a held fixture untouched for want of a known Stripe mode, and retires as the poster", () => {
    const src = read("e2e/prod-audit/fundedOpenJob.ts");
    const fn = src.slice(src.indexOf("export async function retireFundedJob("), src.indexOf("export async function retireFundedJob(") + 2500);
    expect(fn).toMatch(/if \(!releasesWithoutMoney\(before\) && isPreLive\(before, stripeMode\)\) return/);
    expect(fn).toMatch(/invoke\(api, poster, "create-payment", \{ action: "cancel_escrow", jobId \}\)/);
  });

  it("messy-input's afterAll retires the applicant fixture whenever minting was tried, not only when it returned", () => {
    const src = read("e2e/prod-audit/messy-input.spec.ts");
    const flag = src.search(/applicantMintTried = true;\s*const a = await unlessLivePay\(\(\) => ensureFundedApplicantJob\(/);
    expect(flag).toBeGreaterThan(0);
    const after = src.slice(src.indexOf("test.afterAll("));
    expect(after).toMatch(/if \(applicantMintTried \|\| runtime\.applicantJob\) \{[\s\S]{0,300}?const retired = await retireApplicantFixtures\(/);
  });

  it("the held release path alerts nobody but the test poster: its Slack alert carries seed", () => {
    const hold = read("supabase/functions/_shared/cardHold.ts");
    const rel = hold.slice(hold.indexOf("export async function releaseCardHold("), hold.indexOf("export async function placeOffSessionHold("));
    const alerts = [...rel.matchAll(/postSlackOpsAlert\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) expect(a).toMatch(/seed: job\.is_seed === true/);
    expect(rel).toMatch(/notifyPosterOnce\(db, job, hold, "released"\)/);
  });
});
