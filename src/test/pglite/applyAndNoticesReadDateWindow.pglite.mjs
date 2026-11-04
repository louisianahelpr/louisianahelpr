#!/usr/bin/env node
/**
 * PGlite proof for 20261104084501_apply_and_notices_read_date_window (Q2408 part 4, lead re-review 11-04): the apply
 * gate (enforce_application_job_state), direct_accept_block_reason, job_announceable_to and get_public_open_jobs judge
 * a window job by the start on its window's LAST day; a one-day job is judged exactly as before.
 *
 *   node src/test/pglite/applyAndNoticesReadDateWindow.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/applyAndNoticesReadDateWindow.pglite.mjs # RED: the newest definitions before it
 *
 * The "before" functions are cut from their newest definitions (enforce_application_job_state: 20261012185633; the
 * other three: 20261027185146); job_offer_cutoff is its real definition (20261005184940); other helpers are stubbed
 * permissive. Grants are checked after the migration.
 *
 *   A1 a window job whose FIRST day's start has passed (last day ahead) takes an application
 *   A2 a one-day job whose start has passed is still refused (job_date_has_passed)
 *   A3 a window job whose last day's start has passed is refused
 *   N1 job_announceable_to: the window job is announceable after its first day's start; the past one-day job is not
 *   D1 direct_accept_block_reason: no job_date_has_passed for the window job; still for the past one-day job
 *   P1 get_public_open_jobs lists the window job, not the past one-day job
 *   G  EXECUTE as stated (no PUBLIC; anon only on get_public_open_jobs)
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261104084501_apply_and_notices_read_date_window.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the newest definitions before Q2408 part 4 (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
function cut(file, start) {
  const sql = read(MIGDIR + file);
  const st = sql.lastIndexOf(start);
  if (st < 0) throw new Error(`${start} not in ${file}`);
  const tag = sql.slice(st).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
  const bodyStart = sql.indexOf(tag, st) + tag.length;
  return sql.slice(st, sql.indexOf(tag, bodyStart) + tag.length) + ";";
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text DEFAULT 't', category text DEFAULT 'yard', location text DEFAULT 'Lafayette, LA', budget numeric DEFAULT 50,
  is_urgent boolean DEFAULT false, boost_expires_at timestamptz, status public.job_status DEFAULT 'open',
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  created_at timestamptz DEFAULT now() - interval '3 days', is_seed boolean DEFAULT false, date_needed date, start_time time,
  expires_at timestamptz, parent_job_id uuid, payment_status text DEFAULT 'escrow', credential_tier int DEFAULT 0,
  is_group_job boolean DEFAULT false, date_window_end date
);
CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid REFERENCES public.jobs(id), helper_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false, credential_tier int DEFAULT 0);
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.crew_spots_open(j uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
CREATE FUNCTION public.job_payment_is_listed(s text) RETURNS boolean LANGUAGE sql AS $$ SELECT s IN ('escrow','payout_pending','released','held') $$;
CREATE FUNCTION public.is_helper_shadowbanned(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
ALTER TABLE public.profiles ADD COLUMN ban_status text, ADD COLUMN auto_suspended_until timestamptz;
`);
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "CREATE OR REPLACE FUNCTION public.job_offer_cutoff("));
await db.exec(cut("20261012185633_listing_closes_at_start.sql", "CREATE OR REPLACE FUNCTION public.enforce_application_job_state("));
for (const fn of ["direct_accept_block_reason", "job_announceable_to", "get_public_open_jobs"]) {
  await db.exec(cut("20261027185146_card_hold_at_post.sql", `CREATE OR REPLACE FUNCTION public.${fn}(`));
}
await db.exec(`CREATE TRIGGER trg_application_job_state BEFORE INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.enforce_application_job_state();`);

let applied = 0;
if (!MODE) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", applied === 3 || !!MODE, `applied ${applied}`);

const P = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const H = "11111111-1111-4111-8111-111111111111";
const today = "(now() AT TIME ZONE 'America/Chicago')::date";
const past = "((now() - interval '1 hour') AT TIME ZONE 'America/Chicago')::time";
// Window: first day = today, start an hour ago (first day's start PASSED), last day today+3.
// One-day: today, start an hour ago. Window over: first day today-5, last day today-1.
await db.exec(`
INSERT INTO public.profiles (user_id) VALUES ('${P}'), ('${H}');
INSERT INTO public.jobs (id, title, customer_id, date_needed, start_time, date_window_end) VALUES
  ('10000000-0000-4000-8000-000000000001', 'window_started', '${P}', ${today}, ${past}, ${today} + 3),
  ('10000000-0000-4000-8000-000000000002', 'oneday_started', '${P}', ${today}, ${past}, NULL),
  ('10000000-0000-4000-8000-000000000003', 'window_over',    '${P}', ${today} - 5, ${past}, ${today} - 1);`);
const tries = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return String(e.message); } };
const apply = (n) => tries(`INSERT INTO public.applications (job_id, helper_id) VALUES ('10000000-0000-4000-8000-00000000000${n}', '${H}')`);

const a1 = await apply(1), a2 = await apply(2), a3 = await apply(3);
check("A1 a window job past its FIRST day's start takes an application", a1 === null, a1 ?? "taken");
check("A2 a one-day job past its start is still refused", !!a2 && /job_date_has_passed/.test(a2), a2 ?? "taken");
check("A3 a window job past its LAST day's start is refused", !!a3 && /job_date_has_passed/.test(a3), a3 ?? "taken");

const ann = Object.fromEntries((await db.query(`SELECT title, public.job_announceable_to(j, '${H}') AS ok FROM public.jobs j`)).rows.map((r) => [r.title, r.ok]));
check("N1 the window job is announceable after its first day's start; the past one-day job is not",
  ann.window_started === true && ann.oneday_started === false && ann.window_over === false, JSON.stringify(ann));

// A pending direct offer to H on every job, so direct_accept_block_reason reaches its date check.
await db.exec(`UPDATE public.jobs SET offered_to_helper_id = '${H}', direct_offer_status = 'pending', direct_offer_expires_at = now() + interval '1 day'`);
let d = {};
try {
  d = Object.fromEntries((await db.query(`SELECT title, public.direct_accept_block_reason(id, '${H}') AS r FROM public.jobs`)).rows.map((r) => [r.title, r.r]));
} catch (e) { d = { error: e.message.slice(0, 80) }; }
check("D1 direct_accept_block_reason: no job_date_has_passed for the window job; still for the past one-day job",
  d.window_started !== "job_date_has_passed" && !d.error && d.oneday_started === "job_date_has_passed", JSON.stringify(d));

await db.exec(`UPDATE public.jobs SET offered_to_helper_id = NULL, direct_offer_status = NULL, direct_offer_expires_at = NULL`);
const pub = (await db.query(`SELECT title FROM public.get_public_open_jobs(10)`)).rows.map((r) => r.title).sort();
check("P1 get_public_open_jobs lists the window job, not the past one-day job or the window that is over",
  JSON.stringify(pub) === JSON.stringify(["window_started"]), JSON.stringify(pub));

if (!MODE) {
  const acl = Object.fromEntries((await db.query(`SELECT proname, proacl::text AS a FROM pg_proc WHERE proname IN ('enforce_application_job_state','direct_accept_block_reason','job_announceable_to','get_public_open_jobs')`)).rows.map((r) => [r.proname, r.a]));
  const noPublic = Object.values(acl).every((a) => a && !/(^|[{,])=X/.test(a));
  const anonOnlyPublic = /anon=X/.test(acl.get_public_open_jobs) && !/anon=X/.test(acl.job_announceable_to) && !/anon=X/.test(acl.direct_accept_block_reason) && !/anon=X/.test(acl.enforce_application_job_state);
  check("G EXECUTE as stated (no PUBLIC; anon only on get_public_open_jobs)", noPublic && anonOnlyPublic, JSON.stringify(acl));
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
