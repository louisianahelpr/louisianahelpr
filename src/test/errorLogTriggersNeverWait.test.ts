/**
 * CLASS GUARD: logging an error must never wait on another transaction.
 *
 * THE BUG (review of 20260923043402_ops_alert_ledger, 2026-09-23).
 * trg_error_logs_zz_ledger -> ops_alert_record did INSERT .. ON CONFLICT
 * (fingerprint) DO UPDATE on one row per alert. Prod runs lock_timeout = 0 and
 * service_role has no statement_timeout of its own, so a second transaction
 * logging the same alert (a webhook retry, a money path, an incident storm)
 * waited for the first to COMMIT — measured 3004 ms against a 3000 ms hold
 * (scripts/probes/ops-alert-ledger-concurrency.embedded-pg.mjs, BEFORE case),
 * up to the 2-minute default in prod. The error logger blocked its caller.
 *
 * THE CLASS, from the migrations themselves: every trigger on public.error_logs
 * (latest CREATE/DROP per trigger name), and every public.* function reachable
 * from its function (latest definition). Any reachable statement that can wait
 * on another transaction's row — ON CONFLICT (either form: DO NOTHING also
 * waits on an uncommitted conflicting insert) or FOR UPDATE / FOR SHARE without
 * NOWAIT / SKIP LOCKED — must sit behind a function that bounds the wait with a
 * literal set_config('lock_timeout', '<n>ms', true) and catches
 * lock_not_available. Everything else is an offender.
 *
 * The fix it pins: 20260923050059 (ops_alert_record bounds the wait to 100 ms
 * and queues the occurrence in ops_alert_pending; ops_alert_verify folds it).
 *
 * @mutate supabase/migrations/20260923050059_ops_alert_ledger_never_blocks_and_keeps_status_codes.sql | PERFORM set_config('lock_timeout', '100ms', true); | PERFORM 1;
 * @mutate supabase/migrations/20260923050059_ops_alert_ledger_never_blocks_and_keeps_status_codes.sql | EXCEPTION WHEN lock_not_available OR deadlock_detected THEN | EXCEPTION WHEN division_by_zero THEN
 * @mutate supabase/migrations/20260923105333_throttle_drops_kind_rename.sql | PERFORM set_config('lock_timeout', '50ms', true); | PERFORM 1;
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** Latest body per public function name (overloads collapse: conservative). */
const fnBody = new Map<string, string>();
/** Latest state per trigger on error_logs: its function, or null if dropped. */
const triggers = new Map<string, string | null>();

const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\2/gi;
const TRG_RE = /(CREATE|DROP)\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+([\s\S]*?);/gi;

for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8");
  for (const m of sql.matchAll(FN_RE)) fnBody.set(m[1].toLowerCase(), m[3]);
  for (const m of sql.matchAll(TRG_RE)) {
    const [, verb, name, rest] = m;
    if (!/\bON\s+(?:public\.)?error_logs\b/i.test(rest)) continue;
    if (verb.toUpperCase() === "DROP") triggers.set(name, null);
    else {
      const fn = /EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?(\w+)\s*\(/i.exec(rest)?.[1];
      triggers.set(name, fn ? fn.toLowerCase() : null);
    }
  }
}

const strip = (b: string) => b.replace(/--[^\n]*/g, "");
const WAITS = [
  /\bON\s+CONFLICT\b/i,
  /\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE)\b(?![^;]*\b(?:NOWAIT|SKIP\s+LOCKED)\b)/i,
];
const BOUNDED = (b: string) =>
  /set_config\(\s*'lock_timeout'\s*,\s*'\d+ms'\s*,\s*true\s*\)/i.test(b) && /\block_not_available\b/i.test(b);

/** Offending paths from `fn`: trigger fn -> ... -> fn with an unbounded wait. */
function offenders(fn: string, path: string[] = [], seen = new Set<string>()): string[][] {
  if (seen.has(fn)) return [];
  seen.add(fn);
  const body = fnBody.get(fn);
  if (body === undefined) return [];
  const here = [...path, fn];
  if (BOUNDED(body)) return []; // everything below is behind a bounded wait
  const out: string[][] = [];
  if (WAITS.some((re) => re.test(strip(body)))) out.push(here);
  for (const m of strip(body).matchAll(/\bpublic\.(\w+)\s*\(/gi)) out.push(...offenders(m[1].toLowerCase(), here, seen));
  return out;
}

const live = [...triggers.entries()].filter(([, fn]) => fn !== null) as [string, string][];
const reached = new Set<string>();
function walk(fn: string) {
  if (reached.has(fn) || !fnBody.has(fn)) return;
  reached.add(fn);
  for (const m of strip(fnBody.get(fn)!).matchAll(/\bpublic\.(\w+)\s*\(/gi)) walk(m[1].toLowerCase());
}
for (const [, fn] of live) walk(fn);

describe("triggers on error_logs never wait on another transaction", () => {
  it("finds the error_logs triggers and what they reach (inventory floor)", () => {
    // 3 at 2026-09-23: 00_stamp_origin, slack, zz_ledger.
    expect(live.length).toBeGreaterThanOrEqual(3);
    expect(reached.has("ops_alert_record")).toBe(true);
    // Q113 (20260923100454): the throttle's drop counter is an upsert on the insert path.
    expect(reached.has("record_error_log_throttle_drop")).toBe(true);
    expect(reached.size).toBeGreaterThanOrEqual(4);
  });

  it("every reachable row-lock wait is bounded by lock_timeout + a lock_not_available fallback", () => {
    const bad = live.flatMap(([trg, fn]) => offenders(fn).map((p) => `${trg}: ${p.join(" -> ")}`));
    expect(bad, "unbounded lock wait reachable from an error_logs trigger").toEqual([]);
  });
});
