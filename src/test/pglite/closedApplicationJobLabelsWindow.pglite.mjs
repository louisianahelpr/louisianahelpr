#!/usr/bin/env node
/**
 * PGlite proof for 20261105233602_closed_application_job_labels_window (Q2408: the Not picked row prints a window job's
 * window, not its first day). Runs the JOBS-12 migration (20261031021424) first, then this one 3x.
 *
 *   npx tsx src/test/pglite/closedApplicationJobLabelsWindow.pglite.mjs            # AFTER: every check PASS
 *   npx tsx src/test/pglite/closedApplicationJobLabelsWindow.pglite.mjs --before   # RED: this migration skipped, W1 FAILS
 *
 *   W1 an applicant gets the title, first day AND last day of a window job closed to them; NULL end for a one-day job
 *   W2 still nothing for a job they did not apply to, for another member, or with no caller
 *   W3 authenticated + service_role may run it; anon and PUBLIC may not; SECURITY DEFINER, pinned search_path
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const BASE = mig("20261031021424_closed_application_job_labels.sql");
const MIGRATION = mig("20261105233602_closed_application_job_labels_window.sql");
const BEFORE = process.argv.includes("--before") || process.env.NEW_MIGRATION === "skip";

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = U(1), H = U(2), OTHER = U(3), J1 = U(101), J2 = U(102), J3 = U(103);
const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, date_needed date, date_window_end date, location text, budget numeric, status text);
CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid, helper_id uuid, status text, closed_reason text);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO public.jobs VALUES
  ('${J1}', '${P}', NULL, 'Yard', '2026-11-02', '2026-11-08', '12 Oak St', 100, 'cancelled'),
  ('${J2}', '${P}', NULL, 'Not mine', '2026-11-03', '2026-11-09', '9 Elm', 50, 'open'),
  ('${J3}', '${P}', '${OTHER}', 'Gutters', '2026-11-04', NULL, '3 Pine', 80, 'accepted');
INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J1}', '${H}', 'rejected'), ('${J3}', '${H}', 'rejected');
`);
await db.exec(BASE);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
console.log(BEFORE ? "-- BEFORE: 20261105233602 NOT applied (W1 must FAIL)" : "-- AFTER: 20261105233602 applied 3x");

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${JSON.stringify(got)})`);
  if (!ok) failures++;
};
const ymd = (d) => (d?.toISOString?.().slice(0, 10) ?? d ?? null);
const call = async (uid) => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
  try {
    return (await db.query(`SELECT * FROM public.get_closed_application_job_labels() ORDER BY job_id`)).rows.map((r) => ({
      job_id: r.job_id, title: r.title, date_needed: ymd(r.date_needed), date_window_end: ymd(r.date_window_end),
    }));
  } catch (e) { return `ERR ${e.message}`; }
};
check("W1 the applicant gets each job's first and last day (NULL end for a one-day job)", await call(H), [
  { job_id: J1, title: "Yard", date_needed: "2026-11-02", date_window_end: "2026-11-08" },
  { job_id: J3, title: "Gutters", date_needed: "2026-11-04", date_window_end: null },
]);
check("W2 another member gets nothing", await call(OTHER), []);
check("W2 no caller gets nothing", await call(""), []);
const f = (await db.query(`SELECT proacl::text a, prosecdef d, proconfig::text c FROM pg_proc WHERE proname='get_closed_application_job_labels'`)).rows[0];
check("W3 ACL, definer, search_path", [/authenticated=X/.test(f.a), /service_role=X/.test(f.a), /anon=X/.test(f.a), /(^|[{,])=X/.test(f.a), f.d, /search_path=public/.test(f.c)], [true, true, false, false, true, true]);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
