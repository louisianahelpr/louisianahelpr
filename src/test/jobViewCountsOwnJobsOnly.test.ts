/**
 * Q1284 — get_job_view_counts answers only for the caller's own jobs.
 *
 * The SECURITY DEFINER RPC counted distinct viewers for any job ids it was
 * handed, so any signed-in account could read another poster's view counts.
 * 20261005060053 joins jobs and keeps only rows whose customer_id is
 * auth.uid(). This pins the NEWEST definition in the ledger (effectiveDefs
 * replays every migration); the behaviour is proven in
 * src/test/pglite/jobViewCountsOwnJobsOnly.pglite.mjs (2 FAILED on the live
 * body, ALL PASS applied 3x). The class (any client-callable definer body that
 * never reads its caller) is checked live by scripts/check-live-privileges.mjs
 * against the "unscoped" section of scripts/ci/definer-exec-allowlist.json.
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate supabase/migrations/20261005060053_job_view_counts_own_jobs_only.sql |     AND j.customer_id = auth.uid() |     AND j.customer_id IS NOT NULL
// @mutate scripts/ci/definer-exec-allowlist.json |   "unscoped": { |   "unscoped": {\n    "get_job_view_counts(uuid[])": "reviewed 2026-10-05 (Q1284): counts only, fine for anyone to read, no person named at all.",
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();

describe("Q1284: get_job_view_counts is scoped to the caller's own jobs", () => {
  const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
  const def = defs.get("get_job_view_counts");

  it("the newest definition is found", () => {
    expect(def, "no CREATE FUNCTION get_job_view_counts in the migrations").toBeDefined();
    expect(defs.size).toBeGreaterThan(200);
  });

  it("it keeps only jobs whose customer_id is auth.uid()", () => {
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/SECURITY\s+DEFINER/i);
    expect(body).toMatch(/\bcustomer_id\s*=\s*auth\.uid\(\)/i);
  });

  it("the allowlist does not excuse it as unscoped", () => {
    const allow = JSON.parse(readFileSync(join(ROOT, "scripts/ci/definer-exec-allowlist.json"), "utf8"));
    expect(Object.keys(allow.unscoped ?? {})).not.toContain("get_job_view_counts(uuid[])");
  });
});
