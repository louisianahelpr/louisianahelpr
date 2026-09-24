/**
 * Every CI job that runs the vacuity harness gives it the service-role key.
 *
 * The harness mutates source and re-runs the guard that registered the
 * mutation, including e2e specs that mint prod test sessions through
 * scripts/test-signin-link.mjs — which exits "ERROR: .env is missing
 * VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY" without it. Such a guard
 * is red before any mutation, so the harness reports it INCONCLUSIVE and the
 * run fails: vacuity.yml run 35935153284 (2026-09-23, nightly-red #1731) had 5
 * of 11 registrations inconclusive for exactly that reason, while prod-audit.yml
 * (which also runs the harness) wrote the key and was fine.
 *
 * Inventory: every job in .github/workflows whose steps run the harness
 * (`npm run vacuity…` or `scripts/vacuity/index.mjs`), read from the parsed
 * YAML so comments cannot satisfy it.
 */
// @mutate .github/workflows/vacuity.yml | 'SUPABASE_SERVICE_ROLE_KEY=%s | 'KEY_WRITTEN=%s
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DIR = join(process.cwd(), ".github", "workflows");

type Step = { run?: string };
type Job = { steps?: Step[] };

const RUNS_HARNESS = /npm run vacuity(?!:report)|scripts\/vacuity\/index\.mjs(?![^\n]*--no-mutate)/;
const WRITES_KEY = (run: string) => /SUPABASE_SERVICE_ROLE_KEY=/.test(run) && />>?\s*\.env\b/.test(run);

function harnessJobs(): { where: string; steps: Step[] }[] {
  const out: { where: string; steps: Step[] }[] = [];
  for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const doc = parse(readFileSync(join(DIR, file), "utf8")) as { jobs?: Record<string, Job> } | null;
    for (const [name, job] of Object.entries(doc?.jobs ?? {})) {
      const steps = job?.steps ?? [];
      if (steps.some((s) => typeof s.run === "string" && RUNS_HARNESS.test(s.run))) {
        out.push({ where: `${file}#${name}`, steps });
      }
    }
  }
  return out;
}

describe("vacuity harness jobs can run prod-backed e2e guards", () => {
  const jobs = harnessJobs();

  it("the inventory is read from the workflows", () => {
    // 2026-09-24: vacuity.yml and prod-audit.yml run the harness.
    expect(jobs.length).toBeGreaterThan(1);
    expect(jobs.map((j) => j.where.split("#")[0])).toContain("vacuity.yml");
  });

  it("every harness job writes SUPABASE_SERVICE_ROLE_KEY into .env", () => {
    const missing = jobs
      .filter((j) => !j.steps.some((s) => typeof s.run === "string" && WRITES_KEY(s.run)))
      .map((j) => j.where);
    expect(missing).toEqual([]);
  });
});
