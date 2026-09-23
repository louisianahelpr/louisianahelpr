#!/usr/bin/env node
/**
 * Weekly plan headroom check — how close is prod to its limits?
 *
 * Owner-approved 2026-09-14, when prod was on the FREE tier (500 MB database,
 * 1 GB storage). The plan is PRO since (measured 2026-09-23, docs/OPEN.md
 * Q221), so the limits are no longer written here: they come from PLAN_LIMITS
 * in scripts/lib/quotaMonitor.mjs, the ONE definition quota-monitor.yml and
 * the Vercel check also read (src/test/planLimits.test.ts holds all three to
 * it). This warns at 70% of either, so the ceiling is never hit as a surprise
 * mid-week.
 *
 * MANAGEMENT API, NOT SQL. Deliberately: prod is a t4g.nano that fell over on
 * 2026-09-13 under workflow load. `pg_database_size()` is cheap but it still
 * means opening a connection to the database to ask about the database; the
 * Management API answers from Supabase's own control plane and costs the
 * instance nothing. Auth is the SUPABASE_ACCESS_TOKEN secret the backup and
 * drift workflows already hold; nothing new to rotate.
 *
 * WHAT THE API ACTUALLY EXPOSES is not a fixed contract and has changed
 * before, so this script PROBES a candidate set of endpoints, reports what
 * each one answered (status code included), and states plainly which of the
 * three metrics it could not get. A metric this cannot read is reported as
 * "not exposed by the Management API", never silently dropped — an alert you
 * cannot tell is blind is worse than no alert.
 *
 * Disk IO and CPU: as of 2026-09-14 the control-plane REST API exposes these
 * only through the project's own Prometheus endpoint
 * (https://<ref>.supabase.co/customer/v1/privileged/metrics), which needs the
 * SERVICE ROLE key, not the management access token, and is a request against
 * the instance itself. The run output below says exactly what came back, so
 * this comment can be corrected by evidence rather than belief.
 *
 * Exit code is always 0. Outputs (GITHUB_OUTPUT): warn=true|false,
 * summary=<one line>. Writes supabase-usage-report.md always.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { PLAN_LIMITS, PLANS } from "./lib/quotaMonitor.mjs";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
const THRESHOLD = Number(process.env.WARN_AT_PERCENT || 70);
const PLAN = PLANS.supabase;
const DB_LIMIT = PLAN_LIMITS.supabase_db_bytes.value;
const STORAGE_LIMIT = PLAN_LIMITS.supabase_storage_bytes.value;

if (!TOKEN || !REF) {
  console.error("::error::SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
  process.exit(1);
}

const API = "https://api.supabase.com";
const H = { authorization: `Bearer ${TOKEN}`, accept: "application/json" };

async function get(path) {
  try {
    const res = await fetch(`${API}${path}`, { headers: H });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON — keep the text */ }
    return { path, status: res.status, json, text: text.slice(0, 400) };
  } catch (e) {
    return { path, status: 0, json: null, text: String(e?.message || e) };
  }
}

// Candidates, most specific first. Unknown/removed routes answer 404 and are
// reported as such rather than crashing the run.
const ENDPOINTS = [
  `/v1/projects/${REF}`,
  `/v1/projects/${REF}/usage`,
  `/v1/projects/${REF}/database/usage`,
  `/v1/projects/${REF}/billing/usage`,
  `/v1/projects/${REF}/billing/addons`,
  `/v1/projects/${REF}/health?services=db,storage`,
  `/v1/projects/${REF}/storage/buckets`,
  `/v1/projects/${REF}/analytics/endpoints/usage.api-counts?interval=1d`,
  `/v1/organizations`,
];

const probes = [];
for (const p of ENDPOINTS) probes.push(await get(p));

// Organization-scoped usage lives under the org slug, which we only learn
// from /v1/organizations — so it is a second hop, not a guess.
const orgs = probes.find((p) => p.path === "/v1/organizations");
const orgSlugs = Array.isArray(orgs?.json) ? orgs.json.map((o) => o.id ?? o.slug).filter(Boolean) : [];
for (const slug of orgSlugs.slice(0, 3)) {
  probes.push(await get(`/v1/organizations/${slug}/usage`));
  probes.push(await get(`/v1/organizations/${slug}/billing/subscription`));
}

/**
 * SECOND SOURCE, and as of 2026-09-14 the ONLY one that carries these numbers.
 *
 * Measured, not assumed: the run of 2026-09-14 (34881959722) probed every
 * plausible Management API usage route and got 404 from all of them —
 * /v1/projects/{ref}/usage, /database/usage, /billing/usage and
 * /v1/organizations/{slug}/usage. The public control-plane API answers
 * project identity and health; it does NOT expose database size, storage
 * size, disk IO or CPU. The endpoint table in every report is the evidence,
 * so this claim is re-tested weekly rather than believed.
 *
 * Supabase serves those four from the project's own Prometheus endpoint,
 * https://<ref>.supabase.co/customer/v1/privileged/metrics, basic-auth
 * `service_role:<SUPABASE_SERVICE_ROLE_KEY>`. It is NOT SQL and NOT a query
 * against the database — one scrape of the instance's metrics exporter,
 * once a week.
 *
 * It is OPTIONAL here because the service-role key is not a repo secret yet.
 * Without it the report says every metric is UNMEASURED, in as many words —
 * it never reports "ok" as though it had looked. Add SUPABASE_SERVICE_ROLE_KEY
 * to the repo secrets and the alert starts working with no code change.
 */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let prom = null;
if (SERVICE_KEY) {
  try {
    const auth = Buffer.from(`service_role:${SERVICE_KEY}`).toString("base64");
    const res = await fetch(`https://${REF}.supabase.co/customer/v1/privileged/metrics`, {
      headers: { authorization: `Basic ${auth}` },
    });
    const text = await res.text();
    probes.push({ path: "(project) /customer/v1/privileged/metrics", status: res.status, json: null, text: `${text.length} bytes of Prometheus text` });
    if (res.status === 200) prom = text;
  } catch (e) {
    probes.push({ path: "(project) /customer/v1/privileged/metrics", status: 0, json: null, text: String(e?.message || e) });
  }
} else {
  probes.push({
    path: "(project) /customer/v1/privileged/metrics",
    status: 0,
    json: null,
    text: "skipped — no SUPABASE_SERVICE_ROLE_KEY repo secret. OWNER: add it to measure database size, storage size, disk IO and CPU; the Management API exposes none of them.",
  });
}

/** Sum every sample of a Prometheus metric family (labels ignored). */
function promSum(text, name) {
  if (!text) return null;
  let total = null;
  const re = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)\\s*$`, "gm");
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) total = (total ?? 0) + v;
  }
  return total == null ? null : { key: name, value: total };
}
const METRICS_PATH = "(project) /customer/v1/privileged/metrics";
const promHit = (name) => {
  const hit = promSum(prom, name);
  return hit ? { p: { path: METRICS_PATH }, hit } : null;
};

/** One sample of `name` whose label set contains `needle`. */
function promLabeled(text, name, needle) {
  if (!text) return null;
  const re = new RegExp(`^${name}\\{([^}]*)\\}\\s+([0-9.eE+-]+)\\s*$`, "gm");
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1].includes(needle)) {
      const v = Number(m[2]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

/**
 * The /data volume is the thing that actually ran out on 2026-09-13 — the
 * database file lives on it, and it is 2 GB on this instance size, not 500 MB.
 * Reported beside the logical database size because they fill at different
 * rates (WAL, bloat and temp files land here and not in pg_database_size).
 */
const dataTotal = promLabeled(prom, "node_filesystem_size_bytes", 'mountpoint="/data"');
const dataAvail = promLabeled(prom, "node_filesystem_avail_bytes", 'mountpoint="/data"');
const dataHit =
  dataTotal != null && dataAvail != null
    ? { p: { path: METRICS_PATH }, hit: { key: "node_filesystem_size_bytes - avail (/data)", value: dataTotal - dataAvail } }
    : null;

/** Depth-first hunt for a numeric value under any of `keys`. */
function findNumber(node, keys, seen = new Set()) {
  if (node == null || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);
  for (const [k, v] of Object.entries(node)) {
    if (keys.some((re) => re.test(k)) && typeof v === "number" && Number.isFinite(v)) return { key: k, value: v };
    if (keys.some((re) => re.test(k)) && v && typeof v === "object" && typeof v.usage === "number") {
      return { key: `${k}.usage`, value: v.usage };
    }
  }
  for (const v of Object.values(node)) {
    const hit = findNumber(v, keys, seen);
    if (hit) return hit;
  }
  return null;
}

const ok = probes.filter((p) => p.status === 200 && p.json);

/** First probe whose payload contains a number under one of these key shapes. */
function hunt(keys) {
  for (const p of ok) {
    const hit = findNumber(p.json, keys);
    if (hit) return { p, hit };
  }
  return null;
}

// Management API first (it is the documented, stable surface); the project's
// metrics scrape is the fallback that actually has the numbers today.
const dbHit = hunt([/^db_size(_bytes)?$/i, /^database_size(_bytes)?$/i]) ?? promHit("pg_database_size_bytes");
/**
 * BUCKET STORAGE, from the Storage API itself.
 *
 * Measured 2026-09-14: NEITHER source above carries it — the Management API
 * 404s on every usage route, and the metrics exporter covers the database
 * instance only (no storage_* family in a 1494-line scrape). So this lists
 * every object through `POST /storage/v1/object/list/<bucket>` (one folder
 * level per call) and sums `metadata.size`.
 *
 * Every list call IS a query against the nano instance (storage.search), so it
 * is paced (250ms apart), capped (MAX_LIST_CALLS) and time-boxed per call. The
 * listing of the ten app buckets on 2026-09-14 took 106 calls for 95 objects / 20.3 MB
 * (docs/archive/storage-audit-2026-09-14.md). A run that hits the cap, times
 * out or errors reports storage as UNMEASURED with the reason — a partial sum
 * is never shown as the total.
 */
const MAX_LIST_CALLS = 400;
async function measureBuckets() {
  if (!SERVICE_KEY) return { hit: null, note: "skipped — no SUPABASE_SERVICE_ROLE_KEY repo secret" };
  const base = `https://${REF}.supabase.co/storage/v1`;
  const headers = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" };
  let calls = 0;
  const call = async (method, path, body) => {
    if (++calls > MAX_LIST_CALLS) throw new Error(`stopped at the ${MAX_LIST_CALLS}-call cap`);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    try {
      const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
      if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  try {
    const buckets = await call("GET", "/bucket");
    let bytes = 0;
    let objects = 0;
    for (const { id } of buckets) {
      const stack = [""];
      while (stack.length) {
        const prefix = stack.pop();
        for (let offset = 0; ; offset += 100) {
          const rows = await call("POST", `/object/list/${id}`, { prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } });
          for (const r of rows) {
            const full = prefix ? `${prefix}/${r.name}` : r.name;
            if (r.id === null) stack.push(full);
            else { objects++; bytes += Number(r.metadata?.size ?? 0); }
          }
          if (rows.length < 100) break;
        }
      }
    }
    return {
      hit: { p: { path: `(project) /storage/v1/object/list × ${calls} calls` }, hit: { key: `sum(metadata.size) over ${objects} objects in ${buckets.length} buckets`, value: bytes } },
      note: `${objects} objects, ${buckets.length} buckets, ${calls} list calls`,
    };
  } catch (e) {
    return { hit: null, note: `UNMEASURED — ${String(e?.message || e)}` };
  }
}
const bucketMeasure = await measureBuckets();
probes.push({ path: "(project) /storage/v1/object/list (all buckets)", status: bucketMeasure.hit ? 200 : 0, json: null, text: bucketMeasure.note });
const storageHit = hunt([/^storage_size(_bytes)?$/i]) ?? promHit("storage_storage_size_bytes") ?? bucketMeasure.hit;
// CONSUMPTION only. `baseline_disk_io_mbs` from /v1/projects/{ref}/billing/
// addons is the provisioned CAPACITY of the instance (87 MB/s on this one),
// not how much of it is being used — the run of 2026-09-14 printed it in the
// "used" column, which reads as an alarming number that means nothing. It is
// reported on its own row below instead.
const ioHit = promHit("node_disk_io_now");
const cpuHit = promHit("node_load1");
const ioBaselineHit = hunt([/baseline_disk_io_mbs/i]);

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const rows = [];
let warn = false;
const warnings = [];

/**
 * `limit` null means "no published plan ceiling for this one" — it is
 * reported as a raw value, never silently turned into a percentage.
 */
function metric(name, hit, limit, fmt = mb) {
  if (!hit) {
    rows.push(`| ${name} | — | ${limit ? mb(limit) : "—"} | **not exposed** by any endpoint probed below |`);
    return;
  }
  const v = hit.hit.value;
  const src = `\`${hit.hit.key}\` from \`${hit.p.path}\``;
  if (limit == null) {
    rows.push(`| ${name} | ${fmt(v)} | — | no published ${PLAN} limit (${src}) |`);
    return;
  }
  const pct = (v / limit) * 100;
  if (pct >= THRESHOLD) {
    warn = true;
    warnings.push(`${name} at ${pct.toFixed(1)}% of the ${PLAN} limit (${fmt(v)} of ${fmt(limit)})`);
  }
  rows.push(`| ${name} | ${fmt(v)} | ${fmt(limit)} | ${pct.toFixed(1)}% (${src}) |`);
}

metric("Database size", dbHit, DB_LIMIT);
metric("Disk volume (/data)", dataHit, dataTotal ?? null);
metric("Storage size (buckets)", storageHit, STORAGE_LIMIT);
// No metric name baked into the value — the source column already names the
// key it came from, and hardcoding one there made the row lie when the value
// came from a different source.
metric("Disk IO in flight", ioHit, null, String);
metric("CPU load (1 min)", cpuHit, null, String);
metric("Disk IO baseline provisioned (MB/s)", ioBaselineHit, null, String);

const summary = warn
  ? `WARN — ${warnings.join("; ")}`
  : dbHit || storageHit
    ? `ok — under ${THRESHOLD}% of every ${PLAN} limit measured`
    : "UNMEASURED — nothing available could report database or storage size (see the endpoint table)";

const report = [
  `## Supabase ${PLAN} headroom`,
  "",
  `**${summary}**`,
  "",
  `Warn threshold: ${THRESHOLD}% · ${PLAN} plan: ${mb(DB_LIMIT)} database, ${mb(STORAGE_LIMIT)} storage (PLAN_LIMITS, scripts/lib/quotaMonitor.mjs).`,
  "",
  `| Metric | Used | ${PLAN} limit | Share |`,
  "| --- | --- | --- | --- |",
  ...rows,
  "",
  "### What each Management API endpoint answered",
  "",
  "| Endpoint | HTTP | First 400 chars |",
  "| --- | --- | --- |",
  ...probes.map((p) => `| \`${p.path}\` | ${p.status} | \`${p.text.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 400)}\` |`),
  "",
  "A metric shown as **not exposed** is not zero and not fine — it is unmeasured.",
  "The last row is provisioned CAPACITY, not consumption; it does not move with load.",
  "",
  "Measured 2026-09-14 (run 34881959722): the public Management API returns 404 for",
  "every usage route — `/v1/projects/{ref}/usage`, `/database/usage`, `/billing/usage`",
  "and `/v1/organizations/{slug}/usage`. It answers project identity and health only.",
  "All four numbers come instead from the project's own Prometheus endpoint",
  "(`/customer/v1/privileged/metrics`, basic auth `service_role:<key>`) — one scrape a",
  "week, not a database query. That needs the repo secret `SUPABASE_SERVICE_ROLE_KEY`;",
  "until it exists this report says UNMEASURED rather than pretending to be ok.",
  "",
  "Bucket storage is the one metric NEITHER source has: the scrape (1494 lines,",
  "2026-09-14) covers the database instance only, with no `storage_*` family. It is",
  "therefore sized by listing every object through the Storage API (paced 250ms,",
  `capped at ${MAX_LIST_CALLS} calls); a capped or failed listing reports UNMEASURED, never a partial sum.`,
  "Baseline 2026-09-14, the ten app buckets only: 95 objects, 20.3 MB (docs/archive/storage-audit-2026-09-14.md).",
].join("\n");

writeFileSync("supabase-usage-report.md", report + "\n");
console.log(report);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `warn=${warn}\nsummary=${summary.replace(/\n/g, " ")}\n`);
}
