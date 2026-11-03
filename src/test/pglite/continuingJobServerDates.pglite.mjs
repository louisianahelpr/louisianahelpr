#!/usr/bin/env node
/**
 * PGlite proof for 20261103214229_continuing_job_admin_stalled_and_crew_no_show.sql (owner bug 11-03: a job with an
 * OPEN continue day is dated by it wherever the server decides "late").
 *
 *   node src/test/pglite/continuingJobServerDates.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/continuingJobServerDates.pglite.mjs  # RED: prod's bodies (the migration's
 *        bodies with its changes taken out; that text hashes to prod's md5(prosrc), ffb4fd34... and ff47bcf9...)
 *   MIGRATION_PATH=<planted copy> node ...                                         # RED on a planted defect
 *
 * World: stubs of jobs, job_completion_nudges, job_continue_days, group_job_helpers, notifications, user_roles,
 * has_role, log_cron_defect and auth.uid() (request GUC). The migration is applied 3x. Checks: the admin queue dates
 * an in-progress job by its open SET day (date and start time), leaves out a job whose SET day is today or ahead, ignores a closed or proposed day and a job not in
 * progress, still gives a non-admin no rows; the crew no-show sweep skips a crew with an open SET day and still asks a
 * crew with none (or with a closed one); anon and authenticated cannot run the sweep.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = process.env.MIGRATION_PATH ??
  new URL("../../../supabase/migrations/20261103214229_continuing_job_admin_stalled_and_crew_no_show.sql", import.meta.url).pathname;
const skip = process.env.NEW_MIGRATION === "skip";
let sql = readFileSync(MIG, "utf8");
if (skip) {
  console.log("NEW_MIGRATION=skip: prod's bodies (expect FAILs)");
  sql = sql
    .replace(/    -- Owner bug 11-03: a job in progress[^\n]*\n    coalesce\(c\.new_date, j\.date_needed\),\n    CASE WHEN[^\n]*\n/, "    j.date_needed,\n    j.start_time,\n")
    .replace(/  LEFT JOIN LATERAL \([\s\S]*?\) c ON true\n/, "")
    .replace(/    -- Owner bug 11-03 \(lead\)[^\n]*\n[^\n]*\n    AND NOT \(c\.new_date[^\n]*\n/, "")
    .replace(/      -- Owner bug 11-03: a crew job[^\n]*\n      AND NOT EXISTS[^\n]*\n[^\n]*\n/, "");
}

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, budget numeric,
  date_needed date, start_time time, estimated_hours numeric, status text, payment_status text,
  no_show_alert_sent_at timestamptz, is_group_job boolean DEFAULT false);
CREATE TABLE public.job_completion_nudges (job_id uuid PRIMARY KEY, first_sent_at timestamptz, second_sent_at timestamptz,
  escalated_at timestamptz, resolved_at timestamptz);
CREATE TABLE public.job_continue_days (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
  new_date date NOT NULL, new_start_time time NOT NULL, status text NOT NULL, closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_arrived_at timestamptz);
CREATE TABLE public.notifications (user_id uuid, type text, title text, message text, link text, read boolean, job_id uuid);
CREATE TABLE public.cron_defects (fn text, ref text, msg text);
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql
  AS $$ INSERT INTO public.cron_defects VALUES (a, b, c) $$;
`);
for (let i = 1; i <= 3; i++) await db.exec(sql);
ok(true, "migration applied 3x");

const ADMIN = "33333333-3333-3333-3333-333333333333";
const MEMBER = "44444444-4444-4444-4444-444444444444";
const P = "11111111-1111-1111-1111-111111111111";
const H = "22222222-2222-2222-2222-222222222222";
const id = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
await db.exec(`
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
-- Stalled queue: 1 continuing (open set day), 2 no day, 3 closed day, 4 proposed day, 5 not in progress with a set day.
INSERT INTO public.jobs (id, title, customer_id, helper_id, budget, date_needed, start_time, estimated_hours, status, payment_status) VALUES
  ('${id(1)}', 'continuing', '${P}', '${H}', 50, '2026-11-01', '09:00', 3, 'in_progress', 'paid'),
  ('${id(2)}', 'no day',     '${P}', '${H}', 50, '2026-11-01', '09:00', 3, 'in_progress', 'paid'),
  ('${id(3)}', 'closed day', '${P}', '${H}', 50, '2026-11-01', '09:00', 3, 'in_progress', 'paid'),
  ('${id(4)}', 'proposed',   '${P}', '${H}', 50, '2026-11-01', '09:00', 3, 'in_progress', 'paid'),
  ('${id(5)}', 'disputed',   '${P}', '${H}', 50, '2026-11-01', '09:00', 3, 'disputed', 'paid'),
  ('${id(6)}', 'day ahead',  '${P}', '${H}', 50, '2026-11-01', '09:00', 3, 'in_progress', 'paid'),
  ('${id(7)}', 'day today',  '${P}', '${H}', 50, '2026-11-01', '09:00', 3, 'in_progress', 'paid');
INSERT INTO public.job_completion_nudges (job_id, escalated_at) SELECT id, now() - interval '1 hour' FROM public.jobs;
INSERT INTO public.job_continue_days (job_id, new_date, new_start_time, status, closed_at) VALUES
  ('${id(1)}', ((now() AT TIME ZONE 'America/Chicago')::date - 1), '13:30', 'set', NULL),
  ('${id(6)}', ((now() AT TIME ZONE 'America/Chicago')::date + 2), '13:30', 'set', NULL),
  ('${id(7)}', ((now() AT TIME ZONE 'America/Chicago')::date), '13:30', 'set', NULL),
  ('${id(3)}', '2026-11-05', '13:30', 'closed', now()),
  ('${id(4)}', '2026-11-05', '13:30', 'proposed', NULL),
  ('${id(5)}', '2026-11-05', '13:30', 'set', NULL);
`);
const asUser = async (uid, q) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return (await db.query(q)).rows; } finally { await db.exec("RESET ROLE;"); }
};
const rows = await asUser(ADMIN, "SELECT job_id, date_needed::text d, start_time::text t FROM public.admin_stalled_job_queue(false)");
const by = Object.fromEntries(rows.map((r) => [r.job_id, r]));
const yesterday = (await db.query("SELECT ((now() AT TIME ZONE 'America/Chicago')::date - 1)::text d")).rows[0].d;
ok(rows.length === 5, "admin: the 5 rows with no open day ahead are listed", `got ${rows.length}`);
ok(by[id(1)]?.d === yesterday && by[id(1)]?.t === "13:30:00", "admin: a job whose open SET day has passed is dated by that day", JSON.stringify(by[id(1)]));
ok(!by[id(6)], "admin: a job whose open SET day is still ahead is left out (not stalled)");
ok(!by[id(7)], "admin: a job whose open SET day is today is left out (not stalled yet)");
ok(by[id(2)]?.d === "2026-11-01" && by[id(2)]?.t === "09:00:00", "admin: a job with no continue day keeps its date");
ok(by[id(3)]?.d === "2026-11-01", "admin: a closed continue day does not count", JSON.stringify(by[id(3)]));
ok(by[id(4)]?.d === "2026-11-01", "admin: a proposed (not agreed) day does not count", JSON.stringify(by[id(4)]));
ok(by[id(5)]?.d === "2026-11-01", "admin: a job not in progress keeps its date", JSON.stringify(by[id(5)]));
ok((await asUser(MEMBER, "SELECT * FROM public.admin_stalled_job_queue(true)")).length === 0, "member: no rows");

// Crew no-show sweep: three crews whose first start was 1 h ago (inside the 30 min .. 6 h window), a member not arrived.
await db.exec(`
INSERT INTO public.jobs (id, title, customer_id, date_needed, start_time, status, is_group_job)
SELECT x.id, x.t, '${P}', ((now() AT TIME ZONE 'America/Chicago') - interval '1 hour')::date,
       ((now() AT TIME ZONE 'America/Chicago') - interval '1 hour')::time, 'in_progress', true
  FROM (VALUES ('${id(11)}'::uuid, 'crew continuing'), ('${id(12)}'::uuid, 'crew plain'), ('${id(13)}'::uuid, 'crew closed day')) x(id, t);
INSERT INTO public.group_job_helpers VALUES ('${id(11)}', '${H}', NULL), ('${id(12)}', '${H}', NULL), ('${id(13)}', '${H}', NULL);
INSERT INTO public.job_continue_days (job_id, new_date, new_start_time, status, closed_at) VALUES
  ('${id(11)}', '2026-11-20', '09:00', 'set', NULL),
  ('${id(13)}', '2026-11-20', '09:00', 'closed', now());
`);
await db.query("SELECT public.sweep_no_show_alerts()");
const sent = Object.fromEntries((await db.query("SELECT id, no_show_alert_sent_at IS NOT NULL s FROM public.jobs WHERE is_group_job")).rows.map((r) => [r.id, r.s]));
const notes = async (j) => Number((await db.query(`SELECT count(*)::int n FROM public.notifications WHERE job_id = '${j}'`)).rows[0].n);
ok(!sent[id(11)] && (await notes(id(11))) === 0, "sweep: a crew with an open SET continue day is not asked", `sent=${sent[id(11)]} notes=${await notes(id(11))}`);
ok(sent[id(12)] && (await notes(id(12))) === 2, "sweep: a crew with no continue day is still asked (poster + member)");
ok(sent[id(13)] && (await notes(id(13))) === 2, "sweep: a closed continue day does not hold the alert");
ok((await db.query("SELECT count(*)::int n FROM public.cron_defects")).rows[0].n === 0, "sweep: no cron defects");

const canRun = async (role) => {
  await db.exec(`SET ROLE ${role};`);
  try { await db.query("SELECT public.sweep_no_show_alerts()"); return true; } catch { return false; } finally { await db.exec("RESET ROLE;"); }
};
ok(!(await canRun("anon")) && !(await canRun("authenticated")), "sweep: anon and authenticated cannot run it");
ok(!(await (async () => { await db.exec("SET ROLE anon;"); try { await db.query("SELECT * FROM public.admin_stalled_job_queue(false)"); return true; } catch { return false; } finally { await db.exec("RESET ROLE;"); } })()), "queue: anon cannot run it");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
