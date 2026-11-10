#!/usr/bin/env node
/**
 * PGlite proof for 20261110210539_map_pins_ungeocoded_jobs (owner bug 2026-11-10): get_open_jobs_for_map no longer
 * drops a job whose address never geocoded. It pins it at its ZIP's centroid (louisiana_zip_parishes), else the
 * middle of its parish's, and leaves jobs.latitude/longitude NULL (the arrival check reads them). A geocoded job is
 * unchanged; a job with nothing to place it by stays off the map. Same columns, same grants, same function shape.
 *
 *   node src/test/pglite/mapPinsUngeocodedJobs.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/mapPinsUngeocodedJobs.pglite.mjs # RED: 20261104080753's map drops them
 *   MIGRATION_PATH=<planted copy> node ...                                   # red on a planted defect
 *
 * The "before" map is its newest definition (20261104080753) with its grants; job_offer_cutoff is its real
 * definition (20261005184940); other helpers are stubbed permissive, as in mapAndRankedReadDateWindow.pglite.mjs.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGDIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const read = (f) => readFileSync(MIGDIR + f, "utf8");
const NEW = readFileSync(process.env.MIGRATION_PATH ?? `${MIGDIR}20261110210539_map_pins_ungeocoded_jobs.sql`, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
/** The map's DROP + CREATE + REVOKE + GRANT from one migration. */
function mapStatements(sql) {
  const a = sql.indexOf("DROP FUNCTION IF EXISTS public.get_open_jobs_for_map();");
  const end = "GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated, service_role;";
  const b = sql.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error("map statements not found");
  return sql.slice(a, b + end.length);
}
function cut(file, start) {
  const sql = read(file);
  const st = sql.lastIndexOf(start);
  const tag = sql.slice(st).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
  const bodyStart = sql.indexOf(tag, st) + tag.length;
  return sql.slice(st, sql.indexOf(tag, bodyStart) + tag.length) + ";";
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, category text DEFAULT 'yard', budget numeric DEFAULT 100, is_urgent boolean,
  latitude numeric, longitude numeric, parish text, zip_code text, created_at timestamptz DEFAULT now() - interval '3 days',
  location text DEFAULT 'New Iberia, LA', date_needed date, start_time time, urgent_fee numeric, is_group_job boolean,
  helpers_needed int DEFAULT 1, boost_expires_at timestamptz, boosted_at timestamptz, expires_at timestamptz,
  helper_fee_flat_cents int, helper_fee_percent numeric, date_window_end date, status public.job_status DEFAULT 'open',
  parent_job_id uuid, customer_id uuid, payment_status text DEFAULT 'escrow', credential_tier int DEFAULT 0,
  offered_to_helper_id uuid, direct_offer_status text, is_seed boolean DEFAULT false
);
-- louisiana_zip_parishes as 20260907051306 leaves it; rows copied from that file.
CREATE TABLE public.louisiana_zip_parishes (zip_code text PRIMARY KEY, parish text NOT NULL, city text, latitude numeric, longitude numeric);
INSERT INTO public.louisiana_zip_parishes VALUES
  ('70560', 'Iberia', 'New Iberia', 29.937141, -91.864508),
  ('70563', 'Iberia', 'New Iberia', 30.019898, -91.737003),
  ('70501', 'Lafayette', 'Lafayette', 30.236193, -91.993145);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.crew_spots_open(j uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
`);
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "CREATE OR REPLACE FUNCTION public.job_offer_cutoff("));
await db.exec(mapStatements(read("20261104080753_map_and_ranked_read_date_window.sql")));

const P = "71c56dfb-b326-4010-b960-b18dd3966e7f";
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, latitude, longitude, zip_code, parish) VALUES
    ('10000000-0000-4000-8000-000000000001', 'geocoded', '${P}', 29.9761875, -91.9479804, '70560', 'Iberia'),
    ('10000000-0000-4000-8000-000000000002', 'christmas_lights_zip', '${P}', NULL, NULL, '70560', 'Iberia'),
    ('10000000-0000-4000-8000-000000000003', 'parish_only', '${P}', NULL, NULL, NULL, 'Iberia Parish'),
    ('10000000-0000-4000-8000-000000000004', 'unknown_zip_known_parish', '${P}', NULL, NULL, '77001', 'lafayette'),
    ('10000000-0000-4000-8000-000000000005', 'half_pair', '${P}', 30.5, NULL, '70501', NULL),
    ('10000000-0000-4000-8000-000000000006', 'nothing_to_go_on', '${P}', NULL, NULL, NULL, NULL);`);

const shape = async () => (await db.query(`SELECT p.proacl::text[] acl, p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) res
  FROM pg_proc p WHERE p.proname = 'get_open_jobs_for_map'`)).rows;
const beforeShape = await shape();
const beforeRows = (await db.query(`SELECT title FROM public.get_open_jobs_for_map() ORDER BY title`)).rows.map((r) => r.title);

if (!skip) {
  for (let i = 0; i < 3; i++) {
    try { await db.exec(NEW); check(`the migration applies (run ${i + 1} of 3)`, true); }
    catch (e) { check(`the migration applies (run ${i + 1} of 3)`, false, e.message); }
  }
}
const rows = Object.fromEntries((await db.query(`SELECT title, latitude::float8 lat, longitude::float8 lng FROM public.get_open_jobs_for_map()`)).rows.map((r) => [r.title, r]));
check("before: the old map dropped every job without a coordinate pair", JSON.stringify(beforeRows) === JSON.stringify(["geocoded"]), JSON.stringify(beforeRows));
check("the owner's job (ZIP 70560, no coordinates) is on the map at its ZIP's centroid, 2 decimals",
  rows.christmas_lights_zip?.lat === 29.94 && rows.christmas_lights_zip?.lng === -91.86, JSON.stringify(rows.christmas_lights_zip));
check("no ZIP: the middle of the parish's ZIP centroids ('X Parish', any case)",
  rows.parish_only?.lat === 29.98 && rows.parish_only?.lng === -91.8, JSON.stringify(rows.parish_only));
check("a ZIP we do not have falls back to the parish", rows.unknown_zip_known_parish?.lat === 30.24, JSON.stringify(rows.unknown_zip_known_parish));
check("half a pair is not a position: the ZIP's centroid", rows.half_pair?.lat === 30.24 && rows.half_pair?.lng === -91.99, JSON.stringify(rows.half_pair));
check("a geocoded job keeps its own rounded point", rows.geocoded?.lat === 29.98 && rows.geocoded?.lng === -91.95, JSON.stringify(rows.geocoded));
check("nothing to place it by: still off the map (never a made-up point)", !("nothing_to_go_on" in rows), Object.keys(rows).join(","));
const stored = (await db.query(`SELECT count(*)::int n FROM public.jobs WHERE latitude IS NULL`)).rows[0].n;
check("jobs.latitude stays NULL (read-time only; the arrival check trusts these columns)", stored === 4, String(stored));
check("same result columns, grants, SECURITY DEFINER, STABLE and settings", JSON.stringify(await shape()) === JSON.stringify(beforeShape), JSON.stringify(await shape()));

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
