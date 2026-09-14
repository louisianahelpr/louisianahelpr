#!/usr/bin/env node
/**
 * Weekly free-tier headroom check — how close is prod to its limits?
 *
 * Owner-approved 2026-09-14. Free tier: 500 MB database, 1 GB storage. This
 * warns at 70% of either, so the ceiling is never hit as a surprise mid-week.
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

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
const THRESHOLD = Number(process.env.WARN_AT_PERCENT || 70);
const DB_LIMIT = 500 * 1024 * 1024; // free tier
const STORAGE_LIMIT = 1024 * 1024 * 1024; // free tier

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
}

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

const dbHit = hunt([/^db_size(_bytes)?$/i, /^database_size(_bytes)?$/i, /^disk_volume_size_gb$/i]);
const storageHit = hunt([/^storage_size(_bytes)?$/i, /^storage_egress$/i]);
const ioHit = hunt([/disk_io/i, /^iops$/i, /io_budget/i]);
const cpuHit = hunt([/^cpu(_usage)?$/i]);

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const rows = [];
let warn = false;
const warnings = [];

/**
 * `limit` null means "no published free-tier ceiling for this one" — it is
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
    rows.push(`| ${name} | ${fmt(v)} | — | no published free-tier limit (${src}) |`);
    return;
  }
  const pct = (v / limit) * 100;
  if (pct >= THRESHOLD) {
    warn = true;
    warnings.push(`${name} at ${pct.toFixed(1)}% of the free-tier limit (${fmt(v)} of ${fmt(limit)})`);
  }
  rows.push(`| ${name} | ${fmt(v)} | ${fmt(limit)} | ${pct.toFixed(1)}% (${src}) |`);
}

metric("Database size", dbHit, DB_LIMIT);
metric("Storage size", storageHit, STORAGE_LIMIT);
metric("Disk IO", ioHit, null, String);
metric("CPU", cpuHit, null, String);

const summary = warn
  ? `WARN — ${warnings.join("; ")}`
  : `ok — ${dbHit || storageHit ? "under " + THRESHOLD + "% of every limit this API exposes" : "the Management API exposed no size metric (see the report)"}`;

const report = [
  "## Supabase free-tier headroom",
  "",
  `**${summary}**`,
  "",
  `Warn threshold: ${THRESHOLD}% · Free tier: 500 MB database, 1 GB storage.`,
  "",
  "| Metric | Used | Free-tier limit | Share |",
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
  "Disk IO and CPU are served by the project's own Prometheus endpoint",
  "(`/customer/v1/privileged/metrics`, service-role auth), not by this control-plane API.",
].join("\n");

writeFileSync("supabase-usage-report.md", report + "\n");
console.log(report);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `warn=${warn}\nsummary=${summary.replace(/\n/g, " ")}\n`);
}
