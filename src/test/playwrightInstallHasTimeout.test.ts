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
 * The wrapper's limit only helps if the JOB outlives it. e2e-happy-path.yml
 * had `timeout-minutes: 15` against the wrapper's 900 s (15 min) per-attempt
 * limit: on 2026-10-01 (push run 36904969418) apt fetched at 38 kB/s ("Fetched
 * 29.0 MB in 12min 40s"), the tests started at 18:26:31 and the job was
 * cancelled at 18:28:07 — a cancel that files no failure and blocks main. So
 * every job that installs must leave room for one full attempt plus the rest
 * of the job: timeout-minutes >= per-attempt limit + INSTALL_HEADROOM_MIN.
 *
 * Inventory: every `run:` step of every job in .github/workflows, read from
 * the parsed YAML so a comment cannot satisfy or trip it.
 */
// @mutate .github/workflows/vacuity.yml | run: bash scripts/ci/playwright-install.sh chromium webkit | run: npx playwright install --with-deps chromium webkit
// @mutate .github/workflows/e2e-happy-path.yml | timeout-minutes: 30 | timeout-minutes: 15
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DIR = join(process.cwd(), ".github", "workflows");
const WRAPPER = "scripts/ci/playwright-install.sh";

type Env = Record<string, unknown> | undefined;
type Step = { run?: string; uses?: string; env?: Env };
type Job = { steps?: Step[]; env?: Env; "timeout-minutes"?: number };

/** The wrapper's own default per-attempt limit, read from the script (never restated). */
function wrapperDefaultLimitSec(): number {
  const m = /LH_PW_INSTALL_TIMEOUT:-(\d+)/.exec(readFileSync(join(process.cwd(), WRAPPER), "utf8"));
  if (!m) throw new Error(`${WRAPPER} no longer has a LH_PW_INSTALL_TIMEOUT default`);
  return Number(m[1]);
}

/** Minutes a job needs beyond one install attempt (checkout, npm install, build, the tests). */
const INSTALL_HEADROOM_MIN = 5;

/** Every job that runs the wrapper, with its timeout and the per-attempt limit that applies to it. */
function installingJobs(): { where: string; timeoutMin: number | undefined; limitSec: number }[] {
  const def = wrapperDefaultLimitSec();
  const out: { where: string; timeoutMin: number | undefined; limitSec: number }[] = [];
  for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const doc = parse(readFileSync(join(DIR, file), "utf8")) as { env?: Env; jobs?: Record<string, Job> } | null;
    for (const [name, job] of Object.entries(doc?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (typeof step.run !== "string" || !step.run.includes(WRAPPER)) continue;
        const set = step.env?.LH_PW_INSTALL_TIMEOUT ?? job.env?.LH_PW_INSTALL_TIMEOUT ?? doc?.env?.LH_PW_INSTALL_TIMEOUT;
        out.push({ where: `${file}#${name}`, timeoutMin: job["timeout-minutes"], limitSec: set === undefined ? def : Number(set) });
      }
    }
  }
  return out;
}

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

  it("gives every installing job room for one full install attempt (no silent cancel)", () => {
    const jobs = installingJobs();
    // Inventory floor: 27 wrapper call sites in 26 jobs on 2026-10-01.
    expect(jobs.length).toBeGreaterThanOrEqual(27);
    const tight = jobs
      .filter((j) => !(typeof j.timeoutMin === "number" && j.timeoutMin >= Math.ceil(j.limitSec / 60) + INSTALL_HEADROOM_MIN))
      .map((j) => `${j.where}: timeout-minutes ${j.timeoutMin ?? "unset"} < ${Math.ceil(j.limitSec / 60)} min install attempt + ${INSTALL_HEADROOM_MIN}`);
    expect(tight).toEqual([]);
  });

  it("only runs the wrapper after the repo is checked out", () => {
    const early = steps.filter((s) => s.run.includes(WRAPPER) && !s.checkedOut).map((s) => s.where);
    expect(early).toEqual([]);
  });
});
