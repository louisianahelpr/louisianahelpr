#!/usr/bin/env node
/**
 * PGlite proof for 20261006031016_crew_spots_open_not_client_callable (docs/OPEN.md
 * Q1409; lh-authz-rls review of c5785c40d, 2026-10-05: public.crew_spots_open
 * was client-callable with none of the browse exclusions, so any job UUID told
 * whether the job exists and its empty-spot count, seed and hidden jobs too).
 *
 *   npx tsx src/test/pglite/crewSpotsOpenPrivate.pglite.mjs [--replay] [--before]
 *
 * open_jobs_browse and crew_spots_open are loaded from their EFFECTIVE
 * definitions before this migration (20261006023437), with the grants they
 * carry live. --before leaves the migration out and the RED checks must FAIL
 * (count asserted); without it the migration is applied (3x with --replay) and
 * every check must PASS. The browse reads run under the REAL anon and
 * authenticated roles (SET ROLE), since the point is what a client may call.
 * Stubs as in crewFreeSpotRelisted.pglite.mjs.
 *
 *   P1 anon cannot call crew_spots_open                                 RED before
 *   P2 authenticated cannot call crew_spots_open                        RED before
 *   P3 as anon AND as authenticated, open_jobs_browse still lists the re-listed
 *      crew with 1 spot open and hides the full, too-soon and started crews
 *   P4 the view's inline count equals crew_spots_open for every crew (parity)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261006031016_crew_spots_open_not_client_callable.sql";
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
const FNS = ["job_offer_cutoff", "crew_spots_open"];

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


${viewBefore()}
REVOKE ALL ON FUNCTION public.crew_spots_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crew_spots_open(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
`;

const db = new PGlite();
const all = async (sql, p) => (await db.query(sql, p)).rows;
const attempt = async (sql) => {
  try {
    await db.exec(sql);
    return "";
  } catch (e) {
    return e.message;
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
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, title, budget, status, is_group_job, helpers_needed, date_needed, start_time, is_seed) VALUES
    ('${CREW_FREE}',  '${POSTER}', 'Move a piano',  90, 'accepted',    true, 3, ${at("3 days")}::date, ${at("3 days")}::time, false),
    ('${CREW_FULL}',  '${POSTER}', 'Move a couch',  90, 'accepted',    true, 3, ${at("3 days")}::date, ${at("3 days")}::time, false),
    ('${CREW_SOON}',  '${POSTER}', 'Move a bed',    90, 'accepted',    true, 3, ${at("10 minutes")}::date, ${at("10 minutes")}::time, false),
    ('${CREW_GOING}', '${POSTER}', 'Move a table',  90, 'in_progress', true, 3, ${at("3 days")}::date, ${at("3 days")}::time, false),
    ('${SINGLE}',     '${POSTER}', 'Mow the lawn',  40, 'open',        false, 1, ${at("3 days")}::date, ${at("3 days")}::time, true);
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents)
    SELECT j, gen_random_uuid(), s, 3000 FROM unnest(ARRAY['${CREW_FREE}','${CREW_SOON}','${CREW_GOING}']::uuid[]) j, generate_series(0, 1) s
    UNION ALL SELECT '${CREW_FULL}'::uuid, gen_random_uuid(), s, 3000 FROM generate_series(0, 2) s;
`);

const asRole = (role, uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SELECT set_config('request.jwt.claim.role', '${role}', false); SET ROLE ${role};`);

await asRole("anon");
let err = await attempt(`SELECT public.crew_spots_open('${SINGLE}')`);
check("P1 anon cannot call crew_spots_open (a seed job's existence and count are not answered)", /permission denied/.test(err), err || "the call went through");
await asRole("authenticated", NEWBIE);
err = await attempt(`SELECT public.crew_spots_open('${SINGLE}')`);
check("P2 authenticated cannot call crew_spots_open", /permission denied/.test(err), err || "the call went through");

for (const [role, uid] of [["anon", null], ["authenticated", NEWBIE]]) {
  await asRole(role, uid);
  let rows = [];
  let e = "";
  try {
    rows = await all(`SELECT id, crew_spots_open FROM public.open_jobs_browse ORDER BY id`);
  } catch (x) { e = x.message; }
  const ids = rows.map((r) => r.id);
  const free = rows.find((r) => r.id === CREW_FREE);
  check(`P3 as ${role}, the feed lists the re-listed crew with 1 spot open and hides the full, too-soon and started crews`,
    !e && free?.crew_spots_open === 1 && !ids.includes(CREW_FULL) && !ids.includes(CREW_SOON) && !ids.includes(CREW_GOING) && ids.includes(SINGLE),
    e || JSON.stringify(rows));
}

await db.exec("RESET ROLE");
// The view's inline count over EVERY crew (its row filter set aside), against the function.
const parity = await all(`
  SELECT j.id, public.crew_spots_open(j.id) AS fn,
         (SELECT v.crew_spots_open FROM public.open_jobs_browse v WHERE v.id = j.id) AS listed
    FROM public.jobs j WHERE j.is_group_job`);
const listedMatch = parity.every((r) => r.listed == null ? r.fn === 0 : r.listed === r.fn);
check("P4 the view's count equals crew_spots_open for every crew it lists, and every crew it hides has 0", listedMatch, JSON.stringify(parity));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // P1 and P2 are RED on the old grants; P3 and P4 hold either way (the point
  // of P3 is that it still holds once the function is not callable).
  const expected = 2;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
