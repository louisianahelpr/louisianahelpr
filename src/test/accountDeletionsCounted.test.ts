/**
 * OPS-DEL (owner 10-29): nothing recorded that an account was deleted. Every deletion path (Delete account, the
 * admin's delete, under-13, the abandoned-signup sweep) ends in auth.admin.deleteUser, so the count lives in ONE place:
 * a BEFORE DELETE trigger on auth.users writing a count-only row to account_deletion_log, which the daily member
 * summary reads and says ("N accounts were deleted.").
 *
 * CLASS: (1) in the NEWEST definitions, a trigger on auth.users runs BEFORE DELETE and calls log_account_deletion,
 * whose body inserts into account_deletion_log and skips test accounts (is_seed, is_test_subject) and unconfirmed
 * signups; (2) the log has no column that could say who (no user id, email or name); (3) the newest
 * send_new_member_daily_summary reads the log and its message function says the deletions; (4) every edge function
 * that deletes an account does it through auth.admin.deleteUser (so the trigger sees it), never a raw delete of
 * profiles. Backend proof: src/test/pglite/accountDeletionCount.pglite.mjs (3x replay; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261031205315_account_deletion_count_in_daily_summary.sql |   BEFORE DELETE ON auth.users |   AFTER UPDATE ON auth.users
 * @mutate supabase/migrations/20261031205315_account_deletion_count_in_daily_summary.sql |        AND NOT public.is_test_subject(OLD.id) THEN |        THEN
 * @mutate supabase/migrations/20261031205315_account_deletion_count_in_daily_summary.sql |   v_message := public.daily_member_summary_message(v_ids, v_deleted); |   v_message := public.new_member_summary_message(v_ids);
 * @mutate supabase/migrations/20261031205315_account_deletion_count_in_daily_summary.sql |   deleted_at timestamptz NOT NULL DEFAULT now(),\n |   deleted_at timestamptz NOT NULL DEFAULT now(),\n  user_id uuid,\n
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "");

/** The newest CREATE TRIGGER <name> ON auth.users statement, and the newest CREATE TABLE of the log. */
function newestStatement(re: RegExp): string {
  for (let i = FILES.length - 1; i >= 0; i--) {
    const sql = blankSqlComments(readFileSync(join(MIG, FILES[i]), "utf8"));
    const all = [...sql.matchAll(re)];
    if (all.length) return all[all.length - 1][0];
  }
  return "";
}

describe("every deleted account is counted, and the daily summary says how many (OPS-DEL)", () => {
  it("reads a real inventory", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("a BEFORE DELETE trigger on auth.users calls log_account_deletion", () => {
    const trig = newestStatement(/CREATE TRIGGER\s+zz_log_account_deletion[\s\S]*?;/gi);
    expect(trig).toMatch(/BEFORE\s+DELETE\s+ON\s+auth\.users/i);
    expect(trig).toMatch(/EXECUTE FUNCTION public\.log_account_deletion\(\)/i);
  });

  it("log_account_deletion counts confirmed real members only", () => {
    const b = body("log_account_deletion");
    expect(b).toMatch(/INSERT INTO public\.account_deletion_log/i);
    expect(b).toMatch(/email_confirmed_at IS NOT NULL/i);
    expect(b).toMatch(/is_seed/i);
    expect(b).toMatch(/public\.is_test_subject\(OLD\.id\)/i);
  });

  it("the log holds a count only: no column that could say who", () => {
    const table = newestStatement(/CREATE TABLE IF NOT EXISTS public\.account_deletion_log\s*\([\s\S]*?\);/gi);
    expect(table).not.toBe("");
    expect(table).not.toMatch(/user_id|email|name|reason|uuid/i);
    const alters = FILES.map((f) => readFileSync(join(MIG, f), "utf8")).filter((s) => /ALTER TABLE public\.account_deletion_log\s+ADD/i.test(s));
    expect(alters).toEqual([]);
  });

  it("the daily summary reads the log and says the deletions", () => {
    const send = body("send_new_member_daily_summary");
    expect(send).toMatch(/FROM public\.account_deletion_log/i);
    expect(send).toMatch(/daily_member_summary_message\(v_ids, v_deleted\)/);
    expect(body("daily_member_summary_message")).toMatch(/accounts were deleted/);
    expect(body("retract_new_member_notice_for_test_account")).toMatch(/daily_member_summary_message\(/);
  });

  it("every edge function that deletes an account goes through auth.admin.deleteUser", () => {
    const fnDir = join(REPO, "supabase", "functions");
    const deleters: string[] = [];
    const raw: string[] = [];
    for (const d of readdirSync(fnDir)) {
      let src: string;
      try { src = blankComments(readFileSync(join(fnDir, d, "index.ts"), "utf8")); } catch { continue; } // not a function folder
      if (/auth\.admin\.deleteUser\(/.test(src)) deleters.push(d);
      if (/from\(\s*["']profiles["']\s*\)\s*\.delete\(/.test(src)) raw.push(d);
    }
    expect(deleters.length).toBeGreaterThan(3);
    expect(deleters).toEqual(expect.arrayContaining(["delete-own-account", "admin-delete-user"]));
    expect(raw).toEqual([]);
  });
});
