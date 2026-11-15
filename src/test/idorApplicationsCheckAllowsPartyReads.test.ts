/**
 * The abuse-journeys IDOR check on applications tells a party read from a leak.
 *
 * 2026-11-10 (e2e-abuse-notifications 42860928141, nightly red): "neither account can read the other's
 * applications" asserted `[]` on every application the helper account could read with helper_id = the
 * poster. Read on prod 2026-11-15: the one row (b47b1961) sits on job 7f02689d, which the HELPER account
 * owns (seed "SEED TEST Wash two cars", 2026-11-09); the poster account is its applicant. The live policy
 * "Job owners can view applications for their jobs" lets an owner see applicants, so the red was a false
 * SECURITY finding, not a leak.
 *
 * Pinned here: (1) crossAccountApplicationRows keeps every row not on a job the reader owns, drops only
 * owned-job rows, and keeps a row with no job; (2) the spec passes it the reader's own `jobs` read and
 * never excuses rows through an embedded `jobs!inner` (an embed whose job RLS hides DROPS the leaked row).
 *
 * @mutate e2e/journeys/abuse/crossAccountRows.ts | return rows.filter((r) => r.job_id === null \|\| !owned.has(r.job_id)); | return rows.filter((r) => r.job_id !== null && !owned.has(r.job_id));
 * @mutate e2e/journeys/abuse/crossAccountRows.ts | return rows.filter((r) => r.job_id === null \|\| !owned.has(r.job_id)); | return [];
 * @mutate e2e/journeys/abuse/idor-and-authz.spec.ts | crossAccountApplicationRows(helperSeesPosterApps, helperOwnJobs.map((j) => j.id)), | helperSeesPosterApps,
 * @mutate e2e/journeys/abuse/idor-and-authz.spec.ts | `jobs?customer_id=eq.${helperId}&select=id` | `jobs?customer_id=eq.${posterId}&select=id`
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { crossAccountApplicationRows } from "../../e2e/journeys/abuse/crossAccountRows";

const SPEC = resolve(__dirname, "../../e2e/journeys/abuse/idor-and-authz.spec.ts");

describe("crossAccountApplicationRows", () => {
  const rows = [
    { id: "party", job_id: "helper-job" },
    { id: "leak", job_id: "someone-else-job" },
    { id: "orphan", job_id: null },
  ];

  it("drops only rows on jobs the reader owns (the 11-10 seed shape passes)", () => {
    expect(crossAccountApplicationRows([rows[0]], ["helper-job"])).toEqual([]);
  });

  it("keeps a row on a job the reader does not own, and a row with no job", () => {
    expect(crossAccountApplicationRows(rows, ["helper-job"]).map((r) => r.id)).toEqual(["leak", "orphan"]);
  });

  it("an empty owned set excuses nothing", () => {
    expect(crossAccountApplicationRows(rows, []).length).toBe(rows.length);
  });
});

describe("idor-and-authz applications check", () => {
  const code = blankComments(readFileSync(SPEC, "utf8"));

  it("excuses rows only through the reader's own jobs read", () => {
    const calls = code.match(/crossAccountApplicationRows\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(code).toContain("crossAccountApplicationRows(helperSeesPosterApps, helperOwnJobs.map((j) => j.id))");
    expect(code).toMatch(/const helperOwnJobs = [^;]*`jobs\?customer_id=eq\.\$\{helperId\}&select=id`/);
  });

  it("never filters applications through an embedded jobs!inner", () => {
    expect(code).not.toMatch(/applications\?[^`]*jobs!inner/);
  });
});
