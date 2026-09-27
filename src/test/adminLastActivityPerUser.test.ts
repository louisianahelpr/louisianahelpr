// @mutate supabase/migrations/20260927231025_admin_last_activity.sql |   GROUP BY a.user_id\n | GROUP BY a.user_id\n  LIMIT 500\n
// @mutate supabase/migrations/20260927231025_admin_last_activity.sql |   WHERE public.has_role((SELECT auth.uid()), 'admin'::public.app_role)\n | \n
// @mutate supabase/migrations/20260927231025_admin_last_activity.sql | FROM PUBLIC, anon; | FROM PUBLIC;
// @mutate src/components/admin/useAdminUserSummaries.ts |     if (rpc.error?.code !== "PGRST202") {\n      const wanted = new Set(userIds);\n      return { data: rpc.data?.filter((r) => wanted.has(r.user_id)) ?? null, error: rpc.error };\n    }\n    const [jobs | {\n      const wanted = new Set(userIds);\n      void wanted; void rpc;\n    }\n    const [jobs
// @mutate src/components/admin/useAdminUserSummaries.ts |       loadLastActivity(userIds),\n |       supabase.from("jobs").select("customer_id, created_at").in("customer_id", userIds).order("created_at", { ascending: false }).limit(500),\n
/*
 * Q819: Admin People built each user's last activity ("Posted Job", "Applied
 * to Job") from the newest 500 jobs and the newest 500 applications across
 * every listed user: the Q428 shape, which drops quieter users once a busy
 * account fills the page. Measured on prod 2026-09-27: 421 jobs, 208
 * applications, so nothing was cut yet.
 *
 * The rule: per-user activity comes from admin_last_activity (GROUP BY
 * user_id, max(), no LIMIT, admin-gated, not executable by anon), and no admin
 * summary read of jobs/applications is bounded outside the PGRST202
 * not-deployed-yet fallback. Executable proof (PGlite, migration applied 3x,
 * 600 jobs for one user plus an older job and application for another): the
 * old read sees 1 user, admin_last_activity returns both; a non-admin gets 0.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase/migrations");
const def = effectiveDefs(MIG).get("admin_last_activity");
const body = blankSqlComments(def?.stmt ?? "");
const file = blankSqlComments(def ? readFileSync(join(MIG, def.file), "utf8") : "");

const HOOK = "src/components/admin/useAdminUserSummaries.ts";
const hook = blankComments(readFileSync(join(process.cwd(), HOOK), "utf8"));

describe("Q819: one user's many jobs cannot hide another user's last activity", () => {
  it("the inventory is real", () => {
    expect(def, "admin_last_activity has no definition in supabase/migrations").toBeTruthy();
    expect(hook).toMatch(/\.from\(\s*"jobs"\s*\)/);
    expect(hook).toMatch(/\.from\(\s*"applications"\s*\)/);
  });

  it("admin_last_activity groups per user, takes the max, and has no LIMIT", () => {
    expect(body).toMatch(/max\(\s*a\.posted_at\s*\)/i);
    expect(body).toMatch(/max\(\s*a\.applied_at\s*\)/i);
    expect(body).toMatch(/GROUP\s+BY\s+a\.user_id/i);
    expect(body).not.toMatch(/\bLIMIT\b/i);
  });

  it("admin_last_activity returns nothing to a non-admin and is not executable by anon", () => {
    expect(body).toMatch(/has_role\(\s*\(\s*SELECT\s+auth\.uid\(\)\s*\)\s*,\s*'admin'/i);
    expect(file).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.admin_last_activity\(\)\s+FROM\s+PUBLIC\s*,\s*anon\s*;/i);
    expect(file).not.toMatch(/GRANT[^;]*admin_last_activity[^;]*\bTO\b[^;]*\banon\b/i);
  });

  it("the activity summary reads admin_last_activity, the bounded reads only on PGRST202", () => {
    expect(hook).toMatch(/loadActivitySummary[\s\S]*?Promise\.all\(\[[\s\S]*?loadLastActivity\(userIds\)[\s\S]*?\]\)/);
    expect(hook).toMatch(/supabase\.rpc\(\s*"admin_last_activity"\s*\)/);
    expect(hook).toMatch(/if\s*\(\s*rpc\.error\?\.code\s*!==\s*"PGRST202"\s*\)\s*\{[^}]*return\b/);
  });

  it("no bounded jobs/applications read in the summary hook sits outside a PGRST202 fallback", () => {
    const reads = [...hook.matchAll(/\.from\(\s*"(?:jobs|applications)"\s*\)[^;]*?\.limit\(/g)];
    // The two PGRST202 fallback reads (jobs, applications) are the inventory.
    expect(reads.length).toBeGreaterThan(1);
    const offenders: string[] = [];
    for (const m of reads) {
      const before = hook.slice(Math.max(0, m.index! - 600), m.index!);
      if (!/"PGRST202"/.test(before)) offenders.push(`${HOOK}@${m.index}`);
    }
    expect(offenders).toEqual([]);
  });
});
