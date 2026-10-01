/**
 * Every workflow installs Playwright browsers through
 * scripts/ci/playwright-install.sh, never a bare `npx playwright install`.
 *
 * The bare install has hung with no output until the job's own budget ran
 * out: vacuity.yml's "Guards shown able to fail" job sat 34 min and then
 * 15 min at "Install Playwright browsers" on 2026-10-01 (PR #2006, run
 * 36887972258) and needed a force-cancel, which keeps no log. The wrapper
 * puts a time limit on each attempt and retries, so a hang costs minutes
 * instead of the job.
 *
 * Inventory: every `run:` step of every job in .github/workflows, read from
 * the parsed YAML so a comment cannot satisfy or trip it.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DIR = join(process.cwd(), ".github", "workflows");
const WRAPPER = "scripts/ci/playwright-install.sh";

type Step = { run?: string; uses?: string };
type Job = { steps?: Step[] };

function runSteps(): { where: string; run: string; checkedOut: boolean }[] {
  const out: { where: string; run: string; checkedOut: boolean }[] = [];
  for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const doc = parse(readFileSync(join(DIR, file), "utf8")) as { jobs?: Record<string, Job> } | null;
    for (const [name, job] of Object.entries(doc?.jobs ?? {})) {
      let checkedOut = false;
      for (const step of job?.steps ?? []) {
        if (typeof step.uses === "string" && step.uses.startsWith("actions/checkout")) checkedOut = true;
        if (typeof step.run === "string") out.push({ where: `${file}#${name}`, run: step.run, checkedOut });
      }
    }
  }
  return out;
}

describe("Playwright browser installs in CI", () => {
  const steps = runSteps();

  it("finds the install steps it guards", () => {
    expect(steps.filter((s) => s.run.includes(WRAPPER)).length).toBeGreaterThan(0);
  });

  it("never calls a bare `playwright install`", () => {
    const bare = steps
      .filter((s) => /\bplaywright install\b/.test(s.run))
      .map((s) => s.where);
    expect(bare, `use bash ${WRAPPER} <browsers> instead`).toEqual([]);
  });

  it("only runs the wrapper after the repo is checked out", () => {
    const early = steps.filter((s) => s.run.includes(WRAPPER) && !s.checkedOut).map((s) => s.where);
    expect(early).toEqual([]);
  });
});
