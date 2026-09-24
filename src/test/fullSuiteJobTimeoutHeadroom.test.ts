// A job that runs the WHOLE vitest suite must be given time to finish it.
//
// Measured 2026-09-24: vitest.yml ("Vitest unit tests", a REQUIRED check on
// main) had timeout-minutes: 10 while the suite takes ~8-10 min on a hosted
// runner. Of its last 40 runs, 36 were cancelled with "The job has exceeded
// the maximum execution time of 10m0s", 2 failed, 0 passed — a required
// check that could not pass, reported as "cancelled", not red. test.yml's
// job (lint + typecheck + build + the same suite) took 10.0 and 13.2 min
// against a 15-min limit.
//
// Inventory: every workflow job with a step that runs the full suite
// (`npm test`, or `vitest run` with no file/dir argument).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DIR = join(__dirname, "..", "..", ".github", "workflows");
const MIN_MINUTES = 25;

type Step = { run?: string };
type Job = { steps?: Step[]; "timeout-minutes"?: number };

function runsFullSuite(run: string): boolean {
  for (const line of run.split("\n").map((l) => l.trim())) {
    if (/^npm (run )?test\s*$/.test(line)) return true;
    const m = line.match(/^(?:npx )?vitest run((?:\s+--?[\w-]+(?:=\S+)?)*)\s*$/);
    if (m) return true;
  }
  return false;
}

function fullSuiteJobs() {
  const out: { job: string; minutes: number | undefined }[] = [];
  for (const f of readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const wf = parse(readFileSync(join(DIR, f), "utf8")) as { jobs?: Record<string, Job> };
    for (const [id, job] of Object.entries(wf?.jobs ?? {})) {
      if ((job.steps ?? []).some((s) => typeof s.run === "string" && runsFullSuite(s.run))) {
        out.push({ job: `${f}#${id}`, minutes: job["timeout-minutes"] });
      }
    }
  }
  return out;
}

describe("full-suite vitest jobs have timeout headroom", () => {
  const jobs = fullSuiteJobs();

  it("finds the full-suite jobs (floor: test.yml and vitest.yml on 2026-09-24)", () => {
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect(jobs.map((j) => j.job.split("#")[0]).sort()).toEqual(expect.arrayContaining(["test.yml", "vitest.yml"]));
  });

  it(`every one allows at least ${MIN_MINUTES} minutes (the default 360 counts as enough)`, () => {
    const short = jobs.filter((j) => j.minutes !== undefined && j.minutes < MIN_MINUTES).map((j) => `${j.job}: ${j.minutes}`);
    expect(short, "a full vitest run is ~8-10 min on a hosted runner; a tighter limit reports a cancelled, never-passing check").toEqual([]);
  });

  it("the matcher recognises the full-suite forms and ignores scoped runs", () => {
    expect(runsFullSuite("npm test")).toBe(true);
    expect(runsFullSuite("npx vitest run --reporter=default")).toBe(true);
    expect(runsFullSuite("npx vitest run src/test/foo.test.ts")).toBe(false);
  });
});

// @mutate .github/workflows/vitest.yml | timeout-minutes: 25 | timeout-minutes: 10
// @mutate .github/workflows/test.yml | timeout-minutes: 25 | timeout-minutes: 15
