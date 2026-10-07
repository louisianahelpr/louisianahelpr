// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |         OR NOT public.seed_review_hidden(reviewer_id, reviewee_id, job_id) |         OR true
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |     AND (p.is_seed IS NOT TRUE OR NOT public.seed_hidden_in_discovery()) |     AND true
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |      AND NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false) |      AND true
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql | REVOKE ALL ON FUNCTION public.seed_review_hidden(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.seed_review_hidden(uuid, uuid, uuid) FROM authenticated;
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |         WHERE me.user_id = p_user_id AND me.is_seed IS TRUE\n          AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = me.user_id) |         WHERE me.user_id = p_user_id AND me.is_seed IS TRUE
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql | AND public.seed_hidden_for(NEW.helper_id) THEN | AND public.seed_jobs_hidden_publicly() THEN
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql | GRANT EXECUTE ON FUNCTION public.seed_hidden_for(uuid) TO service_role; | GRANT EXECUTE ON FUNCTION public.seed_hidden_for(uuid) TO authenticated, service_role;
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql | NOT is_seed OR NOT public.seed_hidden_in_discovery() | NOT is_seed OR NOT public.seed_jobs_hidden_publicly()
//
// Q552 (owner, 2026-10-07: "hide test profiles and test jobs NOW"): the launch
// switch hides test ACCOUNTS too. The four profile read functions are held to
// it by showSeedJobs.parity.test.ts (registered with `via`); this guard holds
// what that one cannot see:
//   * the reviews read POLICY (a policy is not a function),
//   * the predicate's carve-outs (admins and test accounts keep seeing test
//     rows, or the nightly journeys between two test accounts break),
//   * the grants (no anon EXECUTE on the predicates),
//   * the PGlite proof that runs it under the real roles exists for this file.
// Behaviour proof: src/test/pglite/seedSwitchHidesProfiles.pglite.mjs
// (6 RED checks fail without the migration; all pass applied 3x).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "supabase/migrations");
const FILES = migrationFiles(DIR);
const DEFS = effectiveDefs(DIR);
// Known-counterpart reads spare admins; discovery reads do not (the owner browses as an admin).
const READ_PATHS: [string, string][] = [
  ["search_profiles_by_name", "seed_hidden_in_discovery"],
  ["get_safe_profiles", "seed_hidden_from_caller"],
  ["get_public_profile_reviews", "seed_hidden_from_caller"],
  ["get_public_profile_stats", "seed_hidden_from_caller"],
  ["get_parish_activity", "seed_hidden_in_discovery"],
];

/** The newest CREATE POLICY "<name>" ON public.reviews, comments blanked. */
function newestReviewsPolicy(name: string): { file: string; stmt: string } | null {
  let found: { file: string; stmt: string } | null = null;
  for (const f of FILES) {
    const sql = blankSqlComments(readFileSync(resolve(DIR, f), "utf8"));
    const re = new RegExp(`CREATE\\s+POLICY\\s+"${name}"\\s+ON\\s+(?:public\\.)?reviews\\b[\\s\\S]*?;`, "gi");
    for (const m of sql.matchAll(re)) found = { file: f, stmt: m[0] };
  }
  return found;
}

/** The newest GRANT / REVOKE statements naming `fn(` across the migrations, in order. */
function aclStatements(fn: string): string[] {
  const out: string[] = [];
  for (const f of FILES) {
    const sql = blankSqlComments(readFileSync(resolve(DIR, f), "utf8"));
    for (const m of sql.matchAll(new RegExp(`(?:GRANT|REVOKE)[^;]*FUNCTION\\s+public\\.${fn}\\([^;]*;`, "gi"))) out.push(m[0]);
  }
  return out;
}

describe("Q552: the launch switch hides test accounts", () => {
  it("the reviews read policy asks seed_review_hidden, and keeps the writer's and the subject's own reviews", () => {
    expect(FILES.length).toBeGreaterThan(500);
    const p = newestReviewsPolicy("Published reviews visible after reveal");
    expect(p, "no CREATE POLICY for the reviews read").not.toBeNull();
    expect(p!.stmt).toMatch(/NOT\s+public\.seed_review_hidden\(\s*reviewer_id\s*,\s*reviewee_id\s*,\s*job_id\s*\)/);
    expect(p!.stmt).toMatch(/reviewer_id\s*=\s*\(SELECT auth\.uid\(\)\)/);
    expect(p!.stmt).toMatch(/reviewee_id\s*=\s*\(SELECT auth\.uid\(\)\)/);
  });

  it("the predicate reads the launch switch and spares admins and test accounts", () => {
    const d = DEFS.get("seed_hidden_from_caller");
    expect(d, "seed_hidden_from_caller is not defined").toBeDefined();
    const body = blankSqlComments(d!.stmt);
    expect(body).toContain("public.seed_jobs_hidden_publicly()");
    expect(body).toMatch(/NOT\s+COALESCE\(public\.has_role\(\(SELECT auth\.uid\(\)\), 'admin'::app_role\), false\)/);
    expect(body).toMatch(/NOT EXISTS[\s\S]*me\.is_seed IS TRUE/);
    expect(blankSqlComments(DEFS.get("seed_review_hidden")!.stmt)).toContain("public.seed_hidden_from_caller()");
    // Discovery: the switch and the test-account carve-out, and NO admin carve-out.
    const disc = blankSqlComments(DEFS.get("seed_hidden_in_discovery")?.stmt ?? "");
    expect(disc).toContain("public.seed_jobs_hidden_publicly()");
    expect(disc).toMatch(/me\.is_seed IS TRUE/);
    expect(disc).not.toMatch(/has_role/);
  });

  it.each(READ_PATHS)("%s gates the test account row on %s in its newest definition", (fn, predicate) => {
    const d = DEFS.get(fn);
    expect(d, `${fn} is not defined`).toBeDefined();
    expect(blankSqlComments(d!.stmt)).toMatch(new RegExp(`is_seed IS NOT TRUE OR[^\\n]*${predicate}\\(\\)`));
  });

  it("only the self-describing predicate reaches anon; the by-user one reaches no client", () => {
    // seed_hidden_for(uuid) answers "is THIS uuid a test account": no client.
    // seed_hidden_in_discovery() answers only about the caller, and anon NEEDS it:
    // open_jobs_browse calls it and Postgres checks a view's function EXECUTE
    // against the caller.
    const expectAnon: Record<string, boolean> = {
      seed_hidden_for: false,
      seed_hidden_from_caller: false,
      seed_review_hidden: false,
      seed_hidden_in_discovery: true,
    };
    for (const [fn, anonOk] of Object.entries(expectAnon)) {
      const acl = aclStatements(fn);
      expect(acl.length, `${fn} has no grants`).toBeGreaterThan(1);
      expect(acl.some((s) => /REVOKE[\s\S]*FROM\s+PUBLIC\s*,\s*anon/i.test(s)), `${fn}: REVOKE ... FROM PUBLIC, anon`).toBe(true);
      expect(acl.some((s) => /GRANT[\s\S]*\banon\b/i.test(s)), `${fn} granted to anon`).toBe(anonOk);
    }
    expect(aclStatements("seed_hidden_for").some((s) => /GRANT[\s\S]*\bauthenticated\b/i.test(s))).toBe(false);
  });

  it("the job gates spare test accounts by profiles.is_seed, never by anything a member sets", () => {
    const forBody = blankSqlComments(DEFS.get("seed_hidden_for")?.stmt ?? "");
    expect(forBody).toContain("public.seed_jobs_hidden_publicly()");
    expect(forBody).toMatch(/me\.user_id = p_user_id AND me\.is_seed IS TRUE/);
    expect(blankSqlComments(DEFS.get("enforce_application_job_state")!.stmt)).toMatch(
      /COALESCE\(v_job\.is_seed, false\) AND public\.seed_hidden_for\(NEW\.helper_id\)/,
    );
    expect(blankSqlComments(DEFS.get("direct_accept_block_reason")!.stmt)).toMatch(
      /COALESCE\(v_job\.is_seed, false\) AND public\.seed_hidden_for\(p_helper\)/,
    );
    for (const fn of ["get_ranked_open_jobs", "get_open_jobs_for_map"]) {
      expect(blankSqlComments(DEFS.get(fn)!.stmt), fn).toContain("public.seed_hidden_in_discovery() AS seed_hidden");
    }
    // The anon-only landing teaser keeps the plain switch (no test account calls it).
    expect(blankSqlComments(DEFS.get("get_public_open_jobs")!.stmt)).toContain("public.seed_jobs_hidden_publicly()");
  });

  it("the newest open_jobs_browse asks seed_hidden_in_discovery and stays security_invoker = false", () => {
    let stmt = "";
    for (const f of FILES) {
      const sql = blankSqlComments(readFileSync(resolve(DIR, f), "utf8"));
      for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.open_jobs_browse\b[\s\S]*?;/gi)) stmt = m[0];
    }
    expect(stmt.length).toBeGreaterThan(500);
    expect(stmt).toMatch(/WITH\s*\(\s*security_invoker\s*=\s*false\s*\)/i);
    expect(stmt).toContain("NOT public.seed_hidden_in_discovery()");
    expect(stmt).not.toMatch(/NOT\s+(?:public\.)?seed_jobs_hidden_publicly\(\)/);
  });

  it("a test account is ENROLLED by the service role, never derived from is_seed alone (a mailinator sign-up sets is_seed)", () => {
    for (const fn of ["seed_hidden_for", "seed_hidden_in_discovery", "seed_hidden_from_caller"]) {
      expect(blankSqlComments(DEFS.get(fn)?.stmt ?? ""), fn).toMatch(
        /me\.is_seed IS TRUE\s+AND EXISTS \(SELECT 1 FROM public\.test_accounts t WHERE t\.user_id = me\.user_id\)/,
      );
    }
    const mig = blankSqlComments(readFileSync(resolve(DIR, "20261007033530_seed_switch_hides_test_profiles.sql"), "utf8"));
    expect(mig).toMatch(/ALTER TABLE public\.test_accounts ENABLE ROW LEVEL SECURITY;/);
    expect(mig).toMatch(/REVOKE ALL ON public\.test_accounts FROM PUBLIC, anon, authenticated;/);
    expect(mig).not.toMatch(/GRANT[^;]*ON public\.test_accounts TO[^;]*\b(?:anon|authenticated)\b/);
    expect(mig).not.toMatch(/CREATE POLICY[^;]*ON public\.test_accounts/);
  });

  it("both PGlite proofs exist for this migration and assert their RED counts", () => {
    const world = readFileSync(resolve(ROOT, "src/test/pglite/seedSwitchWorld.mjs"), "utf8");
    expect(world).toContain("20261007033530_seed_switch_hides_test_profiles.sql");
    for (const f of ["seedSwitchHidesProfiles.pglite.mjs", "seedSwitchTestAccounts.pglite.mjs"]) {
      const proof = readFileSync(resolve(ROOT, "src/test/pglite", f), "utf8");
      expect(proof, f).toContain('from "./seedSwitchWorld.mjs"');
      expect(proof, f).toMatch(/const expected(?:Red)? = \d+;/);
    }
  });
});
