#!/usr/bin/env node
/**
 * Analytics that silently stop (docs/OPEN.md Q72), daily from
 * .github/workflows/quota-monitor.yml. The event list, ground-truth SQL and
 * the quiet-vs-broken verdicts live in scripts/lib/analyticsFreshness.mjs;
 * this file runs the one read-only statement and acts on the verdicts.
 *
 *   BROKEN / DEGRADED -> an item in the ops alert ledger (verify-ref
 *                        quota-monitor.yml), the run stays green so the item
 *                        closes on the first green re-run after it clears.
 *   QUIET / UNVERIFIED -> reported only (pre-launch: nobody did it).
 *   UNREADABLE          -> ledger error AND exit 1 (red run).
 *
 * Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF. Test seam:
 * LH_SUPABASE_API_BASE. --no-ledger skips ledger writes.
 */
import { appendFileSync } from "node:fs";
import { KEY_EVENTS, alertTitle, evaluateFreshness, freshnessSql } from "./lib/analyticsFreshness.mjs";
import { recordOpsAlert } from "./lib/opsAlertLedger.mjs";

const env = process.env;
const SUPA = env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com";
const noLedger = process.argv.includes("--no-ledger");
const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;

async function readRows() {
  const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = env;
  if (!token || !ref) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
  const res = await fetch(`${SUPA}/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: freshnessSql(), read_only: true }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Management API SQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  let rows;
  let readError = null;
  try {
    rows = await readRows();
    if (!Array.isArray(rows) || rows.length !== KEY_EVENTS.length) {
      readError = `expected ${KEY_EVENTS.length} rows, got ${Array.isArray(rows) ? rows.length : typeof rows} — refusing to report clean`;
    }
  } catch (e) {
    readError = `could not read analytics_events: ${e?.message ?? e}`;
  }
  const res = evaluateFreshness(readError ? [] : rows);
  console.log(res.report);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, res.report + "\n");

  if (!noLedger) {
    for (const r of res.alerts) {
      await recordOpsAlert({
        sourceKind: "workflow", source: "analytics-freshness", title: alertTitle(r),
        severity: r.status === "broken" ? "error" : "warning",
        sample: `${r.k.event}: ${r.row?.events} events vs ${r.row?.real_actions} real actions in ${r.k.windowDays}d (last event ${r.row?.last_event_at ?? "never"})`,
        sampleRef: { run_url: runUrl, event: r.k.event }, verifyKind: "workflow", verifyRef: "quota-monitor.yml",
      });
    }
    if (res.unreadable.length) {
      await recordOpsAlert({
        sourceKind: "workflow", source: "analytics-freshness", title: "Analytics freshness monitor cannot read analytics_events",
        severity: "error", sample: readError ?? `unreadable: ${res.unreadable.map((r) => r.k.event).join(", ")}`,
        sampleRef: { run_url: runUrl }, verifyKind: "workflow", verifyRef: "quota-monitor.yml",
      });
    }
  }
  for (const r of res.alerts) console.log(`::warning title=Analytics ${r.status}::${alertTitle(r)}`);
  if (res.unreadable.length) {
    console.error(`::error::${readError ?? `${res.unreadable.length} key event(s) came back unreadable: ${res.unreadable.map((r) => r.k.event).join(", ")} — refusing to report clean`}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
