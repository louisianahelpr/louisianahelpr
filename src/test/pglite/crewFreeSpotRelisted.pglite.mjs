#!/usr/bin/env node
/**
 * PGlite proof for 20261006023437_crew_free_spot_relisted (docs/OPEN.md Q1409;
 * owner decision 2026-10-05 ~21:45 CT: a booked crew's free spot is RE-LISTED
 * until its start so new Helprs can apply, and the poster can still hire from
 * earlier applicants).
 *
 *   npx tsx src/test/pglite/crewFreeSpotRelisted.pglite.mjs [--replay] [--before]
 *
 * Every function and the open_jobs_browse view are loaded from their EFFECTIVE
 * definitions before this migration (the view verbatim from 20260927012806),
 * with the REAL application-insert gate trigger (trg_application_job_state)
 * and the real is_server_context. --before leaves the migration out and the
 * RED checks must FAIL (count asserted); without it the migration is applied
 * (3x with --replay) and every check must PASS.
 * Stubs (not under test): mask_job_location (a fixed mask), early_access_cutoff
 * (now), seed_jobs_hidden_publicly (false), my_credential_tier and
 * get_user_credential_tier (0), job_payment_is_funded (escrow-family),
 * application_cap (no cap), are_users_blocked (false), miles_between (1),
 * user_may_see_job_address (false).
 *
 * Jobs (all funded, posted long ago):
 *   CREW_FREE  a booked crew of 3 with 2 on it, starting in 3 days
 *   CREW_FULL  a booked crew of 3 with 3 on it
 *   CREW_SOON  a booked crew of 3 with 2 on it, starting in 10 minutes
 *   CREW_GOING a started (in_progress) crew of 3 with 2 on it
 *   SINGLE     an open single-Helpr job (the control)
 *
 *   B1 open_jobs_browse lists CREW_FREE and says 1 spot is open           RED before
 *   B2 it never lists a full crew, one within 15 minutes of its start, or a
 *      started crew; the open single job is still listed
 *   B3 get_ranked_open_jobs, get_open_jobs_for_map and get_public_open_jobs
 *      list CREW_FREE (and none of the three crews that must not show)       RED before
 *   A1 a new Helpr applies to CREW_FREE through apply_to_job                 RED before
 *   A2 a direct application insert to CREW_FREE passes the insert gate      RED before
 *   A3 applying to CREW_FULL or CREW_SOON is still refused
 *   M1 the applicant still sees CREW_FREE in their applications             RED before
 *   F1 once the spot is filled the crew leaves browse (0 open)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261006023437_crew_free_spot_relisted.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}
function triggerStmt(name) {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const raw = readFileSync(DIR + f, "utf8");
    for (const m of blankSqlComments(raw).matchAll(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi"))) {
      found = raw.slice(m.index, m.index + m[0].length);
    }
  }
  if (!found) throw new Error(`no migration before ${THIS} creates trigger ${name}`);
  return found;
}
/** The newest open_jobs_browse statement before this migration (a DO $view$ block). */
function viewBefore() {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const raw = readFileSync(DIR + f, "utf8");
    const at = raw.indexOf("DO $view$\nBEGIN\n  IF to_regclass('public.open_jobs_browse') IS NULL THEN");
    if (at >= 0) found = raw.slice(at, raw.indexOf("$view$;", at) + "$view$;".length);
  }
  if (!found) throw new Error("no open_jobs_browse statement before this migration");
  // The statement skips itself when the view is absent (replay guard); here it
  // is the CREATE, so the guard is opened.
  return found.replace("IF to_regclass('public.open_jobs_browse') IS NULL THEN", "IF false THEN");
}
const FNS = [
  "is_server_context", "job_offer_cutoff", "get_ranked_open_jobs", "get_open_jobs_for_map", "get_public_open_jobs",
  "apply_to_job", "enforce_application_job_state", "get_jobs_for_my_applications",
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(2), NEWBIE = U(9);
const CREW_FREE = U(101), CREW_FULL = U(102), CREW_SOON = U(103), CREW_GOING = U(104), SINGLE = U(105);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TYPE public.job_category AS ENUM ('cleaning','moving','yard_work','other');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, description text, category public.job_category DEFAULT 'moving', budget numeric,
  date_needed date, location text DEFAULT '123 Main St, Lafayette', is_urgent boolean DEFAULT false, urgent_fee numeric DEFAULT 0,
  is_flexible_schedule boolean DEFAULT false, is_recurring boolean DEFAULT false, is_group_job boolean DEFAULT false,
  helpers_needed integer DEFAULT 1, estimated_hours numeric, start_time time, photos text[], special_requirements text,
  status public.job_status NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now() - interval '3 days',
  updated_at timestamptz DEFAULT now(), boosted_at timestamptz, boost_expires_at timestamptz, expires_at timestamptz,
  recurrence_interval text, recurrence_end_date date, parent_job_id uuid, payment_status text DEFAULT 'escrow',
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  pricing_mode text DEFAULT 'fixed', latitude numeric DEFAULT 30.22, longitude numeric DEFAULT -92.02, parish text DEFAULT 'Lafayette',
  credential_tier integer DEFAULT 0, require_photo_proof boolean DEFAULT false, recurrence_days integer[], recurrence_weeks integer,
  series_split_ok boolean, is_seed boolean DEFAULT false);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, slot_no integer, share_cents integer, UNIQUE (job_id, helper_id));
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs(id), helper_id uuid,
  status text, message text, created_at timestamptz DEFAULT now(), closed_reason text, offer_message text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, parish text, latitude numeric, longitude numeric, subscription_tier text, subscription_expires_at timestamptz);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION public.mask_job_location(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Lafayette area'::text $$;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.get_user_credential_tier(uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.job_payment_is_funded(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT $1 IN ('escrow','payout_pending','released') $$;
CREATE FUNCTION public.application_cap(text) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT NULL::integer $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.miles_between(numeric, numeric, numeric, numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 1::numeric $$;
CREATE FUNCTION public.user_may_see_job_address(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

${FNS.map(fnStmt).join("\n\n")}

${triggerStmt("trg_application_job_state")}

${viewBefore()}
`;

const db = new PGlite();
const all = async (sql, p) => (await db.query(sql, p)).rows;
const as = (uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
const server = () => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
const attempt = async (sql) => {
  try {
    await db.exec(sql);
    return "";
  } catch (e) {
    return e.message;
  }
};
const ids = async (sql) => {
  try {
    return (await all(sql)).map((r) => r.id);
  } catch (e) {
    return [`ERROR: ${e.message}`];
  }
};

await db.exec(SCHEMA);
if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (the RED checks must FAIL)`);
}

const at = (offset) => `(now() AT TIME ZONE 'America/Chicago' + interval '${offset}')`;
async function seed() {
  await server();
  await db.exec(`
    DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, budget, status, is_group_job, helpers_needed, date_needed, start_time) VALUES
      ('${CREW_FREE}',  '${POSTER}', 'Move a piano',  90, 'accepted',    true, 3, ${at("3 days")}::date, ${at("3 days")}::time),
      ('${CREW_FULL}',  '${POSTER}', 'Move a couch',  90, 'accepted',    true, 3, ${at("3 days")}::date, ${at("3 days")}::time),
      ('${CREW_SOON}',  '${POSTER}', 'Move a bed',    90, 'accepted',    true, 3, ${at("10 minutes")}::date, ${at("10 minutes")}::time),
      ('${CREW_GOING}', '${POSTER}', 'Move a table',  90, 'in_progress', true, 3, ${at("3 days")}::date, ${at("3 days")}::time),
      ('${SINGLE}',     '${POSTER}', 'Mow the lawn',  40, 'open',        false, 1, ${at("3 days")}::date, ${at("3 days")}::time);
    INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents)
      SELECT j, gen_random_uuid(), s, 3000 FROM unnest(ARRAY['${CREW_FREE}','${CREW_SOON}','${CREW_GOING}']::uuid[]) j, generate_series(0, 1) s
      UNION ALL SELECT '${CREW_FULL}'::uuid, gen_random_uuid(), s, 3000 FROM generate_series(0, 2) s;
  `);
}

await seed();
await as(NEWBIE);
const browse = await ids(`SELECT id FROM public.open_jobs_browse ORDER BY id`);
let spots = null;
try {
  spots = (await all(`SELECT crew_spots_open FROM public.open_jobs_browse WHERE id = '${CREW_FREE}'`))[0]?.crew_spots_open ?? null;
} catch (e) { spots = `ERROR: ${e.message}`; }
check("B1 open_jobs_browse lists the booked crew with a free spot and says 1 spot is open",
  browse.includes(CREW_FREE) && spots === 1, `browse=${JSON.stringify(browse)} spots=${spots}`);
check("B2 never a full crew, one within 15 minutes of its start, or a started crew; the open single job still listed",
  !browse.includes(CREW_FULL) && !browse.includes(CREW_SOON) && !browse.includes(CREW_GOING) && browse.includes(SINGLE),
  JSON.stringify(browse));
const ranked = await ids(`SELECT id FROM public.get_ranked_open_jobs(50, 0, true, NULL, NULL, NULL)`);
const map = await ids(`SELECT id FROM public.get_open_jobs_for_map()`);
const pub = await ids(`SELECT id FROM public.get_public_open_jobs(50)`);
const none = (l) => !l.includes(CREW_FULL) && !l.includes(CREW_SOON) && !l.includes(CREW_GOING);
check("B3 the ranked, map and public lists show the re-listed crew (and none of the three that must not show)",
  [ranked, map, pub].every((l) => l.includes(CREW_FREE) && l.includes(SINGLE) && none(l)),
  `ranked=${JSON.stringify(ranked)} map=${JSON.stringify(map)} public=${JSON.stringify(pub)}`);

await as(NEWBIE);
let err = await attempt(`SELECT public.apply_to_job('${CREW_FREE}', 'I can lift')`);
check("A1 a new Helpr applies to the re-listed spot through apply_to_job", !err, err);
await server();
await db.exec(`DELETE FROM public.applications`);
await as(NEWBIE);
err = await attempt(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW_FREE}', '${NEWBIE}', 'pending')`);
check("A2 a direct application insert to the re-listed spot passes the insert gate", !err, err);
const e1 = await attempt(`SELECT public.apply_to_job('${CREW_FULL}', 'x')`);
const e2 = await attempt(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW_SOON}', '${NEWBIE}', 'pending')`);
check("A3 applying to a full crew or one within 15 minutes of its start is still refused",
  /no longer accepting/.test(e1) && /job_not_open/.test(e2), `${e1} | ${e2}`);

// Independent of A1/A2: the pending application is written by the server here.
await server();
await db.exec(`DELETE FROM public.applications; INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW_FREE}', '${NEWBIE}', 'pending')`);
await as(NEWBIE);
const mine = await ids(`SELECT id FROM public.get_jobs_for_my_applications()`);
check("M1 the applicant still sees the re-listed crew among their applications", mine.includes(CREW_FREE), JSON.stringify(mine));

await server();
await db.exec(`INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents) VALUES ('${CREW_FREE}', '${NEWBIE}', 2, 3000)`);
await as(NEWBIE);
const after = await ids(`SELECT id FROM public.open_jobs_browse`);
check("F1 once the spot is filled the crew leaves browse", !after.includes(CREW_FREE) && after.includes(SINGLE), JSON.stringify(after));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // B1 B3 A1 A2 M1 are RED on the old surfaces; B2 A3 F1 hold either way.
  const expected = 5;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
