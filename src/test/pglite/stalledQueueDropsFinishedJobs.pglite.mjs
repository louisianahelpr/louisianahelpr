/**
 * Q2789 PGlite proof for 20261115185124_stalled_queue_drops_finished_jobs.sql.
 *
 * A stuck job the two sides finish themselves after it was escalated must leave the admin's open Stuck jobs list
 * (admin_stalled_job_queue(false)) and stop holding the Slack item open (admin_queue_still_pending('stalled-job')).
 *
 *   node src/test/pglite/stalledQueueDropsFinishedJobs.pglite.mjs
 *   NEW_MIGRATION=skip node ...   -> the same checks against the previous definitions (expected FAIL lines)
 *
 * Applies the previous newest definitions (20261030221720 admin_queue_still_pending, 20261108214605
 * admin_stalled_job_queue, extracted verbatim) and then the new migration 3x for replay safety.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = "20261115185124_stalled_queue_drops_finished_jobs.sql";

/** One CREATE FUNCTION statement (through its REVOKE/GRANT lines) out of an older migration, verbatim. */
function extract(file, name) {
  const s = mig(file);
  const i = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const g = s.indexOf(`GRANT EXECUTE ON FUNCTION public.${name}(`, i);
  return s.slice(i, s.indexOf("\n", g) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "dddddddd-0000-4000-8000-000000000001";
const J = "eeeeeeee-0000-4000-8000-000000000001";
const J2 = "eeeeeeee-0000-4000-8000-000000000002";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, budget numeric,
  date_needed date, start_time time, estimated_hours numeric, status public.job_status, payment_status text,
  helper_completed_at timestamptz, poster_completed_at timestamptz, is_seed boolean);
CREATE TABLE public.job_completion_nudges (job_id uuid PRIMARY KEY, first_sent_at timestamptz, second_sent_at timestamptz,
  escalated_at timestamptz, resolved_at timestamptz, resolved_by uuid);
CREATE TABLE public.job_continue_days (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, new_date date,
  new_start_time time, status text, closed_at timestamptz, created_at timestamptz DEFAULT now());
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs (id, title, status, payment_status, date_needed, is_seed) VALUES
  ('${J}', 'Mow', 'in_progress', 'escrow', '2026-11-01', false),
  ('${J2}', 'Other', 'in_progress', 'escrow', '2026-11-01', false);
INSERT INTO public.job_completion_nudges (job_id, first_sent_at, escalated_at) VALUES ('${J}', now() - interval '1 day', now());
`);
await db.exec(extract("20261030221720_support_ticket_alert_closes_itself.sql", "admin_queue_still_pending"));
await db.exec(extract("20261108214605_continue_day_missed_return.sql", "admin_stalled_job_queue"));

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig(NEW));
  console.log("applied the new migration 3x");
}

const q = async (sql) => (await db.query(sql)).rows;
const pending = async () =>
  (await q(`SELECT public.admin_queue_still_pending('stalled-job', '{"job_id":"${J}"}'::jsonb, now()) v`))[0].v;
const queue = async (inc) => {
  await db.exec(`SET request.jwt.claim.sub = '${ADMIN}'`);
  return (await q(`SELECT job_id FROM public.admin_stalled_job_queue(${inc})`)).map((r) => r.job_id);
};

check("escalated and still in the trap: still pending", (await pending()) === true);
check("…and on the open list", (await queue(false)).includes(J));

await db.exec(`UPDATE public.jobs SET helper_completed_at = now() WHERE id = '${J}'`);
check("the Helpr marked it done: no longer pending here", (await pending()) === false);
check("…and off the open list", !(await queue(false)).includes(J));

await db.exec(`UPDATE public.jobs SET status = 'completed', poster_completed_at = now(), payment_status = 'payout_pending' WHERE id = '${J}'`);
check("finished by both sides (the prod case): not pending", (await pending()) === false);
check("…not on the open list", !(await queue(false)).includes(J));
check("…still in the history tab", (await queue(true)).includes(J));

await db.exec(`UPDATE public.jobs SET status = 'cancelled', poster_completed_at = NULL, helper_completed_at = NULL WHERE id = '${J}'`);
check("cancelled: not pending", (await pending()) === false);

await db.exec(`UPDATE public.jobs SET status = 'in_progress' WHERE id = '${J}'`);
check("back in the trap: pending again", (await pending()) === true);
await db.exec(`UPDATE public.job_completion_nudges SET resolved_at = now() WHERE job_id = '${J}'`);
check("Mark Reviewed still closes it", (await pending()) === false && !(await queue(false)).includes(J));

await db.exec(`RESET request.jwt.claim.sub`);
const acl = await q(`SELECT proname, proacl::text a FROM pg_proc WHERE proname IN ('admin_queue_still_pending','admin_stalled_job_queue') ORDER BY 1`);
check("still_pending: service_role only", !/(anon|authenticated)=/.test(acl[0].a), acl[0].a);
check("stalled queue: no anon", !/anon=/.test(acl[1].a) && /authenticated=X/.test(acl[1].a), acl[1].a);

console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
