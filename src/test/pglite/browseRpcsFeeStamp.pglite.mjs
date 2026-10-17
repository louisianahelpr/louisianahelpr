#!/usr/bin/env node
/**
 * PGlite proof for 20261017094018_browse_rpcs_carry_fee_stamp (Q1839): the
 * ranked-feed and map RPCs return jobs.helper_fee_flat_cents as their LAST
 * column, and NOTHING else about them changes: same arguments, SECURITY
 * DEFINER, STABLE, search_path + TimeZone, the same rows for the same caller,
 * and EXECUTE exactly as live (pg_proc.proacl read on prod 2026-10-17).
 *
 *   node src/test/pglite/browseRpcsFeeStamp.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/browseRpcsFeeStamp.pglite.mjs # RED: the state on main
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). The "before"
 * functions are cut from 20261012185633 (their newest definitions on main,
 * prosrc md5 equal to live 2026-10-17); the jobs table gets the column from
 * 20261015023908. Helpers the bodies call are stubbed permissive.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261017094018_browse_rpcs_carry_fee_stamp.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

/** One function's CREATE + its REVOKE/GRANT lines, cut from a migration. */
function cutFunction(file, name) {
  const sql = read(MIGDIR + file);
  const st = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf("$function$;", sql.indexOf("AS $function$", st) + 13) + "$function$;".length;
  const grants = sql.slice(end).split("\n").filter((l) => l.startsWith("REVOKE") || l.startsWith("GRANT")).slice(0, 2).join("\n");
  return `${sql.slice(st, end)}\n${grants}`;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.job_category AS ENUM ('yard', 'moving', 'cleaning');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, description text, category public.job_category DEFAULT 'yard', budget numeric DEFAULT 100,
  date_needed date, start_time time, location text DEFAULT 'Lafayette, LA', is_urgent boolean DEFAULT false,
  urgent_fee numeric, is_flexible_schedule boolean DEFAULT false, is_recurring boolean DEFAULT false,
  is_group_job boolean DEFAULT false, helpers_needed int DEFAULT 1, estimated_hours numeric, photos text[],
  special_requirements text, status public.job_status DEFAULT 'open', created_at timestamptz DEFAULT now() - interval '1 day',
  boosted_at timestamptz, boost_expires_at timestamptz, expires_at timestamptz,
  recurrence_interval text, parent_job_id uuid, payment_status text DEFAULT 'escrow',
  customer_id uuid, offered_to_helper_id uuid, direct_offer_status text,
  pricing_mode text, latitude numeric DEFAULT 30.22, longitude numeric DEFAULT -92.02, parish text,
  credential_tier int DEFAULT 0, is_seed boolean DEFAULT false, helper_fee_percent numeric
);
CREATE TABLE public.profiles (user_id uuid, parish text, latitude numeric, longitude numeric, subscription_tier text, subscription_expires_at timestamptz);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT current_user = 'postgres' $$;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.crew_spots_open(j uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
CREATE FUNCTION public.job_offer_cutoff(d date, t time) RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() + interval '1 day' $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT NULL::numeric $$;
`);
await db.exec(read(`${MIGDIR}20261015023908_jobs_helper_fee_flat_cents.sql`));
await db.exec(cutFunction("20261012185633_listing_closes_at_start.sql", "get_ranked_open_jobs"));
await db.exec(cutFunction("20261012185633_listing_closes_at_start.sql", "get_open_jobs_for_map"));
// The live COMMENT on the ranked feed (obj_description, prod 2026-10-17), as
// 20260907052949 set it; the map has none.
{
  const old = read(`${MIGDIR}20260907052949_browse_ranks_by_distance_without_leaking_it.sql`);
  const at = old.indexOf("COMMENT ON FUNCTION public.get_ranked_open_jobs(");
  await db.exec(old.slice(at, old.indexOf("';", at) + 2));
}

const P = "71c56dfb-b326-4010-b960-b18dd3966e7f";
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, helper_fee_flat_cents, helper_fee_percent) VALUES
    ('10000000-0000-4000-8000-000000000001', 'flat', '${P}', 70, 5),
    ('10000000-0000-4000-8000-000000000002', 'legacy', '${P}', NULL, 12);
  INSERT INTO public.jobs (id, title, customer_id, payment_status) VALUES
    ('10000000-0000-4000-8000-000000000003', 'unfunded', '${P}', 'unpaid');`);

const SIGS = {
  get_ranked_open_jobs: "get_ranked_open_jobs(integer,integer,boolean,numeric,numeric,numeric)",
  get_open_jobs_for_map: "get_open_jobs_for_map()",
};
// The live snapshot (prod pg_proc, 2026-10-17): both functions identical.
const LIVE = {
  acl: ["anon=X/postgres", "authenticated=X/postgres", "postgres=X/postgres", "service_role=X/postgres"],
  prosecdef: true, provolatile: "s", proconfig: ["TimeZone=America/Chicago", "search_path=public"],
};

async function shape(name) {
  const r = (await db.query(`SELECT p.oid::regprocedure::text sig, p.proacl::text[] acl, p.prosecdef, p.provolatile,
      p.proconfig, pg_get_function_arguments(p.oid) args, p.proargnames, p.proallargtypes::text
    FROM pg_proc p WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace`, [name])).rows;
  return r.length === 1 ? r[0] : null;
}
/** The RETURNS TABLE columns, in order, with their types. */
async function outCols(name) {
  return (await db.query(`SELECT a.n || ' ' || format_type(a.t, NULL) c
      FROM pg_proc p, unnest(p.proargnames, p.proargmodes::text[], p.proallargtypes) WITH ORDINALITY a(n, m, t, i)
     WHERE p.proname = $1 AND a.m = 't' ORDER BY a.i`, [name])).rows.map((r) => r.c);
}
async function comment(name) {
  return (await db.query(`SELECT obj_description(p.oid, 'pg_proc') c FROM pg_proc p WHERE p.proname = $1`, [name])).rows[0]?.c ?? null;
}
async function callAs(role, sql) {
  await db.exec(`SET ROLE ${role}`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("RESET ROLE"); }
}
const CALLS = {
  get_ranked_open_jobs: "SELECT id, budget FROM public.get_ranked_open_jobs() ORDER BY id",
  get_open_jobs_for_map: "SELECT id, budget FROM public.get_open_jobs_for_map() ORDER BY id",
};

const before = {};
for (const n of Object.keys(SIGS)) {
  before[n] = { comment: await comment(n), shape: await shape(n), cols: await outCols(n), anon: JSON.stringify(await callAs("anon", CALLS[n])), auth: JSON.stringify(await callAs("authenticated", CALLS[n])) };
}

let applied = 0;
if (!MODE) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", applied === 3, `applied ${applied}`);
check("the ranked feed had its live COMMENT before", typeof before.get_ranked_open_jobs.comment === "string" && before.get_ranked_open_jobs.comment.startsWith("Public /jobs feed, ranked."));

for (const n of Object.keys(SIGS)) {
  const s = await shape(n);
  check(`${n}: still exactly one function, same signature`, s?.sig === SIGS[n], s?.sig);
  check(`${n}: same arguments and defaults`, s?.args === before[n].shape.args, s?.args);
  check(`${n}: SECURITY DEFINER, STABLE, search_path + TimeZone as live`,
    s?.prosecdef === LIVE.prosecdef && s?.provolatile === LIVE.provolatile && JSON.stringify([...(s?.proconfig ?? [])].sort()) === JSON.stringify(LIVE.proconfig),
    JSON.stringify([s?.prosecdef, s?.provolatile, s?.proconfig]));
  check(`${n}: EXECUTE exactly as live (no PUBLIC, no new grantee)`, JSON.stringify([...(s?.acl ?? [])].sort()) === JSON.stringify(LIVE.acl), JSON.stringify(s?.acl));
  const cols = await outCols(n);
  check(`${n}: the old columns, in order, plus helper_fee_flat_cents last`,
    JSON.stringify(cols) === JSON.stringify([...before[n].cols, "helper_fee_flat_cents integer"]), `${before[n].cols.length} -> ${cols.length}, last=${cols.at(-1)}`);
  check(`${n}: the COMMENT is exactly as before`, (await comment(n)) === before[n].comment, String(before[n].comment).slice(0, 40));
  check(`${n}: anon sees the same rows`, JSON.stringify(await callAs("anon", CALLS[n])) === before[n].anon, before[n].anon);
  check(`${n}: authenticated sees the same rows`, JSON.stringify(await callAs("authenticated", CALLS[n])) === before[n].auth);
  let stamps = {};
  try {
    const rows = await callAs("anon", `SELECT id, helper_fee_flat_cents FROM public.${n}()`);
    stamps = Object.fromEntries(rows.map((r) => [r.id.slice(-1), r.helper_fee_flat_cents]));
  } catch (e) { stamps = { error: e.message }; }
  check(`${n}: a flat job reads its stamp (70); a legacy job reads NULL; an unfunded one is absent`,
    stamps["1"] === 70 && stamps["2"] === null && !("3" in stamps), JSON.stringify(stamps));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
