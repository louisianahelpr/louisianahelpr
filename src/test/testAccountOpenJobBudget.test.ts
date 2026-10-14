/**
 * Q1779 — the shared test poster must not accumulate open jobs.
 *
 * core-loop-canary 38619494580 (2026-10-14 18:56Z) died inserting its fixture:
 * "You can have a maximum of 5 open jobs at a time". poster-e2e held 5 jobs the
 * cap counts (live SQL 2026-10-14): the browse fixture plus three "Prod audit
 * funded fixture" rows and one "Prod audit accepted fixture" row, every one
 * cs_test_. Each fresh run starts with Stripe mode "unknown", and the planners
 * treated every cs_test_ fixture as pre-live then: never reused, never retired,
 * so each run paid for another one.
 *
 * Two halves:
 *  1. openJobBudgetProblem (run first by ensureFundedOpenJob, so by the hourly
 *     canary and every prod-audit run) fails BY NAME while two slots are left.
 *     Its count mirrors enforce_open_job_limit, read from the migrations.
 *  2. The planners now REUSE a cs_test_ fixture in an unknown mode
 *     (src/test/fundedOpenJobPlan.test.ts pins that).
 *
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | if (counted.length <= POSTER_OPEN_JOB_BUDGET) return null; | if (counted.length <= OPEN_JOB_CAP) return null;
 * @mutate e2e/prod-audit/fundedOpenJobPlan.ts | const NOT_COUNTED = new Set(["unpaid", "abandoned", "failed"]); | const NOT_COUNTED = new Set(["unpaid", "abandoned", "failed", "escrow"]);
 * @mutate e2e/prod-audit/fundedOpenJob.ts | if (overBudget) throw new Error(overBudget); | void overBudget;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import {
  OPEN_JOB_CAP,
  POSTER_OPEN_JOB_BUDGET,
  capCountedOpenJobs,
  openJobBudgetProblem,
  type CapRow,
} from "../../e2e/prod-audit/fundedOpenJobPlan";

const REPO = join(__dirname, "..", "..");

// The measured incident state (SQL, 2026-10-14 ~19:20Z): poster-e2e's open rows
// the cap counts, plus never-paid open rows it does not count.
const INCIDENT: CapRow[] = [
  { id: "13025164", title: "SEED Deep clean a kitchen", status: "open", payment_status: "escrow", created_at: "2026-10-11T01:54:45Z" },
  { id: "c28c1249", title: "Prod audit funded fixture", status: "open", payment_status: "escrow", created_at: "2026-10-13T21:40:08Z" },
  { id: "50aa0467", title: "Prod audit funded fixture", status: "open", payment_status: "escrow", created_at: "2026-10-13T21:54:40Z" },
  { id: "726b01be", title: "Prod audit accepted fixture", status: "open", payment_status: "escrow", created_at: "2026-10-13T22:17:57Z" },
  { id: "2e109db3", title: "Prod audit funded fixture", status: "open", payment_status: "escrow", created_at: "2026-10-14T16:08:17Z" },
  { id: "abandoned1", title: "SEED Mow and edge a corner lot", status: "open", payment_status: "abandoned", created_at: "2026-10-09T00:00:00Z" },
  { id: "unpaid1", title: "x", status: "open", payment_status: "unpaid", created_at: "2026-10-09T00:00:00Z" },
];

describe("Q1779: the shared poster's open-job budget", () => {
  it("is red on the measured incident state, and names every counted job", () => {
    const msg = openJobBudgetProblem(INCIDENT);
    expect(msg).not.toBeNull();
    for (const id of ["13025164", "c28c1249", "50aa0467", "726b01be", "2e109db3"]) expect(msg).toContain(id);
    expect(msg).not.toContain("abandoned1");
    expect(msg).toMatch(/5 count toward the 5-open-job cap/);
  });

  it("fails while slots remain: one over budget is red, the budget itself is green", () => {
    const counted = capCountedOpenJobs(INCIDENT);
    expect(counted).toHaveLength(5);
    expect(openJobBudgetProblem(counted.slice(0, POSTER_OPEN_JOB_BUDGET + 1))).not.toBeNull();
    expect(openJobBudgetProblem(counted.slice(0, POSTER_OPEN_JOB_BUDGET))).toBeNull();
    expect(POSTER_OPEN_JOB_BUDGET).toBeLessThan(OPEN_JOB_CAP);
  });

  it("never counts a job the cap does not (never-paid, or not open)", () => {
    const rows: CapRow[] = ["unpaid", "abandoned", "failed"].map((p, i) => ({
      id: `n${i}`, title: "t", status: "open", payment_status: p, created_at: "2026-10-01T00:00:00Z",
    }));
    rows.push({ id: "acc", title: "t", status: "accepted", payment_status: "escrow", created_at: "2026-10-01T00:00:00Z" });
    expect(capCountedOpenJobs(rows)).toEqual([]);
  });

  it("mirrors enforce_open_job_limit as the migrations leave it (cap and the statuses it skips)", () => {
    const defs = effectiveDefs(join(REPO, "supabase", "migrations"));
    expect(defs.size).toBeGreaterThan(400);
    const def = defs.get("enforce_open_job_limit");
    expect(def, "no migration defines enforce_open_job_limit").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    const cap = Number(body.match(/open_count\s*>=\s*(\d+)/i)?.[1]);
    expect(cap).toBe(OPEN_JOB_CAP);
    const notIn = body.match(/payment_status[^)]*\)\s*NOT IN\s*\(([^)]*)\)/i)?.[1] ?? "";
    const skipped = [...notIn.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(skipped).toEqual(["abandoned", "failed", "unpaid"]);
    expect(body).toMatch(/status\s*=\s*'open'/);
  });

  it("ensureFundedOpenJob checks the budget before it reads, reuses or mints any fixture", () => {
    const src = blankComments(readFileSync(join(REPO, "e2e/prod-audit/fundedOpenJob.ts"), "utf8"));
    const fn = src.slice(src.indexOf("export async function ensureFundedOpenJob("));
    expect(fn.length).toBeGreaterThan(100);
    const check = fn.search(/if \(overBudget\) throw new Error\(overBudget\);/);
    const firstFixtureRead = fn.search(/FUNDED_FIXTURE_TITLE/);
    expect(check).toBeGreaterThan(0);
    expect(fn.search(/openJobBudgetProblem\(capRows\)/)).toBeGreaterThan(0);
    expect(check).toBeLessThan(firstFixtureRead);
  });
});
