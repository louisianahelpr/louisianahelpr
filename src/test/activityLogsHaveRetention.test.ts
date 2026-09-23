/**
 * CLASS GUARD (Q224): every log / history / views / events table has an
 * age-based DELETE that cron actually runs, or is on an exact list with why.
 *
 * THE BUG (bus CJ-003, verified 2026-09-23): job_views, profile_views,
 * notification_logs and login_history had no age-based DELETE in any
 * migration or edge function; the only removal was purge_user_data at account
 * deletion, so IPs, user agents, recipient addresses and subjects were kept
 * with no end date. Fixed by 20260923185658_prune_old_activity_logs.sql
 * (prune_old_activity_logs, daily cron 'prune-old-activity-logs'). Behaviour,
 * with the old state red, in PGlite: src/test/pglite/pruneOldActivityLogs.pglite.mjs.
 *
 * THE CLASS, from the migrations: every table they leave defined whose name
 * ends in _views, _log(s), _history, _events, _requests, _details or _runs.
 * Each must have `DELETE FROM <table> WHERE ... < now()/LOCALTIMESTAMP ...`
 * in the NEWEST body of a function that some cron.schedule(...) runs (or in
 * the scheduled command itself). Anything else is on NO_RETENTION with its
 * reason. Two-way: an entry that now has a scheduled prune, or is gone, fails.
 *
 * @mutate supabase/migrations/20260923185658_prune_old_activity_logs.sql | DELETE FROM public.login_history lh | DELETE FROM public.login_history_x lh
 * @mutate supabase/migrations/20260923185658_prune_old_activity_logs.sql | DELETE FROM public.profile_views WHERE viewed_at < | DELETE FROM public.profile_views WHERE viewed_at >
 * @mutate supabase/migrations/20260923185658_prune_old_activity_logs.sql | PERFORM cron.schedule('prune-old-activity-logs', '45 4 * * *',\n                          'SELECT public.prune_old_activity_logs();'); | NULL;
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: blankSqlComments(readFileSync(join(MIG, file), "utf8")) }));

/** Log-shaped tables with no scheduled age prune, each with why. Exact (two-way). */
// @two-way src/test/activityLogsHaveRetention.test.ts:on NO_RETENTION but pruned or gone
const NO_RETENTION: Record<string, string> = {
  admin_audit_log: "Accountability record of admin actions (bans, refunds, deletions); how long to keep it is an owner decision (Q301).",
  application_rate_log: "Gap (Q301): rate-limit log, read over at most 1 day, never pruned.",
  cron_catchup_runs: "Gap (Q301): one claim row per caught-up slot, never pruned.",
  profile_search_rate_log: "Gap (Q301): rate-limit log, read over at most 1 day, never pruned.",
  str_processed_events: "Gap (Q301): processed-event ledger of str-ical-sync, never pruned.",
};

const LOG_NAME = /(?:_views|_logs?|_history|_events|_requests|_details|_runs)$/;

// ── inventory: tables the migrations leave defined ─────────────────────────
const tables = new Set<string>();
for (const { sql } of files) {
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi)) tables.add(m[1].toLowerCase());
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)\s+RENAME\s+TO\s+(\w+)/gi)) {
    if (tables.delete(m[1].toLowerCase())) tables.add(m[2].toLowerCase());
  }
  // Not `ALTER PUBLICATION ... DROP TABLE x`, which only stops realtime for it.
  for (const m of sql.matchAll(/(?<!PUBLICATION\s+\w+\s+)DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)/gi)) tables.delete(m[1].toLowerCase());
}
const logTables = [...tables].filter((t) => LOG_NAME.test(t)).sort();

// ── newest body of every function, any dollar tag ──────────────────────────
const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\2/gi;
const bodies = new Map<string, string>();
for (const { sql } of files) for (const m of sql.matchAll(FN_RE)) bodies.set(m[1].toLowerCase(), m[3]);

// ── what cron runs (schedule calls, net of unschedule) ─────────────────────
const commands = new Map<string, string>();
for (const { sql } of files) {
  for (const m of sql.matchAll(/cron\.(schedule|unschedule)\s*\(\s*'([a-z0-9-]+)'([^;]*)/gi)) {
    if (m[1].toLowerCase() === "schedule") commands.set(m[2], m[3]);
    else commands.delete(m[2]);
  }
}
const scheduledText = [...commands.values()].join("\n");
const isScheduled = (fn: string) => new RegExp(`\\b${fn}\\b`, "i").test(scheduledText);

const ageDelete = (t: string) =>
  new RegExp(`DELETE\\s+FROM\\s+(?:public\\.)?${t}\\b[^;]*?<\\s*(?:now\\(\\)|LOCALTIMESTAMP|CURRENT_TIMESTAMP|clock_timestamp\\(\\))`, "i");

function prunedBy(t: string): string[] {
  const re = ageDelete(t);
  const fns = [...bodies].filter(([fn, body]) => re.test(body) && isScheduled(fn)).map(([fn]) => fn);
  if (re.test(scheduledText)) fns.push("(inline cron command)");
  return fns;
}

describe("log-shaped tables have a scheduled age prune (Q224)", () => {
  it("reads the inventory from the migrations (floor)", () => {
    // 16 log-shaped tables on 2026-09-23.
    expect(logTables.length).toBeGreaterThan(12);
    for (const t of ["job_views", "profile_views", "notification_logs", "login_history"]) expect(logTables).toContain(t);
    expect(commands.size).toBeGreaterThan(40);
  });

  it("the four Q224 tables are pruned by prune_old_activity_logs, which cron runs", () => {
    for (const t of ["job_views", "profile_views", "notification_logs", "login_history"]) {
      expect(prunedBy(t), t).toContain("prune_old_activity_logs");
    }
  });

  it("login_history keeps each user's newest row (last-active stays real)", () => {
    const body = bodies.get("prune_old_activity_logs") ?? "";
    expect(body).toMatch(/DELETE\s+FROM\s+public\.login_history\s+lh\s+WHERE\s+lh\.created_at\s*<[^;]*AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.login_history\s+newer\s+WHERE\s+newer\.user_id\s*=\s*lh\.user_id\s+AND\s+newer\.created_at\s*>\s*lh\.created_at\s*\)/i);
  });

  it("every log-shaped table is pruned on a schedule, or is on NO_RETENTION", () => {
    const unpruned = logTables.filter((t) => prunedBy(t).length === 0);
    expect(unpruned).toEqual(Object.keys(NO_RETENTION).sort());
  });
});
