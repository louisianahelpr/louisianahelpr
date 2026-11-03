#!/usr/bin/env node
/**
 * PGlite proof for 20261103025348_crew_seat_takes_helpr_schedule_lock
 * (docs/OPEN.md Q1919).
 *
 *   npx tsx src/test/pglite/crewSeatTakesHelprScheduleLock.pglite.mjs           # AFTER: the fix applied 3x
 *   npx tsx src/test/pglite/crewSeatTakesHelprScheduleLock.pglite.mjs --before  # RED: the live definition
 *
 * accept_group_application is loaded from its EFFECTIVE definition (before
 * this migration with --before; md5(prosrc) 375f9abf... = live prod,
 * measured 2026-11-02). Stubs (not under test): job_offer_cutoff (a spy that
 * records whether the Helpr's schedule lock is already held when it runs, the
 * first call after the job row is locked), are_users_blocked (false),
 * crew_slot_share_cents.
 *
 * PGlite is one connection, so the race itself cannot be run here. What this
 * proves is the half the race depends on: the crew-seat accept holds the SAME
 * advisory lock respond_job_schedule_change takes,
 * pg_advisory_xact_lock(hashtext('helpr_schedule:' || helper)), from before
 * its checks and its INSERT until its transaction ends. Two transactions that
 * both take one advisory lock take turns (Postgres semantics), and the second
 * one's statements read a fresh snapshot under READ COMMITTED. The lock order
 * (no wait cycle) is argued in the migration header and pinned by
 * src/test/crewSeatTakesHelprScheduleLock.test.ts.
 *
 *   L1 the seat accept holds helpr_schedule:<the hired Helpr> at its end        RED before
 *   L2 it already holds it when the first post-job-lock call runs              RED before
 *   L3 it holds no schedule lock for any other Helpr (the key is the hired one)
 *   L4 the lock is released at COMMIT (transaction-scoped, never leaks)
 *   L5 the seat is still hired (slot 0, the job stays open while filling)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261103025348_crew_seat_takes_helpr_schedule_lock.sql";
const BEFORE = process.argv.includes("--before");

function fnStmt(defs, name) {
  const d = defs.get(name);
  if (!d) throw new Error(`no migration defines ${name}`);
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
const POSTER = U(1), H = U(2), OTHER = U(3), CREW = U(101), APP = U(201);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, budget numeric,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  date_needed date, start_time time);
CREATE TABLE public.applications (id uuid PRIMARY KEY, job_id uuid, helper_id uuid, status text, offer_message text);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, helper_id uuid,
  status text NOT NULL DEFAULT 'accepted', slot_no integer, share_cents integer, response_deadline timestamptz,
  UNIQUE (job_id, helper_id));
CREATE TABLE public.crew_block_fees (job_id uuid, slot_no integer);
-- The spy: records, at the first call after the job row is locked, whether
-- this backend already holds the hired Helpr's schedule lock.
CREATE TABLE public.spy (held_at_cutoff boolean);
CREATE FUNCTION public.holds_schedule_lock(p_helper uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_locks l
                  WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
                    AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtext('helpr_schedule:' || p_helper::text)::bigint)
$$;
CREATE FUNCTION public.job_offer_cutoff(p_date date, p_time time) RETURNS timestamptz LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.spy VALUES (public.holds_schedule_lock('${H}'));
  RETURN now() + interval '5 days';
END $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.crew_slot_share_cents(p_total bigint, p_n int, p_slot int) RETURNS bigint LANGUAGE sql AS $$ SELECT p_total / p_n $$;
`);

if (BEFORE) {
  await db.exec(fnStmt(effectiveDefs(DIR, { before: THIS }), "accept_group_application"));
  console.log("--before: the live definition (expect L1 and L2 to FAIL)");
} else {
  const sql = readFileSync(DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("the migration applies 3x (replay-safe)", true);
  check("the newest definition is this migration's", effectiveDefs(DIR).get("accept_group_application")?.file === THIS);
}

await db.exec(`
INSERT INTO public.jobs (id, customer_id, budget, status, is_group_job, helpers_needed, date_needed, start_time)
VALUES ('${CREW}', '${POSTER}', 90, 'open', true, 3, current_date + 5, '10:00');
INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${APP}', '${CREW}', '${H}', 'pending');
`);

await db.exec(`BEGIN; SELECT set_config('request.jwt.claim.sub', '${POSTER}', true);`);
const r = await db.query(`SELECT * FROM public.accept_group_application('${APP}', now() + interval '6 hours', NULL)`);
const atEnd = (await db.query(`SELECT public.holds_schedule_lock('${H}') AS h, public.holds_schedule_lock('${OTHER}') AS o`)).rows[0];
const spy = (await db.query(`SELECT held_at_cutoff FROM public.spy`)).rows;
await db.exec("COMMIT");
const afterCommit = (await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)).rows[0].n;
const seat = (await db.query(`SELECT slot_no, status FROM public.group_job_helpers WHERE job_id = '${CREW}' AND helper_id = '${H}'`)).rows;
const job = (await db.query(`SELECT status::text AS s FROM public.jobs WHERE id = '${CREW}'`)).rows[0];

check("L1 the seat accept holds helpr_schedule:<the hired Helpr> at its end", atEnd.h === true, `held=${atEnd.h}`);
check("L2 it already holds it when the first call after the job lock runs", spy.length === 1 && spy[0].held_at_cutoff === true, JSON.stringify(spy));
check("L3 no schedule lock for another Helpr", atEnd.o === false);
check("L4 the lock is released at COMMIT", afterCommit === 0, `advisory locks after commit=${afterCommit}`);
check("L5 the seat is hired (slot 0) and the filling crew stays open",
  r.rows[0]?.slots_filled === 1 && seat.length === 1 && seat[0].slot_no === 0 && seat[0].status === "accepted" && job.s === "open",
  JSON.stringify({ r: r.rows[0], seat, job }));

await db.close();
if (BEFORE) {
  // RED must be exactly the two lock checks; anything else means the world is wrong.
  console.log(`\n--before: ${failures} FAILED (expected 2)`);
  process.exit(failures === 2 ? 0 : 1);
}
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log("\nALL PASS");
