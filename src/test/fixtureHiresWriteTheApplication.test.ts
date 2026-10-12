/**
 * Q1525 (alert-ledger 41f88aeb227f, 2026-10-08 17:00Z): auto-expire-jobs
 * returned 500 with one defect, "job 75aae101 was reopened but no accepted
 * application was found to reject". 75aae101 was a seed job of the e2e pair
 * (helper-e2e hired on it); every real hire goes through accept_application,
 * which writes the Helpr's application as `accepted` in the same transaction
 * (pg_get_functiondef on prod, 2026-10-12), and prod held 0 hired jobs without
 * one when measured (2026-10-12). So the two tables only disagree when a
 * fixture hires by writing the job row alone, and the sweep then reports a
 * defect that is test data, not product.
 *
 * THE CLASS: any e2e/ or scripts/ file that writes a job literal with
 * `status: "accepted"` and a `helper_id` (a hire) must also write the Helpr's
 * accepted application (a literal with job_id, helper_id and status
 * "accepted"), unless it is named in NOT_A_PROD_HIRE with why. Two-way and
 * exact: a stale exemption fails too.
 *
 * @mutate scripts/probes/mint-funded-seed-jobs.prod.mjs | body: { job_id: job.id, helper_id: SEED_HELPER, status: "accepted" } | body: { job_id: job.id, helper_id: SEED_HELPER }
 * @mutate src/test/fixtureHiresWriteTheApplication.test.ts | nothing reaches the database",\n  "scripts/probes/direct-patch-hire | nothing reaches the database",\n  "scripts/probes/gone-patch-hire
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

/** Files that write a hire literal on purpose without the application, and why. */
// @two-way src/test/fixtureHiresWriteTheApplication.test.ts:NOT_A_PROD_HIRE names a file that no longer writes a hire literal
const NOT_A_PROD_HIRE: Record<string, string> = {
  "e2e/happy-path/state-matrix/stateMatrix.ts": "mocked page.route() payloads; nothing reaches the database",
  "e2e/happy-path/state-matrix/state-sweep.spec.ts": "mocked page.route() payloads; nothing reaches the database",
  "scripts/probes/direct-patch-hire.prod.mjs": "proves a direct PATCH hire is REFUSED; its jobs are deleted in finally",
};

const LITERAL = /\{[^{}]*\}/g;
const ACCEPTED = /\bstatus\s*:\s*["']accepted["']/;

function scan(): { hires: string[]; missing: string[] } {
  const files = execSync("git ls-files e2e scripts", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
  const hires: string[] = [];
  const missing: string[] = [];
  for (const f of files) {
    const lits = blankComments(readFileSync(resolve(ROOT, f), "utf8")).match(LITERAL) ?? [];
    const accepted = lits.filter((l) => ACCEPTED.test(l) && /\bhelper_id\b/.test(l));
    if (!accepted.some((l) => !/\bjob_id\b/.test(l))) continue;
    hires.push(f);
    if (!accepted.some((l) => /\bjob_id\b/.test(l))) missing.push(f);
  }
  return { hires, missing };
}

describe("Q1525: a fixture that hires writes the Helpr's accepted application too", () => {
  const { hires, missing } = scan();

  it("the inventory reads e2e/ and scripts/ (floor)", () => {
    expect(hires.length).toBeGreaterThan(4);
    expect(hires).toContain("e2e/journeys/time-travel.spec.ts");
  });

  it("every hire literal outside NOT_A_PROD_HIRE comes with an accepted application", () => {
    expect(missing.filter((f) => !(f in NOT_A_PROD_HIRE)), "write the application accept_application would: { job_id, helper_id, status: \"accepted\" }").toEqual([]);
  });

  it("NOT_A_PROD_HIRE names only files that still write a hire without one", () => {
    expect(Object.keys(NOT_A_PROD_HIRE).filter((f) => !missing.includes(f))).toEqual([]);
  });
});
