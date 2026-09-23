#!/usr/bin/env node
/**
 * LIVE: no client-callable SECURITY DEFINER function may write public.jobs
 * from a caller-supplied column list or JSON patch.
 *
 * Why this exists (2026-09-15, enforce_dispute_state_server_owned). The jobs
 * dispute-state trigger trusts every statement that does NOT run as a client
 * role (`current_user NOT IN ('anon','authenticated')`): edge functions run as
 * service_role and every SECURITY DEFINER RPC runs as its owner, postgres. That
 * trust is only sound while each definer RPC decides for itself WHICH columns
 * it writes and to WHAT. One definer function that forwards the caller's
 * choice — `EXECUTE format('UPDATE jobs SET %I = $1', col)`, a
 * `jsonb_populate_record(NULL::jobs, patch)` write, or `SET status = p->>'status'`
 * — turns it into a bypass for every guarded column at once.
 *
 * The migrations are checked statically in src/test/jobsStateColumnGuard.test.ts.
 * This reads the LIVE pg_proc as well, because prod can hold a function no
 * migration defines (a dashboard edit, an MCP apply, a failed replay).
 *
 * Usage:
 *   node scripts/check-jobs-dynamic-writers.mjs               # prod via Management API, or `supabase db query --linked`
 *   node scripts/check-jobs-dynamic-writers.mjs --inject-fake # prove it goes red (adds one synthetic offender)
 *
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (CI). Without them it uses
 * the linked Supabase CLI. Exit 1 on an offender, 2 if it could not look.
 */
import { execFileSync } from "node:child_process";
import { aclIsClientCallable, dynamicJobsWriterReasons, isReviewedJobsWriter, parseArgs } from "./lib/jobsWriteSurface.mjs";

const SQL = `
SELECT p.proname::text AS name,
       p.proacl::text AS acl,
       pg_get_function_arguments(p.oid) AS args,
       p.prosrc AS body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prosecdef
   AND p.prorettype <> 'trigger'::regtype
   AND p.prosrc ~* '\\mjobs\\M'
 ORDER BY 1`;

async function liveRows() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`${process.env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com"}/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: SQL, read_only: true }),
    });
    if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
  const out = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", SQL], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  return json.rows ?? json;
}

let rows;
try {
  rows = await liveRows();
} catch (e) {
  console.error(`::error::could not read live pg_proc: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(rows) || rows.length === 0) {
  // Prod has dozens of definer functions touching jobs. Zero means the read
  // failed quietly, not that the surface is clean.
  console.error(`::error::live pg_proc returned ${Array.isArray(rows) ? 0 : "no"} definer functions touching jobs — refusing to report clean.`);
  process.exit(2);
}

if (process.argv.includes("--inject-fake")) {
  rows.push({
    name: "zz_fake_patch_job",
    acl: "{postgres=X/postgres,authenticated=X/postgres}",
    args: "p_job_id uuid, p_patch jsonb",
    body: "BEGIN UPDATE public.jobs SET status = (p_patch->>'status')::job_status WHERE id = p_job_id; END",
  });
}

const offenders = [];
for (const r of rows) {
  if (!aclIsClientCallable(r.acl)) continue;
  if (isReviewedJobsWriter(r.name, r.body)) continue;
  const reasons = dynamicJobsWriterReasons({ name: r.name, args: parseArgs(r.args), body: r.body });
  if (reasons.length) offenders.push({ name: r.name, reasons });
}

console.log(`Checked ${rows.length} live SECURITY DEFINER functions that mention jobs.`);
if (offenders.length) {
  for (const o of offenders) {
    console.error(`::error::public.${o.name} is client-callable, SECURITY DEFINER, and writes jobs from caller input: ${o.reasons.join("; ")}`);
  }
  console.error(
    "A definer function runs as postgres, which enforce_dispute_state_server_owned trusts. Forwarding the caller's " +
      "columns or values through one bypasses every guarded jobs column. Name the columns and values in the function, " +
      "or revoke EXECUTE from anon/authenticated.",
  );
  process.exit(1);
}
console.log("OK: no client-callable definer function writes jobs from a caller-supplied column list or patch.");
