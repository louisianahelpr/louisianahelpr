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
 *  4. scripts/ci/rowtype-args-unreadable.sql — no function a client role may
 *     EXECUTE takes a whole row of a relation that role cannot SELECT in full.
 *     PostgREST hands a computed field the whole row, so payment_captured(jobs)
 *     403'd every admin money read (authenticated may not read
 *     jobs.offered_to_helper_id) until 20261003050100 dropped it.
 *  5. scripts/ci/client-insert-columns.sql (Q340, Q1166) — on a table whose
 *     client INSERT/UPDATE columns are declared there (messages), a client role
 *     holds that privilege on exactly those columns: nothing table-level, no
 *     server-owned column (is_system, created_at, read on INSERT; edited_at,
 *     read_at on UPDATE), and none of the client's columns missing.
 *     authenticated held table-level INSERT on messages until 20261003182009,
 *     and UPDATE on edited_at until 20261004001242.
 *  6. scripts/ci/current-date-time-zone.sql (Q1185) — every function in public
 *     that reads the date (CURRENT_DATE, now()::date, date(now()), ...) pins
 *     TimeZone to America/Chicago. Prod sessions
 *     run in UTC, so an unpinned `date_needed < CURRENT_DATE` calls a job dated
 *     today "already passed" every evening from 19:00 CDT. Not a privilege, but
 *     a catalog setting a dashboard edit can drop like one.
 *  7. scripts/ci/unconfirmed-email-gate.sql (Q838) — every public table but
 *     the two anon-writable telemetry tables keeps an ENABLED Q807 email gate
 *     (zz_refuse_unconfirmed_email_write on INSERT/UPDATE/DELETE, running
 *     refuse_unconfirmed_email_write). The migration guard cannot see a table
 *     made in the dashboard or a gate disabled outside a migration.
 *
 *  8. scripts/ci/definer-exec-inventory.sql (Q14) — the SECURITY DEFINER
 *     functions in public that anon / authenticated may EXECUTE are EXACTLY the
 *     ones in scripts/ci/definer-exec-allowlist.json, each with why a client
 *     needs it (src/test/definerExecAllowlist.test.ts checks the reasons). Five
 *     answered about other people for any id and no client called them until
 *     20261005054927.
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
import { supabaseDbQuery } from "./lib/supabaseDbQuery.mjs";
import { readFileSync } from "node:fs";

const load = (p) =>
  readFileSync(new URL(p, import.meta.url), "utf8")
    .replace(/^\s*--[^\n]*\n/gm, "")
    .trim()
    .replace(/;\s*$/, "");

const DEFAULTS_SQL = load("./ci/client-default-privileges.sql");
const NULL_UID_SQL = load("./ci/null-uid-trust.sql");
const ROWTYPE_SQL = load("./ci/rowtype-args-unreadable.sql");
const CLIENT_INSERT_SQL = load("./ci/client-insert-columns.sql");
const CURRENT_DATE_SQL = load("./ci/current-date-time-zone.sql");
const EMAIL_GATE_SQL = load("./ci/unconfirmed-email-gate.sql");
const DEFINER_EXEC_SQL = load("./ci/definer-exec-inventory.sql");
const DEFINER_ALLOW = JSON.parse(readFileSync(new URL("./ci/definer-exec-allowlist.json", import.meta.url), "utf8"));

// Q304: profiles columns only the server may write. The locked list is what
// sync_profiles_update_grants() subtracts every 10 minutes; the two literals
// keep the ban columns checked even if they were dropped from it.
// The list is read from the function's SOURCE, not by calling it: CI queries
// with read_only:true (supabase_read_only_user), which has no EXECUTE on it
// (db-deploy run 35923703691: "permission denied for function").
const SERVER_ONLY_COLUMNS = `(COALESCE((SELECT array_agg(m[1]) FROM pg_proc p,
      regexp_matches(regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g'), '''([a-z_]+)''', 'g') m
    WHERE p.oid = to_regprocedure('public.profiles_locked_update_columns()')), ARRAY[]::text[])
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
       coalesce((SELECT json_agg(o) FROM (${ROWTYPE_SQL}) o), '[]'::json) AS rowtype_offenders,
       coalesce((SELECT json_agg(o) FROM (${CLIENT_INSERT_SQL}) o), '[]'::json) AS client_insert_offenders,
       coalesce((SELECT json_agg(o) FROM (${CURRENT_DATE_SQL}) o), '[]'::json) AS current_date_offenders,
       coalesce((SELECT json_agg(o) FROM (${EMAIL_GATE_SQL}) o), '[]'::json) AS email_gate_offenders,
       coalesce((SELECT json_agg(o) FROM (${DEFINER_EXEC_SQL}) o), '[]'::json) AS definer_exec_rows,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_refuse_unconfirmed_email_write' AND NOT tgisinternal)::int AS email_gates,
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
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const fns = Number(row?.plpgsql_functions ?? 0);
const acl = Number(row?.postgres_default_acl_entries ?? 0);
const defaults = parse(row?.default_offenders);
const nullUid = parse(row?.null_uid_offenders);
const serverOnly = parse(row?.server_only_column_offenders);
const rowtype = parse(row?.rowtype_offenders);
const clientInsert = parse(row?.client_insert_offenders);
const currentDate = parse(row?.current_date_offenders);
const emailGate = parse(row?.email_gate_offenders);
const emailGates = Number(row?.email_gates ?? 0);
const definerRows = parse(row?.definer_exec_rows);
const serverOnlyPresent = Number(row?.server_only_columns_present ?? 0);
if (!fns || !acl || !Array.isArray(defaults) || !Array.isArray(nullUid) || !Array.isArray(serverOnly) || !Array.isArray(rowtype) || !Array.isArray(clientInsert) || !Array.isArray(emailGate) || !Array.isArray(currentDate) || !Array.isArray(definerRows) || definerRows.length < 50 || emailGates < 50 || serverOnlyPresent !== 2) {
  console.error(`::error::live catalog returned ${Array.isArray(definerRows) ? definerRows.length : "no"} client-executable SECURITY DEFINER rows (Q14: ~127 live) /`);
  console.error(`::error::live catalog returned ${fns} plpgsql functions / ${acl} postgres default-ACL entries in public / ${serverOnlyPresent} of 2 server-only profiles columns (Q304: ban_status, auto_suspended_until) / ${emailGates} Q807 email gates (Q838: ~100 live) — refusing to report clean.`);
  process.exit(2);
}

if (process.argv.includes("--self-test")) {
  defaults.push({ owner_role: "postgres", schema: "public", object_type: "tables", grantee: "anon", privilege: "INSERT" });
  nullUid.push({ function_name: "zz_fake_guard", shape: "A", condition: "auth.uid() IS NULL" });
  serverOnly.push({ column: "ban_status", role: "authenticated" });
  rowtype.push({ function_name: "zz_fake_field(jobs)", row_of: "jobs", role: "authenticated" });
  clientInsert.push({ table: "messages", role: "authenticated", what: "INSERT (is_system)" });
  clientInsert.push({ table: "messages", role: "authenticated", what: "UPDATE (edited_at)" });
  currentDate.push({ function_name: "zz_fake_date_check", config: "search_path=public" });
  emailGate.push({ table: "jobs", what: "email gate trigger not enabled (tgenabled D)" });
  definerRows.push({ signature: "zz_fake_definer(uuid)", role: "authenticated" });
}

// Q14: two-way diff of the live client-executable definer set against the allowlist.
const liveDefiner = new Set(definerRows.map((r) => `${r.role} ${r.signature}`));
const allowedDefiner = new Set(
  ["anon", "authenticated"].flatMap((role) => Object.keys(DEFINER_ALLOW[role] ?? {}).map((sig) => `${role} ${sig}`)),
);
const definerUnlisted = [...liveDefiner].filter((k) => !allowedDefiner.has(k)).sort();
const definerStale = [...allowedDefiner].filter((k) => !liveDefiner.has(k)).sort();

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
if (rowtype.length) {
  failed = true;
  for (const o of rowtype) console.error(`::error::${o.role} may EXECUTE public.${o.function_name} but cannot SELECT every column of ${o.row_of}: every call through PostgREST (a computed field) fails 42501`);
  console.error(
    "PostgREST passes a computed field the whole row, and a whole-row reference needs SELECT on every column. " +
      "Fix: answer from a function with scalar arguments or an admin RPC (see 20261003050100), or REVOKE EXECUTE from that role if no client calls it.",
  );
}
if (clientInsert.length) {
  failed = true;
  for (const o of clientInsert) console.error(`::error::public.${o.table}: ${o.role} ${o.what} (Q340/Q1166, scripts/ci/client-insert-columns.sql)`);
  console.error(
    "A client may INSERT and UPDATE only the columns it sends; a table-level privilege implies every column, the server-owned ones included. " +
      "Fix: REVOKE <INSERT|UPDATE> ON <table> FROM PUBLIC, anon, authenticated, then GRANT <INSERT|UPDATE> (<the declared columns>) TO authenticated " +
      "(see 20261003182009, 20261004001242); a 'missing' row means a client column lost its grant and every such client write now fails.",
  );
}
if (currentDate.length) {
  failed = true;
  for (const o of currentDate) console.error(`::error::public.${o.function_name} reads the date (CURRENT_DATE, now()::date, ...) without TimeZone=America/Chicago (config: ${o.config || "none"}) (Q1185, scripts/ci/current-date-time-zone.sql)`);
  console.error(
    "CURRENT_DATE is the session's date and prod sessions run in UTC, a day ahead of Louisiana from 19:00 CDT. " +
      "Fix: add SET \"TimeZone\" TO 'America/Chicago' to the function (see 20261003214350), as enforce_application_job_state has.",
  );
}
if (emailGate.length) {
  failed = true;
  for (const o of emailGate) console.error(`::error::public.${o.table}: ${o.what} (Q838, scripts/ci/unconfirmed-email-gate.sql)`);
  console.error(
    "An unconfirmed-email session can write this table: Q807's gate is missing or off. Fix: SELECT " +
      "public.attach_unconfirmed_email_gate() in a migration (it attaches to every gated table), or re-enable the " +
      "trigger; a table that must take anonymous writes joins the exemption list in both 20260927234313's attach " +
      "function and the SQL file, with its reason.",
  );
}
if (definerUnlisted.length || definerStale.length) {
  failed = true;
  for (const k of definerUnlisted) console.error(`::error::SECURITY DEFINER public.${k.slice(k.indexOf(" ") + 1)} is EXECUTE-able by ${k.slice(0, k.indexOf(" "))} but not in scripts/ci/definer-exec-allowlist.json (Q14)`);
  for (const k of definerStale) console.error(`::error::scripts/ci/definer-exec-allowlist.json lists ${k} but the live catalog does not grant it (stale entry, Q14)`);
  console.error(
    "A definer function runs as its owner and skips RLS, so every one a client may call must say why. Fix: if no client calls it, " +
      "REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated in a migration (see 20261005054927); otherwise add it to the allowlist " +
      "with \"client\" (src/ calls it), \"policy\" (a policy calls it) or a reviewed reason; delete entries for revoked or dropped functions.",
  );
}
if (!Number(row?.has_server_context_helper)) {
  console.log("note: public.is_server_context() is not deployed yet.");
}
if (failed) process.exit(1);
console.log("OK: no client default privileges in public; no function trusts a bare NULL uid; no client UPDATE on a server-only profiles column; no client-callable function takes a row its caller cannot read; no client INSERT or UPDATE beyond the declared columns; every function that reads the date pins America/Chicago; every public table keeps its email gate; the client-executable SECURITY DEFINER functions are exactly the allowlist.");
