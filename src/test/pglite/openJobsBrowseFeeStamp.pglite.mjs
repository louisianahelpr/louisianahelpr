#!/usr/bin/env node
/**
 * PGlite proof for 20261015034054_open_jobs_browse_fee_stamp (roadmap F3): the
 * browse view projects jobs.helper_fee_flat_cents as its LAST column, so the
 * feed can quote a flat-model job's take-home, and nothing else about the view
 * changes (same rows, still a definer view, same grants).
 *
 *   node src/test/pglite/openJobsBrowseFeeStamp.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/openJobsBrowseFeeStamp.pglite.mjs # RED: the state on main
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). The "before"
 * view is cut from 20261012185633 (its newest definition on main); the jobs
 * table gets the column from 20261015023908. Functions the view calls are
 * stubbed permissive.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261015034054_open_jobs_browse_fee_stamp.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function cutView(file) {
  const sql = read(MIGDIR + file);
  const st = sql.lastIndexOf("CREATE OR REPLACE VIEW public.open_jobs_browse");
  return sql.slice(st, sql.indexOf(";", sql.indexOf(" FROM jobs", st)) + 1);
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
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, description text, category text DEFAULT 'yard', budget numeric DEFAULT 100,
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
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT current_user = 'postgres' $$;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
`);
// The stamp column, exactly as its own migration adds it.
await db.exec(read(`${MIGDIR}20261015023908_jobs_helper_fee_flat_cents.sql`));
await db.exec(cutView("20261012185633_listing_closes_at_start.sql"));
await db.exec(`ALTER VIEW public.open_jobs_browse SET (security_invoker = false);
  GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;`);
const colsBefore = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'open_jobs_browse'`)).rows[0].n;

const P = "71c56dfb-b326-4010-b960-b18dd3966e7f";
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, helper_fee_flat_cents, helper_fee_percent) VALUES
    ('10000000-0000-4000-8000-000000000001', 'flat', '${P}', 70, 5),
    ('10000000-0000-4000-8000-000000000002', 'legacy', '${P}', NULL, 12);
  INSERT INTO public.jobs (id, title, customer_id, payment_status) VALUES
    ('10000000-0000-4000-8000-000000000003', 'unfunded', '${P}', 'unpaid');`);
const rowsBefore = (await db.query(`SELECT id FROM public.open_jobs_browse ORDER BY id`)).rows.map((r) => r.id).join(",");

if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);
check("the migration applies three times", true);

const cols = (await db.query(`SELECT column_name, ordinal_position FROM information_schema.columns
  WHERE table_name = 'open_jobs_browse' ORDER BY ordinal_position`)).rows;
const last = cols.at(-1)?.column_name;
check("the view projects helper_fee_flat_cents as its last column", last === "helper_fee_flat_cents", `last=${last}`);
check("exactly one column was added", cols.length === colsBefore + 1, `${colsBefore} -> ${cols.length}`);

let stamps = {};
try {
  stamps = Object.fromEntries((await db.query(`SELECT title, helper_fee_flat_cents FROM public.open_jobs_browse`)).rows
    .map((r) => [r.title, r.helper_fee_flat_cents]));
} catch (e) { stamps = { error: e.message }; }
check("a flat job reads its stamp (70); a legacy job reads NULL", stamps.flat === 70 && stamps.legacy === null, JSON.stringify(stamps));

const rowsAfter = (await db.query(`SELECT id FROM public.open_jobs_browse ORDER BY id`)).rows.map((r) => r.id).join(",");
check("the same rows are visible (the WHERE is unchanged)", rowsAfter === rowsBefore && !rowsAfter.includes("000000000003"), rowsAfter);

const opts = (await db.query(`SELECT reloptions FROM pg_class WHERE relname = 'open_jobs_browse'`)).rows[0].reloptions;
check("still a definer view (security_invoker=false)", JSON.stringify(opts ?? []).includes("security_invoker=false"), JSON.stringify(opts));
const grants = (await db.query(`SELECT has_table_privilege('anon', 'public.open_jobs_browse', 'SELECT') a,
  has_table_privilege('authenticated', 'public.open_jobs_browse', 'SELECT') b`)).rows[0];
check("anon and authenticated keep SELECT", grants.a === true && grants.b === true, JSON.stringify(grants));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
