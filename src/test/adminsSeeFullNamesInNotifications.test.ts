/**
 * Owner, 2026-10-23: "admin should always see their first and last name on every notification. no one else."
 *
 * ONE rule for every producer, present and future: notifications_admin_full_names (BEFORE INSERT on
 * public.notifications) rewrites a member's "First L." to their full name in the title and message of a row
 * whose RECIPIENT is an admin, and returns every other row untouched. Executable proof (admin row rewritten,
 * member row never, ambiguous short forms left, metacharacters literal, backfill, 3x replay):
 * src/test/pglite/adminsSeeFullNamesInNotifications.pglite.mjs. This file pins the newest definitions so a
 * later migration cannot drop the admin gate (which would hand last names to members) or the trigger.
 *
 * @mutate supabase/migrations/20261023130742_admins_see_full_names_in_notifications.sql |      OR NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_recipient AND ur.role = 'admin') THEN |      OR false THEN
 * @mutate supabase/migrations/20261023130742_admins_see_full_names_in_notifications.sql |   BEFORE INSERT ON public.notifications\n  FOR EACH ROW EXECUTE FUNCTION public.notifications_admin_full_names(); |   AFTER INSERT ON public.notifications\n  FOR EACH ROW EXECUTE FUNCTION public.notifications_admin_full_names();
 * @mutate supabase/migrations/20261023130742_admins_see_full_names_in_notifications.sql |     HAVING count(DISTINCT full_name) = 1 |     HAVING count(DISTINCT full_name) >= 1
 * @mutate supabase/migrations/20261023130742_admins_see_full_names_in_notifications.sql |   EXCEPTION WHEN OTHERS THEN\n    -- Never fail a notification (or the backfill) | \n    -- Never fail a notification (or the backfill)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"));

function newestFunction(name: string): string {
  const header = `CREATE OR REPLACE FUNCTION public.${name}(`;
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = sqlOf(files[i]);
    const at = sql.lastIndexOf(header);
    if (at < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at))?.[1];
    if (!tag) throw new Error(`${name}: no dollar-quote tag`);
    const open = sql.indexOf(tag, at);
    return sql.slice(at, sql.indexOf(tag, open + tag.length) + tag.length);
  }
  return "";
}

function newestTrigger(name: string): string {
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = sqlOf(files[i]);
    const at = sql.lastIndexOf(`CREATE TRIGGER ${name}\n`);
    if (at >= 0) return sql.slice(at, sql.indexOf(";", at));
  }
  return "";
}

describe("admins see full names in notifications; nobody else does (owner 2026-10-23)", () => {
  const rule = newestFunction("notification_admin_full_names");
  const trigFn = newestFunction("notifications_admin_full_names");
  const trigger = newestTrigger("notifications_admin_full_names");

  it("the rule returns a non-admin recipient's row untouched, before any rewrite", () => {
    expect(rule.length).toBeGreaterThan(500);
    const gate = rule.indexOf("ur.role = 'admin'");
    const firstRewrite = rule.indexOf("regexp_replace(title");
    expect(gate, "the admin gate").toBeGreaterThan(-1);
    expect(firstRewrite).toBeGreaterThan(gate);
    expect(rule.slice(gate, firstRewrite)).toMatch(/THEN\s+RETURN;/);
  });

  it("an ambiguous short form is never guessed, and the recipient is never their own candidate", () => {
    expect(rule).toMatch(/HAVING count\(DISTINCT full_name\) = 1/);
    expect(rule).toMatch(/c\.uid <> p_recipient/);
    // The exact text producers write: member_display_name(full_name, NULL).
    expect(rule).toMatch(/public\.member_display_name\(p\.full_name, NULL\)/);
  });

  it("the trigger rewrites BEFORE the row is stored (push reads the stored row), ahead of the duplicate check", () => {
    expect(trigFn).toMatch(/notification_admin_full_names\(NEW\.user_id, NEW\.job_id, NEW\.link, NEW\.title, NEW\.message\)/);
    expect(trigger).toMatch(/BEFORE INSERT ON public\.notifications/);
    // Same-kind triggers fire in name order: the duplicate check must compare the REWRITTEN text with the
    // stored (rewritten) rows, so the rewrite sorts before it (lh-authz-rls review, 2026-10-23).
    expect("notifications_admin_full_names" < "suppress_exact_duplicate_notification").toBe(true);
    // It finds the job itself when the producer left job_id empty (fill_job_id runs after it).
    expect(rule).toMatch(/COALESCE\(p_job_id, public\.notification_job_id_from_link\(p_link\)\)/);
  });

  it("a name never fails a notification: any error keeps the producer's text", () => {
    // (comments are blanked before matching)
    expect(rule).toMatch(/EXCEPTION WHEN OTHERS THEN\s+title := p_title;\s+message := p_message;/);
    expect(trigFn).toMatch(/EXCEPTION WHEN OTHERS THEN/);
  });

  it("neither function is callable by a member", () => {
    const all = files.map(sqlOf).join("\n");
    for (const sig of ["notification_admin_full_names(uuid, uuid, text, text, text)", "notifications_admin_full_names()"]) {
      expect(all, sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
    }
  });
});
