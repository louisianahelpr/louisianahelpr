#!/usr/bin/env node
/**
 * Quota and limit monitor (docs/OPEN.md Q63), daily from
 * .github/workflows/quota-monitor.yml. The quota table, limits, threshold
 * maths and report live in scripts/lib/quotaMonitor.mjs; this file only reads.
 *
 * Reads (each one is its own try, so one failure never hides the others):
 *   1. ONE read-only SQL statement through the Management API: database size,
 *      max_connections + client connections, storage.objects bytes, and
 *      email_send_log 'sent' rows (month to date, last 24h).
 *   2. Management API logs query: function_edge_logs rows in the last 24h.
 *   3. GitHub REST: deployments created in the last 24h (all environments).
 *   4. Sentry REST: error events over 30 days, accepted + rate_limited (org
 *      stats_v2, all four outcomes read and split in the note; Q311 — an
 *      accepted-only read cannot tell a quiet window from one where events
 *      are being dropped by quota/rate-limit). On a 401/403 falls back to the
 *      project stats endpoint (project:read only), which cannot split outcomes.
 *   5. Sentry REST: session replays over 30 days, accepted + rate_limited
 *      (org stats_v2 category=replay; Q275). No project-level fallback
 *      exists for replays, so a refused read is UNREADABLE.
 *
 * At >= 80% of a limit: a warning item in the ops alert ledger (>= 100%: an
 * error item), verify-ref quota-monitor.yml, so the item closes only when this
 * workflow re-runs green after the last occurrence. A quota whose read FAILED
 * or came back empty is UNREADABLE: an error item in the ledger AND exit 1.
 * Quotas with no API at all are listed as NOT MONITORED with a ::warning on
 * every run.
 *
 * Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, GITHUB_TOKEN,
 * GITHUB_REPOSITORY, SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, and the
 * per-quota LH_QUOTA_* limit overrides. Test seams: LH_SUPABASE_API_BASE,
 * LH_GITHUB_API_BASE, LH_SENTRY_API_BASE. --no-ledger skips ledger writes.
 */
import { appendFileSync } from "node:fs";
import { QUOTAS, alertTitle, evaluateQuotas, unreadableTitle } from "./lib/quotaMonitor.mjs";
import { recordOpsAlert } from "./lib/opsAlertLedger.mjs";
import { logsQueryUrl } from "./lib/supabaseLogs.mjs";

const env = process.env;
const SUPA = env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com";
const GH = env.LH_GITHUB_API_BASE ?? "https://api.github.com";
const SENTRY = env.LH_SENTRY_API_BASE ?? "https://sentry.io";
const REF = env.SUPABASE_PROJECT_REF;
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const noLedger = process.argv.includes("--no-ledger");

/** @type {Record<string, {value?: number, error?: string, note?: string}>} */
const readings = {};
/** Limits the systems themselves report (max_connections). */
const live = {};
const fail = (ids, error) => { for (const id of ids) readings[id] = { error }; };

export const USAGE_SQL = `
SELECT pg_database_size(current_database())::bigint AS db_bytes,
       current_setting('max_connections')::int AS max_conns,
       (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend')::int AS client_conns,
       (SELECT coalesce(sum((metadata->>'size')::bigint), 0) FROM storage.objects)::bigint AS storage_bytes,
       (SELECT count(*) FROM storage.objects)::int AS storage_objects,
       (SELECT count(*) FROM public.email_send_log
         WHERE status = 'sent' AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS emails_month,
       (SELECT count(*) FROM public.email_send_log
         WHERE status = 'sent' AND created_at > now() - interval '24 hours')::int AS emails_day`;

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

async function readSql() {
  const ids = ["supabase.db_size", "supabase.connections", "supabase.storage", "resend.sends_month", "resend.sends_day"];
  if (!TOKEN || !REF) return fail(ids, "could not read: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
  let rows;
  try {
    const res = await fetch(`${SUPA}/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: USAGE_SQL, read_only: true }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Management API SQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
    rows = await res.json();
  } catch (e) {
    return fail(ids, `could not read the usage SQL: ${e?.message ?? e}`);
  }
  const r = Array.isArray(rows) ? rows[0] : null;
  if (!r) return fail(ids, "the usage SQL returned no row — refusing to report clean");
  const db = num(r.db_bytes);
  // An empty-looking database is a broken read, not 0% of a quota.
  if (!(db > 0)) fail(["supabase.db_size"], `database size read as ${r.db_bytes} — refusing to report clean`);
  else readings["supabase.db_size"] = { value: db };
  const maxConns = num(r.max_conns);
  const conns = num(r.client_conns);
  if (!(maxConns > 0) || !Number.isFinite(conns)) {
    fail(["supabase.connections"], `connections read as ${r.client_conns}/${r.max_conns} — refusing to report clean`);
  } else {
    live["supabase.connections"] = maxConns;
    readings["supabase.connections"] = { value: conns, note: `max_connections ${maxConns} (live)` };
  }
  const st = num(r.storage_bytes);
  if (!Number.isFinite(st)) fail(["supabase.storage"], `storage read as ${r.storage_bytes}`);
  else readings["supabase.storage"] = { value: st, note: `${num(r.storage_objects)} objects` };
  for (const [id, key] of [["resend.sends_month", "emails_month"], ["resend.sends_day", "emails_day"]]) {
    const v = num(r[key]);
    if (!Number.isFinite(v)) fail([id], `${key} read as ${r[key]}`);
    else readings[id] = { value: v, note: "email_send_log status 'sent' (floor)" };
  }
}

async function readEdgeInvocations() {
  const id = "supabase.edge_invocations";
  if (!TOKEN || !REF) return fail([id], "could not read: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600_000);
  const q = "select count(*) as n from logs where source = 'function_edge_logs'";
  try {
    const url = logsQueryUrl({ ref: REF, sql: q, start: start.toISOString(), end: end.toISOString(), base: SUPA });
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Management API logs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    if (body?.error) throw new Error(`logs query error: ${JSON.stringify(body.error).slice(0, 200)}`);
    const n = num(body?.result?.[0]?.n);
    if (!Number.isFinite(n)) throw new Error(`no count in the logs response — refusing to report clean: ${JSON.stringify(body).slice(0, 160)}`);
    readings[id] = { value: n * 30, note: `${n} in the last 24h` };
  } catch (e) {
    fail([id], `could not read edge invocations: ${e?.message ?? e}`);
  }
}

async function readDeploys() {
  const id = "vercel.deploys_per_day";
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (!token) return fail([id], "could not read: GITHUB_TOKEN is required to count deployments");
  const repo = env.GITHUB_REPOSITORY ?? "louisianahelpr/louisianahelpr";
  const since = Date.now() - 24 * 3600_000;
  let count = 0;
  try {
    for (let page = 1; page <= 10; page++) {
      const res = await fetch(`${GH}/repos/${repo}/deployments?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`GitHub deployments ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error("GitHub deployments did not return a list");
      // The repo has had hundreds of Vercel deployments: an empty FIRST page is a
      // broken read (wrong repo, no access), not a quiet day.
      if (page === 1 && list.length === 0) throw new Error("GitHub returned no deployments at all — refusing to report clean");
      const recent = list.filter((d) => Date.parse(d.created_at) > since);
      count += recent.length;
      if (recent.length < list.length || list.length < 100) break;
      if (page === 10) throw new Error("more than 1,000 deployments in 24h — stopped paging; count is a floor");
    }
    readings[id] = { value: count, note: "GitHub deployments, all environments (floor: CLI deploys create none)" };
  } catch (e) {
    fail([id], `could not read deployments: ${e?.message ?? e}`);
  }
}

async function readSentry() {
  // Q311: a 401/403/429 or quota exhaustion drops events under outcome
  // rate_limited/filtered/invalid, which an accepted-only read can never see —
  // that is how Sentry showed 0 errors for 17h on 2026-09-23 with no monitor noticing.
  // Ask for every outcome and count accepted + rate_limited against the
  // quota, the same way readSentryReplays() already does.
  const id = "sentry.errors_30d";
  const { SENTRY_AUTH_TOKEN: t, SENTRY_ORG: org, SENTRY_PROJECT: project } = env;
  if (!t || !org) return fail([id], "could not read: SENTRY_AUTH_TOKEN and SENTRY_ORG are required");
  const h = { Authorization: `Bearer ${t}` };
  try {
    const res = await fetch(
      `${SENTRY}/api/0/organizations/${org}/stats_v2/?field=sum(quantity)&category=error`
        + `&outcome=accepted&outcome=rate_limited&outcome=filtered&outcome=invalid&groupBy=outcome&statsPeriod=30d&interval=1d`,
      { headers: h, signal: AbortSignal.timeout(20_000) },
    );
    if ((res.status === 401 || res.status === 403) && project) {
      // The ledger-sync token is scoped project:read + event:read; stats_v2 wants
      // org:read. The project stats endpoint needs only project:read, but it
      // reports 'received' only — it cannot split out dropped events.
      const until = Math.floor(Date.now() / 1000);
      const r2 = await fetch(
        `${SENTRY}/api/0/projects/${org}/${project}/stats/?stat=received&resolution=1d&since=${until - 30 * 86400}&until=${until}`,
        { headers: h, signal: AbortSignal.timeout(20_000) },
      );
      if (!r2.ok) throw new Error(`Sentry stats_v2 ${res.status}, project stats ${r2.status}: ${(await r2.text()).slice(0, 200)}`);
      const pts = await r2.json();
      if (!Array.isArray(pts) || pts.length === 0) throw new Error("Sentry project stats returned no points — refusing to report clean");
      readings[id] = { value: pts.reduce((s, p) => s + num(p?.[1] ?? 0), 0), note: "project stats 'received' (stats_v2 refused the token; this is an upper bound, and cannot see filtered/invalid)" };
      return;
    }
    if (!res.ok) throw new Error(`Sentry stats_v2 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    if (!Array.isArray(body?.groups) || !Array.isArray(body?.intervals) || body.intervals.length === 0) {
      throw new Error(`Sentry stats_v2 answered without groups/intervals — refusing to report clean: ${JSON.stringify(body).slice(0, 160)}`);
    }
    const by = { accepted: 0, rate_limited: 0, filtered: 0, invalid: 0 };
    for (const g of body.groups) {
      const o = g?.by?.outcome;
      if (o === "rate_limited" || o === "filtered" || o === "invalid") by[o] += num(g?.totals?.["sum(quantity)"] ?? 0);
      else by.accepted += num(g?.totals?.["sum(quantity)"] ?? 0);
    }
    readings[id] = {
      value: by.accepted + by.rate_limited,
      note: `org stats_v2 category=error: ${by.accepted} accepted, ${by.rate_limited} dropped by quota (rate_limited), ${by.filtered} filtered, ${by.invalid} invalid`,
    };
  } catch (e) {
    fail([id], `could not read Sentry: ${e?.message ?? e}`);
  }
}

async function readSentryReplays() {
  const id = "sentry.replays_30d";
  const { SENTRY_AUTH_TOKEN: t, SENTRY_ORG: org } = env;
  if (!t || !org) return fail([id], "could not read: SENTRY_AUTH_TOKEN and SENTRY_ORG are required");
  try {
    const res = await fetch(
      `${SENTRY}/api/0/organizations/${org}/stats_v2/?field=sum(quantity)&category=replay&outcome=accepted&outcome=rate_limited&groupBy=outcome&statsPeriod=30d&interval=1d`,
      { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) throw new Error(`Sentry stats_v2 (replay) ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    if (!Array.isArray(body?.groups) || !Array.isArray(body?.intervals) || body.intervals.length === 0) {
      throw new Error(`Sentry stats_v2 (replay) answered without groups/intervals — refusing to report clean: ${JSON.stringify(body).slice(0, 160)}`);
    }
    const by = { accepted: 0, rate_limited: 0 };
    for (const g of body.groups) {
      const o = g?.by?.outcome === "rate_limited" ? "rate_limited" : "accepted";
      by[o] += num(g?.totals?.["sum(quantity)"] ?? 0);
    }
    readings[id] = {
      value: by.accepted + by.rate_limited,
      note: `org stats_v2 category=replay: ${by.accepted} accepted, ${by.rate_limited} dropped by quota (rate_limited)`,
    };
  } catch (e) {
    fail([id], `could not read Sentry replays: ${e?.message ?? e}`);
  }
}

async function main() {
  await Promise.all([readSql(), readEdgeInvocations(), readDeploys(), readSentry(), readSentryReplays()]);
  const res = evaluateQuotas(readings, { env, live });
  console.log(res.report);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, res.report + "\n");
  for (const r of res.notMonitored) {
    console.log(`::warning title=Quota NOT monitored::${r.q.service} ${r.q.name} (limit ${r.limit} ${r.q.unit}) has no readable API: ${r.q.why}`);
  }
  const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  if (!noLedger) {
    for (const r of res.alerts) {
      await recordOpsAlert({
        sourceKind: "workflow", source: "quota-monitor", title: alertTitle(r),
        severity: r.status === "over" ? "error" : "warning",
        sample: `${r.q.service} ${r.q.name}: ${r.used} of ${r.limit} ${r.q.unit} (${r.pct}%). ${r.q.limitSource}`,
        sampleRef: { run_url: runUrl, quota: r.q.id }, verifyKind: "workflow", verifyRef: "quota-monitor.yml",
      });
    }
    for (const r of res.unreadable) {
      await recordOpsAlert({
        sourceKind: "workflow", source: "quota-monitor", title: unreadableTitle(r), severity: "error",
        sample: r.note, sampleRef: { run_url: runUrl, quota: r.q.id }, verifyKind: "workflow", verifyRef: "quota-monitor.yml",
      });
    }
  }
  for (const r of res.alerts) console.log(`::warning title=Quota at ${r.pct}%::${r.q.service} ${r.q.name}: ${r.used} of ${r.limit} ${r.q.unit}`);
  if (res.unreadable.length) {
    for (const r of res.unreadable) console.error(`::error title=Quota unreadable::${r.q.service} ${r.q.name}: ${r.note}`);
    console.error(`::error::${res.unreadable.length} of ${QUOTAS.length} quotas could not be read — this run is red on purpose.`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
