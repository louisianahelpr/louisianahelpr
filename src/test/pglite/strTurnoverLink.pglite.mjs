#!/usr/bin/env node
/**
 * PGlite proof for 20261007145950_str_turnover_link_job (docs/OPEN.md Q768).
 *
 *   npx tsx src/test/pglite/strTurnoverLink.pglite.mjs [--replay] [--before]
 *
 * With --before the migration is NOT applied and every check must FAIL (the
 * function does not exist); without it the migration is applied (3x with
 * --replay) and every check must PASS.
 *
 *   L1 the host links their imported turnover to the open job they posted from it
 *   L2 a turnover linked to a FUNDED job is never re-pointed
 *   L3 another account cannot link the host's turnover, even to its own job
 *   L4 the host cannot link their turnover to someone else's job
 *   L5 anon cannot call it
 *   L6 an unpaid orphan job a turnover points at can still be deleted (FK SET NULL)
 *   L7 a turnover linked to a never-funded job is re-pointed at the next post
 *   L8 one turnover per job: a job another turnover points at is refused
 * (L2 funded, L6-L8 from the lh-authz-rls review of this migration.)
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261007145950_str_turnover_link_job.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HOST = U(1), OTHER = U(2), CONN = U(10), EV = U(20), EV2 = U(21), EV3 = U(22), JOB = U(30), JOB2 = U(31), OTHERJOB = U(32), ORPHAN = U(33), JOB3 = U(34);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, status text NOT NULL DEFAULT 'open', payment_status text NOT NULL DEFAULT 'unpaid');
CREATE TABLE public.str_calendar_connections (id uuid PRIMARY KEY, user_id uuid);
CREATE TABLE public.str_processed_events (id uuid PRIMARY KEY, connection_id uuid REFERENCES public.str_calendar_connections(id),
  event_uid text, checkout_date date, job_id uuid);
-- Prod's FK as it stands before this migration: NO ACTION on delete.
ALTER TABLE public.str_processed_events ADD CONSTRAINT str_processed_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
INSERT INTO public.jobs (id, customer_id) VALUES ('${JOB}', '${HOST}'), ('${JOB2}', '${HOST}'), ('${OTHERJOB}', '${OTHER}'), ('${ORPHAN}', '${HOST}'), ('${JOB3}', '${HOST}');
INSERT INTO public.str_calendar_connections VALUES ('${CONN}', '${HOST}');
INSERT INTO public.str_processed_events VALUES ('${EV}', '${CONN}', 'a', current_date, NULL), ('${EV2}', '${CONN}', 'b', current_date, NULL), ('${EV3}', '${CONN}', 'c', current_date, NULL);
`);
if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try { await db.exec(MIGRATION); console.log(`applied ${THIS} (run ${i})`); }
    catch (e) { check(`migration applies (run ${i})`, false, e.message); }
  }
} else console.log(`--before: ${THIS} NOT applied (every check must FAIL)`);

const as = (uid) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
const link = async (ev, job) => {
  try { return { r: (await db.query(`SELECT public.link_str_turnover_job('${ev}', '${job}') AS r`)).rows[0].r }; }
  catch (e) { return { err: e.message }; }
};
const jobOf = async (ev) => (await db.query(`SELECT job_id FROM public.str_processed_events WHERE id = '${ev}'`)).rows[0].job_id;

await as(OTHER);
const l3 = await link(EV, OTHERJOB);
check("L3 another account cannot link the host's turnover, even to its own job", l3.r === false && (await jobOf(EV)) === null, JSON.stringify(l3));
await as(HOST);
const l4 = await link(EV2, OTHERJOB);
check("L4 the host cannot link their turnover to someone else's job", /not your open job/.test(l4.err ?? "") && (await jobOf(EV2)) === null, JSON.stringify(l4));
const l1 = await link(EV, JOB);
check("L1 the host links their imported turnover to the open job they posted", l1.r === true && (await jobOf(EV)) === JOB, JSON.stringify(l1));
await db.exec(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${JOB}'`);
const l2 = await link(EV, JOB2);
check("L2 a turnover linked to a FUNDED job is never re-pointed", l2.r === false && (await jobOf(EV)) === JOB, JSON.stringify(l2));
// L6: Post a Job links, then the checkout could not start, and it deletes its orphan.
const l6link = await link(EV2, ORPHAN);
let l6 = "";
try { await db.exec(`DELETE FROM public.jobs WHERE id = '${ORPHAN}'`); } catch (e) { l6 = e.message; }
check("L6 an unpaid orphan job a turnover points at can still be deleted (the link clears)",
  l6link.r === true && l6 === "" && (await jobOf(EV2)) === null, `link=${JSON.stringify(l6link)} delete=${l6 || "ok"} job_id=${await jobOf(EV2)}`);
// L7: the host abandoned the checkout of JOB3's predecessor; the next post takes the turnover.
await link(EV3, JOB2);
const l7 = await link(EV3, JOB3);
check("L7 a turnover linked to a never-funded job is re-pointed at the next post", l7.r === true && (await jobOf(EV3)) === JOB3, JSON.stringify(l7));
const l8 = await link(EV2, JOB3);
check("L8 one turnover per job: a job another turnover points at is refused", l8.r === false && (await jobOf(EV2)) === null, JSON.stringify(l8));
let anon = null;
try { anon = (await db.query(`SELECT has_function_privilege('anon', 'public.link_str_turnover_job(uuid, uuid)', 'EXECUTE') AS x`)).rows[0].x; }
catch (e) { anon = `error: ${e.message}`; }
check("L5 anon cannot call it", anon === false, String(anon));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  const expected = 8;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
