#!/usr/bin/env node
/**
 * LIVE: the TABLE half of the excess-client-grant class (check-updatable-views.mjs
 * is the view half). Three rules, read from the prod catalog:
 *
 *   WRITE (H-004): no RLS-enabled table in an exposed schema may carry an `anon`
 *   INSERT/UPDATE/DELETE grant that no policy backs for that command. public.jobs
 *   held anon UPDATE/INSERT/REFERENCES/DELETE with its DELETE policy TO
 *   authenticated only and its lock triggers stepping aside for a NULL uid — RLS
 *   the sole gate, one GRANT/policy away from a live hole.
 *
 *   ZERO-POLICY (2026-09-19): no table with RLS on and NO POLICY AT ALL may
 *   carry a client grant — anon OR authenticated, on any of SELECT/INSERT/
 *   UPDATE/DELETE. This is the rule that is derived from the catalog instead of
 *   from a list, and it exists because the two below are lists and therefore
 *   never looked at `notification_dedupe_suppressions`: RLS on, ZERO policies,
 *   yet anon SELECT and authenticated SELECT+INSERT, live on prod. Not
 *   exploitable while RLS denies all — which is exactly what a missing second
 *   line of defence looks like, one `USING (true)` away from a live read.
 *
 *   READ (AUTHZ-02): no sensitive admin/money/trust table (allowlist in
 *   scripts/ci/sensitive-anon-grants.sql) may carry an `anon` SELECT grant.
 *   These have no signed-out read path; the privilege is the only thing between
 *   a `USING(true)` regression and full anonymous exposure.
 *
 * Prod's default privileges re-grant on every CREATE TABLE / recreation, so a
 * one-off REVOKE cannot hold; this check is what does. Shape and env mirror
 * scripts/check-updatable-views.mjs exactly.
 *
 * Usage:
 *   node scripts/check-anon-table-grants.mjs               # prod: Management API, or `supabase db query --linked`
 *   node scripts/check-anon-table-grants.mjs --self-test   # prove it goes red (a synthetic offender)
 *
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (CI). Without them it uses
 * the linked Supabase CLI. Exit 1 on an offender, 2 if it could not look.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const OFFENDERS_SQL = readFileSync(new URL("./ci/sensitive-anon-grants.sql", import.meta.url), "utf8")
  .replace(/--[^\n]*\n/g, "\n")
  .trim()
  .replace(/;\s*$/, "");

// One round trip: how many exposed-schema base tables exist (so an empty
// offender list from a failed read cannot pass as clean), plus the offenders.
const SQL = `
SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r' AND n.nspname IN ('public','graphql_public'))::int AS tables_checked,
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
  console.error(`::error::could not read live grant catalog: ${e.message}`);
  process.exit(2);
}
const tablesChecked = Number(row?.tables_checked ?? 0);
let offenders = row?.offenders;
if (typeof offenders === "string") offenders = JSON.parse(offenders);
if (!tablesChecked || !Array.isArray(offenders)) {
  // public has dozens of base tables. Zero means the read failed quietly,
  // not that there are none.
  console.error(`::error::live catalog returned ${tablesChecked} base tables in public/graphql_public — refusing to report clean.`);
  process.exit(2);
}

if (process.argv.includes("--self-test")) {
  offenders.push({ schema: "public", table: "zz_fake_sensitive", role: "anon", priv: "SELECT", rule: "read:sensitive" });
  offenders.push({ schema: "public", table: "zz_fake_service_only", role: "authenticated", priv: "INSERT", rule: "zero-policy:client-grant" });
}

console.log(`Checked ${tablesChecked} base tables in public/graphql_public.`);
if (offenders.length) {
  for (const o of offenders) {
    console.error(
      o.rule === "stale-exception:zero-policy"
        ? `::error::${o.schema}.${o.table} is declared as a zero-policy exception in scripts/ci/sensitive-anon-grants.sql but holds no client grant any more — remove the exception (the list may only shrink).`
        : `::error::${o.schema}.${o.table} — ${o.role} holds ${o.priv} (${o.rule})`,
    );
  }
  console.error(
    "A client write grant no policy backs, an anon SELECT on a sensitive table, or ANY client grant on a table " +
      "with zero policies, is a second-line-of-defence hole. Fix in the migration that owns the table: " +
      "REVOKE ALL ON <table> FROM PUBLIC, anon, authenticated for a service-only table, or REVOKE the one privilege " +
      "for a scoped offender, keeping the grants the app actually uses. Default privileges re-grant on any " +
      "recreation, so this check — not the one REVOKE — is the guarantee.",
  );
  process.exit(1);
}
console.log("OK: no exposed-schema table carries an excess client grant.");
