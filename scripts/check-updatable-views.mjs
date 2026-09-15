#!/usr/bin/env node
/**
 * LIVE: no view in a PostgREST-exposed schema may be writable by a client role
 * while running as its owner.
 *
 * Why this exists (2026-09-15). public.open_jobs_browse is owned by postgres
 * (which bypasses RLS) and is WITH (security_invoker=false), so a write through
 * it lands on the underlying jobs table with RLS bypassed. It carried
 * INSERT/UPDATE/DELETE for anon and authenticated — proven on prod: an anon
 * DELETE and a signed-in stranger's UPDATE of another user's funded job both
 * landed. 20260706140000 revoked those grants once; a later DROP+CREATE of the
 * view (20260912021641) silently re-granted them, because prod's default
 * privileges grant ALL on every postgres-owned relation in public to
 * anon/authenticated. A one-off REVOKE cannot prevent the next recreation, so
 * this check reads the LIVE catalog and fails on the shape itself:
 *
 *   a view in ('public','graphql_public'), security_invoker OFF,
 *   auto-updatable, with an INSERT/UPDATE/DELETE grant to anon/authenticated/PUBLIC.
 *
 * A security_invoker=true view is fine (writes run with the caller's rights and
 * hit RLS). A table is fine (RLS applies). Only an owner-run, client-writable
 * view is the RLS-bypass door.
 *
 * Usage:
 *   node scripts/check-updatable-views.mjs               # prod: Management API, or `supabase db query --linked`
 *   node scripts/check-updatable-views.mjs --self-test   # prove it goes red (a synthetic offender)
 *
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (CI). Without them it uses
 * the linked Supabase CLI. Exit 1 on an offender, 2 if it could not look.
 */
import { execFileSync } from "node:child_process";

const SQL = `
SELECT n.nspname AS schema,
       c.relname AS view,
       pg_get_userbyid(c.relowner) AS owner,
       coalesce(c.reloptions, '{}') AS reloptions,
       pg_relation_is_updatable(c.oid, false) AS updbits,
       (SELECT array_agg(DISTINCT g.grantee || ':' || g.privilege_type)
          FROM information_schema.role_table_grants g
         WHERE g.table_schema = n.nspname AND g.table_name = c.relname
           AND g.grantee IN ('anon','authenticated','PUBLIC')
           AND g.privilege_type IN ('INSERT','UPDATE','DELETE')) AS client_write
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'v'
   AND n.nspname IN ('public','graphql_public')`;

function invokerOn(reloptions) {
  const opts = Array.isArray(reloptions)
    ? reloptions
    : String(reloptions ?? "").replace(/[{}"]/g, "").split(",").filter(Boolean);
  return opts.some((o) => /^security_invoker\s*=\s*(on|true|1)$/i.test(o.trim()));
}

async function liveRows() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
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
  console.error(`::error::could not read live view catalog: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(rows) || rows.length === 0) {
  // public has several views (open_jobs_browse among them). Zero means the read
  // failed quietly, not that there are none.
  console.error(`::error::live catalog returned ${Array.isArray(rows) ? 0 : "no"} views in public/graphql_public — refusing to report clean.`);
  process.exit(2);
}

if (process.argv.includes("--self-test")) {
  rows.push({ schema: "public", view: "zz_fake_writable_view", owner: "postgres", reloptions: ["security_invoker=false"], updbits: 28, client_write: ["anon:DELETE", "authenticated:UPDATE"] });
}

const offenders = rows.filter((r) => {
  const writable = (r.updbits & 0b11100) !== 0; // insert(4) | update(8) | delete(16)
  const clientWrite = Array.isArray(r.client_write) ? r.client_write.length > 0 : !!r.client_write;
  return !invokerOn(r.reloptions) && writable && clientWrite;
});

console.log(`Checked ${rows.length} views in public/graphql_public.`);
if (offenders.length) {
  for (const o of offenders) {
    console.error(`::error::view ${o.schema}.${o.view} (owner ${o.owner}) is security_invoker-off, auto-updatable, and client-writable: ${(Array.isArray(o.client_write) ? o.client_write : [o.client_write]).join(", ")}`);
  }
  console.error(
    "An owner-run view bypasses the base table's RLS on write, so these grants let any client write rows RLS would refuse. " +
      "Fix: REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON <view> FROM PUBLIC, anon, authenticated; " +
      "(keep GRANT SELECT). Note default privileges re-grant these on any DROP+CREATE.",
  );
  process.exit(1);
}
console.log("OK: no exposed-schema view is owner-run and client-writable.");
