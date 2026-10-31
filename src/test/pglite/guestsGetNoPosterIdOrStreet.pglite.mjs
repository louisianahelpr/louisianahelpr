#!/usr/bin/env node
/**
 * PGlite proof for 20261031000945_guests_get_no_poster_id_or_street.sql (jobs audit 10-30): a guest reads no poster id from
 * open_jobs_browse, and a two-part address loses its street. The same rows for every
 * caller, a member's own-job id intact, still a definer view, grants unchanged.
 *
 *   node src/test/pglite/guestsGetNoPosterIdOrStreet.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/guestsGetNoPosterIdOrStreet.pglite.mjs # RED: the state before it
 *
 * The "before" view is 20261029194021_browse_carries_scope_video.sql and the "before"
 * mask is the live body read from prod 10-30 (pg_get_functiondef). Other helpers are stubbed.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261031000945_guests_get_no_poster_id_or_street.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state before it (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
function cutView(file) {
  const sql = read(MIGDIR + file);
  const st = sql.lastIndexOf("CREATE OR REPLACE VIEW public.open_jobs_browse");
  return sql.slice(st, sql.indexOf(";", sql.indexOf(" FROM jobs", st)) + 1);
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.job_category AS ENUM ('yard', 'moving', 'cleaning');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, description text, category public.job_category DEFAULT 'yard', budget numeric DEFAULT 100,
  date_needed date, start_time time, location text DEFAULT '12 Oak St, Lafayette, LA 70501', is_urgent boolean DEFAULT false,
  urgent_fee numeric, is_flexible_schedule boolean DEFAULT false, is_recurring boolean DEFAULT false,
  is_group_job boolean DEFAULT false, helpers_needed int DEFAULT 1, estimated_hours numeric, photos text[],
  special_requirements text, status public.job_status DEFAULT 'open', created_at timestamptz DEFAULT now() - interval '1 day',
  updated_at timestamptz DEFAULT now(), boosted_at timestamptz, boost_expires_at timestamptz, expires_at timestamptz,
  recurrence_interval text, recurrence_end_date date, parent_job_id uuid, payment_status text DEFAULT 'escrow',
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  pricing_mode text, latitude numeric DEFAULT 30.22, longitude numeric DEFAULT -92.02, parish text,
  credential_tier int DEFAULT 0, require_photo_proof boolean, recurrence_days int[], recurrence_weeks int,
  series_split_ok boolean, materials_note text, is_seed boolean DEFAULT false, helper_fee_flat_cents int,
  helper_fee_percent numeric, scope_video_url text
);
CREATE TABLE public.applications (job_id uuid);
CREATE TABLE public.group_job_helpers (job_id uuid);
CREATE TABLE public.crew_block_fees (job_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
-- The live body, prod pg_get_functiondef 10-30.
CREATE OR REPLACE FUNCTION public.mask_job_location(loc text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN loc IS NULL OR loc = '' THEN loc
    WHEN array_length(string_to_array(loc, ','), 1) >= 2 THEN
      trim(split_part(loc, ',', array_length(string_to_array(loc, ','), 1) - 1))
      || ', '
      || regexp_replace(
           trim(split_part(loc, ',', array_length(string_to_array(loc, ','), 1))),
           '\\s*\\d{5}(-\\d{4})?\\s*$', ''
         )
    ELSE loc
  END;
$function$;
`);
await db.exec(cutView("20261029194021_browse_carries_scope_video.sql"));
await db.exec(`REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated; GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;`);

const P = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const J1 = "10000000-0000-4000-8000-000000000001";
await db.exec(`INSERT INTO public.jobs (id, title, customer_id) VALUES
  ('${J1}', 'one', '${P}'),
  ('10000000-0000-4000-8000-000000000002', 'two', '${P}');
  INSERT INTO public.jobs (id, title, customer_id, payment_status) VALUES ('10000000-0000-4000-8000-000000000003', 'unfunded', '${P}', 'unpaid');`);

const cols = async () =>
  (await db.query(`SELECT column_name || ' ' || data_type c FROM information_schema.columns WHERE table_name = 'open_jobs_browse' ORDER BY ordinal_position`)).rows.map((r) => r.c);
async function as(role, sql, sub = "") {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${sub}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);"); }
}
const ROWS = "SELECT id, title, location, budget FROM public.open_jobs_browse ORDER BY id";
const before = { cols: await cols(), anon: JSON.stringify(await as("anon", ROWS)), auth: JSON.stringify(await as("authenticated", ROWS, P)) };

let applied = 0;
if (!MODE) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", applied === 3, `applied ${applied}`);

check("the same columns, in the same order, with the same types", JSON.stringify(await cols()) === JSON.stringify(before.cols));
check("a guest sees the same rows", JSON.stringify(await as("anon", ROWS)) === before.anon, before.anon.slice(0, 80));
check("a member sees the same rows", JSON.stringify(await as("authenticated", ROWS, P)) === before.auth);

const guest = await as("anon", "SELECT customer_id FROM public.open_jobs_browse");
const ZERO = "00000000-0000-0000-0000-000000000000";
check("a guest reads no poster id", guest.length === 2 && guest.every((r) => r.customer_id === ZERO), JSON.stringify(guest[0]));
// Every client's browse cull is `!!customer_id` (useDashboardFilters), and installed apps keep it.
check("a guest's rows survive the clients' empty-id cull", guest.every((r) => !!r.customer_id));
const probe = await as("anon", `SELECT id FROM public.open_jobs_browse WHERE customer_id = '${P}'`);
check("a guest cannot find a poster's jobs by filtering on the id", probe.length === 0, `${probe.length} rows`);
// What a guest can do with the zero id: nothing. It groups every poster's jobs as one, and matches no other table.
const grouped = await as("anon", "SELECT customer_id, count(*)::int n FROM public.open_jobs_browse GROUP BY 1");
check("a guest can't tell whose jobs are whose: every row groups as one", grouped.length === 1 && grouped[0].n === 2, JSON.stringify(grouped));
const byZero = await as("anon", `SELECT id FROM public.open_jobs_browse WHERE customer_id = '${ZERO}'`);
check("filtering on the zero id returns only what the guest already sees", byZero.length === 2, `${byZero.length} rows`);
const memberZero = await as("authenticated", `SELECT id FROM public.open_jobs_browse WHERE customer_id = '${ZERO}'`, "20000000-0000-4000-8000-000000000009");
check("a member never sees the zero id", memberZero.length === 0, `${memberZero.length} rows`);
const definerRead = (await db.query(`SELECT DISTINCT customer_id FROM public.open_jobs_browse`)).rows;
check("a definer function (role postgres, as get_ranked_open_jobs) still reads the real id", definerRead.length === 1 && definerRead[0].customer_id === P, JSON.stringify(definerRead));
const own = await as("authenticated", `SELECT customer_id FROM public.open_jobs_browse WHERE id = '${J1}'`, P);
check("a poster still reads their own id, so the own-job check holds", own[0]?.customer_id === P);
const other = await as("authenticated", `SELECT customer_id FROM public.open_jobs_browse WHERE id = '${J1}'`, "20000000-0000-4000-8000-000000000009");
check("another member still reads it", other[0]?.customer_id === P);
const svc = await as("service_role", `SELECT 1`);
check("service_role runs", svc.length === 1);
await db.exec(`GRANT SELECT ON public.open_jobs_browse TO service_role`);
const svcRead = await as("service_role", `SELECT customer_id FROM public.open_jobs_browse WHERE id = '${J1}'`);
check("service_role, with no auth.uid(), still reads it", svcRead[0]?.customer_id === P);

const mask = async (loc) => (await db.query(`SELECT public.mask_job_location($1) m`, [loc])).rows[0].m;
for (const [input, want] of [
  // Unchanged: every shape real jobs have (measured on prod 10-30).
  ["999 Bertrand Dr, Lafayette, LA 70501", "Lafayette, LA"],
  ["Lake Peigneur Rd, New Iberia, LA 70560", "New Iberia, LA"],
  ["999 St Mary St / 999 St Mary New Iberia, New Iberia, LA 70560", "New Iberia, LA"],
  ["Lafayette, LA", "Lafayette, LA"],
  ["Lafayette, LA 70501", "Lafayette, LA"],
  ["New Iberia, Louisiana", "New Iberia, Louisiana"],
  ["Lafayette", "Lafayette"],
  [null, null],
  ["", ""],
  // Closed: a two-part address, and a lone street.
  ["123 Main St, Lafayette", "Lafayette"],
  ["Main St, Lafayette", "Lafayette"],
  ["123 Main St, LA", "LA"],
  ["123 Main St, LA 70501", "LA"],
  ["123 Main St,", null],
  ["123 Main St", null],
]) {
  const got = await mask(input);
  check(`mask ${JSON.stringify(input)} -> ${JSON.stringify(want)}`, got === want, `got ${JSON.stringify(got)}`);
}

const opts = (await db.query(`SELECT reloptions FROM pg_class WHERE relname = 'open_jobs_browse'`)).rows[0].reloptions;
check("still a definer view (security_invoker=false)", JSON.stringify(opts ?? []).includes("security_invoker=false"), JSON.stringify(opts));
const g = (await db.query(`SELECT has_table_privilege('anon','public.open_jobs_browse','SELECT') a, has_table_privilege('authenticated','public.open_jobs_browse','SELECT') b,
  has_table_privilege('anon','public.open_jobs_browse','INSERT,UPDATE,DELETE') w, has_table_privilege('authenticated','public.open_jobs_browse','INSERT,UPDATE,DELETE') x,
  has_table_privilege('anon','public.jobs','SELECT') j`)).rows[0];
check("anon + authenticated keep SELECT and gain nothing, jobs stays closed", g.a && g.b && !g.w && !g.x && !g.j, JSON.stringify(g));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
