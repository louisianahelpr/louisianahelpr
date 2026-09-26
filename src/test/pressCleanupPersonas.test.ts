// @mutate .github/workflows/press-every-control.yml | PLAYWRIGHT_INCOMPLETE_PASSWORD: ${{ secrets.PLAYWRIGHT_INCOMPLETE_PASSWORD }} # swept persona | NOT_A_SECRET: "" # swept persona
/**
 * CLASS GUARD: the press-every-control clean-up job can sign in as every
 * persona it sweeps.
 *
 * The "Clean up what the presses created" job runs the press script with
 * CLEANUP_SINCE and the script's DEFAULT persona list, and it fails when any
 * persona is not minted ("Not cleaned is not green", Q52). The job has no .env
 * (no service-role key), so a persona is minted only by the password grant from
 * its PLAYWRIGHT_<ROLE>_EMAIL / _PASSWORD secrets. Run 36069319716's clean-up (2026-09-25):
 *
 *   ERROR: no .env at /home/runner/work/louisianahelpr/louisianahelpr/.env.
 *   ::warning::incomplete: Command failed: node …/scripts/test-signin-link.mjs incomplete-e2e --session --json
 *   FAIL: clean-up left 0 residue row(s); personas not minted: incomplete
 *
 * The press job passed PLAYWRIGHT_INCOMPLETE_*; the Sweep step did not.
 * Inventory: every non-anon persona in the script's default list, mapped
 * through PERSONA_ACCOUNT to the secret names prodSession() reads.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import { PERSONA_ACCOUNT } from "../../scripts/audit/pressProdSafety.mjs";

const ROOT = resolve(__dirname, "..", "..");
type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = { env?: Record<string, string>; steps?: Step[] };
const wf = parse(readFileSync(resolve(ROOT, ".github/workflows/press-every-control.yml"), "utf8")) as {
  jobs: Record<string, Job>;
};
const script = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
const defaults = /process\.env\.PERSONAS \?\? "([^"]+)"/.exec(script)?.[1] ?? "";
const personas = defaults.split(",").filter((p) => p && p !== "anon");
// Since Q326 (2026-09-26) the restore/sweep is a step of the press job itself
// (the job that holds the account lock), so a step sees the JOB env plus its own.
const effective = (job: Job | undefined, step: Step | undefined) => ({ ...(job?.env ?? {}), ...(step?.env ?? {}) });
const jobWith = (rx: RegExp) => Object.values(wf.jobs).find((j) => j.steps?.some((s) => rx.test(s.run ?? "")));
const sweepJob = jobWith(/CLEANUP_SINCE=/);
const sweep = sweepJob?.steps?.find((s) => /CLEANUP_SINCE=/.test(s.run ?? ""));
const pressJob = jobWith(/press-wave\.sh|press-every-control\.mjs/);
const press = pressJob?.steps?.find((s) => /press-wave\.sh/.test(s.run ?? "")) ?? pressJob?.steps?.find((s) => /press-every-control\.mjs/.test(s.run ?? ""));
const secretsFor = (persona: string) => {
  const role = String((PERSONA_ACCOUNT as Record<string, string>)[persona] ?? "").toUpperCase();
  return [`PLAYWRIGHT_${role}_EMAIL`, `PLAYWRIGHT_${role}_PASSWORD`];
};

describe("press clean-up signs in as every persona it sweeps", () => {
  it("finds the default personas and the Sweep step (inventory floor)", () => {
    expect(personas.length).toBeGreaterThanOrEqual(4);
    expect(sweep).toBeDefined();
    expect(press).toBeDefined();
  });

  it("the Sweep step carries each persona's password-grant secrets", () => {
    const env = Object.keys(effective(sweepJob, sweep));
    const missing = personas.flatMap(secretsFor).filter((k) => !env.includes(k));
    expect(missing).toEqual([]);
  });

  it("the Sweep step carries every PLAYWRIGHT_* credential the press step has", () => {
    const pressKeys = Object.keys(effective(pressJob, press)).filter((k) => k.startsWith("PLAYWRIGHT_"));
    expect(pressKeys.length).toBeGreaterThanOrEqual(8);
    const env = Object.keys(effective(sweepJob, sweep));
    expect(pressKeys.filter((k) => !env.includes(k))).toEqual([]);
  });
});
