#!/usr/bin/env node
/**
 * PGlite proof for 20261112202620_guests_read_masked_job_description.sql (F268a, owner 11-12: a guest's shared job page
 * shows the description; still no poster, address or coordinates). A guest's copy of the description comes out of
 * open_jobs_browse with phone numbers and numbered street addresses masked; a member reads the text as before; the
 * same rows and columns for every caller; still a definer view; grants unchanged. The same holds for the anon-callable
 * ranked feed RPC get_ranked_open_jobs (part 3), whose "before" is 20261104080753.
 *
 *   node src/test/pglite/guestsReadMaskedJobDescription.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/guestsReadMaskedJobDescription.pglite.mjs # RED: the state before it
 *
 * The "before" view is 20261104074500_browse_reads_date_window.sql (prod's live definition, read 11-12 with
 * pg_get_viewdef). Other helpers are stubbed.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261112202620_guests_read_masked_job_description.sql`);
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
  helper_fee_percent numeric, scope_video_url text, date_window_end date
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
const rankedShape = async () => (await db.query(`SELECT p.oid::regprocedure::text sig, p.proacl::text acl, p.prosecdef, p.provolatile, p.proconfig::text cfg,
  pg_get_function_result(p.oid) res, obj_description(p.oid, 'pg_proc') cmt FROM pg_proc p WHERE p.proname = 'get_ranked_open_jobs'`)).rows;

const P = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const J1 = "10000000-0000-4000-8000-000000000001";
const TEXT = "Mow the front yard. Call me at (337) 555-0142 or text 337.555.0199. Gate code at 9816 Lake Peigneur Rd, by the shed.";
await db.exec(`INSERT INTO public.jobs (id, title, description, customer_id) VALUES
  ('${J1}', 'one', '${TEXT}', '${P}'),
  ('10000000-0000-4000-8000-000000000002', 'two', 'Trim 3 hedges and bag the clippings.', '${P}');
  INSERT INTO public.jobs (id, title, description, customer_id, payment_status) VALUES ('10000000-0000-4000-8000-000000000003', 'unfunded', 'call 3375550100', '${P}', 'unpaid');
  INSERT INTO public.jobs (id, title, description, customer_id, status) VALUES ('10000000-0000-4000-8000-000000000004', 'done', 'call 3375550100', '${P}', 'completed');`);

const cols = async () =>
  (await db.query(`SELECT column_name || ' ' || data_type c FROM information_schema.columns WHERE table_name = 'open_jobs_browse' ORDER BY ordinal_position`)).rows.map((r) => r.c);
async function as(role, sql, sub = "") {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${sub}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);"); }
}
const ROWS = "SELECT id, title, location, budget, customer_id FROM public.open_jobs_browse ORDER BY id";
// rank_score has a recency term (it moves with the clock between the two reads), so it is not compared.
const RANKED_ROWS = "SELECT id, title, location, budget, parish_match, distance_band FROM public.get_ranked_open_jobs() ORDER BY id";
const before = { cols: await cols(), anon: JSON.stringify(await as("anon", ROWS)), auth: JSON.stringify(await as("authenticated", ROWS, P)),
  ranked: JSON.stringify(await rankedShape()), rankedAnon: JSON.stringify(await as("anon", RANKED_ROWS)), rankedAuth: JSON.stringify(await as("authenticated", RANKED_ROWS, P)) };

let applied = 0;
if (!MODE) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", applied === 3, `applied ${applied}`);

check("the same columns, in the same order, with the same types", JSON.stringify(await cols()) === JSON.stringify(before.cols));
check("a guest sees the same rows (open, funded only)", JSON.stringify(await as("anon", ROWS)) === before.anon && JSON.parse(before.anon).length === 2, before.anon.slice(0, 80));
check("a member sees the same rows", JSON.stringify(await as("authenticated", ROWS, P)) === before.auth);

const guestText = (await as("anon", `SELECT description FROM public.open_jobs_browse WHERE id = '${J1}'`))[0]?.description ?? "";
check("a guest's description has no phone number", !/\d{3}\D{0,2}\d{3}\D?\d{4}/.test(guestText), guestText);
check("a guest's description has no street address", !/9816|Peigneur Rd/.test(guestText), guestText);
check("a guest's description keeps the rest of the words", guestText.startsWith("Mow the front yard.") && guestText.includes("[phone hidden]") && guestText.includes("[address hidden]") && guestText.endsWith(", by the shed."), guestText);
const plain = (await as("anon", `SELECT description FROM public.open_jobs_browse WHERE id = '10000000-0000-4000-8000-000000000002'`))[0]?.description;
check("a description with no contact details reads as written", plain === "Trim 3 hedges and bag the clippings.", plain);
const memberText = (await as("authenticated", `SELECT description FROM public.open_jobs_browse WHERE id = '${J1}'`, "20000000-0000-4000-8000-000000000009"))[0]?.description;
check("a member reads the description unmasked", memberText === TEXT, memberText);
const guestFilter = await as("anon", `SELECT id FROM public.open_jobs_browse WHERE description ILIKE '%555%'`);
check("a guest cannot find the hidden number by filtering on it", guestFilter.length === 0, `${guestFilter.length} rows`);

// Part 3: the ranked feed RPC (anon EXECUTE) hands a guest the same masked copy; a member the text; nothing else moves.
const rankedGuest = (await as("anon", `SELECT description FROM public.get_ranked_open_jobs() WHERE id = '${J1}'`))[0]?.description ?? "";
check("get_ranked_open_jobs: a guest's description has no phone number or street", !/555|Peigneur/.test(rankedGuest) && rankedGuest.includes("[phone hidden]"), rankedGuest);
const rankedMember = (await as("authenticated", `SELECT description FROM public.get_ranked_open_jobs() WHERE id = '${J1}'`, "20000000-0000-4000-8000-000000000009"))[0]?.description;
check("get_ranked_open_jobs: a member reads the description unmasked", rankedMember === TEXT, rankedMember);
check("get_ranked_open_jobs: same signature, result, grants, SECURITY DEFINER, config and COMMENT", JSON.stringify(await rankedShape()) === before.ranked, JSON.stringify(await rankedShape()).slice(0, 120));
check("get_ranked_open_jobs: same rows for a guest and for a member", JSON.stringify(await as("anon", RANKED_ROWS)) === before.rankedAnon && JSON.stringify(await as("authenticated", RANKED_ROWS, P)) === before.rankedAuth && JSON.parse(before.rankedAnon).length >= 2, before.rankedAnon.slice(0, 80));

const mask = async (t) => (MODE ? t : (await db.query(`SELECT public.mask_guest_contact($1) m`, [t])).rows[0].m);
for (const [input, want] of [
  ["Call 337-555-0142 after 5", "Call [phone hidden] after 5"],
  ["text +1 (337) 555 0142", "text [phone hidden]"],
  ["3375550142", "[phone hidden]"],
  ["at 12 Oak St.", "at [address hidden]"],
  ["1405 W Main Street, Lafayette", "[address hidden], Lafayette"],
  ["202 Bayou Teche Hwy", "[address hidden]"],
  ["Mow 2 yards, about 3 hours", "Mow 2 yards, about 3 hours"],
  ["$85 for 1/2 acre", "$85 for 1/2 acre"],
  ["ZIP 70560", "ZIP 70560"],
  [null, null],
  ["", ""],
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
if (!MODE) {
  const f = (await db.query(`SELECT provolatile v, prosecdef d FROM pg_proc WHERE proname = 'mask_guest_contact'`)).rows[0];
  check("mask_guest_contact is IMMUTABLE and not SECURITY DEFINER", f?.v === "i" && f?.d === false, JSON.stringify(f));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
