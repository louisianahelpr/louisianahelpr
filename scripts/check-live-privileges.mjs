#!/usr/bin/env node
/**
 * LIVE: two privilege classes that let an anon write through on 2026-09-15.
 *
 *  1. scripts/ci/client-default-privileges.sql — no default privilege may hand
 *     anon / authenticated / PUBLIC anything on the tables, views or sequences
 *     postgres creates in public. That default (arwdxm) re-granted writes on
 *     public.open_jobs_browse, an RLS-bypassing view, when it was recreated.
 *     Removed by 20260915101101.
 *  2. scripts/ci/null-uid-trust.sql — no plpgsql function in public may treat
 *     a bare NULL auth.uid() as the service role. 23 guard triggers did, so the
 *     anon writes through that view skipped every jobs money/state guard.
 *     Rebuilt on public.is_server_context() by 20260915101102.
 *  3. (Q304) no client role holds UPDATE on a server-only profiles column:
 *     every entry of public.profiles_locked_update_columns(), plus ban_status
 *     and auto_suspended_until named explicitly (so the check still bites if
 *     they are ever dropped from that list). authenticated held UPDATE on both
 *     until 20260923212305.
 *
 * Both queries are shared with the db-smoke replay gate; this reads PROD,
 * because prod is where a dashboard edit, an MCP apply or a failed replay can
 * leave a catalog no migration describes.
 *
 * Usage:
 *   node scripts/check-live-privileges.mjs               # prod: Management API, or `supabase db query --linked`
 *   node scripts/check-live-privileges.mjs --self-test   # prove it goes red (synthetic offenders)
 *
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (CI). Without them it uses
 * the linked Supabase CLI. Exit 1 on an offender, 2 if it could not look.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const load = (p) =>
  readFileSync(new URL(p, import.meta.url), "utf8")
    .replace(/^\s*--[^\n]*\n/gm, "")
    .trim()
    .replace(/;\s*$/, "");

const DEFAULTS_SQL = load("./ci/client-default-privileges.sql");
const NULL_UID_SQL = load("./ci/null-uid-trust.sql");

// Q304: profiles columns only the server may write. The locked list is what
// sync_profiles_update_grants() subtracts every 10 minutes; the two literals
// keep the ban columns checked even if they were dropped from it.
const SERVER_ONLY_COLUMNS = `(CASE WHEN to_regprocedure('public.profiles_locked_update_columns()') IS NOT NULL
    THEN public.profiles_locked_update_columns() ELSE ARRAY[]::text[] END
    || ARRAY['ban_status', 'auto_suspended_until'])`;

// One round trip. The two counts prove the catalog was actually read: prod has
// plpgsql functions in public and a postgres default-ACL entry for public
// (service_role's grants stay), so a zero means a failed read, not a clean one.
const SQL = `
SELECT (SELECT count(*) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
         WHERE p.pronamespace = 'public'::regnamespace AND l.lanname = 'plpgsql')::int AS plpgsql_functions,
       (SELECT count(*) FROM pg_default_acl d
         WHERE d.defaclnamespace = 'public'::regnamespace
           AND pg_get_userbyid(d.defaclrole) = 'postgres')::int AS postgres_default_acl_entries,
       (SELECT count(*) FROM pg_proc WHERE oid = to_regprocedure('public.is_server_context()'))::int AS has_server_context_helper,
       coalesce((SELECT json_agg(o) FROM (${DEFAULTS_SQL}) o), '[]'::json) AS default_offenders,
       coalesce((SELECT json_agg(o) FROM (${NULL_UID_SQL}) o), '[]'::json) AS null_uid_offenders,
       (SELECT count(*) FROM pg_attribute
         WHERE attrelid = 'public.profiles'::regclass AND attname = ANY (ARRAY['ban_status', 'auto_suspended_until'])
           AND NOT attisdropped)::int AS server_only_columns_present,
       coalesce((SELECT json_agg(json_build_object('column', c, 'role', r))
                   FROM (SELECT DISTINCT unnest(${SERVER_ONLY_COLUMNS}) AS c) cols
                   CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r
                  WHERE EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.profiles'::regclass
                                  AND a.attname = cols.c AND NOT a.attisdropped)
                    AND has_column_privilege(r, 'public.profiles', c, 'UPDATE')), '[]'::json) AS server_only_column_offenders`;

async function liveRow() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`${process.env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com"}/v1/projects/${ref}/database/query`, {
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
  console.error(`::error::could not read the live catalog: ${e.message}`);
  process.exit(2);
}
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const fns = Number(row?.plpgsql_functions ?? 0);
const acl = Number(row?.postgres_default_acl_entries ?? 0);
const defaults = parse(row?.default_offenders);
const nullUid = parse(row?.null_uid_offenders);
const serverOnly = parse(row?.server_only_column_offenders);
const serverOnlyPresent = Number(row?.server_only_columns_present ?? 0);
if (!fns || !acl || !Array.isArray(defaults) || !Array.isArray(nullUid) || !Array.isArray(serverOnly) || serverOnlyPresent !== 2) {
  console.error(`::error::live catalog returned ${fns} plpgsql functions / ${acl} postgres default-ACL entries in public / ${serverOnlyPresent} of 2 server-only profiles columns (Q304: ban_status, auto_suspended_until) — refusing to report clean.`);
  process.exit(2);
}

if (process.argv.includes("--self-test")) {
  defaults.push({ owner_role: "postgres", schema: "public", object_type: "tables", grantee: "anon", privilege: "INSERT" });
  nullUid.push({ function_name: "zz_fake_guard", shape: "A", condition: "auth.uid() IS NULL" });
  serverOnly.push({ column: "ban_status", role: "authenticated" });
}

let failed = false;
console.log(`Checked ${acl} postgres default-ACL entries and ${fns} plpgsql functions in public.`);
if (defaults.length) {
  failed = true;
  const by = new Map();
  for (const d of defaults) {
    const k = `${d.owner_role} ${d.schema} ${d.object_type} -> ${d.grantee}`;
    by.set(k, [...(by.get(k) ?? []), d.privilege]);
  }
  for (const [k, privs] of by) console.error(`::error::default privileges grant a client role: ${k}: ${privs.join(", ")}`);
  console.error(
    "Every new relation in public would arrive with those grants (the open_jobs_browse re-grant). " +
      "Fix: ALTER DEFAULT PRIVILEGES FOR ROLE <owner_role> IN SCHEMA public REVOKE ALL ON TABLES|SEQUENCES FROM anon, authenticated (see 20260915101101).",
  );
}
if (nullUid.length) {
  failed = true;
  for (const f of nullUid) console.error(`::error::public.${f.function_name} (shape ${f.shape}) trusts a bare NULL uid: IF ${f.condition} THEN ...`);
  console.error(
    "An anon request has a NULL auth.uid() too. Fix: test public.is_server_context() instead (see 20260915101102), " +
      "or, if the NULL branch is genuinely fail-safe, exempt it in scripts/ci/null-uid-trust.sql with the reason.",
  );
}
if (serverOnly.length) {
  failed = true;
  for (const o of serverOnly) console.error(`::error::${o.role} holds UPDATE on server-only column public.profiles.${o.column}`);
  console.error(
    "A client could write it directly (Q304). Fix: add the column to public.profiles_locked_update_columns() and " +
      "SELECT public.sync_profiles_update_grants() in a migration (a bare REVOKE is re-granted by the 10-minute sync cron).",
  );
}
if (!Number(row?.has_server_context_helper)) {
  console.log("note: public.is_server_context() is not deployed yet.");
}
if (failed) process.exit(1);
console.log("OK: no client default privileges in public; no function trusts a bare NULL uid; no client UPDATE on a server-only profiles column.");
