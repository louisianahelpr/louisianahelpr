/**
 * GUARD (owner via the lead, 11-12): every real member activity rings the admin bell, and test data never does.
 * Migration 20261112061000; backend proof src/test/pglite/adminActivityBell.pglite.mjs.
 *
 * Built from the migrations (the NEWEST definition of each function, and every CREATE TRIGGER), checked both ways:
 *   1. ACTIVITY is the exact list of tables whose writes are member activity the owner asked to see. Each has an
 *      AFTER trigger running an admin_activity_on_* function; no admin_activity_on_* trigger sits on a table off the
 *      list (a new one must be added here, with its seed rule).
 *   2. Each such function calls admin_activity_notice, catches its own errors (a notice never fails a checkout) and,
 *      where its table has an is_seed column, skips an is_seed row.
 *   3. admin_activity_notice skips a test subject (actor AND the other party) and an admin's own action, and writes
 *      type admin_activity, never admin_alert (the Slack-paged operator type).
 *   4. Bell only: admin_activity's push and email switches default OFF.
 *
 * @mutate supabase/migrations/20261112061000_admin_activity_bell.sql |   IF public.is_test_subject(p_actor) OR (p_other IS NOT NULL AND public.is_test_subject(p_other)) THEN |   IF public.is_test_subject(p_actor) THEN
 * @mutate supabase/migrations/20261112061000_admin_activity_bell.sql |   IF public.has_role(p_actor, 'admin') THEN\n    RETURN 'admin'; |   IF false THEN\n    RETURN 'admin';
 * @mutate supabase/migrations/20261112061000_admin_activity_bell.sql |   IF NOT coalesce(NEW.is_seed, false) THEN\n    PERFORM public.admin_activity_notice(NEW.user_id, |   IF true THEN\n    PERFORM public.admin_activity_notice(NEW.user_id,
 * @mutate supabase/migrations/20261112061000_admin_activity_bell.sql | DROP TRIGGER IF EXISTS trg_admin_activity_shop_order ON public.shop_orders;\nCREATE TRIGGER trg_admin_activity_shop_order\n  AFTER UPDATE OF held_at ON public.shop_orders\n  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_shop_order(); | SELECT 1;
 * @mutate supabase/migrations/20261112061000_admin_activity_bell.sql | EXCEPTION WHEN OTHERS THEN\n  RAISE WARNING 'admin_activity_on_job: %', SQLERRM;\n  RETURN NULL;\n |
 * @mutate supabase/migrations/20261112061000_admin_activity_bell.sql | ADD COLUMN IF NOT EXISTS email_admin_activity boolean NOT NULL DEFAULT false; | ADD COLUMN IF NOT EXISTS email_admin_activity boolean NOT NULL DEFAULT true;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIGRATIONS);
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

/** The member activity the owner asked to see (11-12), table -> its trigger function. */
const ACTIVITY: Record<string, string> = {
  declutter_items: "admin_activity_on_declutter_item", // published, Free
  declutter_wanted: "admin_activity_on_declutter_wanted",
  declutter_offers: "admin_activity_on_declutter_offer",
  declutter_swap_offers: "admin_activity_on_declutter_swap", // trades
  declutter_orders: "admin_activity_on_declutter_order", // checkout started, paid, handed over, cancelled
  declutter_free_requests: "admin_activity_on_declutter_free_request", // asked for, picked
  declutter_refund_requests: "admin_activity_on_declutter_refund_request",
  jobs: "admin_activity_on_job", // posted, hired, done, cancelled
  applications: "admin_activity_on_application",
  shop_orders: "admin_activity_on_shop_order",
  reports: "admin_activity_on_report",
};
/** Tables with no is_seed column: their seed rule is the helper's is_test_subject on the people. */
const NO_SEED_COLUMN = new Set(["declutter_free_requests", "applications", "reports"]);

/** The newest CREATE TRIGGER per trigger name: name -> { table, fn } (a later DROP without CREATE removes it). */
function triggers(): Map<string, { table: string; fn: string }> {
  const out = new Map<string, { table: string; fn: string }>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = flat(readFileSync(resolve(MIGRATIONS, f), "utf8"));
    for (const m of sql.matchAll(/DROP TRIGGER IF EXISTS (\w+) ON public\.(\w+)|CREATE TRIGGER (\w+) AFTER [^;]*? ON public\.(\w+) FOR EACH ROW EXECUTE FUNCTION public\.(\w+)\(\)/g)) {
      if (m[1]) out.delete(m[1]);
      else out.set(m[3], { table: m[4], fn: m[5] });
    }
  }
  return out;
}

describe("admin bell: every member activity notifies admins, never for test data", () => {
  const trg = [...triggers().values()].filter((t) => t.fn.startsWith("admin_activity_on_"));

  it("every activity table has its trigger, and no activity trigger sits off the list (both ways)", () => {
    const have = Object.fromEntries(trg.map((t) => [t.table, t.fn]));
    expect(have).toEqual(ACTIVITY);
  });

  it("each trigger function calls the helper, catches its own errors, and skips an is_seed row", () => {
    const bad: string[] = [];
    for (const [table, fn] of Object.entries(ACTIVITY)) {
      const body = flat(DEFS.get(fn)?.stmt ?? "");
      if (!body.includes("public.admin_activity_notice(")) bad.push(`${fn}: no admin_activity_notice`);
      if (!/EXCEPTION WHEN OTHERS THEN RAISE WARNING/.test(body)) bad.push(`${fn}: does not catch its own errors`);
      if (!NO_SEED_COLUMN.has(table) && !/coalesce\((NEW|o|j)\.is_seed, false\)/.test(body)) bad.push(`${fn}: no is_seed skip`);
      if (!body.includes("SECURITY DEFINER") || !body.includes("SET search_path")) bad.push(`${fn}: not a pinned definer`);
    }
    expect(bad).toEqual([]);
  });

  it("the helper skips a test actor and other party and an admin's own action, and writes admin_activity only", () => {
    const h = flat(DEFS.get("admin_activity_notice")?.stmt ?? "");
    expect(h).toContain("IF public.is_test_subject(p_actor) OR (p_other IS NOT NULL AND public.is_test_subject(p_other)) THEN RETURN 'test';");
    expect(h).toContain("IF public.has_role(p_actor, 'admin') THEN RETURN 'admin';");
    expect(h).toContain("'admin_activity', p_link, p_actor");
    expect(h).not.toContain("'admin_alert'");
    expect(h).toContain("interval '10 minutes'");
  });

  it("bell only: admin_activity's push and email switches default off", () => {
    const sql = flat(readFileSync(resolve(MIGRATIONS, DEFS.get("admin_activity_notice")!.file), "utf8"));
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS admin_activity boolean NOT NULL DEFAULT false;");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS email_admin_activity boolean NOT NULL DEFAULT false;");
    expect(sql).toMatch(/\('admin_activity', 'admin_activity', /);
  });
});
