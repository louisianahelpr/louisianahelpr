#!/usr/bin/env node
/**
 * PGlite proof for 20261120221545_browse_and_detail_change_address_after_accept (owner 2026-11-20: a Helpr gets a job's
 * street address only once they accepted):
 *   1. open_jobs_browse gives a pending direct offer's offeree the town (mask_job_location), never the street, and the
 *      row itself still reads (title, price), so the offered Helpr's page can show the offer.
 *   2. job_detail_change_requests' old/new location is readable by a Helpr only once they accepted (or confirmed a crew
 *      seat); the poster always.
 *
 *   node src/test/pglite/browseDetailChangeAddressAfterAccept.pglite.mjs                     # ALL PASS (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/browseDetailChangeAddressAfterAccept.pglite.mjs  # RED: every [RED] check fails
 *
 * Base, read verbatim: open_jobs_browse, mask_guest_contact (20261114234033), mask_job_location (20261031000945),
 * can_read_job_detail_change and its two SELECT policies (20261007113957). Stubbed, and said so: tables cut to the
 * columns read; early_access_cutoff() is far in the future, seed_hidden_in_discovery() false, my_credential_tier() 0.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261120221545_browse_and_detail_change_address_after_accept.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
let reds = 0;
let redFails = 0;
const check = (ok, name, red = false, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${red ? "[RED] " : ""}${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (red) reds++;
  if (!ok) {
    failures++;
    if (red) redFails++;
  }
};

/** The LAST `CREATE [OR REPLACE] FUNCTION public.<name>(` statement in one migration file, any dollar tag. */
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
  let m, last = null;
  while ((m = re.exec(t))) last = m.index;
  if (last === null) throw new Error(`no ${name} in ${file}`);
  const tag = /\bAS\s+(\$\w*\$)/g;
  tag.lastIndex = last;
  const a = tag.exec(t);
  const end = t.indexOf(a[1], a.index + a[0].length);
  return t.slice(last, end + a[1].length) + ";";
}
/** The open_jobs_browse CREATE VIEW statement in one migration file. */
function viewFrom(file) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const a = t.indexOf("CREATE OR REPLACE VIEW public.open_jobs_browse");
  const b = t.indexOf(";", t.indexOf("ban_settlement_queue q WHERE q.user_id = jobs.customer_id", a)) + 1;
  return t.slice(a, b);
}
/** One CREATE POLICY statement by name, from one migration file. */
function policyFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const a = t.indexOf(`CREATE POLICY "${name}"`);
  return t.slice(a, t.indexOf(";", a) + 1);
}

const U = (n) => `0f0f0f0f-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), OFFEREE = U(2), OFFERED_SOLO = U(3), BOOKED = U(4), CREW_OPEN = U(5), CREW_IN = U(6);
const STREET = "1 Main St, Delcambre, LA 70528";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT nullif(current_setting('test.uid', true), '')::uuid \$f\$;
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text DEFAULT 'Move a couch', description text DEFAULT 'A couch',
  category text DEFAULT 'moving', budget numeric DEFAULT 80, date_needed date DEFAULT (current_date + 7), location text DEFAULT '${STREET}',
  is_urgent boolean DEFAULT false, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, is_group_job boolean DEFAULT false,
  helpers_needed integer, estimated_hours numeric, start_time time DEFAULT '14:00', photos text[], special_requirements text,
  status public.job_status DEFAULT 'open', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), boosted_at timestamptz,
  boost_expires_at timestamptz, expires_at timestamptz, recurrence_interval text, recurrence_end_date date, parent_job_id uuid,
  payment_status text DEFAULT 'escrow', customer_id uuid, offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  pricing_mode text, latitude numeric DEFAULT 29.9480123, longitude numeric DEFAULT -91.9880456, parish text, credential_tier integer,
  require_photo_proof boolean, recurrence_days integer[], recurrence_weeks integer, series_split_ok boolean, materials_note text,
  helper_fee_flat_cents integer, helper_fee_percent numeric, scope_video_url text, date_window_end date, is_seed boolean DEFAULT false,
  helper_id uuid, helper_confirmed_at timestamptz);
CREATE TABLE public.applications (job_id uuid);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_confirmed_at timestamptz);
CREATE TABLE public.crew_block_fees (job_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() + interval '10 years' $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql STABLE AS 'SELECT 0';
CREATE TABLE public.job_detail_change_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, requested_by uuid,
  old_location text, new_location text, new_latitude numeric, new_longitude numeric, status text DEFAULT 'pending');
CREATE TABLE public.job_detail_change_answers (request_id uuid, helper_id uuid);
ALTER TABLE public.job_detail_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_detail_change_answers ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON public.job_detail_change_requests, public.job_detail_change_answers TO authenticated;
`);
const BASE = "20261114234033_guests_read_masked_job_text.sql";
const DC = "20261007113957_booked_job_detail_change_request.sql";
for (const s of [
  fnFrom("20261031000945_guests_get_no_poster_id_or_street.sql", "mask_job_location"),
  fnFrom(BASE, "mask_guest_contact"),
  viewFrom(BASE),
  `GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;`,
  fnFrom(DC, "can_read_job_detail_change"),
  policyFrom(DC, "The poster and the Helprs asked read a detail change"),
  policyFrom(DC, "The poster and the Helprs asked read the answers"),
]) await db.exec(s);
if (!skip) {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
const rowsAs = async (uid, sql) => {
  await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('test.uid', '${uid}', true);`);
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec("COMMIT");
  }
};

try {
  // 1. A pending direct offer, as its offeree reads it from the browse view.
  const jOffer = (await q(`INSERT INTO public.jobs (customer_id, offered_to_helper_id, direct_offer_status) VALUES ('${POSTER}', '${OFFEREE}', 'pending') RETURNING id`))[0].id;
  const seen = (await rowsAs(OFFEREE, `SELECT id, title, budget, location, latitude, offered_to_helper_id, direct_offer_status FROM public.open_jobs_browse WHERE id = '${jOffer}'`))[0];
  check(!!seen && seen.title === "Move a couch" && Number(seen.budget) === 80 && seen.direct_offer_status === "pending" && seen.offered_to_helper_id === OFFEREE,
    "the offeree still reads the offer from the browse view (title, price, pending, offered to them)", false, JSON.stringify(seen));
  check(!!seen && seen.location !== STREET && /Delcambre/.test(seen.location ?? "") && Number(seen.latitude) === 29.95,
    "the offeree gets the town from the browse view, never the street", true, JSON.stringify(seen));
  const other = (await rowsAs(U(9), `SELECT location FROM public.open_jobs_browse`)).map((r) => r.location);
  check(!other.includes(STREET), "any other member reads the town too (unchanged)", false, JSON.stringify(other));

  // 2. Detail-change requests: offered solo Helpr, accepted solo Helpr, unconfirmed and confirmed crew seats.
  const jSolo = (await q(`INSERT INTO public.jobs (customer_id, helper_id, status) VALUES ('${POSTER}', '${OFFERED_SOLO}', 'accepted') RETURNING id`))[0].id;
  const jBooked = (await q(`INSERT INTO public.jobs (customer_id, helper_id, status, helper_confirmed_at) VALUES ('${POSTER}', '${BOOKED}', 'accepted', now()) RETURNING id`))[0].id;
  const jCrew = (await q(`INSERT INTO public.jobs (customer_id, status, is_group_job) VALUES ('${POSTER}', 'accepted', true) RETURNING id`))[0].id;
  await q(`INSERT INTO public.group_job_helpers VALUES ('${jCrew}', '${CREW_OPEN}', NULL), ('${jCrew}', '${CREW_IN}', now())`);
  const req = async (job, helpers) => {
    const id = (await q(`INSERT INTO public.job_detail_change_requests (job_id, requested_by, old_location, new_location, new_latitude, new_longitude)
      VALUES ('${job}', '${POSTER}', '${STREET}', '2 Oak Ave, Delcambre, LA 70528', 29.95, -91.99) RETURNING id`))[0].id;
    for (const h of helpers) await q(`INSERT INTO public.job_detail_change_answers VALUES ('${id}', '${h}')`);
    return id;
  };
  const rSolo = await req(jSolo, [OFFERED_SOLO]);
  const rBooked = await req(jBooked, [BOOKED]);
  const rCrew = await req(jCrew, [CREW_OPEN, CREW_IN]);
  const reads = async (uid, r) => (await rowsAs(uid, `SELECT new_location FROM public.job_detail_change_requests WHERE id = '${r}'`)).length === 1;
  check(!(await reads(OFFERED_SOLO, rSolo)), "an offered, not-accepted Helpr cannot read a detail change's address", true);
  check(!(await reads(CREW_OPEN, rCrew)), "an unconfirmed crew seat cannot read a detail change's address", true);
  check(await reads(BOOKED, rBooked), "an accepted Helpr reads the detail change", false);
  check(await reads(CREW_IN, rCrew), "a confirmed crew member reads the detail change", false);
  check(await reads(POSTER, rSolo), "the poster reads their own request", false);
  const ownAnswer = (await rowsAs(OFFERED_SOLO, `SELECT helper_id FROM public.job_detail_change_answers WHERE request_id = '${rSolo}'`)).length;
  check(ownAnswer === 1, "the offered Helpr still reads their own answer row (no address in it)", false, String(ownAnswer));

  const acl = (await q(`SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE proname = 'can_read_job_detail_change'`))[0]?.a ?? "";
  check(/authenticated=X/.test(acl) && !/anon=/.test(acl), "can_read_job_detail_change: authenticated, never anon", true, acl);
} catch (err) {
  check(false, `threw: ${err.message}`);
}
console.log(`\n${reds} RED checks, ${redFails} failed`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
