#!/usr/bin/env node
/**
 * PGlite proof for 20261031015647_poster_cancel_strike_only_inside_24h (JOBS-14,
 * owner ruling 10-30): a poster gets a strike for cancelling a hired Helpr only
 * within 24 hours of the start, matching Helprs. No fee rule changes.
 *
 *   npx tsx src/test/pglite/posterCancelStrikeOnlyInside24h.pglite.mjs           # AFTER: applied 3x, every check PASS
 *   npx tsx src/test/pglite/posterCancelStrikeOnlyInside24h.pglite.mjs --before  # RED: migration skipped, S1, S2, S7, S10 FAIL
 *
 * poster_cancel_job is loaded at its EFFECTIVE definition before this migration
 * (md5-equal to live prod on 2026-10-30) with the real helpers it prices with.
 * Stub (not under test): apply_cancellation_violation_consequence, which writes
 * one row to public.strikes for each call.
 *
 *   S1 committed, 48 h out: no strike, nothing for the Helpr's time, action none
 *   S2 committed, 24 h 6 min out: no strike
 *   S3 committed, 23 h 54 min out: one strike, 25%
 *   S4 committed, 6 h out: one strike, 25%
 *   S5 committed, 1 h out: one strike, 50%
 *   S6 committed, already started: one strike, 50%
 *   S7 crew, 48 h out: no strike, no fee shares above $0
 *   S8 crew, 6 h out: ONE strike for the booking, a fee share per member
 *   S9 offered but never accepted, 6 h out: no strike, no fee
 *   S10 no date on the job: no strike, no fee
 *   S11 the ACL stays authenticated + service_role, not anon
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261031015647_poster_cancel_strike_only_inside_24h.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const BEFORE = process.argv.includes("--before") || process.env.NEW_MIGRATION === "skip";

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
const P = U(1), H = U(2), M1 = U(3), M2 = U(4);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  budget numeric, helper_fee_percent numeric, helper_fee_flat_cents integer,
  date_needed date, start_time time, helper_confirmed_at timestamptz, helper_completed_at timestamptz,
  cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean,
  cancellation_fee numeric, cancellation_fee_status text);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, joined_at timestamptz DEFAULT now(), slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_completed_at timestamptz, UNIQUE (job_id, helper_id));
CREATE TABLE public.crew_cancellation_fee_shares (job_id uuid, helper_id uuid, committed boolean, share_basis_cents bigint,
  fee_percent integer, share_amount numeric, PRIMARY KEY (job_id, helper_id));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text,
  type text, link text, job_id uuid, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.strikes (job_id uuid);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION public.apply_cancellation_violation_consequence(p uuid) RETURNS jsonb LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO public.strikes VALUES (p); RETURN jsonb_build_object('action', 'warning', 'prior_count', 0); END $$;
${["job_hours_until_start", "cancellation_fee_percent", "is_late_cancellation", "crew_fee_pays_unconfirmed",
  "crew_slot_share_cents", "helpr_flat_fee_cents", "poster_cancel_job"].map(fnStmt).join("\n\n")}
REVOKE ALL ON FUNCTION public.poster_cancel_job(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poster_cancel_job(uuid, text, bigint) TO authenticated, service_role;
`);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
console.log(BEFORE ? "-- BEFORE: migration NOT applied (S1, S2, S7, S10 must FAIL)" : "-- AFTER: migration applied 3x");

const at = (h) => `((now() + interval '${h} hours') AT TIME ZONE 'America/Chicago')`;
const job = (id, hours, over = {}) => {
  const cols = { id: `'${id}'`, customer_id: `'${P}'`, helper_id: `'${H}'`, helper_confirmed_at: "now()", title: `'Job ${id.slice(-3)}'`,
    budget: 100, status: `'accepted'`, helper_fee_percent: 10,
    date_needed: hours === null ? "NULL" : `${at(hours)}::date`, start_time: hours === null ? "NULL" : `${at(hours)}::time`, ...over };
  return `INSERT INTO public.jobs (${Object.keys(cols).join(", ")}) VALUES (${Object.values(cols).join(", ")});`;
};
const cancel = async (id) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${P}', false)`);
  try {
    const r = await db.query(`SELECT public.poster_cancel_job('${id}', 'x') v`);
    const j = (await db.query(`SELECT status::text s, cancellation_fee f, late_cancellation l FROM public.jobs WHERE id = '${id}'`)).rows[0];
    const n = Number((await db.query(`SELECT count(*) n FROM public.strikes WHERE job_id = '${id}'`)).rows[0].n);
    return { v: r.rows[0].v, s: j.s, fee: Number(j.f), late: j.l, strikes: n };
  } finally {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
const crew = async (id, hours) => {
  await db.exec(job(id, hours, { helper_id: "NULL", helper_confirmed_at: "NULL", is_group_job: true, helpers_needed: 2 }));
  await db.exec(`INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_confirmed_at) VALUES
    ('${id}', '${M1}', 1, 5000, now()), ('${id}', '${M2}', 2, 5000, now())`);
};
const expectCase = (name, r, strikes, fee, action) => check(name,
  r.s === "cancelled" && r.strikes === strikes && r.fee === fee && (action === undefined || r.v.action === action),
  JSON.stringify({ strikes: r.strikes, fee: r.fee, late: r.late, action: r.v.action }));

await db.exec(job(U(101), 48));
expectCase("S1 committed, 48 h out: no strike, nothing for the Helpr's time", await cancel(U(101)), 0, 0, "none");
await db.exec(job(U(102), 24.1));
expectCase("S2 committed, 24 h 6 min out: no strike", await cancel(U(102)), 0, 0, "none");
await db.exec(job(U(103), 23.9));
expectCase("S3 committed, 23 h 54 min out: one strike, 25%", await cancel(U(103)), 1, 25, "warning");
await db.exec(job(U(104), 6));
expectCase("S4 committed, 6 h out: one strike, 25%", await cancel(U(104)), 1, 25, "warning");
await db.exec(job(U(105), 1));
expectCase("S5 committed, 1 h out: one strike, 50%", await cancel(U(105)), 1, 50, "warning");
await db.exec(job(U(106), -1, { status: "'in_progress'" }));
expectCase("S6 committed, already started: one strike, 50%", await cancel(U(106)), 1, 50, "warning");
await crew(U(107), 48);
expectCase("S7 crew, 48 h out: no strike, no fee", await cancel(U(107)), 0, 0, "none");
await crew(U(108), 6);
expectCase("S8 crew, 6 h out: ONE strike for the booking, $12.50 per member", await cancel(U(108)), 1, 25, "warning");
await db.exec(job(U(109), 6, { helper_confirmed_at: "NULL" }));
expectCase("S9 offered but never accepted, 6 h out: no strike, no fee", await cancel(U(109)), 0, 0, "none");
await db.exec(job(U(110), null));
expectCase("S10 no date on the job: no strike, no fee", await cancel(U(110)), 0, 0, "none");

const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'poster_cancel_job'`)).rows[0].a;
check("S11 the ACL stays authenticated + service_role, not anon", /authenticated=X/.test(acl) && /service_role=X/.test(acl) && !/anon=X/.test(acl) && !/(^|\{|,)=X/.test(acl), acl);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
