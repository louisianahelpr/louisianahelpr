// @mutate supabase/migrations/20260927222725_admin_last_logins.sql |   GROUP BY l.user_id\n | GROUP BY l.user_id\n  LIMIT 500\n
// @mutate supabase/migrations/20260927222725_admin_last_logins.sql |   WHERE public.has_role((SELECT auth.uid()), 'admin'::public.app_role)\n | \n
// @mutate supabase/migrations/20260927222725_admin_last_logins.sql | FROM PUBLIC, anon; | FROM PUBLIC;
// @mutate src/components/admin/useAdminUserSummaries.ts | if (rpc.error?.code !== "PGRST202") { | if (false) {
// @mutate src/components/admin/useAdminUserSummaries.ts |       loadLastLogins(userIds),\n |       supabase.from("login_history").select("user_id, created_at").in("user_id", userIds).order("created_at", { ascending: false }).limit(500),\n
/*
 * Q428: Admin People said "Never logged in" about accounts that had logged in.
 * useAdminUserSummaries took each user's newest login from the newest 500
 * login_history rows across ALL users, so the shared test accounts (hundreds of
 * sign-ins a day) filled the 500 and pushed everyone else out. Measured on prod
 * 2026-09-27: 1507 rows, 8 users with a login, 7 of them inside the newest 500.
 *
 * The class: an admin screen deriving a per-user "newest" value from one
 * globally ordered, LIMITed read. The rule: the per-user last login comes from
 * admin_last_logins (GROUP BY user_id, max(created_at), no LIMIT, admin-gated,
 * not executable by anon), and no admin reader of login_history uses a bounded
 * cross-user read except as the PGRST202 not-deployed-yet fallback.
 * Executable proof (PGlite, 600 logins for one user, one older for another):
 * the old read sees 1 user, admin_last_logins returns both; a non-admin gets 0.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase/migrations");
const def = effectiveDefs(MIG).get("admin_last_logins");
const body = blankSqlComments(def?.stmt ?? "");
const file = blankSqlComments(def ? readFileSync(join(MIG, def.file), "utf8") : "");

const HOOK = "src/components/admin/useAdminUserSummaries.ts";
const hook = blankComments(readFileSync(join(process.cwd(), HOOK), "utf8"));

/** Every admin source file that reads login_history. */
const ADMIN_DIR = join(process.cwd(), "src/components/admin");
const adminReaders = readdirSync(ADMIN_DIR)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
  .map((f) => ({ f, src: blankComments(readFileSync(join(ADMIN_DIR, f), "utf8")) }))
  .filter(({ src }) => /\.from\(\s*"login_history"\s*\)/.test(src));

describe("Q428: one user's many logins cannot hide another user's last login", () => {
  it("the inventory is real", () => {
    expect(def, "admin_last_logins has no definition in supabase/migrations").toBeTruthy();
    // 1 admin reader of login_history on 2026-09-27 (useAdminUserSummaries.ts).
    expect(adminReaders.length).toBeGreaterThan(0);
    expect(adminReaders.map((r) => r.f)).toContain("useAdminUserSummaries.ts");
  });

  it("admin_last_logins groups per user, takes the max, and has no LIMIT", () => {
    expect(body).toMatch(/max\(\s*l\.created_at\s*\)/i);
    expect(body).toMatch(/GROUP\s+BY\s+l\.user_id/i);
    expect(body).not.toMatch(/\bLIMIT\b/i);
  });

  it("admin_last_logins returns nothing to a non-admin and is not executable by anon", () => {
    expect(body).toMatch(/has_role\(\s*\(\s*SELECT\s+auth\.uid\(\)\s*\)\s*,\s*'admin'/i);
    expect(file).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.admin_last_logins\(\)\s+FROM\s+PUBLIC\s*,\s*anon\s*;/i);
    expect(file).not.toMatch(/GRANT[^;]*admin_last_logins[^;]*\bTO\b[^;]*\banon\b/i);
  });

  it("the People list reads last logins from admin_last_logins, the bounded read only on PGRST202", () => {
    expect(hook).toMatch(/loadActivitySummary[\s\S]*?Promise\.all\(\[[\s\S]*?loadLastLogins\(userIds\)[\s\S]*?\]\)/);
    expect(hook).toMatch(/supabase\.rpc\(\s*"admin_last_logins"\s*\)/);
    expect(hook).toMatch(/if\s*\(\s*rpc\.error\?\.code\s*!==\s*"PGRST202"\s*\)\s*\{[^}]*return\b/);
  });

  it("no admin reader of login_history uses a bounded cross-user read outside the PGRST202 fallback", () => {
    const offenders: string[] = [];
    for (const { f, src } of adminReaders) {
      for (const m of src.matchAll(/\.from\(\s*"login_history"\s*\)[^;]*?\.limit\(/g)) {
        const before = src.slice(Math.max(0, m.index! - 600), m.index!);
        if (!/"PGRST202"/.test(before)) offenders.push(`${f}@${m.index}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
