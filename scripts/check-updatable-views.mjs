#!/usr/bin/env node
/**
 * LIVE: no view or materialized view in a PostgREST-exposed schema may be
 * writable by a client role (anon / authenticated, directly, via PUBLIC, or by
 * role membership).
 *
 * Why this exists (2026-09-15). public.open_jobs_browse is owned by postgres
 * (which bypasses RLS) and is WITH (security_invoker=false), so a write through
 * it lands on the underlying jobs table with RLS bypassed. It carried
 * INSERT/UPDATE/DELETE for anon and authenticated — proven on prod inside a
 * rolled-back transaction: an anon UPDATE of payment_status + customer_id and an
 * anon DELETE of a funded job both landed (1 row each). 20260706140000 revoked
 * those grants once; a later DROP+CREATE of the view (20260912021641) silently
 * re-granted them, because prod's default privileges grant arwdxm on every
 * postgres-owned relation in public to anon/authenticated. The first fix
 * (20260915041247) then never deployed: it named the PG17-only MAINTAIN
 * privilege and the PG15 replay gate refused it.
 *
 * Rule (widened 2026-09-15 from "security_invoker off AND writable"): ANY
 * client write privilege on ANY exposed-schema view is a failure. A
 * security_invoker view still hits RLS, but nothing in this app writes through
 * a view, and every such grant is a second, unreviewed write door on a table
 * (jobs_helper_safe was one). The query lives in scripts/ci/client-writable-views.sql
 * and is shared with the db-smoke replay gate, so both read the same rule.
 *
 * Usage:
 *   node scripts/check-updatable-views.mjs               # prod: Management API, or `supabase db query --linked`
 *   node scripts/check-updatable-views.mjs --self-test   # prove it goes red (a synthetic offender)
 *
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (CI). Without them it uses
 * the linked Supabase CLI. Exit 1 on an offender, 2 if it could not look.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const OFFENDERS_SQL = readFileSync(new URL("./ci/client-writable-views.sql", import.meta.url), "utf8")
  .replace(/--[^\n]*\n/g, "\n")
  .trim()
  .replace(/;\s*$/, "");

// One round trip: how many exposed-schema views exist (so an empty offender
// list from a failed read cannot pass as clean), plus the offenders.
const SQL = `
SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('v','m') AND n.nspname IN ('public','graphql_public'))::int AS views_checked,
       coalesce((SELECT json_agg(o) FROM (${OFFENDERS_SQL}) o), '[]'::json) AS offenders`;

async function liveRow() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: SQL, read_only: true }),
    });
    if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
    return (await res.json())[0];
  }
  const out = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", SQL], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  return (json.rows ?? json)[0];
}

let row;
try {
  row = await liveRow();
} catch (e) {
  console.error(`::error::could not read live view catalog: ${e.message}`);
  process.exit(2);
}
const viewsChecked = Number(row?.views_checked ?? 0);
let offenders = row?.offenders;
if (typeof offenders === "string") offenders = JSON.parse(offenders);
if (!viewsChecked || !Array.isArray(offenders)) {
  // public has views (open_jobs_browse among them). Zero means the read failed
  // quietly, not that there are none.
  console.error(`::error::live catalog returned ${viewsChecked} views in public/graphql_public — refusing to report clean.`);
  process.exit(2);
}

if (process.argv.includes("--self-test")) {
  offenders.push({ schema: "public", view: "zz_fake_writable_view", kind: "view", owner: "postgres", reloptions: "security_invoker=false", role: "anon", priv: "DELETE" });
}

console.log(`Checked ${viewsChecked} views in public/graphql_public.`);
if (offenders.length) {
  const byView = new Map();
  for (const o of offenders) {
    const key = `${o.schema}.${o.view}`;
    if (!byView.has(key)) byView.set(key, { ...o, grants: [] });
    byView.get(key).grants.push(`${o.role}:${o.priv}`);
  }
  for (const [name, v] of byView) {
    console.error(`::error::${v.kind} ${name} (owner ${v.owner}${v.reloptions ? `, ${v.reloptions}` : ""}) is client-writable: ${v.grants.join(", ")}`);
  }
  console.error(
    "A client write grant on a view is a write door on its base table (and an owner-run view bypasses that table's RLS). " +
      "Fix: REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON <view> FROM PUBLIC, anon, authenticated; " +
      "plus MAINTAIN on PG17 (behind a server_version_num check — the replay gate is PG15). Keep GRANT SELECT. " +
      "Default privileges re-grant these on any DROP+CREATE, so re-run the REVOKE in the same migration.",
  );
  process.exit(1);
}
console.log("OK: no exposed-schema view is client-writable.");
