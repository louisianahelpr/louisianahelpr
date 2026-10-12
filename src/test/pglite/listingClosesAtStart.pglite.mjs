#!/usr/bin/env node
/**
 * PGlite proof for 20261012185633_listing_closes_at_start (Q1401): a listing
 * closes at its start time on every browse surface, for apply, and for
 * accepting a direct offer.
 *
 *   node src/test/pglite/listingClosesAtStart.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/listingClosesAtStart.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The "before" objects are cut from the newest
 * migrations that define them on main, which is what prod runs (prosrc md5
 * equal, measured 2026-10-12): enforce_application_job_state,
 * direct_accept_block_reason, get_ranked_open_jobs and get_open_jobs_for_map
 * from 20261007033530, get_public_open_jobs from 20261006042617,
 * open_jobs_browse from 20261007073145. Everything they call that is not the
 * rule under test is stubbed permissive (no block, no seed switch, no early
 * access, tier 0).
 *
 * The STARTED job starts 1 minute ago in Louisiana; in the minute after
 * Louisiana midnight it would be dated yesterday, which the old day test also
 * hides, so run it at any other time for the red half.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261012185633_listing_closes_at_start.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}
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

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.job_category AS ENUM ('cleaning', 'yard');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, description text, category public.job_category DEFAULT 'yard', budget numeric DEFAULT 50,
  date_needed date, start_time time, location text DEFAULT 'Lafayette, LA', is_urgent boolean DEFAULT false,
  urgent_fee numeric, is_flexible_schedule boolean DEFAULT false, is_recurring boolean DEFAULT false,
  is_group_job boolean DEFAULT false, helpers_needed int DEFAULT 1, estimated_hours numeric, photos text[],
  special_requirements text, status public.job_status DEFAULT 'open', created_at timestamptz DEFAULT now() - interval '1 day',
  updated_at timestamptz DEFAULT now(), boosted_at timestamptz, boost_expires_at timestamptz, expires_at timestamptz,
  recurrence_interval text, recurrence_end_date date, parent_job_id uuid, payment_status text DEFAULT 'escrow',
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  pricing_mode text, latitude numeric DEFAULT 30.22, longitude numeric DEFAULT -92.02, parish text,
  credential_tier int DEFAULT 0, require_photo_proof boolean, recurrence_days int[], recurrence_weeks int,
  series_split_ok boolean, materials_note text, is_seed boolean DEFAULT false
);
CREATE TABLE public.applications (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid, helper_id uuid, status text DEFAULT 'pending');
CREATE TABLE public.group_job_helpers (job_id uuid);
CREATE TABLE public.crew_block_fees (job_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.profiles (user_id uuid, parish text, latitude numeric, longitude numeric, subscription_tier text,
  subscription_expires_at timestamptz, ban_status text, auto_suspended_until timestamptz, is_seed boolean DEFAULT false);
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.crew_spots_open(j uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT NULL::numeric $$;
CREATE FUNCTION public.job_payment_is_funded(s text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.is_helper_shadowbanned(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`);
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "job_offer_cutoff"));
const OLD = "20261007033530_seed_switch_hides_test_profiles.sql";
for (const fn of ["enforce_application_job_state", "direct_accept_block_reason", "get_ranked_open_jobs", "get_open_jobs_for_map"]) {
  await db.exec(cut(OLD, fn));
}
await db.exec(cut("20261006042617_ban_review_hides_posts_on_crew_surfaces.sql", "get_public_open_jobs"));
await db.exec(cutView("20261007073145_crew_block_fee_ledger.sql"));
await db.exec(cut("20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql", "job_announceable_to"));
// As prod: anon has no EXECUTE on job_offer_cutoff, and reads the view.
await db.exec(`REVOKE ALL ON FUNCTION public.job_offer_cutoff(date, time) FROM PUBLIC;
  GRANT USAGE ON SCHEMA auth TO anon; GRANT EXECUTE ON FUNCTION auth.uid() TO anon;
  GRANT SELECT ON public.open_jobs_browse TO anon;
  GRANT EXECUTE ON FUNCTION public.mask_job_location(text), public.early_access_cutoff(), public.seed_hidden_in_discovery(), public.my_credential_tier() TO anon;`);
await db.exec(`CREATE TRIGGER enforce_application_job_state BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_application_job_state();`);
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

// Louisiana wall clock for an instant, as the two job columns.
const at = (expr) => `((${expr}) AT TIME ZONE 'America/Chicago')::date, ((${expr}) AT TIME ZONE 'America/Chicago')::time`;
const STARTED = id(1), LATER = id(2), DATE_ONLY = id(3), NO_DATE = id(4), OFFERED = id(5), OFFERED_LATER = id(6);
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, date_needed, start_time) VALUES
    ('${STARTED}', 'started a minute ago', '${POSTER}', ${at(`now() - interval '1 minute'`)}),
    ('${LATER}', 'starts in 3 hours', '${POSTER}', ${at(`now() + interval '3 hours'`)}),
    ('${DATE_ONLY}', 'date-only, today', '${POSTER}', (now() AT TIME ZONE 'America/Chicago')::date, NULL),
    ('${NO_DATE}', 'no date', '${POSTER}', NULL, NULL);
  INSERT INTO public.jobs (id, title, customer_id, date_needed, start_time, offered_to_helper_id, direct_offer_status) VALUES
    ('${OFFERED}', 'direct offer, started', '${POSTER}', ${at(`now() - interval '1 minute'`)}, '${HELPER}', 'pending'),
    ('${OFFERED_LATER}', 'direct offer, later', '${POSTER}', ${at(`now() + interval '3 hours'`)}, '${HELPER}', 'pending');`);

await db.exec(`SET request.jwt.claim.sub = '${HELPER}';`);
const ids = async (sql) => new Set((await db.query(sql)).rows.map((r) => r.id));

for (const [surface, sql] of [
  ["open_jobs_browse", `SELECT id FROM public.open_jobs_browse`],
  ["get_ranked_open_jobs", `SELECT id FROM public.get_ranked_open_jobs(50, 0, true, NULL, NULL, NULL)`],
  ["get_open_jobs_for_map", `SELECT id FROM public.get_open_jobs_for_map()`],
]) {
  const listed = await ids(sql);
  check(`${surface}: a job that started a minute ago is not listed`, !listed.has(STARTED));
  check(`${surface}: a job starting in 3 hours is listed`, listed.has(LATER));
  check(`${surface}: a date-only job today is listed until the day ends`, listed.has(DATE_ONLY));
  check(`${surface}: a job with no date is listed as before`, listed.has(NO_DATE));
}
const teaser = await ids(`SELECT id FROM public.get_public_open_jobs(50)`);
check("get_public_open_jobs: a job that started a minute ago is not listed", !teaser.has(STARTED));
check("get_public_open_jobs: a job starting in 3 hours is listed", teaser.has(LATER));
check("get_public_open_jobs: a date-only job today is listed", teaser.has(DATE_ONLY));

async function apply(job) {
  try {
    await db.exec(`INSERT INTO public.applications (job_id, helper_id) VALUES ('${job}', '${HELPER}');`);
    return "ok";
  } catch (e) {
    return e.message;
  }
}
const a1 = await apply(STARTED);
check("apply: refused on a job that started a minute ago (job_date_has_passed)", /job_date_has_passed/.test(a1), a1);
check("apply: allowed on a job starting in 3 hours", (await apply(LATER)) === "ok");
check("apply: allowed on a date-only job today", (await apply(DATE_ONLY)) === "ok");
check("apply: allowed on a job with no date", (await apply(NO_DATE)) === "ok");

const block = async (job) => (await db.query(`SELECT public.direct_accept_block_reason('${job}', '${HELPER}') AS r`)).rows[0].r;
const b1 = await block(OFFERED);
check("direct offer: accepting one whose job started is refused (job_date_has_passed)", b1 === "job_date_has_passed", String(b1));
const b2 = await block(OFFERED_LATER);
check("direct offer: accepting one whose job starts later is allowed", b2 === null, String(b2));

let anonErr = "";
let anonRows = new Set();
try {
  await db.exec(`RESET request.jwt.claim.sub; SET ROLE anon;`);
  anonRows = await ids(`SELECT id FROM public.open_jobs_browse`);
} catch (e) {
  anonErr = e.message;
} finally {
  await db.exec(`RESET ROLE;`);
}
check("anon reads open_jobs_browse with no new privilege (cutoff inlined)", !anonErr && anonRows.has(LATER) && !anonRows.has(STARTED), anonErr || [...anonRows].length + " rows");

const announce = async (job) => (await db.query(`SELECT public.job_announceable_to(j, '${HELPER}') AS a FROM public.jobs j WHERE j.id = '${job}'`)).rows[0].a;
check("announcements: a job that started a minute ago is not announced", (await announce(STARTED)) === false);
check("announcements: a job starting in 3 hours is announced", (await announce(LATER)) === true);

const opts = (await db.query(`SELECT reloptions::text AS o FROM pg_class WHERE oid = 'public.open_jobs_browse'::regclass`)).rows[0].o;
check("open_jobs_browse stays security_invoker = false after the restatement", /security_invoker=false/.test(opts ?? ""), String(opts));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
