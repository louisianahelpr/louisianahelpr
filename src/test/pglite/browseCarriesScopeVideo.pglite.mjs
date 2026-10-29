#!/usr/bin/env node
/**
 * PGlite proof for 20261029194021_browse_carries_scope_video (A2-B6): open_jobs_browse gains
 * jobs.scope_video_url as its LAST column and NOTHING else about it changes: the same rows for the same
 * caller, still a definer view (security_invoker=false), SELECT for anon + authenticated and nothing more.
 *
 *   node src/test/pglite/browseCarriesScopeVideo.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/browseCarriesScopeVideo.pglite.mjs # RED: the state before it
 *
 * The "before" view is its newest definition (20261027185146_card_hold_at_post.sql section 9, whose column
 * list equals the live view's, measured on prod 2026-10-29). Helpers it calls are stubbed permissive.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261029194021_browse_carries_scope_video.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state before A2-B6 (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
/** The newest CREATE OR REPLACE VIEW public.open_jobs_browse in `file`, to the `;` after its FROM. */
function cutView(file) {
  const sql = read(MIGDIR + file);
  const st = sql.lastIndexOf("CREATE OR REPLACE VIEW public.open_jobs_browse");
  if (st < 0) throw new Error(`open_jobs_browse not in ${file}`);
  return sql.slice(st, sql.indexOf(";", sql.indexOf(" FROM jobs", st)) + 1);
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
  series_split_ok boolean, materials_note text, is_seed boolean DEFAULT false, helper_fee_flat_cents int,
  helper_fee_percent numeric, scope_video_url text
);
CREATE TABLE public.applications (job_id uuid);
CREATE TABLE public.group_job_helpers (job_id uuid);
CREATE TABLE public.crew_block_fees (job_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT split_part(l, ',', 2) $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
`);
// BEFORE: the view's newest definition, with its grants, as live.
await db.exec(cutView("20261027185146_card_hold_at_post.sql"));
await db.exec(`REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated; GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;`);

const P = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const URL_ = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/job-photos/10000000-0000-4000-8000-000000000001/scope-video.mp4";
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, location, scope_video_url) VALUES
    ('10000000-0000-4000-8000-000000000001', 'with-video', '${P}', '12 Oak St, Lafayette', '${URL_}'),
    ('10000000-0000-4000-8000-000000000002', 'no-video', '${P}', '9 Elm St, Lafayette', NULL);
  INSERT INTO public.jobs (id, title, customer_id, payment_status, scope_video_url) VALUES
    ('10000000-0000-4000-8000-000000000003', 'unfunded', '${P}', 'unpaid', '${URL_}');`);

const cols = async () =>
  (await db.query(`SELECT column_name || ' ' || data_type c FROM information_schema.columns WHERE table_name = 'open_jobs_browse' ORDER BY ordinal_position`)).rows.map((r) => r.c);
async function rowsAs(role, sql) {
  await db.exec(`SET ROLE ${role}`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("RESET ROLE"); }
}
const ROWS = "SELECT id, title, location, budget FROM public.open_jobs_browse ORDER BY id";
const before = { cols: await cols(), anon: JSON.stringify(await rowsAs("anon", ROWS)), auth: JSON.stringify(await rowsAs("authenticated", ROWS)) };

let applied = 0;
if (!MODE) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", applied === 3, `applied ${applied}`);

const c = await cols();
check("the old columns in order, plus scope_video_url text last",
  JSON.stringify(c) === JSON.stringify([...before.cols, "scope_video_url text"]), `${before.cols.length} -> ${c.length}, last=${c.at(-1)}`);
check("anon sees the same rows, location still masked", JSON.stringify(await rowsAs("anon", ROWS)) === before.anon, before.anon.slice(0, 90));
check("authenticated sees the same rows", JSON.stringify(await rowsAs("authenticated", ROWS)) === before.auth);
let vid = {};
try {
  vid = Object.fromEntries((await rowsAs("authenticated", "SELECT title, scope_video_url FROM public.open_jobs_browse")).map((r) => [r.title, r.scope_video_url]));
} catch (e) { vid = { error: e.message.slice(0, 60) }; }
check("a job with a video reads its URL, one without reads null; the unfunded job stays absent",
  vid["with-video"] === URL_ && vid["no-video"] === null && !("unfunded" in vid), JSON.stringify(vid).slice(0, 120));
const opts = (await db.query(`SELECT reloptions FROM pg_class WHERE relname = 'open_jobs_browse'`)).rows[0].reloptions;
check("still a definer view (security_invoker=false)", JSON.stringify(opts ?? []).includes("security_invoker=false"), JSON.stringify(opts));
const g = (await db.query(`SELECT has_table_privilege('anon','public.open_jobs_browse','SELECT') a, has_table_privilege('authenticated','public.open_jobs_browse','SELECT') b,
  has_table_privilege('anon','public.open_jobs_browse','INSERT,UPDATE,DELETE') w, has_table_privilege('authenticated','public.open_jobs_browse','INSERT,UPDATE,DELETE') x`)).rows[0];
check("anon + authenticated keep SELECT and gain nothing", g.a && g.b && !g.w && !g.x, JSON.stringify(g));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
