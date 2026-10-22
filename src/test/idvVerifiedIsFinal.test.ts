/**
 * CLASS CHECK (member 7bb3a91e, 2026-10-21): Stripe verified him at 13:54:22Z
 * and its OLDER 'processing' event, delivered 1.6 s later, overwrote
 * 'verified' through stripe-idv-webhook's then-unguarded update
 * (helper_verifications: verified -> processing at 13:54:24Z). His paid job's
 * "On the way" step is ID-gated.
 *
 * The class is "a verified ID drops back to a non-decision", from ANY writer,
 * so the guard is at the table. Read from the code that ships (the EFFECTIVE
 * SQL definitions, comments blanked):
 *   1. profiles_idv_verified_is_final raises 42501 when a verified row moves to
 *      anything but 'failed', unless lh.idv_admin_reset = 'on';
 *   2. its trigger is BEFORE UPDATE on profiles, named to fire last (zz_);
 *   3. the only setter of lh.idv_admin_reset is admin_idv_request_reupload,
 *      service_role only, and admin-user-actions' request_id_reupload calls it;
 *   4. the webhook's own write stays guarded (NOT IN (verified,failed)).
 *
 * Behaviour: src/test/pglite/idvVerifiedIsFinal.pglite.mjs (14 [fix] checks;
 * NEW_MIGRATION=skip -> 7 FAILED, all [keep] green both ways; 3x replay).
 *
 * @mutate supabase/migrations/20261022010525_idv_verified_leaves_only_by_decision.sql |      AND NEW.idv_status IS DISTINCT FROM 'failed'\n |      AND NEW.idv_status IS DISTINCT FROM 'failed'\n     AND NEW.idv_status IS DISTINCT FROM 'processing'\n
 * @mutate supabase/migrations/20261022010525_idv_verified_leaves_only_by_decision.sql |   BEFORE UPDATE ON public.profiles |   AFTER UPDATE ON public.profiles
 * @mutate supabase/migrations/20261022010525_idv_verified_leaves_only_by_decision.sql | GRANT EXECUTE ON FUNCTION public.admin_idv_request_reupload(uuid, text) TO service_role; | GRANT EXECUTE ON FUNCTION public.admin_idv_request_reupload(uuid, text) TO service_role, authenticated;
 * @mutate supabase/migrations/20261022010525_idv_verified_leaves_only_by_decision.sql |          idv_session_id = NULL,\n | \n
 * @mutate supabase/functions/admin-user-actions/index.ts | admin.rpc('admin_idv_request_reupload', { | admin.rpc('admin_idv_request_reupload_v0', {
 * @mutate supabase/functions/stripe-idv-webhook/index.ts |         .not("idv_status", "in", "(verified,failed)")\n | \n
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const defs = effectiveDefs(MIG);
const body = (fn: string) => {
  const d = defs.get(fn);
  if (!d) throw new Error(`${fn}: no effective definition`);
  return flat(d.stmt);
};
const migFiles = readdirSync(MIG).filter((f: string) => f.endsWith(".sql")).sort();
const allSql = migFiles.map((f: string) => ({ f, sql: flat(readFileSync(join(MIG, f), "utf8")) }));
const read = (p: string) => blankComments(readFileSync(join(REPO, p), "utf8")).replace(/\s+/g, " ");

describe("a verified ID leaves 'verified' only by a decision or an admin (7bb3a91e, 2026-10-21)", () => {
  it("the trigger function refuses every non-decision value, with the admin flag as the only way past", () => {
    const f = body("profiles_idv_verified_is_final");
    expect(f).toContain("IF OLD.idv_status = 'verified' AND NEW.idv_status IS DISTINCT FROM 'verified' AND NEW.idv_status IS DISTINCT FROM 'failed' AND COALESCE(current_setting('lh.idv_admin_reset', true), '') <> 'on' THEN RAISE EXCEPTION");
    expect(f).toContain("USING ERRCODE = '42501'");
  });

  it("the NEWEST trigger statement is BEFORE UPDATE on profiles, fires last, and is not dropped later", () => {
    const creates = allSql.filter((m) => /CREATE TRIGGER zz_profiles_idv_verified_is_final\b/.test(m.sql));
    expect(creates.length).toBeGreaterThan(0);
    const newest = creates[creates.length - 1];
    const stmt = /CREATE TRIGGER zz_profiles_idv_verified_is_final (.*?);/.exec(newest.sql)![1];
    expect(stmt).toMatch(/^BEFORE UPDATE ON public\.profiles FOR EACH ROW WHEN \(OLD\.idv_status = 'verified' AND NEW\.idv_status IS DISTINCT FROM OLD\.idv_status\) EXECUTE FUNCTION public\.profiles_idv_verified_is_final\(\)$/);
    const laterDrops = allSql.filter((m) => m.f > newest.f && /DROP TRIGGER (IF EXISTS )?zz_profiles_idv_verified_is_final\b/.test(m.sql));
    expect(laterDrops).toEqual([]);
  });

  it("only admin_idv_request_reupload sets the admin flag, and only service_role may run it", () => {
    const setters = [...defs.entries()].filter(([, d]) => /set_config\('lh\.idv_admin_reset', 'on'/.test(flat(d.stmt))).map(([n]) => n);
    expect(setters).toEqual(["admin_idv_request_reupload"]);
    // Q2323: the reset also drops the old session, so a late event from it never matches again.
    expect(body("admin_idv_request_reupload")).toContain("SET idv_status = 'not_started', idv_attempt_count = 0, idv_session_id = NULL,");
    const grants = allSql.flatMap((m) => m.sql.match(/(GRANT|REVOKE)[^;]*admin_idv_request_reupload[^;]*;/g) ?? []);
    expect(grants[grants.length - 1]).toBe("GRANT EXECUTE ON FUNCTION public.admin_idv_request_reupload(uuid, text) TO service_role;");
    expect(grants).toContain("REVOKE ALL ON FUNCTION public.admin_idv_request_reupload(uuid, text) FROM PUBLIC, anon, authenticated;");
    // No edge function or client sets the flag itself.
    const fnDirs = readdirSync(join(REPO, "supabase", "functions"));
    expect(fnDirs.length).toBeGreaterThan(20);
    const edgeSetters = fnDirs.filter((d: string) => {
      try { return /idv_admin_reset/.test(read(`supabase/functions/${d}/index.ts`)); } catch { /* a _shared dir or a non-function folder has no index.ts */ return false; }
    });
    expect(edgeSetters).toEqual([]);
  });

  it("admin-user-actions' request_id_reupload goes through the RPC", () => {
    const a = read("supabase/functions/admin-user-actions/index.ts");
    expect(a).toContain("admin.rpc('admin_idv_request_reupload', { p_user_id: targetUserId,");
  });

  it("the webhook's own write stays guarded (a decision wins, and a stale session never lands)", () => {
    const w = read("supabase/functions/stripe-idv-webhook/index.ts");
    expect(w).toMatch(/\.update\(updateData\) \.eq\("user_id", userId\) \.not\("idv_status", "in", "\(verified,failed\)"\)/);
  });
});
