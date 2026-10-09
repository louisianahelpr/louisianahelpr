/**
 * "New member joined" goes out when the member CONFIRMS their email, never at
 * signup, exactly once (owner decision, 2026-10-09 pop-up).
 *
 * THE BUG: complete-signup inserted the notice when the signup form finished.
 * Kaci's arrived 02:45:58.8Z on 2026-10-09, 5 s after she signed up and 53 s
 * before she confirmed (02:46:52.4Z); an abandoned signup was announced too.
 *
 * THE CLASS: the "New member joined" admin notice has exactly ONE writer,
 * notify_admins_new_member, which refuses an unconfirmed account and claims
 * new_member_admin_notices once per member; its only callers are the
 * auth.users confirm trigger and complete-signup's RPC call. Inventory: every
 * effective SQL function and every edge function source that writes a
 * notification with that title.
 *
 * Red on the original: run against origin/main 6f4775024, "no other writer"
 * fails on supabase/functions/complete-signup/index.ts and the writer/trigger
 * tests fail (neither exists). Behaviour: src/test/pglite/newMemberNoticeOnConfirm.pglite.mjs;
 * complete-signup itself: src/test/edge/complete-signup-new-member-notice.test.ts.
 *
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql |   IF v_confirmed IS NULL THEN\n    RETURN 'not_confirmed'; |   IF false THEN\n    RETURN 'not_confirmed';
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql |   ON CONFLICT (user_id) DO NOTHING\n  RETURNING user_id INTO v_claimed; |   ON CONFLICT (user_id) DO UPDATE SET via = EXCLUDED.via\n  RETURNING user_id INTO v_claimed;
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql |   WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL) |   WHEN (NEW.email_confirmed_at IS NOT NULL)
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql |   AFTER UPDATE OF email_confirmed_at ON auth.users\n  FOR EACH ROW\n  WHEN | AFTER INSERT ON auth.users\n  FOR EACH ROW\n  WHEN
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql |   EXCEPTION WHEN OTHERS OR query_canceled THEN | EXCEPTION WHEN division_by_zero THEN
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql |   EXCEPTION WHEN OTHERS OR query_canceled THEN |   EXCEPTION WHEN OTHERS THEN
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql | SET lock_timeout TO '3s' | SET lock_timeout TO '0'
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql |   IF EXISTS (SELECT 1 FROM public.notifications x\n              WHERE x.user_id IN |   IF false AND EXISTS (SELECT 1 FROM public.notifications x\n              WHERE x.user_id IN
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql |     RETURN 'wipe_failed'; |     NULL;
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql |   IF v_seed AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id) THEN |   IF false THEN
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql |   IF v_seed AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id) THEN |   IF v_seed THEN
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql | ' just joined and can post and apply now.', | ' just joined. They can start posting + applying as soon as they confirm their email.',
 * @mutate supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql | REVOKE ALL ON FUNCTION public.notify_admins_new_member(uuid, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.notify_admins_new_member(uuid, text) FROM PUBLIC;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const FNS = join(ROOT, "supabase", "functions");
const defs = effectiveDefs(MIG);
const code = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");
const TITLE = /New member joined/;
const migrationSql = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8"))).join("\n");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("the new-member admin notice waits for the email confirmation", () => {
  const sqlWriters = [...defs.keys()].filter((n) => {
    const c = code(n);
    return TITLE.test(c) && /insert\s+into\s+(?:public\.)?notifications\b/i.test(c);
  });
  const edgeFiles = walk(FNS).filter((f) => f.endsWith(".ts") && !/\.test\.ts$|\.d\.ts$/.test(f));
  const edgeWriters = edgeFiles
    .filter((f) => {
      const src = blankComments(readFileSync(f, "utf8"));
      return TITLE.test(src) && /from\(\s*["']notifications["']\s*\)\s*\.insert|insertNotifications\(/.test(src);
    })
    .map((f) => relative(ROOT, f));

  it("has exactly one writer, in SQL (inventory floor)", () => {
    // The scan read the real trees: 2026-10-09 there were 1,000+ effective SQL
    // functions and 200+ edge sources.
    expect(defs.size).toBeGreaterThan(500);
    expect(edgeFiles.length).toBeGreaterThan(100);
    expect(sqlWriters).toEqual(["notify_admins_new_member"]);
  });

  it("no edge function writes it (complete-signup used to, at signup)", () => {
    expect(edgeWriters).toEqual([]);
    const signup = blankComments(readFileSync(join(FNS, "complete-signup", "index.ts"), "utf8"));
    expect(signup).toMatch(/\.rpc\(\s*"notify_admins_new_member"/);
  });

  it("the writer refuses an unconfirmed account and sends at most once per member", () => {
    const c = code("notify_admins_new_member");
    const confirmedGate = c.search(/IF\s+v_confirmed\s+IS\s+NULL\s+THEN\s+RETURN\s+'not_confirmed'/i);
    const claim = c.search(/INSERT\s+INTO\s+public\.new_member_admin_notices[\s\S]*?ON\s+CONFLICT\s*\(\s*user_id\s*\)\s+DO\s+NOTHING\s+RETURNING\s+user_id\s+INTO\s+v_claimed/i);
    const send = c.search(/INSERT\s+INTO\s+public\.notifications/i);
    expect(confirmedGate).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(confirmedGate);
    expect(send).toBeGreaterThan(claim);
    expect(c).toMatch(/IF\s+v_claimed\s+IS\s+NULL\s+THEN\s+RETURN\s+'already_sent'/i);
    // A TEST account is is_seed AND enrolled in test_accounts (20261007033530):
    // is_seed alone is set for anyone using a public fixture inbox.
    expect(c).toMatch(/IF\s+v_seed\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.test_accounts\s+t\s+WHERE\s+t\.user_id\s*=\s*p_user_id\s*\)\s+THEN\s+RETURN\s+'seed'/i);
    // A notice the signup-time code already sent counts as sent (deploy order).
    expect(c).toMatch(/IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.notifications\s+x\s+WHERE\s+x\.user_id\s+IN\s*\(\s*SELECT\s+r\.user_id\s+FROM\s+public\.user_roles\s+r\s+WHERE\s+r\.role\s*=\s*'admin'\s*\)\s+AND\s+x\.title\s*=\s*'New member joined'/i);
    // A failed takeover wipe still holds the squatter's name: announce nothing, claim nothing.
    expect(c).toMatch(/w\.error\s+LIKE\s+'wipe failed:%'[\s\S]*?RETURN\s+'wipe_failed'/i);
    expect(c.indexOf("RETURN 'wipe_failed'")).toBeLessThan(c.indexOf("INSERT INTO public.new_member_admin_notices"));
    // It runs inside GoTrue's confirm: a lock wait must fail fast, not time the confirm out.
    expect(defs.get("notify_admins_new_member")?.stmt ?? "").toMatch(/SET\s+lock_timeout\s+TO\s+'3s'/i);
    // The owner's wording, and the title every downstream rule keys on.
    expect(c).toContain("' just joined and can post and apply now.'");
    expect(c).toContain("'New member joined'");
  });

  it("fires on the confirmation itself (NULL -> set), and a failure never breaks the confirmation", () => {
    expect(migrationSql).toMatch(
      /CREATE\s+TRIGGER\s+zzz_notify_admins_new_member\s+AFTER\s+UPDATE\s+OF\s+email_confirmed_at\s+ON\s+auth\.users\s+FOR\s+EACH\s+ROW\s+WHEN\s+\(OLD\.email_confirmed_at\s+IS\s+NULL\s+AND\s+NEW\.email_confirmed_at\s+IS\s+NOT\s+NULL\)\s+EXECUTE\s+FUNCTION\s+public\.notify_admins_on_email_confirm\(\)/i,
    );
    const t = code("notify_admins_on_email_confirm");
    // The send runs in its own block whose handler catches EVERYTHING, so no
    // error can roll back the member's confirmation.
    expect(t).toMatch(
      /BEGIN\s+PERFORM\s+public\.notify_admins_new_member\(NEW\.id[^;]*;\s+EXCEPTION\s+WHEN\s+OTHERS\s+OR\s+query_canceled\s+THEN\s+RAISE\s+WARNING\s+'notify_admins_on_email_confirm: %/i,
    );
  });

  it("is server-only: revoked from PUBLIC, anon and authenticated", () => {
    expect(migrationSql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.notify_admins_new_member\(uuid,\s*text\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
    expect(migrationSql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.notify_admins_on_email_confirm\(\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
    expect(migrationSql).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.new_member_admin_notices\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
  });
});
