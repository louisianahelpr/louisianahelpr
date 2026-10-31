#!/usr/bin/env node
/**
 * PGlite proof for 20261031021424_closed_application_job_labels (JOBS-12).
 *
 *   npx tsx src/test/pglite/closedApplicationJobLabels.pglite.mjs            # AFTER: applied 3x, every check PASS
 *   npx tsx src/test/pglite/closedApplicationJobLabels.pglite.mjs --before   # RED: migration skipped, every check FAILS
 *
 *   L1 an applicant gets the title and date of a job closed to them, and of no job they did not apply to
 *   L2 only those three columns come back
 *   L3 another member gets nothing for it; no caller gets nothing and no error
 *   L4 authenticated + service_role may run it; anon and PUBLIC may not; SECURITY DEFINER, pinned search_path
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(new URL("../../../supabase/migrations/20261031021424_closed_application_job_labels.sql", import.meta.url).pathname, "utf8");
const BEFORE = process.argv.includes("--before") || process.env.NEW_MIGRATION === "skip";

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = U(1), H = U(2), OTHER = U(3), J1 = U(101), J2 = U(102);
const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, date_needed date, location text, budget numeric, status text);
CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid, helper_id uuid, status text, closed_reason text);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO public.jobs VALUES ('${J1}', '${P}', '${OTHER}', 'Yard', '2026-11-02', '12 Oak St', 100, 'accepted'), ('${J2}', '${P}', NULL, 'Not mine', '2026-11-03', '9 Elm', 50, 'open');
INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J1}', '${H}', 'rejected');
`);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
console.log(BEFORE ? "-- BEFORE: migration NOT applied (checks must FAIL)" : "-- AFTER: migration applied 3x");

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${JSON.stringify(got)})`);
  if (!ok) failures++;
};
const call = async (uid) => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
  try { return (await db.query(`SELECT * FROM public.get_closed_application_job_labels()`)).rows.map((r) => ({ ...r, date_needed: r.date_needed?.toISOString?.().slice(0, 10) ?? r.date_needed })); }
  catch (e) { return `ERR ${e.message}`; }
};
check("L1 + L2 the applicant gets only the title and date of the job they applied to", await call(H), [{ job_id: J1, title: "Yard", date_needed: "2026-11-02" }]);
check("L3 another member gets nothing", await call(OTHER), BEFORE ? "not applied" : []);
check("L3 no caller gets nothing", await call(""), BEFORE ? "not applied" : []);
if (!BEFORE) {
  const f = (await db.query(`SELECT proacl::text a, prosecdef d, proconfig::text c FROM pg_proc WHERE proname='get_closed_application_job_labels'`)).rows[0];
  check("L4 ACL, definer, search_path", [/authenticated=X/.test(f.a), /service_role=X/.test(f.a), /anon=X/.test(f.a), /(^|[{,])=X/.test(f.a), f.d, /search_path=public/.test(f.c)], [true, true, false, false, true, true]);
}
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
