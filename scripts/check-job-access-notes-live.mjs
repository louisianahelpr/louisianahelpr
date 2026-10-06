#!/usr/bin/env node
/**
 * LIVE (Q1438): the poster's Access & Parking notes reach nobody but the
 * poster and the booked Helpr(s). Read-only, from the prod catalog.
 *
 * The notes can hold a gate code. Until 20261006204113 they sat in
 * jobs.special_requirements, which open_jobs_browse returned to anon and to
 * every signed-in browser. They now live in public.job_access_notes. This
 * check proves, on the database itself, the five things that keep them there:
 *
 *   1. the table exists and has RLS on;
 *   2. anon holds no SELECT on it, and no policy names anon or public;
 *   3. no view in public reads it (open_jobs_browse, jobs_helper_safe, ...);
 *   4. no browse RPC reads it, and no anon-executable SECURITY DEFINER
 *      function mentions it;
 *   5. no jobs row still carries text in special_requirements (the CHECK
 *      jobs_special_requirements_retired; a row here means it was dropped).
 *
 * Usage:
 *   node scripts/check-job-access-notes-live.mjs   # prod: Management API, or `supabase db query --linked`
 *
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (CI). Without them it uses
 * the linked Supabase CLI. Exit code: one on a leak, two if it could not look (a read
 * that fails or comes back empty is never reported clean).
 */
import { apiBase } from "./lib/apiBase.mjs";
import { supabaseDbQuery } from "./lib/supabaseDbQuery.mjs";

const BROWSE_FNS = ["get_ranked_open_jobs", "get_open_jobs_for_map", "get_public_open_jobs"];

const SQL = `
WITH t AS (SELECT to_regclass('public.job_access_notes') AS oid)
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r')::int AS tables_checked,
  (SELECT t.oid IS NOT NULL FROM t) AS table_exists,
  coalesce((SELECT c.relrowsecurity FROM pg_class c, t WHERE c.oid = t.oid), false) AS rls_on,
  coalesce((SELECT has_table_privilege('anon', t.oid, 'SELECT') FROM t WHERE t.oid IS NOT NULL), false) AS anon_select,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_access_notes'
      AND roles && ARRAY['anon', 'public']::name[])::int AS anon_policies,
  coalesce((SELECT json_agg(c.relname ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
      AND pg_get_viewdef(c.oid) ILIKE '%job_access_notes%'), '[]'::json) AS views_reading,
  (SELECT count(*) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (ARRAY[${BROWSE_FNS.map((f) => `'${f}'`).join(", ")}]))::int AS browse_fns,
  coalesce((SELECT json_agg(p.proname ORDER BY p.proname) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosrc ILIKE '%job_access_notes%'
      AND (p.proname = ANY (ARRAY[${BROWSE_FNS.map((f) => `'${f}'`).join(", ")}])
           OR (p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')))), '[]'::json) AS fns_reading,
  (SELECT count(*) FROM public.jobs WHERE special_requirements IS NOT NULL)::int AS legacy_rows`;

async function liveRow() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`${apiBase(process.env.LH_SUPABASE_API_BASE, "https://api.supabase.com")}/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: SQL, read_only: true }),
    });
    if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
    return (await res.json())[0];
  }
  const out = supabaseDbQuery(["--linked", "-o", "json", SQL], {
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
  console.error(`::error::could not read the live catalog: ${e.message}`);
  process.exit(2);
}
const asList = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const tablesChecked = Number(row?.tables_checked ?? 0);
const viewsReading = asList(row?.views_reading);
const fnsReading = asList(row?.fns_reading);
if (!tablesChecked || !Array.isArray(viewsReading) || !Array.isArray(fnsReading)) {
  console.error(`::error::live catalog returned ${tablesChecked} base tables in public — refusing to report clean.`);
  process.exit(2);
}
if (row.table_exists !== true) {
  console.error("::error::public.job_access_notes does not exist on prod yet (20261006204113 not deployed) — refusing to report clean.");
  process.exit(2);
}
if (Number(row.browse_fns) !== BROWSE_FNS.length) {
  console.error(`::error::found ${row.browse_fns} of the ${BROWSE_FNS.length} browse functions (${BROWSE_FNS.join(", ")}) — refusing to report clean.`);
  process.exit(2);
}

const leaks = [];
if (row.rls_on !== true) leaks.push("RLS is OFF on public.job_access_notes");
if (row.anon_select === true) leaks.push("anon holds SELECT on public.job_access_notes");
if (Number(row.anon_policies) > 0) leaks.push(`${row.anon_policies} policy(ies) on job_access_notes name anon or public`);
for (const v of viewsReading) leaks.push(`view public.${v} reads job_access_notes`);
for (const f of fnsReading) leaks.push(`function public.${f} (a browse RPC or anon-executable definer) reads job_access_notes`);
if (Number(row.legacy_rows) > 0) leaks.push(`${row.legacy_rows} jobs row(s) still hold text in special_requirements (returned by open_jobs_browse)`);

console.log(`Checked public.job_access_notes against ${tablesChecked} public tables, every public view, and ${BROWSE_FNS.length} browse functions.`);
if (leaks.length) {
  for (const l of leaks) console.error(`::error::${l}`);
  console.error("The Access & Parking notes are for the poster and the booked Helpr(s) only (owner, 2026-10-06; docs/OPEN.md Q1438).");
  process.exit(1);
}
console.log("OK: anon cannot read job_access_notes, and no browse view or RPC reads it.");
