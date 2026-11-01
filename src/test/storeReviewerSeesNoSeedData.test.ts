/**
 * App Review sees no seed or test data, like an ordinary member (lead 2026-11-01).
 * The seed visibility helpers waive hiding for an is_seed test account; the App
 * Review account is one (for its own data isolation), so it saw other test jobs
 * (4 open jobs vs a guest's 1, 2026-11-01). The newest definition of each
 * caller helper must hide seed rows from a store_review_accounts member before
 * any waiver. PGlite proof: ~/.lh-pglite/release-seed-hidden.mjs (3x; red
 * without the clause on all three).
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

// @mutate supabase/migrations/20261101160649_store_reviewer_sees_no_seed_data.sql |        EXISTS (SELECT 1 FROM public.store_review_accounts r WHERE r.user_id = p_user_id) |        false
// @mutate supabase/migrations/20261101160649_store_reviewer_sees_no_seed_data.sql |        EXISTS (SELECT 1 FROM public.store_review_accounts r WHERE r.user_id = (SELECT auth.uid()))\n       OR NOT EXISTS ( |        false\n       OR NOT EXISTS (
// @mutate supabase/migrations/20261101160649_store_reviewer_sees_no_seed_data.sql |        EXISTS (SELECT 1 FROM public.store_review_accounts r WHERE r.user_id = (SELECT auth.uid()))\n       OR (\n |        false\n       OR (\n

const defs = effectiveDefs(join(__dirname, "..", "..", "supabase", "migrations"));
const HELPERS: Array<[string, RegExp]> = [
  ["seed_hidden_for", /r\.user_id = p_user_id/],
  ["seed_hidden_in_discovery", /r\.user_id = \(SELECT auth\.uid\(\)\)/],
  ["seed_hidden_from_caller", /r\.user_id = \(SELECT auth\.uid\(\)\)/],
];

describe("store review accounts get no seed waiver", () => {
  it("reads the newest definitions", () => {
    expect(defs.size).toBeGreaterThan(500);
    for (const [fn] of HELPERS) expect(defs.get(fn)?.stmt ?? "").toMatch(/seed_jobs_hidden_publicly\(\)/);
  });

  it.each(HELPERS)("%s: a store_review_accounts member is hidden from before the test-account waiver", (fn, who) => {
    const body = blankSqlComments(defs.get(fn)?.stmt ?? "");
    const tail = body.slice(body.indexOf("seed_jobs_hidden_publicly()"));
    expect(tail).toMatch(/^seed_jobs_hidden_publicly\(\)\s+AND \(\s+EXISTS \(SELECT 1 FROM public\.store_review_accounts r WHERE /);
    expect(tail.slice(0, tail.indexOf("test_accounts t"))).toMatch(who);
    expect(tail.indexOf("store_review_accounts")).toBeLessThan(tail.indexOf("test_accounts t"));
  });
});
