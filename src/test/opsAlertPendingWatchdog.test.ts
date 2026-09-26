/**
 * Q1(e) (docs/OPEN.md): nothing watched public.ops_alert_pending. Only the
 * hourly GitHub ledger job folded the queue, so if that job stopped, queued
 * alerts never reached the ledger and nothing said so.
 *
 * The NEWEST definitions (any dollar tag, comments stripped) must keep:
 *   - check_ops_alert_pending() folding the queue itself (a second path, in
 *     the database) and reporting a row still queued after 2h as error_logs
 *     source 'ops-alert-pending-stale', once per UTC day;
 *   - ops_alert_condition's 'ops-alert-pending-stale' branch (the item closes
 *     only when nothing has sat in the queue over 2h);
 *   - the pg_cron job and its cron_work_expectations row, and no anon /
 *     authenticated EXECUTE on the check.
 * Behaviour (3x apply, 14 FAIL without the migration):
 *   src/test/pglite/opsAlertPendingWatchdog.pglite.mjs
 *
 * @mutate supabase/migrations/20260926040011_ops_alert_pending_watchdog.sql | v_folded := public.ops_alert_fold_pending(); | v_folded := 0;
 * @mutate supabase/migrations/20260926040011_ops_alert_pending_watchdog.sql | WHERE q.queued_at < now() - interval '2 hours'); | WHERE false);
 * @mutate supabase/migrations/20260926040011_ops_alert_pending_watchdog.sql | jsonb_build_object('source', 'ops-alert-pending-stale', 'area', 'ops'), | jsonb_build_object('source', 'ops', 'area', 'ops'),
 * @mutate supabase/migrations/20260926040011_ops_alert_pending_watchdog.sql | REVOKE ALL ON FUNCTION public.check_ops_alert_pending() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.check_ops_alert_pending() FROM PUBLIC;
 * @mutate supabase/migrations/20260926040011_ops_alert_pending_watchdog.sql |   ELSIF p_source = 'push-tokens-empty' THEN |   ELSIF p_source = 'push-tokens-empty-x' THEN
 * @mutate supabase/migrations/20260926040011_ops_alert_pending_watchdog.sql | PERFORM cron.schedule('ops-alert-pending-watchdog', '37 * * * *', | PERFORM cron.schedule('ops-alert-pending-watchdog', '37 3 * * 0',
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";

const MIG = resolve(__dirname, "../../supabase/migrations");
const defs = latestFunctionDefs(MIG);
const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));

const NEW_FILE = "20260926040011_ops_alert_pending_watchdog.sql";
/** Every body of public.ops_alert_condition, in apply order, any dollar tag, comments blanked. */
function conditionBodies(): Array<{ f: string; body: string }> {
  const out: Array<{ f: string; body: string }> = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?ops_alert_condition"?\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1/gi;
  for (const { f, sql } of all) for (const m of sql.matchAll(re)) out.push({ f, body: m[2] });
  return out;
}
const ws = (x: string) => x.replace(/\s+/g, " ").trim();

describe("ops_alert_pending has a watchdog outside the GitHub ledger job (Q1e)", () => {
  it("check_ops_alert_pending folds the queue itself, then reports a row stuck > 2h once a day", () => {
    const body = (defs.get("check_ops_alert_pending")?.body ?? "").replace(/\s+/g, " ");
    expect(body.length, "no check_ops_alert_pending definition").toBeGreaterThan(200);
    expect(body).toMatch(/v_folded := public\.ops_alert_fold_pending\(\);/);
    expect(body).toMatch(/queued_at < now\(\) - interval '2 hours'/);
    expect(body).toMatch(/'source', 'ops-alert-pending-stale'/);
    expect(body).toMatch(/INSERT INTO public\.error_logs/);
    expect(body, "once per UTC day").toMatch(/created_at > date_trunc\('day', now\(\)\)/);
  });

  it("ops_alert_condition closes the item only when nothing is stuck over 2h", () => {
    const body = (defs.get("ops_alert_condition")?.body ?? "").replace(/\s+/g, " ");
    const at = body.indexOf("p_source = 'ops-alert-pending-stale'");
    expect(at, "ops_alert_condition has no 'ops-alert-pending-stale' branch").toBeGreaterThan(-1);
    const branch = body.slice(at, body.indexOf("ELSIF", at + 10));
    expect(branch).toMatch(/FROM public\.ops_alert_pending/);
    expect(branch).toMatch(/queued_at < now\(\) - interval '2 hours'/);
  });

  it("the restatement is its predecessor plus only the new branch (no branch lost)", () => {
    const bodies = conditionBodies();
    expect(bodies.length).toBeGreaterThan(6);
    const idx = bodies.findIndex((b) => b.f === NEW_FILE);
    expect(idx, `${NEW_FILE} defines ops_alert_condition`).toBeGreaterThan(0);
    const own = ws(bodies[idx].body);
    const start = own.indexOf("ELSIF p_source = 'ops-alert-pending-stale' THEN");
    const end = own.indexOf("ELSIF", start + 10);
    expect(start).toBeGreaterThan(-1);
    const without = `${own.slice(0, start)}${own.slice(end)}`;
    expect(without, `${NEW_FILE} vs ${bodies[idx - 1].f}`).toBe(ws(bodies[idx - 1].body));
  });

  it("is scheduled hourly with a liveness expectation, and revoked from anon/authenticated", () => {
    const sched = all.filter(({ sql }) => /cron\.schedule\(\s*'ops-alert-pending-watchdog'/.test(sql));
    expect(sched.length).toBeGreaterThan(0);
    const last = sched[sched.length - 1].sql;
    expect(last).toMatch(/cron\.schedule\(\s*'ops-alert-pending-watchdog',\s*'37 \* \* \* \*'/);
    expect(last).toMatch(/cron_work_expectations[\s\S]*'ops-alert-pending-watchdog', interval '3 hours'/);
    const revokes = all.filter(({ sql }) => /REVOKE ALL ON FUNCTION public\.check_ops_alert_pending\(\)/.test(sql));
    expect(revokes.length).toBeGreaterThan(0);
    expect(revokes[revokes.length - 1].sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.check_ops_alert_pending\(\) FROM PUBLIC, anon, authenticated;/,
    );
  });
});
