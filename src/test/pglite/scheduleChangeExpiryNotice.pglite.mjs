#!/usr/bin/env node
/**
 * PGlite proof for 20261031023227_schedule_change_expiry_notice (JOBS-19).
 *
 *   npx tsx src/test/pglite/scheduleChangeExpiryNotice.pglite.mjs            # AFTER: applied 3x, every check PASS
 *   npx tsx src/test/pglite/scheduleChangeExpiryNotice.pglite.mjs --no-claim # RED: the sweep without its status update: E2, E3 FAIL
 *
 *   E1 a lapsed request becomes 'expired' and whoever asked gets the notice; the job is not touched
 *   E2 a second run sends nothing
 *   E3 a request still inside its time, and an answered one, are left alone
 *   E4 the link opens the asker's side: the poster's Posted, the Helpr's Working
 *   E5 service_role only
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
let MIGRATION = readFileSync(new URL("../../../supabase/migrations/20261031023227_schedule_change_expiry_notice.sql", import.meta.url).pathname, "utf8");
if (process.argv.includes("--no-claim")) {
  const CLAIM = "UPDATE public.job_schedule_change_requests q\n       SET status = 'expired', decided_at = now()\n     WHERE q.status = 'pending'\n       AND q.expires_at <= now()\n     RETURNING q.job_id, q.requested_by";
  if (!MIGRATION.includes(CLAIM)) throw new Error("claim not found");
  MIGRATION = MIGRATION.replace(CLAIM, "SELECT q.job_id, q.requested_by FROM public.job_schedule_change_requests q WHERE q.expires_at <= now()");
}
if (process.env.NEW_MIGRATION === "skip") MIGRATION = "SELECT 1"; // RED: the function doesn't exist, so the first call fails
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = U(1), H = U(2), J1 = U(101), J2 = U(102), J3 = U(103), J4 = U(104);
const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, title text, date_needed date);
CREATE TABLE public.job_schedule_change_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, requested_by uuid, status text, expires_at timestamptz, decided_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO public.jobs VALUES ('${J1}', '${P}', 'Yard', '2026-11-02'), ('${J2}', '${P}', 'Porch', '2026-11-02'), ('${J3}', '${P}', 'Later', '2026-12-01'), ('${J4}', '${P}', 'Done', '2026-11-02');
INSERT INTO public.job_schedule_change_requests (job_id, requested_by, status, expires_at) VALUES
  ('${J1}', '${P}', 'pending', now() - interval '1 hour'),
  ('${J2}', '${H}', 'pending', now() - interval '1 minute'),
  ('${J3}', '${P}', 'pending', now() + interval '1 day'),
  ('${J4}', '${P}', 'declined', now() - interval '1 day');
`);
for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${JSON.stringify(got)})`);
  if (!ok) failures++;
};
const sweep = async () => (await db.query(`SELECT public.expire_unanswered_schedule_changes() n`)).rows[0].n;
const notes = async () => (await db.query(`SELECT user_id, link FROM public.notifications ORDER BY link`)).rows;
const status = async (j) => (await db.query(`SELECT status FROM public.job_schedule_change_requests WHERE job_id='${j}'`)).rows[0].status;

check("E1 two lapsed requests swept", await sweep(), 2);
check("E1 they are expired", [await status(J1), await status(J2)], ["expired", "expired"]);
check("E1 + E4 each asker told once, on their own side", await notes(), [
  { user_id: H, link: `/jobs?job=${J2}` }, { user_id: P, link: `/posts?job=${J1}` },
]);
const msg = (await db.query(`SELECT message FROM public.notifications WHERE job_id='${J1}'`)).rows[0]?.message;
check("E1 the words name the job and the outcome", msg, 'Nobody answered your request to move "Yard" before it started, so the job stays at its original time.');
check("E2 a second run sends nothing", [await sweep(), (await notes()).length], [0, 2]);
check("E3 inside its time and answered rows are untouched", [await status(J3), await status(J4)], ["pending", "declined"]);
const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname='expire_unanswered_schedule_changes'`)).rows[0].a;
check("E5 service_role only", [/service_role=X/.test(acl), /authenticated=X/.test(acl), /anon=X/.test(acl), /(^|[{,])=X/.test(acl)], [true, false, false, false]);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
