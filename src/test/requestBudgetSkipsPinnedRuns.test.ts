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
 *
 * Q702 (2026-09-27): e2e-journeys pins with a `scenario` input instead, read
 * through the job-level `SCENARIO: ${{ inputs.scenario }}`; a pinned run
 * failed "no sample for this label". Both pinning inputs are inventoried, and
 * the env var may sit on the step or on its job.
 */
// @mutate .github/workflows/prod-audit.yml | --label prod-audit ${GREP:+--ceiling-only --allow-empty} | --label prod-audit
// @mutate .github/workflows/e2e-journeys.yml | --label journeys ${SCENARIO:+--ceiling-only --allow-empty} | --label journeys
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DIR = join(process.cwd(), ".github", "workflows");

type Step = { run?: string; if?: string; env?: Record<string, string> };
type Doc = {
  on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
  jobs?: Record<string, { env?: Record<string, string>; steps?: Step[] }>;
};

/** Dispatch inputs that narrow a run to a subset of its tests. */
const PIN_INPUTS = ["grep", "scenario"] as const;

type Pinned = { where: string; input: string; step: Step; env: Record<string, string> };

function pinnableBudgetSteps(): Pinned[] {
  const out: Pinned[] = [];
  for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const doc = parse(readFileSync(join(DIR, file), "utf8")) as Doc | null;
    const inputs = doc?.on?.workflow_dispatch?.inputs ?? {};
    for (const input of PIN_INPUTS.filter((i) => inputs[i])) {
      for (const [name, job] of Object.entries(doc?.jobs ?? {})) {
        for (const step of job?.steps ?? []) {
          if (typeof step.run === "string" && step.run.includes("scripts/e2e/request-budget.mjs")) {
            out.push({ where: `${file}#${name}`, input, step, env: { ...(job.env ?? {}), ...(step.env ?? {}) } });
          }
        }
      }
    }
  }
  return out;
}

describe("request budget never judges a grep-pinned run per test", () => {
  const steps = pinnableBudgetSteps();

  it("finds the pinnable budgeted workflows", () => {
    // 2026-09-27: prod-audit, e2e-abuse-notifications (grep) and both
    // e2e-journeys jobs (scenario). None found means the inventory broke and
    // every assertion below passes vacuously.
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.some((s) => s.input === "scenario")).toBe(true);
  });

  it("every such budget step skips a pinned run or judges only the ceiling", () => {
    const skips = ({ step, input }: Pinned) =>
      new RegExp(`inputs\\.${input}\\s*==\\s*''`).test(String(step.if ?? ""));
    const ceilingOnly = ({ step, input, env }: Pinned) =>
      Object.entries(env).some(
        ([k, v]) =>
          new RegExp(`inputs\\.${input}\\b`).test(String(v)) && step.run!.includes(`\${${k}:+--ceiling-only`),
      );
    const ungated = steps.filter((p) => !skips(p) && !ceilingOnly(p)).map(({ where, input }) => `${where} (${input})`);
    expect(ungated).toEqual([]);
  });
});
