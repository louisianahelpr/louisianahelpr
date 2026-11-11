#!/usr/bin/env node
/**
 * PGlite proof for 20261111202421_no_show_report_opens_30_minutes_after_start (F284, owner 11-11).
 *
 *   node src/test/pglite/noShowOpensAfter30Minutes.pglite.mjs                    # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/noShowOpensAfter30Minutes.pglite.mjs # RED (20261108202000's body)
 *   MUTANT=<name> node src/test/pglite/noShowOpensAfter30Minutes.pglite.mjs      # a planted defect: must FAIL
 *
 * The real report_helper_no_show (the migration's text, every clock read pointed at a fixed instant by
 * ./lib/fixedClock.mjs) on noShowNoticeServerSide.pglite.mjs's minimal schema.
 *   O1 a 9:00 AM job is refused at its start and at 9:29:59 (RED before: allowed from 9:00)
 *   O2 the refusal names the open time, "You can report a no-show from 9:30 AM, 30 minutes after the start time."
 *   O3 from 9:30 AM it is allowed: one strike, the job reopens
 *   O4 asked on an earlier day, the hint names the day too ("Wed, Nov 11 at 9:30 AM")
 *   O5 a job with no start time is unchanged: refused at 11:59 PM on its day, allowed at its day's end
 *   O6 a non-poster is still refused first (not_authorized), whatever the time
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { installClock, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const THIS = "20261111202421_no_show_report_opens_30_minutes_after_start.sql";
const BEFORE = "20261108202000_no_show_notice_server_side.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The wait is dropped: open at the start again.
  noWait: ["ELSE interval '30 minutes' END;", "ELSE interval '0 minutes' END;"],
  // The wait is 15 minutes, not 30.
  shortWait: ["ELSE interval '30 minutes' END;", "ELSE interval '15 minutes' END;"],
  // The hint names the start, not the open time.
  hintStart: ["THEN to_char(v_opens_at AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM')", "THEN to_char(v_starts_at AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM')"],
  // A no-time job gets the 30 minutes too (its day's end + 30).
  noTimeShift: ["CASE WHEN v_start_time IS NULL THEN interval '0 minutes'", "CASE WHEN v_start_time IS NULL THEN interval '30 minutes'"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

const cutFn = (sql, name) => {
  const m = [...sql.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, "g"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const start = m.index + open.index + open[0].length;
  return sql.slice(m.index, sql.indexOf(open[1], start) + open[1].length) + ";";
};
const P = "00000000-0000-0000-0000-00000000000a", A = "00000000-0000-0000-0000-00000000000b", X = "00000000-0000-0000-0000-00000000000e";
const J = "00000000-0000-0000-0000-0000000000f1";

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create table public.jobs (id uuid primary key, customer_id uuid, helper_id uuid, title text, payment_status text, date_needed date, start_time time,
  helper_arrived_at timestamptz, helper_completed_at timestamptz, helper_arrival_near_miss_at timestamptz, helper_confirmed_at timestamptz, status text,
  response_deadline timestamptz, helper_dayof_confirmed_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
  dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz, parent_job_id uuid);
create table public.applications (id serial primary key, job_id uuid, helper_id uuid, status text, closed_reason text);
create table public.user_violations (id serial primary key, user_id uuid, violation_type text, description text, job_id uuid, action_taken text, reported_by uuid);
create function public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid, p_prior_count integer, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean, p_suspension_days integer, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
 returns jsonb language plpgsql as $$ begin insert into public.user_violations (user_id, violation_type, description, job_id, action_taken) values (p_user,p_violation_type,p_description,p_job_id,'warning'); return jsonb_build_object('action','warning','prior_count',p_prior_count); end $$;
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null, type text, link text,
  job_id uuid, created_at timestamptz not null default now());
create function public.series_release_dates(p_parent uuid, p_helper uuid, p_dates date[], p_reason text, p_title text, p_customer uuid)
 returns date[] language sql as $$ select array[]::date[] $$;
`);
await installClock(db);
let sql = cutFn(skip ? mig(BEFORE) : mig(THIS), "report_helper_no_show");
if (MUTANT) {
  const [find, repl] = MUTANTS[MUTANT];
  if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
  sql = sql.split(find).join(repl);
}
// Applied 3x (CREATE OR REPLACE is idempotent).
for (let i = 0; i < 3; i++) await db.exec(onFixedClock(sql));
console.log(skip ? `NEW_MIGRATION=skip: ${BEFORE}'s report_helper_no_show` : "migration's report_helper_no_show applied 3x");

let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`); if (!cond) failed++; };
const rows = async (q) => (await db.query(q)).rows;
const D = "2026-11-12"; // a Thursday, CST (UTC-6)
const at = (h, m = 0, s = 0, day = 12) => new Date(Date.UTC(2026, 10, day, h + 6, m, s)).toISOString();
const seed = (start) => db.exec(`
  delete from public.notifications; delete from public.applications; delete from public.user_violations; delete from public.jobs;
  insert into public.jobs (id, customer_id, helper_id, title, payment_status, date_needed, start_time, helper_confirmed_at, status)
    values ('${J}','${P}','${A}','Mow and Weed Eat','escrow','${D}',${start ? `'${start}'` : "null"}, '2026-11-01T00:00:00Z','in_progress');
  insert into public.applications (job_id, helper_id, status) values ('${J}','${A}','accepted');`);
const report = async (start, iso, uid = P) => {
  await seed(start);
  await setClock(db, iso);
  await db.exec(`select set_config('test.uid','${uid}',false)`);
  try { await db.query(`select public.report_helper_no_show('${J}')`); return { ok: true, error: "", hint: "" }; }
  catch (e) { return { ok: false, error: e.message, hint: e.hint ?? "" }; }
};

// O1 / O2
{
  const atStart = await report("09:00", at(9));
  ok("O1 RED a 9:00 AM job is refused AT its start", !atStart.ok && /job_not_started/.test(atStart.error), JSON.stringify(atStart));
  const justBefore = await report("09:00", at(9, 29, 59));
  ok("O1 RED still refused at 9:29:59 AM", !justBefore.ok && /job_not_started/.test(justBefore.error), JSON.stringify(justBefore));
  ok("O2 RED the refusal names the open time", justBefore.hint === "You can report a no-show from 9:30 AM, 30 minutes after the start time.", justBefore.hint);
  ok("O1 nothing was written on a refusal", (await rows(`select count(*)::int n from public.user_violations`))[0].n === 0 && (await rows(`select status from public.jobs`))[0].status === "in_progress");
}
// O3
{
  const open = await report("09:00", at(9, 30));
  ok("O3 allowed from 9:30 AM", open.ok, JSON.stringify(open));
  ok("O3 one strike, the job reopens", (await rows(`select count(*)::int n from public.user_violations where violation_type='no_show'`))[0].n === 1
    && (await rows(`select status, helper_id from public.jobs`))[0].status === "open");
  const pm = await report("13:45", at(14, 14));
  ok("O2 RED a 1:45 PM job's hint says 2:15 PM", pm.hint === "You can report a no-show from 2:15 PM, 30 minutes after the start time.", pm.hint);
  ok("O3 a 1:45 PM job is allowed at 2:15 PM", (await report("13:45", at(14, 15))).ok);
}
// O4
{
  const dayBefore = await report("09:00", at(20, 0, 0, 11));
  ok("O4 RED asked the day before, the hint names the day", dayBefore.hint === "You can report a no-show from Thu, Nov 12 at 9:30 AM, 30 minutes after the start time.", dayBefore.hint);
}
// O5
{
  const late = await report(null, at(23, 59));
  ok("O5 no start time: refused at 11:59 PM on its day, its old hint", !late.ok && /any time that day/.test(late.hint), JSON.stringify(late));
  const over = await report(null, at(0, 0, 0, 13));
  ok("O5 no start time: allowed at its day's end (unchanged, no 30 minutes)", over.ok, JSON.stringify(over));
}
// O6
{
  const stranger = await report("09:00", at(10), X);
  ok("O6 a non-poster is refused first", !stranger.ok && /not_authorized/.test(stranger.error), JSON.stringify(stranger));
}

console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
process.exit(failed ? 1 : 0);
