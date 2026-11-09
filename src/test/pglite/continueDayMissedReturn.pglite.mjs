#!/usr/bin/env node
/**
 * PGlite proof for 20261108214605_continue_day_missed_return (owner decision #4, 11-08; Jobs audit 11-08 #4).
 *
 *   npx tsx src/test/pglite/continueDayMissedReturn.pglite.mjs                    # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/continueDayMissedReturn.pglite.mjs # RED (no way out: the old state)
 *   MUTANT=<name> npx tsx src/test/pglite/continueDayMissedReturn.pglite.mjs      # a planted defect: must FAIL
 *
 * The RPC, the triggers and admin_stalled_job_queue are THIS migration's (checked against effectiveDefs: the newest).
 *   A1 nobody signed in: refused     A2 a stranger: refused     A3 before the day lapsed: refused too_soon
 *   A4 the Helpr marked it done: refused      A5 the Helpr sends photos: refused     A6 a photo outside the folder: refused
 *   P1 the poster's "Didn't come back" (note + photos): the day closes 'lapsed', the report holds both, the event is
 *      'missed_poster', the admin queue row is escalated and unresolved (re-opened after an earlier review), the Helpr
 *      is told in-app and by email, every admin gets an alert; no money column moves
 *   P2 a second report while one is open: refused
 *   P3 a member's new continue day while the report is open: refused continue_day_missed_open; a server writer passes
 *   P4 admin_stalled_job_queue lists it, dated by the lapsed day, even when that day is today
 *   P5 "Mark Reviewed" (resolved_at) closes the report
 *   H1 the Helpr's "Can't come back" (note): 'cant_come_back', the poster is told
 *   H2 the job leaving in_progress closes the report
 *   T1 a test member on the job: the other side is still told, NO admin alert (test data never pages the owner)
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261108214605_continue_day_missed_return.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  lapse: ["AT TIME ZONE 'America/Chicago') + interval '6 hours' THEN\n    RAISE EXCEPTION 'continue_day_missed_too_soon'", "AT TIME ZONE 'America/Chicago') - interval '9 days' THEN\n    RAISE EXCEPTION 'continue_day_missed_too_soon'"],
  photo: ["OR v_photo !~ ('^' || v_uid::text || '/disputes/' || v_job.id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')", "OR false"],
  party: ["  ELSE\n    RAISE EXCEPTION 'not_a_party'", "  ELSIF false THEN\n    RAISE EXCEPTION 'not_a_party'"],
  done: ["  IF v_job.helper_completed_at IS NOT NULL THEN", "  IF false THEN"],
  queue: ["ON CONFLICT (job_id) DO UPDATE SET escalated_at = now(), resolved_at = NULL, resolved_by = NULL", "ON CONFLICT (job_id) DO UPDATE SET escalated_at = now()"],
  testskip: ["  IF NOT v_test THEN", "  IF true THEN"],
  refuse: ["  IF NEW.status IN ('proposed', 'set') AND EXISTS (\n       SELECT 1 FROM public.job_missed_returns", "  IF false AND EXISTS (\n       SELECT 1 FROM public.job_missed_returns"],
  review: ["  IF NEW.resolved_at IS NOT NULL AND OLD.resolved_at IS NULL THEN", "  IF false THEN"],
  jobchange: ["  IF NEW.status::text IS DISTINCT FROM OLD.status::text AND NEW.status::text <> 'in_progress' THEN", "  IF false THEN"],
  lapsedrow: ["AND NOT (c.status = 'set' AND c.new_date IS NOT NULL", "AND NOT (c.new_date IS NOT NULL"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

const defs = effectiveDefs(DIR);
const stmtOf = (name) => {
  const d = defs.get(name);
  if (!d) throw new Error(`no definition of ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  return d.stmt.slice(0, d.stmt.indexOf(open[1], open.index + open[0].length) + open[1].length) + ";";
};
if (!skip) {
  for (const fn of ["report_continue_day_missed", "refuse_continue_day_while_missed_open", "resolve_missed_return_on_review", "resolve_missed_return_on_job_change", "admin_stalled_job_queue"]) {
    if (!defs.get(fn)?.file.startsWith("20261108214605")) throw new Error(`the newest ${fn} is not THIS migration's`);
  }
}
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [POSTER, HELPR, STRANGER, ADMIN, TESTER] = [1, 2, 3, 4, 5].map(id);
const JOB = id(11);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('${POSTER}'), ('${HELPR}'), ('${STRANGER}'), ('${ADMIN}'), ('${TESTER}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status text, is_group_job boolean DEFAULT false,
  is_seed boolean DEFAULT false, helper_completed_at timestamptz, budget numeric DEFAULT 100, date_needed date, start_time time,
  estimated_hours numeric, payment_status text DEFAULT 'escrow');
CREATE TABLE public.job_continue_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE, proposed_by uuid, new_date date, new_start_time time,
  note text, status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'set', 'declined', 'replaced', 'finished', 'closed')),
  decided_at timestamptz, decided_by uuid, helper_confirmed_at timestamptz, closed_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.job_continue_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, continue_id uuid, actor_id uuid, action text, detail jsonb);
CREATE TABLE public.job_completion_nudges (job_id uuid PRIMARY KEY, first_sent_at timestamptz, second_sent_at timestamptz, escalated_at timestamptz,
  resolved_at timestamptz, resolved_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, title text, message text, type text, link text);
CREATE TABLE public.emails (user_id uuid, title text, type text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, is_seed boolean DEFAULT false);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.test_members (user_id uuid);
INSERT INTO public.profiles VALUES ('${POSTER}', 'Pat Poster'), ('${HELPR}', 'Yusef Helpr'), ('${TESTER}', 'Test Person');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.test_members VALUES ('${TESTER}');
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u AND x.role = r) $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.member_display_name(n text, x text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT n $$;
CREATE FUNCTION public.is_test_subject(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.test_members t WHERE t.user_id = u) $$;
CREATE FUNCTION public.send_notice_email(u uuid, t text, m text, ty text, l text, j uuid) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.emails VALUES (u, t, ty) $$;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
`);
for (const fn of ["is_server_context", "continue_day_label"]) await db.exec(stmtOf(fn));
if (!skip) {
  let sql = readFileSync(DIR + THIS, "utf8");
  if (MUTANT) {
    const [find, repl] = MUTANTS[MUTANT];
    if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
    sql = sql.replace(find, repl);
  }
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: no report RPC (the live state)");

let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`); if (!cond) failed++; };
const rows = async (q) => (await db.query(q)).rows;
const as = async (uid, q) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SELECT set_config('request.jwt.claim.role', '${uid ? "authenticated" : ""}', false);`);
  try { return { rows: (await db.query(q)).rows, err: null }; } catch (e) { return { rows: [], err: String(e.message ?? e) }; } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
  }
};
/** A solo job in progress on a SET continue day `hoursAgo` hours past its start (Central). */
const seed = async ({ hoursAgo = 30, helper = HELPR, done = false, reviewed = false } = {}) => {
  await db.exec(`
    DELETE FROM public.notifications; DELETE FROM public.emails; DELETE FROM public.job_continue_events;
    ${skip ? "" : "DELETE FROM public.job_missed_returns;"} DELETE FROM public.job_continue_days; DELETE FROM public.job_completion_nudges; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, title, customer_id, helper_id, status, helper_completed_at, date_needed, start_time)
      VALUES ('${JOB}', 'Mow and Weed Eat', '${POSTER}', '${helper}', 'in_progress', ${done ? "now()" : "NULL"}, current_date - 7, '09:00');
    INSERT INTO public.job_continue_days (job_id, proposed_by, new_date, new_start_time, status)
      SELECT '${JOB}', '${helper}', (s AT TIME ZONE 'America/Chicago')::date, (s AT TIME ZONE 'America/Chicago')::time, 'set'
        FROM (SELECT date_trunc('minute', now() - interval '${hoursAgo} hours') AS s) x;
    ${reviewed ? `INSERT INTO public.job_completion_nudges (job_id, first_sent_at, escalated_at, resolved_at, resolved_by) VALUES ('${JOB}', now() - interval '9 days', now() - interval '8 days', now() - interval '7 days', '${ADMIN}');` : ""}`);
};
const report = (uid, note = "null", photos = "'{}'::text[]") => as(uid, `SELECT public.report_continue_day_missed('${JOB}', ${note}, ${photos}) AS r`);
const photo = (uid, n = 1) => `${uid}/disputes/${JOB}/missed-${n}.jpg`;

// A1-A6 refusals.
await seed();
ok("A1 nobody signed in: refused", /not_authenticated/.test((await report(null)).err ?? ""), (await report(null)).err);
ok("A2 a stranger: refused", /not_a_party/.test((await report(STRANGER)).err ?? ""), (await report(STRANGER)).err);
await seed({ hoursAgo: 2 });
ok("A3 before the day lapsed (start + 6 h): refused too_soon", /continue_day_missed_too_soon/.test((await report(POSTER)).err ?? ""), (await report(POSTER)).err);
await seed({ done: true });
ok("A4 the Helpr marked it done: refused", /continue_day_missed_marked_done/.test((await report(POSTER)).err ?? ""), (await report(POSTER)).err);
await seed();
ok("A5 the Helpr sends photos: refused", /photos_poster_only/.test((await report(HELPR, "'x'", `ARRAY['${photo(HELPR)}']`)).err ?? ""));
ok("A6 a photo outside the poster's folder for this job: refused", /continue_day_missed_bad_photo/.test((await report(POSTER, "null", `ARRAY['${photo(HELPR)}']`)).err ?? ""));
ok("A1-A6 nothing written", skip ? false : (await rows(`SELECT 1 FROM public.job_missed_returns`)).length === 0);

// P1 the poster's report, on a job whose stuck-job row an admin had reviewed before.
await seed({ reviewed: true });
const p1 = await report(POSTER, "'Half the yard is still tall'", `ARRAY['${photo(POSTER, 1)}', '${photo(POSTER, 2)}']`);
ok("P1 the poster's 'Didn't come back' goes through", p1.err === null, p1.err);
const day = (await rows(`SELECT status, closed_at FROM public.job_continue_days`))[0];
ok("P1 the continue day closes as lapsed", day?.status === "lapsed" && !!day?.closed_at, JSON.stringify(day));
const rep = skip ? [] : await rows(`SELECT reporter_side, note, photos, reported_by, resolved_at FROM public.job_missed_returns`);
ok("P1 the report holds the side, note and photos", rep.length === 1 && rep[0].reporter_side === "poster" && rep[0].note === "Half the yard is still tall" && rep[0].photos.length === 2 && rep[0].reported_by === POSTER && rep[0].resolved_at === null, JSON.stringify(rep));
ok("P1 the event is missed_poster", (await rows(`SELECT 1 FROM public.job_continue_events WHERE action = 'missed_poster'`)).length === 1);
const nudge = (await rows(`SELECT escalated_at, resolved_at, resolved_by FROM public.job_completion_nudges`))[0];
ok("P1 the admin queue row is escalated now and unresolved (re-opened)", !!nudge && nudge.resolved_at === null && nudge.resolved_by === null && Date.now() - new Date(nudge.escalated_at).getTime() < 60_000, JSON.stringify(nudge));
const told = await rows(`SELECT user_id, title, type, link FROM public.notifications`);
ok("P1 the Helpr is told in-app", told.some((n) => n.user_id === HELPR && n.title === "Reported: didn't come back" && n.link === `/jobs?job=${JOB}`), JSON.stringify(told));
ok("P1 and by email under Job updates", (await rows(`SELECT 1 FROM public.emails WHERE user_id = '${HELPR}' AND type = 'job_updates'`)).length === 1);
ok("P1 every admin gets an alert to the stuck-job queue", told.some((n) => n.user_id === ADMIN && n.type === "admin_alert" && n.link === `/admin?view=stalled&job=${JOB}`), JSON.stringify(told));
ok("P1 no money moves: the job is still in progress, escrow", (await rows(`SELECT 1 FROM public.jobs WHERE status = 'in_progress' AND payment_status = 'escrow' AND helper_completed_at IS NULL`)).length === 1);

// P2, P3
ok("P2 a second report while one is open: refused", /already_reported/.test((await report(HELPR, "'sorry'")).err ?? ""));
const newDay = `INSERT INTO public.job_continue_days (job_id, proposed_by, new_date, new_start_time, status) VALUES ('${JOB}', '${HELPR}', current_date + 3, '09:00', 'proposed')`;
ok("P3 a member's new continue day while the report is open: refused", /continue_day_missed_open/.test((await as(HELPR, newDay)).err ?? ""));
let p3 = null;
try { await db.query(newDay); await db.query(`DELETE FROM public.job_continue_days WHERE status = 'proposed'`); } catch (e) { p3 = String(e.message ?? e); }
ok("P3 a server writer passes", p3 === null, String(p3));

// P4 the admin queue, also when the lapsed day is today.
await seed({ hoursAgo: 7 });
await db.exec(`UPDATE public.job_continue_days SET new_date = (now() AT TIME ZONE 'America/Chicago')::date, new_start_time = '00:01'`);
// Make sure the start + 6 h has passed for "today": only when it is past 6:01 AM Central.
const pastSix = (await rows(`SELECT (now() AT TIME ZONE 'America/Chicago')::time > '06:02' AS t`))[0].t;
if (!pastSix) await seed({ hoursAgo: 30 });
await report(POSTER, "'nobody came'");
const q = await as(ADMIN, `SELECT job_id, date_needed FROM public.admin_stalled_job_queue(false)`);
const want = (await rows(`SELECT new_date FROM public.job_continue_days WHERE status = 'lapsed'`))[0]?.new_date;
ok(`P4 the stuck-job queue lists it, dated by the lapsed day${pastSix ? " (today)" : ""}`, q.rows.length === 1 && String(q.rows[0].date_needed) === String(want), JSON.stringify(q));
ok("P4 a non-admin gets no rows", (await as(POSTER, `SELECT 1 FROM public.admin_stalled_job_queue(false)`)).rows.length === 0);

// P5 Mark Reviewed.
await db.exec(`UPDATE public.job_completion_nudges SET resolved_at = now(), resolved_by = '${ADMIN}'`);
ok("P5 'Mark Reviewed' closes the report", skip ? false : (await rows(`SELECT 1 FROM public.job_missed_returns WHERE resolved_at IS NOT NULL AND resolution = 'reviewed' AND resolved_by = '${ADMIN}'`)).length === 1);

// H1, H2 the Helpr.
await seed();
const h1 = await report(HELPR, "'My truck broke down'");
ok("H1 the Helpr's 'Can't come back' goes through", h1.err === null, h1.err);
ok("H1 the event is cant_come_back", (await rows(`SELECT 1 FROM public.job_continue_events WHERE action = 'cant_come_back'`)).length === 1);
ok("H1 the poster is told", (await rows(`SELECT 1 FROM public.notifications WHERE user_id = '${POSTER}' AND title = 'Your Helpr can''t come back' AND link = '/posts?job=${JOB}'`)).length === 1);
await db.exec(`UPDATE public.jobs SET status = 'completed'`);
ok("H2 the job leaving in_progress closes the report", skip ? false : (await rows(`SELECT 1 FROM public.job_missed_returns WHERE resolved_at IS NOT NULL AND resolution = 'job_completed'`)).length === 1);

// T1 a test member.
await seed({ helper: TESTER });
const t1 = await report(POSTER, "'x'");
ok("T1 a test member's job: the report goes through", t1.err === null, t1.err);
ok("T1 the other side is still told", (await rows(`SELECT 1 FROM public.notifications WHERE user_id = '${TESTER}'`)).length === 1);
ok("T1 no admin alert", (await rows(`SELECT 1 FROM public.notifications WHERE user_id = '${ADMIN}'`)).length === 0);

console.log(failed ? `\n${failed} FAILED` : "\nall PASS");
process.exit(failed ? 1 : 0);
