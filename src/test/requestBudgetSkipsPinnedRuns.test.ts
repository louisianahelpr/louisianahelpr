/**
 * A workflow whose dispatch can pin a subset of tests (a `grep` input) never
 * judges that subset against the request budget.
 *
 * e2e/request-budgets.json holds per-test figures measured over a whole suite.
 * A pinned run is a different mix: prod-audit.yml run 36216759390 (2026-09-26)
 * ran only the 3 shell-spacing route walkers and failed "perTest 700 is over
 * its budget 93.5" plus "signIns 0 ... stale budget", neither of which was true
 * of the suite.
 *
 * Inventory: every workflow in .github/workflows with a workflow_dispatch
 * `grep` input, read from the parsed YAML; each step there that runs
 * scripts/e2e/request-budget.mjs must either skip a pinned run
 * (`inputs.grep == ''` in its `if`) or judge it by the load ceiling only
 * (`GREP: ${{ inputs.grep }}` plus `${GREP:+--ceiling-only}`, PR #1815).
 */
// @mutate .github/workflows/prod-audit.yml | ${GREP:+--ceiling-only} | 
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DIR = join(process.cwd(), ".github", "workflows");

type Step = { run?: string; if?: string; env?: Record<string, string> };
type Doc = {
  on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
  jobs?: Record<string, { steps?: Step[] }>;
};

function pinnableBudgetSteps(): { where: string; step: Step }[] {
  const out: { where: string; step: Step }[] = [];
  for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const doc = parse(readFileSync(join(DIR, file), "utf8")) as Doc | null;
    if (!doc?.on?.workflow_dispatch?.inputs?.grep) continue;
    for (const [name, job] of Object.entries(doc.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (typeof step.run === "string" && step.run.includes("scripts/e2e/request-budget.mjs")) {
          out.push({ where: `${file}#${name}`, step });
        }
      }
    }
  }
  return out;
}

describe("request budget never judges a grep-pinned run per test", () => {
  const steps = pinnableBudgetSteps();

  it("finds the pinnable budgeted workflows", () => {
    // 2 on 2026-09-26 (prod-audit, e2e-abuse-notifications); none found means
    // the inventory broke and every assertion below passes vacuously.
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });

  it("every such budget step skips a pinned run or judges only the ceiling", () => {
    const skips = (s: Step) => /inputs\.grep\s*==\s*''/.test(String(s.if ?? ""));
    const ceilingOnly = (s: Step) =>
      /inputs\.grep/.test(String(s.env?.GREP ?? "")) && s.run!.includes("${GREP:+--ceiling-only}");
    const ungated = steps
      .filter(({ step }) => !skips(step) && !ceilingOnly(step))
      .map(({ where }) => where);
    expect(ungated).toEqual([]);
  });
});
