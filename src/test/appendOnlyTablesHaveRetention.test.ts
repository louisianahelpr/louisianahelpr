/**
 * CLASS GUARD (CJ-003, CS-003): every log-shaped table is pruned by age.
 *
 * THE BUG (measured on prod, 2026-09-02 and again 2026-09-25): job_views,
 * profile_views, notification_logs, login_history, application_rate_log and
 * profile_search_rate_log had no age-based DELETE anywhere, so they grew
 * without bound (the only deleter of two of them was purge_user_data, the
 * per-user account deletion). helper_w9_records had no deleter at all, while
 * the owner's decision (MQ15/18, 2026-09-24) is: keep a W-9 for 4 years after
 * signing, then delete it. Fixed by 20260925052618_prune_retention_tables.sql.
 *
 * THE CLASS, from the migrations: every public table a migration creates (and
 * no later one drops) whose name ends in _log, _logs, _history, _views,
 * _events, _runs or _samples must be the target of an age-based DELETE (a
 * DELETE FROM <table> whose statement compares against an interval) in some
 * migration, or be listed in NO_AGE_PRUNE with its reason. Owner-decided
 * retention (RETENTION_BY_DECISION) must be present with its exact window.
 * Two-way: a NO_AGE_PRUNE entry that is pruned, or no longer a table, fails.
 * That the pruning functions actually run is prunersAreScheduled.test.ts.
 *
 * @mutate supabase/migrations/20260925052618_prune_retention_tables.sql | DELETE FROM public.notification_logs | DELETE FROM public.notification_logs_x
 * @mutate supabase/migrations/20260925052618_prune_retention_tables.sql | WHERE signed_at < now() - interval '4 years'; | WHERE signed_at < now() - interval '40 years';
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
const sql = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8")))
  .join("\n");

/** Log-shaped tables deliberately never pruned by age, each with why. */
const NO_AGE_PRUNE: Record<string, string> = {
  admin_audit_log: "The record of what admins did to accounts and money; kept for the life of the platform.",
  str_processed_events: "Dedupe ledger for imported iCal events: deleting a row makes str-ical-sync create the job again. Rows go with their connection (ON DELETE CASCADE).",
  cron_catchup_runs: "One claim row per missed cron slot that was re-run or alerted (5 rows on 2026-09-25); run_missed_cron_catch_up reads it to never act on a slot twice.",
};

/** Owner-decided windows: table -> the interval its DELETE must use. */
const RETENTION_BY_DECISION: Record<string, string> = {
  helper_w9_records: "4 years",
};

const SHAPE = /_(?:log|logs|history|views|events|runs|samples)$/;
const CREATE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
const DROP = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;

const dropped = new Set([...sql.matchAll(DROP)].map((m) => m[1].toLowerCase()));
const created = new Set([...sql.matchAll(CREATE)].map((m) => m[1].toLowerCase()));
const tables = [...created].filter((t) => !dropped.has(t)).sort();
const logShaped = tables.filter((t) => SHAPE.test(t));

/** The age-based DELETE statements for a table (text up to the next `;`). */
const ageDeletes = (t: string): string[] =>
  [...sql.matchAll(new RegExp(String.raw`DELETE\s+FROM\s+(?:public\.)?${t}\b[^;]*;`, "gi"))]
    .map((m) => m[0])
    .filter((s) => /\binterval\b|make_interval\s*\(/i.test(s));

describe("log-shaped tables are pruned by age (CJ-003, CS-003)", () => {
  it("finds the tables (the parse is not empty)", () => {
    expect(logShaped).toContain("login_history");
    expect(logShaped).toContain("notification_logs");
    expect(tables).toContain("helper_w9_records");
    expect(logShaped.length).toBeGreaterThan(12);
  });

  it("each one has an age-based DELETE or is listed in NO_AGE_PRUNE", () => {
    const unpruned = logShaped.filter((t) => ageDeletes(t).length === 0 && !(t in NO_AGE_PRUNE));
    expect(unpruned).toEqual([]);
  });

  it("NO_AGE_PRUNE lists only existing, unpruned log-shaped tables", () => {
    const stale = Object.keys(NO_AGE_PRUNE).filter((t) => !logShaped.includes(t) || ageDeletes(t).length > 0);
    expect(stale).toEqual([]);
  });

  it("owner-decided retention windows are the decided ones", () => {
    for (const [t, window] of Object.entries(RETENTION_BY_DECISION)) {
      const stmts = ageDeletes(t);
      expect(stmts.length, t).toBeGreaterThan(0);
      for (const s of stmts) expect(s, t).toMatch(new RegExp(String.raw`interval\s+'${window}'`, "i"));
    }
  });
});
