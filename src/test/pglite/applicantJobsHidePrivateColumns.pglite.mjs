#!/usr/bin/env node
/**
 * PGlite proof for 20261105102419_applicant_jobs_hide_private_columns (docs/OPEN.md Q2742, Builder 3, 2026-11-05).
 *
 *   npx tsx src/test/pglite/applicantJobsHidePrivateColumns.pglite.mjs [--replay] [--before]
 *
 * get_jobs_for_my_applications is loaded from its EFFECTIVE definition before this migration. --before leaves the
 * migration out and the RED checks must FAIL (count asserted); without it the migration is applied (3x with
 * --replay) and every check must PASS.
 * Stubs (not under test): mask_job_location (a fixed mask), crew_spots_open (0), user_may_see_job_address (true only
 * for the (job, user) pairs in public.address_ok, standing in for the picked / crew helpers).
 *
 * Jobs (one poster):
 *   OPEN_JOB   open, carries a checkout session, a payment intent, a flag, a removal reason, a chargeback date,
 *              dispute and proof data; APPLICANT and HIRED applied
 *   HIRED_JOB  accepted, HIRED is its helper_id; same private data
 *   CREW_JOB   accepted crew; CREW is on the roster and may see the address (address_ok)
 *
 *   P1 an applicant who is not a party gets every private column NULL / empty on OPEN_JOB        RED before
 *   P2 that applicant still gets the job's title, budget, status and the masked location
 *   P3 the hired Helpr still gets the private columns of their own job
 *   P4 a crew member who may see the address still gets them
 *   P5 the row shape is unchanged (SETOF jobs, every column present)
 *   P6 execute stays authenticated + service_role only on both definers (anon and PUBLIC revoked)
 *   D1 get_my_pending_direct_offers still returns the offeree's pending offer on an open job
 *   D2 it no longer returns an offer whose job a Helpr is on (the policy's status/helper test)      RED before
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261105102419_applicant_jobs_hide_private_columns.sql";
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

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(2), APPLICANT = U(3), HIRED = U(4), CREW = U(5);
const OPEN_JOB = U(101), HIRED_JOB = U(102), CREW_JOB = U(103), OFFER_OPEN = U(104), OFFER_FILLED = U(105);
const OFFEREE = U(7);
const PRIVATE = {
  stripe_session_id: null, stripe_payment_intent_id: null, chargeback_evidence_due_by: null, client_request_id: null,
  flag_reasons: [], removal_reason: null, removed_by: null, dispute_reason: null, dispute_evidence_urls: [],
  dispute_helper_response: null, cancellation_reason: null, revision_note: null, proof_before_urls: [], proof_after_urls: [],
  disputed_by: null, dispute_status: null, has_active_dispute: false, dispute_resolved_at: null, disputed_at: null,
  payout_scheduled_at: null, cancellation_fee_status: null, cancelled_by: null, helper_arrival_near_miss_ft: null,
  helper_arrival_near_miss_at: null,
};

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, budget numeric, status public.job_status NOT NULL DEFAULT 'open',
  location text DEFAULT '123 Main St, Lafayette', latitude numeric DEFAULT 30.22345, longitude numeric DEFAULT -92.01987,
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, is_group_job boolean DEFAULT false,
  stripe_session_id text DEFAULT 'cs_live_secret', stripe_payment_intent_id text DEFAULT 'pi_live_secret',
  chargeback_evidence_due_by timestamptz DEFAULT now(), client_request_id uuid DEFAULT gen_random_uuid(),
  flag_reasons text[] DEFAULT ARRAY['spam_words'], removal_reason text DEFAULT 'moderator note',
  removed_by uuid DEFAULT '00000000-0000-4000-8000-000000000999', dispute_reason text DEFAULT 'poster says no-show',
  dispute_evidence_urls text[] DEFAULT ARRAY['evidence/1.jpg'], dispute_helper_response text DEFAULT 'I was there',
  cancellation_reason text DEFAULT 'family emergency', revision_note text DEFAULT 'redo the edges',
  proof_before_urls text[] DEFAULT ARRAY['proof/before.jpg'], proof_after_urls text[] DEFAULT ARRAY['proof/after.jpg'],
  disputed_by uuid DEFAULT '00000000-0000-4000-8000-000000000998', dispute_status text DEFAULT 'open',
  has_active_dispute boolean DEFAULT true, dispute_resolved_at timestamptz DEFAULT now(), disputed_at timestamptz DEFAULT now(),
  payout_scheduled_at timestamptz DEFAULT now(), cancellation_fee_status text DEFAULT 'charged',
  cancelled_by uuid DEFAULT '00000000-0000-4000-8000-000000000997', helper_arrival_near_miss_ft integer DEFAULT 400,
  helper_arrival_near_miss_at timestamptz DEFAULT now(), direct_offer_status text, payment_status text DEFAULT 'escrow',
  created_at timestamptz DEFAULT now());
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs(id), helper_id uuid, status text);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid);
CREATE TABLE public.address_ok (job_id uuid, user_id uuid);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.mask_job_location(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Lafayette area'::text $$;
CREATE FUNCTION public.crew_spots_open(uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.job_payment_is_listed(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT $1 IN ('escrow','held') $$;
CREATE FUNCTION public.user_may_see_job_address(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM public.address_ok WHERE job_id = $1 AND user_id = $2) $$;

${fnStmt("get_jobs_for_my_applications")}
REVOKE ALL ON FUNCTION public.get_jobs_for_my_applications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jobs_for_my_applications() TO authenticated, service_role;
${fnStmt("get_my_pending_direct_offers")}
REVOKE ALL ON FUNCTION public.get_my_pending_direct_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_direct_offers() TO authenticated, service_role;

INSERT INTO public.jobs (id, customer_id, helper_id, title, budget, status, is_group_job) VALUES
  ('${OPEN_JOB}',  '${POSTER}', NULL,        'Mow the lawn', 40, 'open',     false),
  ('${HIRED_JOB}', '${POSTER}', '${HIRED}',  'Move a couch', 90, 'accepted', false),
  ('${CREW_JOB}',  '${POSTER}', U_LEAD,      'Move a piano', 90, 'accepted', true);
INSERT INTO public.jobs (id, customer_id, helper_id, title, budget, status, offered_to_helper_id, direct_offer_status) VALUES
  ('${OFFER_OPEN}',   '${POSTER}', NULL,       'Paint a fence', 70, 'open',     '${OFFEREE}', 'pending'),
  ('${OFFER_FILLED}', '${POSTER}', '${HIRED}', 'Paint a shed',  70, 'accepted', '${OFFEREE}', 'pending');
INSERT INTO public.applications (job_id, helper_id, status) VALUES
  ('${OPEN_JOB}', '${APPLICANT}', 'pending'), ('${OPEN_JOB}', '${HIRED}', 'pending'),
  ('${HIRED_JOB}', '${HIRED}', 'accepted'), ('${CREW_JOB}', '${CREW}', 'accepted');
INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${CREW_JOB}', '${CREW}');
INSERT INTO public.address_ok (job_id, user_id) VALUES ('${HIRED_JOB}', '${HIRED}'), ('${CREW_JOB}', '${CREW}');
`.replace("U_LEAD", `'${U(6)}'`);

const db = new PGlite();
const as = (uid) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
const rowsAs = async (uid) => {
  await as(uid);
  try {
    return (await db.query(`SELECT to_jsonb(r) AS j FROM public.get_jobs_for_my_applications() r`)).rows.map((r) => r.j);
  } catch (e) {
    return [{ error: e.message }];
  }
};
const privateOf = (row) => Object.fromEntries(Object.keys(PRIVATE).map((k) => [k, row?.[k] ?? null]));
const isHidden = (row) => Object.entries(PRIVATE).every(([k, v]) => JSON.stringify(row?.[k] ?? null) === JSON.stringify(v));
const isShown = (row) => Object.keys(PRIVATE).every((k) => row?.[k] !== null && JSON.stringify(row?.[k]) !== "[]");

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

const applicant = await rowsAs(APPLICANT);
const open = applicant.find((r) => r.id === OPEN_JOB);
check("P1 an applicant who is not a party gets every private column NULL / empty", !!open && isHidden(open), JSON.stringify(privateOf(open)));
check("P2 that applicant still gets title, budget, status and the masked location",
  open?.title === "Mow the lawn" && Number(open?.budget) === 40 && open?.status === "open" && open?.location === "Lafayette area"
    && Number(open?.latitude) === 30.22, JSON.stringify({ t: open?.title, l: open?.location, lat: open?.latitude }));

const hired = await rowsAs(HIRED);
const own = hired.find((r) => r.id === HIRED_JOB);
const openForHired = hired.find((r) => r.id === OPEN_JOB);
check("P3 the hired Helpr still gets the private columns of their own job (and not of a job they only applied to)",
  !!own && isShown(own) && own.stripe_session_id === "cs_live_secret" && !!openForHired && isHidden(openForHired),
  JSON.stringify({ own: own?.stripe_session_id, open: openForHired?.stripe_session_id }));

const crew = (await rowsAs(CREW)).find((r) => r.id === CREW_JOB);
check("P4 a crew member who may see the address still gets them", !!crew && isShown(crew), JSON.stringify(privateOf(crew)));

const cols = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs'`)).rows[0].n;
check("P5 the row shape is unchanged (every jobs column present)", !!open && Object.keys(open).length === cols, `${Object.keys(open ?? {}).length} of ${cols}`);

for (const fn of ["get_jobs_for_my_applications", "get_my_pending_direct_offers"]) {
  const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = '${fn}'`)).rows[0]?.a ?? "";
  check(`P6 ${fn}: execute is authenticated + service_role only`, /authenticated=X/.test(acl) && /service_role=X/.test(acl) && !/anon=/.test(acl) && !/(^|[{,])=X/.test(acl), acl);
}

await as(OFFEREE);
const offers = (await db.query(`SELECT id FROM public.get_my_pending_direct_offers()`)).rows.map((r) => r.id);
check("D1 the offeree still gets a pending offer on an open job", offers.includes(OFFER_OPEN), JSON.stringify(offers));
check("D2 an offer whose job is no longer open (a Helpr is on it) is not returned, as the policy would not show it",
  !offers.includes(OFFER_FILLED), JSON.stringify(offers));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // P1, P3 (its second half) and D2 are RED on the old functions; P2 P4 P5 P6 D1 hold either way.
  const expected = 3;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
