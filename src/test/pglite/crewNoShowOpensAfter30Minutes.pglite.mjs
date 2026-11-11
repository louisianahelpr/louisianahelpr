#!/usr/bin/env node
/**
 * PGlite proof for 20261111214523_crew_no_show_opens_30_minutes_after_start (F284, owner 11-11 ~2:10 PM): a poster may
 * report a CREW member as a no-show only from 30 minutes after a timed job's start, as the one-Helpr report.
 *
 *   node src/test/pglite/crewNoShowOpensAfter30Minutes.pglite.mjs                  # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/crewNoShowOpensAfter30Minutes.pglite.mjs  # RED (20261102100421's body)
 *   MUTANT=<name> node src/test/pglite/crewNoShowOpensAfter30Minutes.pglite.mjs     # a planted defect: must FAIL
 *
 * The REAL rpc_poster_report_member_no_show (the newest migration body, applied 3x) and the REAL apply_consequence_ladder.
 *   C1 a 9:00 AM crew job at 9:29 AM: refused job_not_started, the hint names 9:30 AM
 *   C2 at 9:30 AM sharp: the report succeeds (the member's spot closes, one strike)
 *   C3 a job with no start time keeps its rule: refused on its day, allowed after the day
 *   C4 another day's job: the hint names the day and the time
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const THIS = "20261111214523_crew_no_show_opens_30_minutes_after_start.sql";
const BEFORE = "20261102100421_no_start_time_job_is_due_at_the_end_of_its_day.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The wait is dropped: the report opens at the start again.
  noWait: ["ELSE interval '30 minutes' END;", "ELSE interval '0 minutes' END;"],
  // The guard compares against the start, not the opening instant.
  guardOnStart: ["IF v_starts_at IS NULL OR v_now < v_opens_at THEN", "IF v_starts_at IS NULL OR v_now < v_starts_at THEN"],
  // The hint loses the clock time.
  hintNoTime: ["ELSE 'You can report a no-show from '", "ELSE 'Wait until '"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

function cutFn(file, name) {
  const sql = readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8");
  const a = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
  if (a < 0) throw new Error(`${name} not in ${file}`);
  const b = sql.indexOf("$function$;", a) + "$function$;".length;
  return sql.slice(a, b);
}
if (!skip && newestFunction("rpc_poster_report_member_no_show").file !== THIS) {
  throw new Error(`rpc_poster_report_member_no_show's newest definition is not ${THIS}`);
}
let body = cutFn(skip ? BEFORE : THIS, "rpc_poster_report_member_no_show");
if (MUTANTS[MUTANT]) {
  const [find, repl] = MUTANTS[MUTANT];
  if (!body.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
  body = body.split(find).join(repl);
}

const P = "00000000-0000-0000-0000-00000000000a";
const M = (n) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
const J = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create table public.jobs (id uuid primary key, customer_id uuid, title text, payment_status text, date_needed date, start_time time,
  is_group_job boolean, status text, helpers_needed int, helper_completed_at timestamptz);
create table public.group_job_helpers (id serial primary key, job_id uuid, helper_id uuid, helper_confirmed_at timestamptz,
  helper_completed_at timestamptz, helper_arrived_at timestamptz, poster_confirmed_arrival_at timestamptz, helper_arrival_near_miss_at timestamptz);
create table public.applications (id serial primary key, job_id uuid, helper_id uuid, status text, closed_reason text);
create table public.user_violations (id serial primary key, user_id uuid, violation_type text, description text, job_id uuid, action_taken text,
  reported_by uuid, created_at timestamptz default now());
create table public.profiles (user_id uuid primary key, full_name text, email text, ban_status text, auto_suspended_until timestamptz);
create table public.user_bans (user_id uuid, ban_type text, reason text, banned_by uuid);
create table public.user_roles (user_id uuid, role text);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null, type text, link text,
  job_id uuid, read boolean default false, created_at timestamptz not null default now());
create function public.crew_completes_when_hired_done() returns boolean language sql as $$ select false $$;
`);
await installClock(db);
await db.exec(newestFunction("apply_consequence_ladder").stmt);
for (let i = 0; i < 3; i++) await db.exec(onFixedClock(body));
console.log(skip ? `NEW_MIGRATION=skip: ${BEFORE}'s body` : `${THIS}'s rpc_poster_report_member_no_show applied 3x`);

let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`); if (!cond) failed++; };
async function seed(n, date, time) {
  await db.exec(`
    insert into public.profiles (user_id, full_name) values ('${M(n)}', 'Member ${n}') on conflict do nothing;
    insert into public.jobs (id, customer_id, title, payment_status, date_needed, start_time, is_group_job, status, helpers_needed)
      values ('${J(n)}','${P}','Move a couch','escrow','${date}',${time ? `'${time}'` : "null"},true,'in_progress',2);
    insert into public.group_job_helpers (job_id, helper_id, helper_confirmed_at) values ('${J(n)}','${M(n)}','2026-11-10T00:00:00Z');
    insert into public.applications (job_id, helper_id, status) values ('${J(n)}','${M(n)}','accepted');`);
}
async function report(n) {
  await db.exec(`select set_config('test.uid','${P}',false)`);
  try { await db.query(`select public.rpc_poster_report_member_no_show('${J(n)}','${M(n)}')`); return { ok: true }; }
  catch (e) { return { ok: false, msg: e.message, hint: e.hint ?? "" }; }
}

await seed(1, "2026-11-12", "09:00");
await setClock(db, "2026-11-12T15:29:00Z"); // 9:29 AM Central
let r = await report(1);
ok("C1 9:29 AM on a 9:00 AM crew job: refused job_not_started", !r.ok && /job_not_started/.test(r.msg), JSON.stringify(r));
ok("C1 the hint names 9:30 AM", /You can report a no-show from 9:30 AM, 30 minutes after the start time\./.test(r.hint ?? ""), r.hint);

await setClock(db, "2026-11-12T15:30:00Z"); // 9:30 AM sharp
r = await report(1);
ok("C2 at 9:30 AM the report succeeds", r.ok, JSON.stringify(r));
const gone = (await db.query(`select count(*)::int n from public.group_job_helpers where job_id = '${J(1)}'`)).rows[0].n;
const strikes = (await db.query(`select count(*)::int n from public.user_violations where job_id = '${J(1)}' and violation_type = 'no_show'`)).rows[0].n;
ok("C2 the spot closed and one strike was recorded", gone === 0 && strikes === 1, `slots=${gone} strikes=${strikes}`);

await seed(2, "2026-11-12", null);
await setClock(db, "2026-11-12T23:00:00Z"); // 5 PM on the day
r = await report(2);
ok("C3 a no-time job on its day: refused (the day's end rule)", !r.ok && /job_not_started/.test(r.msg) && /once the day is over/.test(r.hint ?? ""), JSON.stringify(r));
await setClock(db, "2026-11-13T06:01:00Z"); // 12:01 AM the next day
r = await report(2);
ok("C3 after the day: allowed", r.ok, JSON.stringify(r));

await seed(3, "2026-11-14", "09:00");
await setClock(db, "2026-11-12T15:00:00Z");
r = await report(3);
ok("C4 another day's job: the hint names the day and time", /You can report a no-show from Sat, Nov 14 at 9:30 AM/.test(r.hint ?? ""), r.hint);

console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
process.exit(failed ? 1 : 0);
