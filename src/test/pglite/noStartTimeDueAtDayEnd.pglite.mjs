#!/usr/bin/env node
/**
 * PGlite proof for 20261102100421_no_start_time_job_is_due_at_the_end_of_its_day (Q2588, server half).
 *
 *   npx tsx src/test/pglite/noStartTimeDueAtDayEnd.pglite.mjs            # the migration, applied 3x
 *   npx tsx src/test/pglite/noStartTimeDueAtDayEnd.pglite.mjs --before   # the bodies before it: RED checks FAIL
 *   PLANT=<name> npx tsx src/test/pglite/noStartTimeDueAtDayEnd.pglite.mjs   # a planted defect: its checks FAIL
 *
 * The rule (src/lib/anyTimeThatDay.ts): a job with no start time is "any time that day"; it is never late on its day,
 * and jobIsOverdue turns it overdue at the NEXT Central midnight. Before this migration auto_start_due_jobs started it
 * at the midnight that STARTS its day (and notify_poster_on_status_change told the poster "Start time passed"), and
 * report_helper_no_show / rpc_poster_report_member_no_show let the poster strike the Helpr from 12:00 AM.
 *
 * The functions are the real ones (the migration's text, every clock read pointed at a fixed instant by
 * ./lib/fixedClock.mjs); notify_poster_on_status_change is the newest body in the repo, on its real trigger. Supabase's
 * default grant (EXECUTE on every new function to anon and authenticated) is emulated with ALTER DEFAULT PRIVILEGES,
 * so the grants checked are what the migration's own REVOKE/GRANT leave.
 *
 * Plants (each must turn at least one check red):
 *   midnight_autostart   auto_start_due_jobs reads a NULL start_time as its day's 00:00 again
 *   midnight_report      report_helper_no_show's gate reads it as 00:00 again
 *   midnight_crew        rpc_poster_report_member_no_show's gate reads it as 00:00 again
 *   timed_shift          a job WITH a start time is pushed a day too
 *   anon_grant           the REVOKE ... FROM PUBLIC, anon lines are dropped
 *   midnight_ontime      get_helper_on_time_percents reads a NULL start_time as its day's 00:00 again
 *   utc_ontime           get_helper_on_time_percents reads the arrival in the session's zone (UTC) again
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102100421_no_start_time_job_is_due_at_the_end_of_its_day.sql";
const BEFORE = process.argv.includes("--before");
const PLANT = process.env.PLANT ?? "";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const DUE_NEW = (d, t) => `(CASE WHEN ${t} IS NULL THEN (${d} + 1) + '00:00'::time ELSE ${d} + ${t} END)`;
const DUE_OLD = (d, t) => `(${d} + COALESCE(${t}, '00:00'::time))`;
function plant(sql, from, to) {
  if (!sql.includes(from)) throw new Error(`PLANT=${PLANT}: "${from.slice(0, 60)}" not found in ${THIS}`);
  return sql.split(from).join(to);
}

let migration;
if (BEFORE) {
  const defs = effectiveDefs(DIR, { before: THIS });
  migration = ["auto_start_due_jobs", "report_helper_no_show", "rpc_poster_report_member_no_show", "get_helper_on_time_percents"].map((n) => {
    const d = defs.get(n);
    if (!d) throw new Error(`no migration before ${THIS} defines ${n}`);
    return d.stmt.trimEnd().endsWith(";") ? d.stmt : `${d.stmt};`;
  }).join("\n\n");
  console.log("--before: the bodies before the migration (RED checks expected to FAIL)");
} else {
  migration = readFileSync(DIR + THIS, "utf8");
  if (PLANT === "midnight_autostart") migration = plant(migration, DUE_NEW("j.date_needed", "j.start_time"), DUE_OLD("j.date_needed", "j.start_time"));
  else if (PLANT === "midnight_report") migration = plant(migration, DUE_NEW("v_date_needed", "v_start_time"), DUE_OLD("v_date_needed", "v_start_time"));
  else if (PLANT === "midnight_crew") migration = plant(migration, DUE_NEW("v_job.date_needed", "v_job.start_time"), DUE_OLD("v_job.date_needed", "v_job.start_time"));
  else if (PLANT === "timed_shift") migration = plant(migration, "ELSE j.date_needed + j.start_time END", "ELSE j.date_needed + 1 + j.start_time END");
  else if (PLANT === "midnight_ontime") migration = plant(migration, "WHEN any_time THEN arrived_local < scheduled_start", "WHEN any_time THEN arrived_local - (scheduled_start - interval '1 day') <= INTERVAL '10 minutes'");
  else if (PLANT === "utc_ontime") migration = plant(migration, "helper_arrived_at AT TIME ZONE 'America/Chicago' AS arrived_local", "helper_arrived_at::timestamp AS arrived_local");
  else if (PLANT === "anon_grant") migration = migration.replace(/^REVOKE ALL ON FUNCTION .*$/gm, "");
  else if (PLANT) throw new Error(`unknown PLANT=${PLANT}`);
  if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);
}

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), HELPR = U(2), M1 = U(3), STRANGER = U(4), JOB = U(100), CREW = U(101);

const db = new PGlite();
const q = async (sql, p) => (await db.query(sql, p)).rows;
await db.exec(`
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
-- Supabase's default: every new function in public is executable by anon and authenticated.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text DEFAULT 'Rake the yard',
  status public.job_status, payment_status text DEFAULT 'escrowed', is_group_job boolean DEFAULT false, helpers_needed int DEFAULT 1,
  is_flexible_schedule boolean DEFAULT false, date_needed date, start_time time,
  helper_confirmed_at timestamptz, helper_arrived_at timestamptz, helper_completed_at timestamptz, helper_arrival_near_miss_at timestamptz,
  poster_confirmed_arrival_at timestamptz, helper_on_the_way_at timestamptz, proof_after_urls text[],
  response_deadline timestamptz, helper_dayof_confirmed_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
  dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz, is_seed boolean DEFAULT false);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid,
  helper_confirmed_at timestamptz, helper_completed_at timestamptz, helper_arrived_at timestamptz, helper_arrival_near_miss_at timestamptz);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, closed_reason text);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid,
  description text, reported_by uuid);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text NOT NULL, message text NOT NULL,
  type text, link text, job_id uuid, read boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid, transit_updates boolean, work_status boolean);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
CREATE FUNCTION public.log_notification(uuid, text, text, text, text, uuid, text DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
CREATE FUNCTION public.is_test_member(uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
CREATE FUNCTION public.member_display_name(text, text) RETURNS text LANGUAGE sql AS $f$ SELECT COALESCE($1, $2) $f$;
-- STUB: the ladder writes the row it is asked for; its rungs are not under test here.
CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid,
  p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
  p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE sql AS
  $f$ INSERT INTO public.user_violations (user_id, violation_type, job_id, description) VALUES (p_user, p_violation_type, p_job_id, p_description)
      RETURNING jsonb_build_object('action', 'warning', 'prior_count', p_prior_count) $f$;
INSERT INTO public.profiles VALUES ('${HELPR}', 'Eli H.');
`);
await installClock(db);
// The poster's in_progress notice, newest body, on its trigger (the "Start time passed" sender).
const notify = newestFunction("notify_poster_on_status_change");
await db.exec(onFixedClock(notify.stmt));
await db.exec(`CREATE TRIGGER trg_notify_poster_status AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_poster_on_status_change();`);
for (let i = 0; i < (BEFORE ? 1 : 3); i++) await db.exec(onFixedClock(migration)); // replay-safe: applies 3x

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
/** The UTC instant of Central wall-clock `date time`. */
async function centralAt(date, time) {
  return new Date((await q(`SELECT ($1::date + $2::time) AT TIME ZONE 'America/Chicago' AS t`, [date, time]))[0].t).getTime();
}
const nextDay = (date) => new Date(Date.parse(`${date}T12:00:00Z`) + DAY).toISOString().slice(0, 10);

async function reset() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
    DELETE FROM public.jobs; DELETE FROM public.group_job_helpers; DELETE FROM public.applications;
    DELETE FROM public.user_violations; DELETE FROM public.notifications;`);
}
async function booked(date, time, over = {}) {
  await q(`INSERT INTO public.jobs (id, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, is_group_job)
           VALUES ($1, $2, $3, 'accepted', $4::date, $5::time, '2026-01-01T00:00:00Z', $6)`,
    [over.id ?? JOB, POSTER, over.crew ? null : HELPR, date, time, !!over.crew]);
  if (!over.crew) await q(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ($1, $2, 'accepted')`, [JOB, HELPR]);
}
/** Run auto_start_due_jobs at `nowMs` on a single booked job; did it start, and was the poster told "Start time passed"? */
async function autoStart(date, time, nowMs) {
  await reset();
  await booked(date, time);
  await setClock(db, iso(nowMs));
  await db.exec(`SELECT public.auto_start_due_jobs()`);
  const started = (await q(`SELECT status FROM public.jobs`))[0].status === "in_progress";
  const told = (await q(`SELECT count(*)::int AS n FROM public.notifications WHERE title = 'Start time passed'`))[0].n > 0;
  return { started, told };
}
/** The poster's report_helper_no_show at `nowMs`: { ok, error, hint }. */
async function report(date, time, nowMs) {
  await reset();
  await booked(date, time);
  await setClock(db, iso(nowMs));
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${POSTER}', false); SET ROLE authenticated;`);
  try {
    await db.query(`SELECT public.report_helper_no_show($1)`, [JOB]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message, hint: e.hint ?? "" };
  } finally {
    await db.exec(`RESET ROLE;`);
  }
}
/** The poster's crew-member report at `nowMs` for a member not on the roster: the refusal names the first gate that held. */
async function crewReport(date, time, nowMs) {
  await reset();
  await booked(date, time, { crew: true, id: CREW });
  await setClock(db, iso(nowMs));
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${POSTER}', false); SET ROLE authenticated;`);
  try {
    await db.query(`SELECT public.rpc_poster_report_member_no_show($1, $2)`, [CREW, M1]);
    return { error: "" };
  } catch (e) {
    return { error: e.message, hint: e.hint ?? "" };
  } finally {
    await db.exec(`RESET ROLE;`);
  }
}

// ---- auto_start_due_jobs -------------------------------------------------------------------------------------------
const D = "2026-11-04"; // an ordinary CST Wednesday
const dayStart = await centralAt(D, "00:00"), dayEnd = await centralAt(nextDay(D), "00:00");
{
  const r = await autoStart(D, null, dayStart);
  check("RED no start time: NOT started at 12:00 AM on its day", !r.started);
  check("RED no start time: the poster is NOT told \"Start time passed\" at 12:00 AM", !r.told);
}
check("RED no start time: not started at 8:00 AM on its day", !(await autoStart(D, null, await centralAt(D, "08:00"))).started);
check("RED no start time: not started 1 ms before the day is over", !(await autoStart(D, null, dayEnd - 1)).started);
{
  const r = await autoStart(D, null, dayEnd);
  check("no start time: started when the day is over (the next Central midnight, jobIsOverdue's instant)", r.started);
  check("no start time: the day-over start tells the poster the Helpr hasn't checked in", r.told);
}
check("RED no start time: the 7-day backstop counts from the day's end (1 ms inside: started)", (await autoStart(D, null, dayEnd + 7 * DAY - 1)).started);
check("no start time: 7 days after the day's end, not retro-started", !(await autoStart(D, null, dayEnd + 7 * DAY)).started);
// DST: the day before fall-back ends 2026-11-01 00:00 CDT (05:00Z); fall-back day itself is 25 hours, ending 11-02 00:00 CST (06:00Z);
// spring-forward day (23 hours) ends 03-09 00:00 CDT (05:00Z).
for (const [date, endUtc] of [["2026-10-31", Date.UTC(2026, 10, 1, 5)], ["2026-11-01", Date.UTC(2026, 10, 2, 6)], ["2026-03-08", Date.UTC(2026, 2, 9, 5)]]) {
  check(`RED no start time ${date}: not started 1 ms before its Central day is over`, !(await autoStart(date, null, endUtc - 1)).started);
  check(`no start time ${date}: started at its Central day's end (${iso(endUtc)})`, (await autoStart(date, null, endUtc)).started);
}
{
  const start = await centralAt(D, "09:00");
  check("a timed job is unchanged: not started 1 ms before its start", !(await autoStart(D, "09:00", start - 1)).started);
  check("a timed job is unchanged: started at its start", (await autoStart(D, "09:00", start)).started);
  check("a timed job is unchanged: still started 6 days 23 h later (inside the backstop)", (await autoStart(D, "09:00", start + 7 * DAY - HOUR)).started);
}

// ---- report_helper_no_show -----------------------------------------------------------------------------------------
{
  const early = await report(D, null, dayStart + MIN);
  check("RED no start time: the poster can't report a no-show at 12:01 AM on its day", !early.ok && /job_not_started/.test(early.error), early.error);
  check("no start time: the refusal says it's any time that day", /any time that day/.test(early.hint), early.hint);
  const late = await report(D, null, dayEnd - MIN);
  check("RED no start time: still refused at 11:59 PM on its day", !late.ok && /job_not_started/.test(late.error), late.error);
  const over = await report(D, null, dayEnd);
  check("no start time: allowed once the day is over", over.ok, over.error);
  const struck = (await q(`SELECT count(*)::int AS n FROM public.user_violations WHERE violation_type = 'no_show'`))[0].n;
  check("no start time: the day-over report strikes once and reopens the job", struck === 1 && (await q(`SELECT status FROM public.jobs`))[0].status === "open");
  const start = await centralAt(D, "09:00");
  const timedEarly = await report(D, "09:00", start - MIN);
  check("a timed job is unchanged: refused 1 min before its start, with the start-time hint",
    !timedEarly.ok && /job_not_started/.test(timedEarly.error) && /scheduled start time/.test(timedEarly.hint), timedEarly.hint);
  check("a timed job is unchanged: allowed at its start", (await report(D, "09:00", start)).ok);
}

// ---- rpc_poster_report_member_no_show ------------------------------------------------------------------------------
{
  const early = await crewReport(D, null, dayStart + MIN);
  check("RED no start time crew: a member can't be reported at 12:01 AM on its day", /job_not_started/.test(early.error), early.error);
  check("no start time crew: the refusal says it's any time that day", /any time that day/.test(early.hint ?? ""), early.hint);
  check("RED no start time crew: still refused at 11:59 PM", /job_not_started/.test((await crewReport(D, null, dayEnd - MIN)).error));
  const over = await crewReport(D, null, dayEnd);
  check("no start time crew: past the day the time gate lets it through (next gate: not_on_this_crew)", /not_on_this_crew/.test(over.error), over.error);
  const start = await centralAt(D, "09:00");
  check("a timed crew is unchanged: refused before its start", /job_not_started/.test((await crewReport(D, "09:00", start - MIN)).error));
  check("a timed crew is unchanged: past the time gate at its start", /not_on_this_crew/.test((await crewReport(D, "09:00", start)).error));
}

// ---- get_helper_on_time_percents (the on-time % a poster sees on an applicant, once the Helpr has the minimum count of completed jobs it asks for) ----------------
/** The Helpr's on-time % over five completed jobs on day D, arrived at the given Central times (session zone UTC, as prod). */
async function onTime(time, arrivals) {
  await reset();
  for (const [i, at] of arrivals.entries()) {
    await q(`INSERT INTO public.jobs (id, customer_id, helper_id, status, date_needed, start_time, helper_arrived_at)
             VALUES ($1, $2, $3, 'completed', $4::date, $5::time, $6::timestamptz)`, [U(200 + i), POSTER, HELPR, D, time, iso(await centralAt(D, at))]);
  }
  const row = (await q(`SELECT on_time_percent FROM public.get_helper_on_time_percents(ARRAY[$1]::uuid[])`, [HELPR]))[0];
  return row ? Number(row.on_time_percent) : null;
}
{
  const anyTime = await onTime(null, ["08:00", "11:30", "14:00", "17:45", "23:50"]);
  check("RED no start time: arrivals any time on its day all count as on time (100%)", anyTime === 100, String(anyTime));
  const timed = await onTime("09:00", ["08:55", "09:00", "09:05", "09:10", "09:40"]);
  check("RED a 9:00 AM job: arrivals up to 9:10 AM Central are on time, 9:40 is late (80%)", timed === 80, String(timed));
}

// ---- grants: what the migration's own REVOKE/GRANT leave over Supabase's default ------------------------------------
if (!BEFORE) {
  const acl = (await q(`SELECT
      has_function_privilege('anon', 'public.auto_start_due_jobs()', 'EXECUTE') AS a_anon,
      has_function_privilege('authenticated', 'public.auto_start_due_jobs()', 'EXECUTE') AS a_auth,
      has_function_privilege('service_role', 'public.auto_start_due_jobs()', 'EXECUTE') AS a_svc,
      has_function_privilege('anon', 'public.report_helper_no_show(uuid)', 'EXECUTE') AS r_anon,
      has_function_privilege('authenticated', 'public.report_helper_no_show(uuid)', 'EXECUTE') AS r_auth,
      has_function_privilege('anon', 'public.rpc_poster_report_member_no_show(uuid, uuid)', 'EXECUTE') AS m_anon,
      has_function_privilege('authenticated', 'public.rpc_poster_report_member_no_show(uuid, uuid)', 'EXECUTE') AS m_auth,
      has_function_privilege('anon', 'public.get_helper_on_time_percents(uuid[])', 'EXECUTE') AS o_anon,
      has_function_privilege('authenticated', 'public.get_helper_on_time_percents(uuid[])', 'EXECUTE') AS o_auth`))[0];
  check("auto_start_due_jobs: anon and authenticated can't run it; service_role can", !acl.a_anon && !acl.a_auth && acl.a_svc, JSON.stringify(acl));
  check("the two report RPCs and the on-time %: anon can't run them; a signed-in member can",
    !acl.r_anon && !acl.m_anon && !acl.o_anon && acl.r_auth && acl.m_auth && acl.o_auth, JSON.stringify(acl));
  // Only the poster: a stranger past the day is refused before anything changes.
  await reset();
  await booked(D, null);
  await setClock(db, iso(dayEnd + HOUR));
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${STRANGER}', false); SET ROLE authenticated;`);
  let refused = false;
  try { await db.query(`SELECT public.report_helper_no_show($1)`, [JOB]); } catch (e) { refused = /not_authorized/.test(e.message); }
  await db.exec(`RESET ROLE;`);
  check("a stranger can't report the no-show (not_authorized), nothing written",
    refused && (await q(`SELECT count(*)::int AS n FROM public.user_violations`))[0].n === 0);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
