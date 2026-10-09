/**
 * Q1159 class guard: a SQL function that reads public.error_logs must not count
 * rows a CLIENT wrote, unless it is on the exact list below of readers that look
 * at client rows on purpose.
 *
 * anon and authenticated hold INSERT on error_logs (the signed-out app logs its
 * crashes), and stamp_error_log_origin only re-sources four paging sources. A
 * server throttle or dedupe that counts error_logs rows by tags.source / area /
 * job / queue / ref therefore counts a forged client row, and one forged row
 * tagged with a server source mutes that source's Slack page or its once-a-day
 * report (found by the lh-authz-rls review of Q1156). 20261004004835 makes every
 * such read ignore tags.origin = 'client'; the behaviour is proven in
 * src/test/pglite/clientRowsCannotMuteServerAlerts.pglite.mjs (red on the
 * chain before it).
 *
 * The inventory is every function's EFFECTIVE definition after all migrations
 * (effectiveDefs), comments blanked. A read counts as FILTERED when its function
 * body carries one origin predicate per read: `coalesce(<alias>.tags ->> 'origin',
 * '') <> 'client'` or `tags ->> 'origin' = 'client' | 'server'`. KNOWN_UNFILTERED is exact and
 * two-way: a new unfiltered reader fails, and so does a listed one that got fixed
 * without lowering its count.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG_DIR = join(process.cwd(), "supabase/migrations");

// @two-way src/test/errorLogDedupesIgnoreClientRows.test.ts:stale unfiltered entry
// function -> number of error_logs reads WITHOUT an origin predicate, and why that is accepted.
//   ops_alert_record_user_error_screen 3, ops_alert_condition 2: read CLIENT rows by design
//     (user-error-screen rows are client rows; their caps are per account / per fingerprint).
//   sweep_old_error_logs 2, cleanup_observability_tables 1: retention deletes, not a throttle.
//   export_my_data 1: the caller's own rows.
//   send_ops_daily_digest 1: lists rows for the owner to read; it mutes nothing.
//   prevent_self_escalation 1: its once-an-hour dedupe is on source 'rls-escalation-refused',
//     a paging source stamp_error_log_origin rewrites to 'client-error' on any client row,
//     so a client cannot forge it (checked in the stamp body, 20260923094457).
//   (detect_stuck_payments and cron_silent_rule left this list in 20261007043834,
//   Q1263 / Q1264 (3): both now ignore client rows.)
// @mutate supabase/migrations/20261009223355_stuck_payment_needs_stripe_proof.sql |              AND coalesce(e.tags ->> 'origin', '') <> 'client'\n             AND e.tags ->> 'source' = 'detect_stuck_payments-seed' |              AND e.tags ->> 'source' = 'detect_stuck_payments-seed'
const KNOWN_UNFILTERED: Record<string, number> = {
  cleanup_observability_tables: 1,
  export_my_data: 1,
  ops_alert_condition: 2,
  ops_alert_record_user_error_screen: 3,
  prevent_self_escalation: 1,
  send_ops_daily_digest: 1,
  sweep_old_error_logs: 2,
};

// Q1264 (2): the LIVE check (scripts/check-live-privileges.mjs, after every
// db-deploy and nightly) reads the deployed bodies against this same list, kept
// in scripts/ci/error-log-unfiltered-readers.json; the two may not drift.
// @mutate scripts/ci/error-log-unfiltered-readers.json |   "export_my_data": 1, |   "export_my_data": 2,
it("the live check's allowlist is this list", () => {
  const live = JSON.parse(readFileSync(join(process.cwd(), "scripts/ci/error-log-unfiltered-readers.json"), "utf8"));
  expect(live).toEqual(KNOWN_UNFILTERED);
});
const READ = /\b(?:from|join)\s+(?:public\.)?error_logs\b/gi;
// Predicates on a ROW being read; `NEW.tags ->> 'origin'` tests the row being inserted, not a read.
const ORIGIN =
  /coalesce\s*\(\s*((?:\w+\.)?)tags\s*->>\s*'origin'\s*,\s*''\s*\)\s*<>\s*'client'|((?:\w+\.)?)tags\s*->>\s*'origin'\s*(?:=|<>)\s*'(?:client|server)'/gi;
const isRow = (prefix: string | undefined) => !/^(?:new|old)\.$/i.test(prefix ?? "");

function inventory(): { readers: string[]; unfiltered: Record<string, number> } {
  const readers: string[] = [];
  const unfiltered: Record<string, number> = {};
  for (const [name, def] of effectiveDefs(MIG_DIR)) {
    const body = blankSqlComments(def.stmt);
    const reads = [...body.matchAll(READ)].length;
    if (!reads) continue;
    readers.push(name);
    const filtered = [...body.matchAll(ORIGIN)].filter((m) => isRow(m[1] ?? m[2])).length;
    if (filtered < reads) unfiltered[name] = reads - filtered;
  }
  return { readers: readers.sort(), unfiltered };
}

// @mutate supabase/migrations/20261004004835_client_rows_cannot_mute_server_alerts.sql |   WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.id <> NEW.id |   WHERE e.id <> NEW.id
// @mutate supabase/migrations/20261004004835_client_rows_cannot_mute_server_alerts.sql |      WHERE coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags->>'source' = 'cron-dead' |      WHERE e.tags->>'source' = 'cron-dead'
describe("Q1159: server throttles and dedupes ignore client-written error_logs rows", () => {
  const { readers, unfiltered } = inventory();

  it("the inventory is real", () => {
    expect(readers.length).toBeGreaterThan(20);
    expect(readers).toContain("notify_slack_on_error_log");
    expect(readers).toContain("sweep_dead_crons");
  });

  it("the Slack throttle and the cron-dead dedupe ignore client rows", () => {
    expect(unfiltered.notify_slack_on_error_log ?? 0).toBe(0);
    expect(unfiltered.sweep_dead_crons ?? 0).toBe(0);
  });

  it("no known entry is stale (fixed or gone without lowering it here)", () => {
    const stale = Object.entries(KNOWN_UNFILTERED)
      .filter(([fn, n]) => (unfiltered[fn] ?? 0) < n)
      .map(([fn, n]) => `stale unfiltered entry ${fn} (${n} listed, ${unfiltered[fn] ?? 0} found) — remove it (lower the baseline)`);
    expect(stale).toEqual([]);
  });

  it("unfiltered error_logs reads are exactly the known list (two-way)", () => {
    expect(unfiltered).toEqual(KNOWN_UNFILTERED);
  });
});
