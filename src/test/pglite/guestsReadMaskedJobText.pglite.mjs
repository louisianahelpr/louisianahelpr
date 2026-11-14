#!/usr/bin/env node
/**
 * PGlite proof for 20261114234033_guests_read_masked_job_text.sql (F268a follow-up, lead 11-14): a guest's copy of an
 * open job masks phones, numbered street addresses AND email addresses in every free-text field a guest can read:
 * open_jobs_browse's title, description, special_requirements and materials_note; get_ranked_open_jobs' title,
 * description and special_requirements; get_open_jobs_for_map's and get_public_open_jobs' title. A member reads every
 * field as written; rows, columns, signatures, grants, definer-ness and the ranked COMMENT do not move.
 *
 *   node src/test/pglite/guestsReadMaskedJobText.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/guestsReadMaskedJobText.pglite.mjs # RED: the state before it (prod 11-14)
 *
 * The "before" is prod's live state, read 11-14 (md5 of each live prosrc equal to its newest migration's body):
 * 20261112202620 (mask_guest_contact, open_jobs_browse, get_ranked_open_jobs), 20261110210539 (get_open_jobs_for_map),
 * 20261104084501 (get_public_open_jobs). Other helpers are stubbed.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const PREV = read(`${MIGDIR}20261112202620_guests_read_masked_job_description.sql`);
const NEW = read(`${MIGDIR}20261114234033_guests_read_masked_job_text.sql`);
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
  helper_fee_percent numeric, scope_video_url text, date_window_end date, zip_code text
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
await db.exec(cutView("20261104074500_browse_reads_date_window.sql"));
await db.exec(`REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated; GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;`);

// get_ranked_open_jobs (part 3): its newest definition, grants and COMMENT (20261104080753) as the "before".
// job_offer_cutoff is its real definition (20261005184940); the other helpers are stubbed permissive.
function cutFn(file, start) {
  const sql = read(MIGDIR + file);
  const st = sql.lastIndexOf(start);
  const tag = sql.slice(st).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
  const bodyStart = sql.indexOf(tag, st) + tag.length;
  return sql.slice(st, sql.indexOf(tag, bodyStart) + tag.length) + ";";
}
await db.exec(`
CREATE TABLE public.profiles (user_id uuid, parish text, latitude numeric, longitude numeric, subscription_tier text, subscription_expires_at timestamptz);
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.crew_spots_open(j uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT NULL::numeric $$;
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`);
await db.exec(cutFn("20261005184940_offer_deadline_before_start.sql", "CREATE OR REPLACE FUNCTION public.job_offer_cutoff("));
{
  const RANKED = "20261104080753_map_and_ranked_read_date_window.sql";
  await db.exec(cutFn(RANKED, "CREATE FUNCTION public.get_ranked_open_jobs("));
  const g = read(MIGDIR + RANKED);
  const sig = "get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric)";
  const r = g.indexOf(`REVOKE ALL ON FUNCTION public.${sig}`);
  const gr = g.indexOf(`GRANT EXECUTE ON FUNCTION public.${sig}`);
  await db.exec(g.slice(r, g.indexOf(";", r) + 1) + g.slice(gr, g.indexOf(";", gr) + 1));
  const at = g.indexOf("COMMENT ON FUNCTION public.get_ranked_open_jobs(");
  await db.exec(g.slice(at, g.indexOf("never a number.';", at) + "never a number.';".length));
}
// The state before: 20261112202620 on top of its own "before", then the map and teaser RPCs as their newest migrations.
await db.exec(`
CREATE TABLE public.louisiana_zip_parishes (zip_code text, parish text, latitude numeric, longitude numeric);
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`);
await db.exec(PREV);
await db.exec(cutFn("20261110210539_map_pins_ungeocoded_jobs.sql", "CREATE FUNCTION public.get_open_jobs_for_map("));
await db.exec(`REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated, service_role;`);
await db.exec(cutFn("20261104084501_apply_and_notices_read_date_window.sql", "CREATE OR REPLACE FUNCTION public.get_public_open_jobs("));
await db.exec(`REVOKE ALL ON FUNCTION public.get_public_open_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_open_jobs(integer) TO anon, authenticated, service_role;`);

const shape = async () => JSON.stringify((await db.query(`SELECT p.oid::regprocedure::text sig, (SELECT array_agg(a ORDER BY a) FROM unnest(p.proacl::text[]) a)::text acl, p.prosecdef, p.provolatile,
  p.proconfig::text cfg, pg_get_function_result(p.oid) res, obj_description(p.oid, 'pg_proc') cmt FROM pg_proc p
  WHERE p.proname IN ('get_ranked_open_jobs', 'get_open_jobs_for_map', 'get_public_open_jobs', 'mask_guest_contact') ORDER BY 1`)).rows);
const cols = async () =>
  JSON.stringify((await db.query(`SELECT column_name || ' ' || data_type c FROM information_schema.columns WHERE table_name = 'open_jobs_browse' ORDER BY ordinal_position`)).rows);
async function as(role, sql, sub = "") {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${sub}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);"); }
}

const P = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const M = "20000000-0000-4000-8000-000000000009";
const J1 = "10000000-0000-4000-8000-000000000001";
const J2 = "10000000-0000-4000-8000-000000000002";
const TITLE = "Yard help, text 337-555-0142";
const DESC = "Mow the lawn. Questions: mowjob@example.com or 225.555.0177.";
const REQS = "Park at 12 Oak St and email me at sam.l+yard@gmail.com";
const MATS = "Bring bags, call (337) 555 0199 first";
await db.exec(`INSERT INTO public.jobs (id, title, description, special_requirements, materials_note, customer_id, date_needed) VALUES
  ('${J1}', '${TITLE}', '${DESC}', '${REQS}', '${MATS}', '${P}', current_date + 3),
  ('${J2}', 'Trim 3 hedges', 'Bag the clippings.', 'Gloves please', 'Bags provided', '${P}', current_date + 3);`);

const BROWSE = "SELECT id, title, description, special_requirements, materials_note FROM public.open_jobs_browse ORDER BY id";
const RANKED = "SELECT id, title, description, special_requirements FROM public.get_ranked_open_jobs() ORDER BY id";
const MAP = "SELECT id, title FROM public.get_open_jobs_for_map() ORDER BY id";
const TEASER = "SELECT id, title FROM public.get_public_open_jobs(10) ORDER BY id";
const READS = { BROWSE, RANKED, MAP, TEASER };
const ids = async (role, sql, sub) => JSON.stringify((await as(role, sql, sub)).map((r) => r.id));
const before = { shape: await shape(), cols: await cols(), ids: {} };
for (const [k, q] of Object.entries(READS)) before.ids[k] = [await ids("anon", q), await ids("authenticated", q, M)];

let applied = 0;
if (!MODE) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", applied === 3, `applied ${applied}`);

const leaks = (s) => (s ?? "").match(/@|555|Oak St/g) ?? [];
const fieldsOf = { BROWSE: ["title", "description", "special_requirements", "materials_note"], RANKED: ["title", "description", "special_requirements"], MAP: ["title"], TEASER: ["title"] };
const written = { title: TITLE, description: DESC, special_requirements: REQS, materials_note: MATS };
for (const [k, q] of Object.entries(READS)) {
  const g = (await as("anon", q)).find((r) => r.id === J1) ?? {};
  for (const f of fieldsOf[k]) check(`${k}: a guest's ${f} carries no email, phone or street`, g[f] != null && leaks(g[f]).length === 0, JSON.stringify(g[f]));
  const m = (await as("authenticated", q, M)).find((r) => r.id === J1) ?? {};
  check(`${k}: a member reads every field as written`, fieldsOf[k].every((f) => m[f] === written[f]), JSON.stringify(m).slice(0, 160));
  const plain = (await as("anon", q)).find((r) => r.id === J2) ?? {};
  check(`${k}: a guest reads a title with no contact details as written`, plain.title === "Trim 3 hedges", JSON.stringify(plain.title));
  check(`${k}: the same rows for a guest and a member`, (await ids("anon", q)) === before.ids[k][0] && (await ids("authenticated", q, M)) === before.ids[k][1] && JSON.parse(before.ids[k][0]).length === 2, before.ids[k][0]);
}
const g1 = (await as("anon", BROWSE)).find((r) => r.id === J1) ?? {};
check("the masked copy keeps the other words", g1.title === "Yard help, text [phone hidden]" && g1.description === "Mow the lawn. Questions: [email hidden] or [phone hidden]." && g1.special_requirements === "Park at [address hidden] and email me at [email hidden]" && g1.materials_note === "Bring bags, call [phone hidden] first", JSON.stringify(g1));
check("a guest cannot find a hidden email by filtering on it", (await as("anon", "SELECT id FROM public.open_jobs_browse WHERE special_requirements ILIKE '%gmail%' OR description ILIKE '%example.com%'")).length === 0);

const mask = async (t) => (await db.query(`SELECT public.mask_guest_contact($1) m`, [t])).rows[0].m;
for (const [input, want] of [
  ["write to a.b-c_d%e+f@mail.co.uk today", "write to [email hidden] today"],
  ["JOE@EXAMPLE.COM", "[email hidden]"],
  ["me@x.io / 337-555-0142", "[email hidden] / [phone hidden]"],
  ["call 3375550142", "call [phone hidden]"],
  ["at 12 Oak St.", "at [address hidden]"],
  ["Price @ $40 an hour", "Price @ $40 an hour"],
  ["Mow 2 yards, about 3 hours", "Mow 2 yards, about 3 hours"],
  [null, null],
]) {
  const got = await mask(input);
  check(`mask ${JSON.stringify(input)} -> ${JSON.stringify(want)}`, got === want, `got ${JSON.stringify(got)}`);
}

check("same view columns, in the same order, with the same types", (await cols()) === before.cols);
check("same signatures, results, grants, SECURITY DEFINER, volatility, config and COMMENTs", (await shape()) === before.shape, (await shape()).slice(0, 160));
const opts = (await db.query(`SELECT reloptions FROM pg_class WHERE relname = 'open_jobs_browse'`)).rows[0].reloptions;
check("still a definer view (security_invoker=false)", JSON.stringify(opts ?? []).includes("security_invoker=false"), JSON.stringify(opts));
const acl = (await db.query(`SELECT has_table_privilege('anon','public.open_jobs_browse','SELECT') a, has_table_privilege('authenticated','public.open_jobs_browse','SELECT') b,
  has_table_privilege('anon','public.open_jobs_browse','INSERT,UPDATE,DELETE') w, has_table_privilege('anon','public.jobs','SELECT') j`)).rows[0];
check("anon + authenticated keep SELECT and gain nothing, jobs stays closed", acl.a && acl.b && !acl.w && !acl.j, JSON.stringify(acl));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
