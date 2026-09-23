/**
 * The retired $5,000 job price cap is not hard-coded anywhere as a price
 * (docs/OPEN.md Q210(e)). Q202 lowered the cap to $1,000 (MAX_JOB_BUDGET_DOLLARS
 * in supabase/functions/_shared/jobBudgetLimits.ts) but left the admin
 * auto-flag at `job.budget > 5000` (a flag that can never fire, since no job
 * above $1,000 can be posted) and a CollapsedPolicy comment quoting "$5,000
 * maximum". Both now name the shared constant.
 *
 * Inventory: every .ts/.tsx/.mjs/.js file under src/, supabase/functions/,
 * scripts/ and e2e/ (tests excluded: they may name old values to prove a
 * change), comments blanked. A price-shaped 5000 is:
 *   - a "$5,000" / "$5000" in code (a string the user or admin reads);
 *   - 5000 compared with, or assigned to, something named budget or price.
 * Cents amounts (5000 = $50) and limits/timeouts are not prices and do not match.
 * The two files the queue item named are also checked with comments kept.
 *
 * Proven red 2026-09-23 on origin/main bf4007bed: 2 of 3 failed
 * (adminJobsHelpers.ts:105 `job.budget > 5000`; CollapsedPolicy.tsx "$5,000").
 *
 * @mutate src/components/admin/adminJobs/adminJobsHelpers.ts | if (job.budget > MAX_JOB_BUDGET_DOLLARS) { | if (job.budget > 5000) {
 * @mutate src/components/policy/CollapsedPolicy.tsx | $10 minimum, MAX_JOB_BUDGET_DOLLARS maximum") | $10 minimum, $5,000 maximum")
 * @mutate src/components/postjob/BudgetSection.tsx | const overBudgetCap = (parseFloat(budget) \|\| 0) > MAX_JOB_BUDGET_DOLLARS; | const overBudgetCap = (parseFloat(budget) \|\| 0) > 5000;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const FILES = execSync("git ls-files src supabase/functions scripts e2e", { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
  .filter((f) => !/\.test\.(ts|tsx)$|(^|\/)test\/|\.spec\.ts$|\.d\.ts$/.test(f));

const PRICE_5000 = [
  /\$\s*5,?000\b(?!\.\d)/,
  /\b(?:budget|price)\w*[^;\n]{0,30}?(?:[<>]=?|===?|!==?)\s*5,?000\b/i,
  /\b5,?000\s*(?:[<>]=?|===?|!==?)\s*[\w.]*(?:budget|price)/i,
  /\b(?:budget|price)\w*\s*[:=]\s*5,?000\b/i,
];

describe("no hard-coded $5,000 price cap (Q210(e))", () => {
  it("inventory is the real source tree", () => {
    expect(FILES.length).toBeGreaterThan(1000);
  });

  it("no source file writes 5000/5,000 as a price", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const lines = blankComments(read(f)).split("\n");
      lines.forEach((line, i) => {
        if (PRICE_5000.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("the admin auto-flag and the policy comment name the shared $1,000 cap", () => {
    const helpers = read("src/components/admin/adminJobs/adminJobsHelpers.ts");
    expect(helpers).not.toMatch(/\b5,?000\b/);
    expect(helpers).toMatch(/import \{[^}]*\bMAX_JOB_BUDGET_DOLLARS\b[^}]*\} from "@\/lib\/moneyLimits"/);
    expect(blankComments(helpers)).toMatch(/job\.budget > MAX_JOB_BUDGET_DOLLARS/);
    const policy = read("src/components/policy/CollapsedPolicy.tsx");
    expect(policy).not.toMatch(/\b5,?000\b/);
  });
});
