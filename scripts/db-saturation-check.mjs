#!/usr/bin/env node
/**
 * db-saturation-check — the half of the Q53 monitor the database cannot do
 * for itself.
 *
 * Statement timeouts are not recorded in pg_stat_statements (a cancelled
 * statement never completes), and the Postgres log is only reachable through
 * the Management API. So, hourly from .github/workflows/prod-errors.yml
 * (BEFORE the ledger sync, so ops_alert_verify sees this sample):
 *
 *   1. count "canceling statement due to statement timeout" in postgres_logs
 *      over the last WINDOW_MINUTES (default 60);
 *   2. pass it to public.check_db_saturation(count, window) — which stores a
 *      sample, judges it against public.db_saturation_thresholds() and writes
 *      the 'db-statement-timeouts' error_logs row (hence the ledger item) on a
 *      breach. It also reads the live connection signals at the same moment.
 *
 * Exits 1 when either step fails: a monitor that cannot read its signal must
 * turn its run red (the workflow's notify job files it), never pass quietly.
 * 2026-09-22 is exactly the case where the database is too starved to answer,
 * and that must be loud.
 *
 * Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, WINDOW_MINUTES.
 */
import { appendFileSync } from "node:fs";
import { sql } from "./lib/opsAlertLedger.mjs";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
const WINDOW_MIN = Number(process.env.WINDOW_MINUTES ?? 60);

const TIMEOUT_LOG_SQL =
  "select count(*) as n from postgres_logs where regexp_contains(event_message, 'canceling statement due to statement timeout')";

/** The count out of a logs.all response, or throw — never a silent 0. */
export function countFromLogsBody(body) {
  if (body?.error) throw new Error(`logs query error: ${JSON.stringify(body.error).slice(0, 200)}`);
  const n = Number(body?.result?.[0]?.n);
  if (!Number.isFinite(n)) throw new Error(`no count in the logs response: ${JSON.stringify(body).slice(0, 200)}`);
  return n;
}

async function countTimeouts(now) {
  const start = new Date(now - WINDOW_MIN * 60_000).toISOString();
  const url = `https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all?sql=${encodeURIComponent(TIMEOUT_LOG_SQL)}`
    + `&iso_timestamp_start=${encodeURIComponent(start)}&iso_timestamp_end=${encodeURIComponent(new Date(now).toISOString())}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Management API logs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return countFromLogsBody(await res.json());
}

async function main() {
  if (!TOKEN || !REF) {
    console.error("::error::SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
    process.exit(2);
  }
  const now = Date.now();
  let n;
  try {
    n = await countTimeouts(now);
  } catch (e) {
    console.error(`::error::could not count statement timeouts: ${e?.message ?? e}`);
    process.exit(1);
  }
  let r;
  try {
    const rows = await sql(`SELECT public.check_db_saturation(${Math.trunc(n)}, ${Math.trunc(WINDOW_MIN)}) AS r`, { timeoutMs: 30_000 });
    r = rows?.[0]?.r;
    if (typeof r === "string") r = JSON.parse(r);
    if (!r || typeof r.ok !== "boolean") throw new Error(`unexpected result: ${JSON.stringify(rows).slice(0, 200)}`);
  } catch (e) {
    console.error(`::error::check_db_saturation failed (is the database answering?): ${e?.message ?? e}`);
    process.exit(1);
  }
  const line = `statement timeouts ${n} in ${WINDOW_MIN} min; connections ${r.client_conns}/${r.max_conns} (${r.conn_pct}%), `
    + `${r.active_conns} active, longest ${r.longest_active_s}s, idle-in-xact ${r.idle_in_xact}; `
    + (r.ok ? "OK" : `PROBLEM: ${[...(r.problems ?? []), r.log_problem].filter(Boolean).join("; ")}`);
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### DB saturation (Q53)\n\n${line}\n`);
  if (!r.ok) console.log(`::warning::${line}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
