/**
 * The job price cap is ONE number (docs/OPEN.md Q202, owner 2026-09-23:
 * "MAX JOB PRICE $1,000: client constant, server validators, the DB CHECK").
 *
 * The cap used to live in four hand-kept places that only agreed by review:
 * src/lib/moneyLimits.ts (the form), create-payment's URGENT_FEE_CEILING_CENTS
 * literal, the jobs_budget_range / jobs_urgent_fee_ceiling CHECKs and the
 * validate_job_budget() trigger, each with 5000 typed into it. This guard makes
 * the shared module the only place the number is written and reads every other
 * enforcement point back against it:
 *
 *   1. client:  src/lib/moneyLimits.ts RE-EXPORTS the constants from
 *               supabase/functions/_shared/jobBudgetLimits.ts (declares none);
 *   2. server:  create-payment imports the module, refuses a checkout for a
 *               budget outside it, and derives its urgent ceiling from it;
 *   3. DB:      the NEWEST migration defining validate_job_budget(), adding
 *               jobs_budget_range and adding jobs_urgent_fee_ceiling each carries
 *               exactly MAX/MIN (read with comments blanked, any dollar tag);
 *   4. copy:    the post-job budget field states the cap from the constant;
 *   5. seeds:   no fixture budget above the cap (prod-seed.mjs is a script the
 *               schema-fixture guard does not walk).
 *
 * Proven red 2026-09-23 on the unfixed state: with MAX_JOB_BUDGET_DOLLARS back
 * at 5000 the DB half fails (1000 in SQL); each mutation below also fails it.
 *
 * @mutate supabase/functions/_shared/jobBudgetLimits.ts | export const MAX_JOB_BUDGET_DOLLARS = 1000; | export const MAX_JOB_BUDGET_DOLLARS = 5000;
 * @mutate supabase/migrations/20260923154148_job_budget_cap_1000.sql | ADD CONSTRAINT jobs_budget_range CHECK (budget >= 10 AND budget <= 1000); | ADD CONSTRAINT jobs_budget_range CHECK (budget >= 10 AND budget <= 5000);
 * @mutate supabase/migrations/20260923154148_job_budget_cap_1000.sql | IF NEW.budget IS NOT NULL AND NEW.budget > 1000 THEN | IF NEW.budget IS NOT NULL AND NEW.budget > 5000 THEN
 * @mutate supabase/functions/create-payment/index.ts | if (jobBudgetOutOfRange(job.budget)) { | if (false) {
 * @mutate src/components/postjob/BudgetSection.tsx | The most a job can be is {formatDollarsWhole(MAX_JOB_BUDGET_DOLLARS)}. | The most a job can be is $5,000.
 * @mutate src/pages/post-job/useJobDerived.ts | && parseFloat(budget) <= MAX_JOB_BUDGET_DOLLARS); | );
 * @mutate scripts/audit/prod-seed.mjs | budget: [10, 45, 180, 450, 750, 999, 1000][i % 7], | budget: [10, 45, 180, 450, 750, 999, 5000][i % 7],
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import * as shared from "../../supabase/functions/_shared/jobBudgetLimits";
import * as client from "@/lib/moneyLimits";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIGRATIONS = join(ROOT, "supabase/migrations");

/** The CHECK body of the newest migration that ADDs `name` (comments blanked). */
function newestConstraint(name: string): { file: string; check: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort().reverse();
  const re = new RegExp(`ADD\\s+CONSTRAINT\\s+${name}\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*(?:NOT\\s+VALID)?\\s*;`, "gi");
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    const hits = [...sql.matchAll(re)];
    // Every ADD in the newest file must agree (the NOT VALID branch too).
    if (hits.length > 0) return { file: f, check: hits.map((h) => h[1]).join(" ;; ") };
  }
  throw new Error(`no migration adds ${name}`);
}
const numbers = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => Number(m[1]));

describe("job price cap — one constant shared by client, server and DB (Q202)", () => {
  it("is $1,000 in the shared module (the urgent bonus has its own $250 cap, Q210(c))", () => {
    expect(shared.MAX_JOB_BUDGET_DOLLARS).toBe(1000);
    expect(shared.MIN_JOB_BUDGET_DOLLARS).toBe(10);
    // The urgent ceiling is no longer the budget ceiling: urgentBonusCap.test.tsx.
    expect(shared.MAX_URGENT_FEE_DOLLARS).toBeLessThan(shared.MAX_JOB_BUDGET_DOLLARS);
    expect(shared.jobBudgetOutOfRange(1000)).toBe(false);
    expect(shared.jobBudgetOutOfRange(1000.01)).toBe(true);
    expect(shared.jobBudgetOutOfRange(9.99)).toBe(true);
    expect(shared.jobBudgetOutOfRange("abc")).toBe(true);
  });

  it("the client re-exports the shared constants instead of declaring its own", () => {
    expect(client.MAX_JOB_BUDGET_DOLLARS).toBe(shared.MAX_JOB_BUDGET_DOLLARS);
    expect(client.MIN_JOB_BUDGET_DOLLARS).toBe(shared.MIN_JOB_BUDGET_DOLLARS);
    expect(client.MAX_URGENT_FEE_DOLLARS).toBe(shared.MAX_URGENT_FEE_DOLLARS);
    const src = blankComments(read("src/lib/moneyLimits.ts"));
    expect(src).not.toMatch(/export\s+const\s+(MAX_JOB_BUDGET_DOLLARS|MIN_JOB_BUDGET_DOLLARS|MAX_URGENT_FEE_DOLLARS)\b/);
    expect(src).toMatch(/from\s+"\.\.\/\.\.\/supabase\/functions\/_shared\/jobBudgetLimits"/);
  });

  it("create-payment refuses a checkout outside the range and derives its urgent ceiling", () => {
    const src = blankComments(read("supabase/functions/create-payment/index.ts"));
    expect(src).toMatch(/from\s+"\.\.\/_shared\/jobBudgetLimits\.ts"/);
    const escrow = src.slice(src.indexOf('if (action === "escrow")'), src.indexOf('if (action === "release")'));
    expect(escrow).toMatch(/if\s*\(\s*jobBudgetOutOfRange\(job\.budget\)\s*\)\s*\{\s*throw new PublicError/);
    // The cap check runs before any Checkout Session is created.
    expect(escrow.indexOf("jobBudgetOutOfRange(job.budget)")).toBeLessThan(escrow.indexOf("checkout.sessions.create"));
    expect(src).toMatch(/const URGENT_FEE_CEILING_CENTS = MAX_URGENT_FEE_DOLLARS \* 100;/);
    // No budget-sized literal left behind (the old 500000 / 5000 ceiling).
    expect(src).not.toMatch(/URGENT_FEE_CEILING_CENTS\s*=\s*\d/);
  });

  it("the NEWEST validate_job_budget() carries exactly MIN and MAX", () => {
    const def = latestFunctionDefs(MIGRATIONS).get("validate_job_budget");
    expect(def, "validate_job_budget has no live definition").toBeDefined();
    const body = def!.body;
    expect(numbers(body, /NEW\.budget\s*>\s*(\d+)/g), def!.file).toEqual([shared.MAX_JOB_BUDGET_DOLLARS]);
    expect(numbers(body, /NEW\.budget\s*<\s*(\d+)/g), def!.file).toEqual([shared.MIN_JOB_BUDGET_DOLLARS]);
  });

  it("the NEWEST jobs_budget_range and jobs_urgent_fee_ceiling CHECKs carry the same numbers", () => {
    const range = newestConstraint("jobs_budget_range");
    const maxes = numbers(range.check, /budget\s*<=\s*(\d+)/g);
    const mins = numbers(range.check, /budget\s*>=\s*(\d+)/g);
    expect(maxes.length, range.file).toBeGreaterThan(0);
    expect(new Set(maxes), range.file).toEqual(new Set([shared.MAX_JOB_BUDGET_DOLLARS]));
    expect(new Set(mins), range.file).toEqual(new Set([shared.MIN_JOB_BUDGET_DOLLARS]));

    const urgent = newestConstraint("jobs_urgent_fee_ceiling");
    const uMax = numbers(urgent.check, /urgent_fee\s*<=\s*(\d+)/g);
    expect(uMax.length, urgent.file).toBeGreaterThan(0);
    expect(new Set(uMax), urgent.file).toEqual(new Set([shared.MAX_URGENT_FEE_DOLLARS]));
  });

  it("the post-job budget field states the cap from the constant", () => {
    const src = blankComments(read("src/components/postjob/BudgetSection.tsx"));
    expect(src).toMatch(/The most a job can be is \{formatDollarsWhole\(MAX_JOB_BUDGET_DOLLARS\)\}/);
    expect(src).toMatch(/>\s*MAX_JOB_BUDGET_DOLLARS/);
    // …and the step does not read "Done" on a budget submit will refuse.
    const derived = blankComments(read("src/pages/post-job/useJobDerived.ts"));
    expect(derived).toMatch(/budgetComplete = [^;]*<= MAX_JOB_BUDGET_DOLLARS/);
  });

  it("no seed fixture posts a budget above the cap", () => {
    const files = ["scripts/audit/prod-seed.mjs", "e2e/happy-path/seedDataHeavy.ts", "e2e/happy-path/seedData.ts"];
    let seen = 0;
    for (const f of files) {
      const src = blankComments(read(f));
      for (const m of src.matchAll(/\bbudget:\s*(\[[^\]]*\]|\d+(?:\.\d+)?)/g)) {
        const vals = m[1].startsWith("[") ? numbers(m[1], /(\d+(?:\.\d+)?)/g) : [Number(m[1])];
        for (const v of vals) {
          seen++;
          expect(v, `${f}: budget ${v}`).toBeLessThanOrEqual(shared.MAX_JOB_BUDGET_DOLLARS);
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});
