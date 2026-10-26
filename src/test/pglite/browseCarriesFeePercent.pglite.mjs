#!/usr/bin/env node
/**
 * PGlite proof for 20261025235701_browse_carries_helper_fee_percent (Q2400): open_jobs_browse,
 * get_ranked_open_jobs and get_open_jobs_for_map each gain jobs.helper_fee_percent as their LAST column, right
 * after helper_fee_flat_cents, and NOTHING else about them changes: same rows for the same caller, still a definer
 * view with the same grants, functions with the same arguments, SECURITY DEFINER, STABLE, search_path + TimeZone,
 * EXECUTE exactly as live (pg_proc.proacl read on prod 2026-10-25) and the ranked feed's COMMENT.
 *
 *   node src/test/pglite/browseCarriesFeePercent.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/browseCarriesFeePercent.pglite.mjs # RED: the state before it
 *
 * The "before" objects are each one's newest definition (view: 20261015034054; ranked: 20261021062609; map:
 * 20261017094018; ranked + map prosrc md5 equal to live 2026-10-25). Helpers they call are stubbed permissive.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261025235701_browse_carries_helper_fee_percent.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state before Q2400 (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
/** One statement cut from a migration: from `start` to the end of its dollar-quoted body (or `;` for a view). */
function cut(file, start, endMark) {
  const sql = read(MIGDIR + file);
  const st = sql.lastIndexOf(start);
  if (st < 0) throw new Error(`${start} not in ${file}`);
  const end = sql.indexOf(endMark, sql.indexOf(endMark === ";" ? " FROM jobs" : "AS $function$", st) + (endMark === ";" ? 0 : 13));
  let stmt = sql.slice(st, end + endMark.length);
  if (!stmt.trim().endsWith(";")) stmt += ";";
  return stmt;
}

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
  updated_at timestamptz DEFAULT now(), boosted_at timestamptz, boost_expires_at timestamptz, expires_at timestamptz,
  recurrence_interval text, recurrence_end_date date, parent_job_id uuid, payment_status text DEFAULT 'escrow',
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  pricing_mode text, latitude numeric DEFAULT 30.22, longitude numeric DEFAULT -92.02, parish text,
  credential_tier int DEFAULT 0, require_photo_proof boolean, recurrence_days int[], recurrence_weeks int,
  series_split_ok boolean, materials_note text, is_seed boolean DEFAULT false, helper_fee_percent numeric
);
CREATE TABLE public.applications (job_id uuid);
CREATE TABLE public.group_job_helpers (job_id uuid);
CREATE TABLE public.crew_block_fees (job_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.profiles (user_id uuid, parish text, latitude numeric, longitude numeric, subscription_tier text, subscription_expires_at timestamptz);
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT current_user = 'postgres' $$;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.crew_spots_open(j uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.job_offer_cutoff(d date, t time) RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() + interval '1 day' $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT NULL::numeric $$;
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`);
await db.exec(read(`${MIGDIR}20261015023908_jobs_helper_fee_flat_cents.sql`));
// BEFORE: each object's newest definition, as live.
await db.exec(cut("20261015034054_open_jobs_browse_fee_stamp.sql", "CREATE OR REPLACE VIEW public.open_jobs_browse", ";"));
await db.exec(`GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;`);
await db.exec(cut("20261021062609_memberships_off_paid_perks.sql", "CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(", "$function$"));
await db.exec(cut("20261017094018_browse_rpcs_carry_fee_stamp.sql", "CREATE FUNCTION public.get_open_jobs_for_map()", "$function$"));
for (const sig of ["get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric)", "get_open_jobs_for_map()"]) {
  await db.exec(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.${sig} TO anon, authenticated, service_role;`);
}
{
  const old = read(`${MIGDIR}20261017094018_browse_rpcs_carry_fee_stamp.sql`);
  const at = old.indexOf("COMMENT ON FUNCTION public.get_ranked_open_jobs(");
  await db.exec(old.slice(at, old.indexOf("never a number.';", at) + "never a number.';".length));
}

const P = "71c56dfb-b326-4010-b960-b18dd3966e7f";
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, helper_fee_flat_cents, helper_fee_percent) VALUES
    ('10000000-0000-4000-8000-000000000001', 'flat5', '${P}', 70, 5),
    ('10000000-0000-4000-8000-000000000004', 'flat10', '${P}', 70, 10),
    ('10000000-0000-4000-8000-000000000002', 'legacy', '${P}', NULL, 12);
  INSERT INTO public.jobs (id, title, customer_id, payment_status) VALUES
    ('10000000-0000-4000-8000-000000000003', 'unfunded', '${P}', 'unpaid');`);

const SURFACES = {
  view: { sel: (c) => `SELECT ${c} FROM public.open_jobs_browse` },
  get_ranked_open_jobs: { sel: (c) => `SELECT ${c} FROM public.get_ranked_open_jobs()`, sig: "get_ranked_open_jobs(integer,integer,boolean,numeric,numeric,numeric)" },
  get_open_jobs_for_map: { sel: (c) => `SELECT ${c} FROM public.get_open_jobs_for_map()`, sig: "get_open_jobs_for_map()" },
};
const LIVE = { acl: ["anon=X/postgres", "authenticated=X/postgres", "postgres=X/postgres", "service_role=X/postgres"], proconfig: ["TimeZone=America/Chicago", "search_path=public"] };
async function cols(name) {
  if (name === "view") return (await db.query(`SELECT column_name || ' ' || data_type c FROM information_schema.columns WHERE table_name = 'open_jobs_browse' ORDER BY ordinal_position`)).rows.map((r) => r.c);
  return (await db.query(`SELECT a.n || ' ' || format_type(a.t, NULL) c FROM pg_proc p, unnest(p.proargnames, p.proargmodes::text[], p.proallargtypes) WITH ORDINALITY a(n, m, t, i)
     WHERE p.proname = $1 AND a.m = 't' ORDER BY a.i`, [name])).rows.map((r) => r.c);
}
async function shape(name) {
  const r = (await db.query(`SELECT p.oid::regprocedure::text sig, p.proacl::text[] acl, p.prosecdef, p.provolatile, p.proconfig, pg_get_function_arguments(p.oid) args, obj_description(p.oid, 'pg_proc') cmt
    FROM pg_proc p WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace`, [name])).rows;
  return r.length === 1 ? r[0] : null;
}
async function rowsAs(role, sql) {
  await db.exec(`SET ROLE ${role}`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("RESET ROLE"); }
}
const before = {};
for (const [n, s] of Object.entries(SURFACES)) {
  before[n] = { cols: await cols(n), shape: n === "view" ? null : await shape(n),
    anon: JSON.stringify(await rowsAs("anon", `${s.sel("id, budget")} ORDER BY id`)), auth: JSON.stringify(await rowsAs("authenticated", `${s.sel("id, budget")} ORDER BY id`)) };
}

let applied = 0;
if (!MODE) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", applied === 3, `applied ${applied}`);

for (const [n, s] of Object.entries(SURFACES)) {
  const c = await cols(n);
  check(`${n}: the old columns in order, plus helper_fee_percent numeric last`,
    JSON.stringify(c) === JSON.stringify([...before[n].cols, "helper_fee_percent numeric"]), `${before[n].cols.length} -> ${c.length}, last=${c.at(-1)}`);
  check(`${n}: anon sees the same rows`, JSON.stringify(await rowsAs("anon", `${s.sel("id, budget")} ORDER BY id`)) === before[n].anon, before[n].anon);
  check(`${n}: authenticated sees the same rows`, JSON.stringify(await rowsAs("authenticated", `${s.sel("id, budget")} ORDER BY id`)) === before[n].auth);
  let pct = {};
  try { pct = Object.fromEntries((await rowsAs("anon", s.sel("title, helper_fee_flat_cents, helper_fee_percent"))).map((r) => [r.title, `${r.helper_fee_flat_cents}/${r.helper_fee_percent}`])); }
  catch (e) { pct = { error: e.message.slice(0, 60) }; }
  check(`${n}: a 5% job reads 70/5, a 10% job 70/10, a legacy job null/12; unfunded absent`,
    pct.flat5 === "70/5" && pct.flat10 === "70/10" && pct.legacy === "null/12" && !("unfunded" in pct), JSON.stringify(pct));
  if (n === "view") {
    const opts = (await db.query(`SELECT reloptions FROM pg_class WHERE relname = 'open_jobs_browse'`)).rows[0].reloptions;
    check("view: still a definer view (security_invoker=false)", JSON.stringify(opts ?? []).includes("security_invoker=false"), JSON.stringify(opts));
    const g = (await db.query(`SELECT has_table_privilege('anon','public.open_jobs_browse','SELECT') a, has_table_privilege('authenticated','public.open_jobs_browse','SELECT') b, has_table_privilege('anon','public.open_jobs_browse','INSERT') w`)).rows[0];
    check("view: anon + authenticated keep SELECT and gain nothing", g.a && g.b && !g.w, JSON.stringify(g));
  } else {
    const sh = await shape(n);
    check(`${n}: one function, same signature and arguments`, sh?.sig === s.sig && sh?.args === before[n].shape.args, sh?.sig);
    check(`${n}: SECURITY DEFINER, STABLE, search_path + TimeZone as live`, sh?.prosecdef === true && sh?.provolatile === "s" && JSON.stringify([...(sh?.proconfig ?? [])].sort()) === JSON.stringify(LIVE.proconfig));
    check(`${n}: EXECUTE exactly as live`, JSON.stringify([...(sh?.acl ?? [])].sort()) === JSON.stringify(LIVE.acl), JSON.stringify(sh?.acl));
    check(`${n}: COMMENT unchanged`, sh?.cmt === before[n].shape.cmt, String(sh?.cmt).slice(0, 30));
  }
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
