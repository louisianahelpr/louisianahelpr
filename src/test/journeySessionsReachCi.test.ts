/*
 * CLASS GUARD: every account a journey signs in can be signed in on CI.
 *
 * nightly-red #1719 (e2e-journeys run 36164148002, 2026-09-25): the
 * trailing-icon /complete-profile leg minted the incomplete-e2e account through
 * the service role and returned null when there was no local `.env`. CI never
 * has one, so the leg skipped every night and the skip reporter counted it
 * UNJUSTIFIED, while the PLAYWRIGHT_INCOMPLETE_EMAIL/_PASSWORD secrets (already
 * used by press-every-control, loading-states-refresh, a11y-prod) went unused.
 *
 * Two rules, inventory derived from source:
 *   1. Every role a journey passes to getSession/optionalSession has its
 *      PLAYWRIGHT_<ROLE>_EMAIL and _PASSWORD secrets wired into EVERY job of
 *      e2e-journeys.yml that runs the journeys (fixtures.envCreds reads those
 *      names; without them the role is unreachable in CI).
 *   2. No journey spec gates itself on a local `.env` existing. `.env` is the
 *      off-CI fallback and lives only in fixtures.ts, behind `!process.env.CI`.
 */

// @mutate .github/workflows/e2e-journeys.yml | # Same as the journeys job: trailing-icon's incomplete-e2e leg (#1719).\n      PLAYWRIGHT_INCOMPLETE_EMAIL: ${{ secrets.PLAYWRIGHT_INCOMPLETE_EMAIL }} | # Same as the journeys job: trailing-icon's incomplete-e2e leg (#1719).
// @mutate e2e/journeys/trailing-icon-fields.spec.ts | test.skip(!session, "PLAYWRIGHT_INCOMPLETE_EMAIL | test.skip(!session \|\| !require("node:fs").existsSync(".env"), "PLAYWRIGHT_INCOMPLETE_EMAIL

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const root = join(__dirname, "..", "..");
const JOURNEYS = join(root, "e2e/journeys");
const WORKFLOW = readFileSync(join(root, ".github/workflows/e2e-journeys.yml"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(JOURNEYS).map((p) => ({ rel: relative(root, p), code: blankComments(readFileSync(p, "utf8")) }));

const roles = new Set<string>();
for (const f of files) {
  for (const m of f.code.matchAll(/\b(?:getSession|optionalSession)\(\s*\w+\s*,\s*"(\w+)"/g)) roles.add(m[1]);
}

/** Each workflow job that runs the journeys, as its own text block. */
const jobBlocks = WORKFLOW.split(/\n {2}(?=[\w-]+:\n)/).filter((b) => /npx playwright test --project=journeys/.test(b));

describe("journey sessions reach CI", () => {
  it("inventories the roles and the journey jobs (floors)", () => {
    expect(roles.size).toBeGreaterThan(2);
    expect([...roles]).toEqual(expect.arrayContaining(["poster", "helper", "incomplete"]));
    expect(jobBlocks.length).toBeGreaterThan(1);
  });

  it.each([...roles].sort())("role %s has its password secrets in every journey job", (role) => {
    const key = `PLAYWRIGHT_${role.toUpperCase()}`;
    for (const block of jobBlocks) {
      const name = /^([\w-]+):/.exec(block.trimStart())?.[1] ?? "?";
      for (const suffix of ["EMAIL", "PASSWORD"]) {
        expect(
          block.includes(`${key}_${suffix}: \${{ secrets.${key}_${suffix} }}`),
          `e2e-journeys.yml job "${name}" does not pass ${key}_${suffix}: a journey signs in "${role}", so CI cannot`,
        ).toBe(true);
      }
    }
  });

  it("no journey spec gates on a local .env (the off-CI fallback lives in fixtures.ts only)", () => {
    const offenders = files
      .filter((f) => !f.rel.endsWith("e2e/journeys/fixtures.ts"))
      .filter((f) => f.code.split("\n").some((line) => line.includes("existsSync(") && /["'`]\.env["'`]/.test(line)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
