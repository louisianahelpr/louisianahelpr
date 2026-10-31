#!/usr/bin/env node
/**
 * PGlite proof for 20261031013445_helper_cancel_says_why (Jobs audit 10-30, JOBS-21).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/helperCancelSaysWhy.pglite.mjs
 *
 * A minimal schema (the columns helper_cancel_booking reads and writes; the constraint as live on 2026-10-30), then:
 *   OLD STATE: the newest body before this migration closes the application 'rejected' with closed_reason NULL
 *   (printed, RED by design: it reads "Not selected this time").
 *   NEW STATE: the migration applied 3x (replay-safe): the Helpr's cancel closes it with closed_reason
 *   'helper_cancelled' and reopens the job; another member is refused and changes nothing; the strike rule is
 *   untouched (none over 24 hours out, the ladder inside 24); the constraint still refuses an unknown reason; one
 *   SECURITY DEFINER definition; anon/PUBLIC cannot run it, authenticated and service_role can.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const migText = readFileSync(new URL("../../../supabase/migrations/20261031013445_helper_cancel_says_why.sql", import.meta.url).pathname, "utf8");
// The old body: this migration's own function with its one change taken out, as the live definition was read.
const CHANGE = "     SET status = 'rejected',\n         closed_reason = 'helper_cancelled'\n";
if (!migText.includes(CHANGE)) throw new Error("the migration's one change was not found");
const fnStart = migText.indexOf("CREATE OR REPLACE FUNCTION public.helper_cancel_booking");
const oldBody = migText.slice(fnStart).replace(CHANGE, "     SET status = 'rejected'\n");
const NEW_MIGRATION = process.env.NEW_MIGRATION;

const H = "00000000-0000-0000-0000-00000000000b", P = "00000000-0000-0000-0000-00000000000a", X = "00000000-0000-0000-0000-00000000000e";
const J = "00000000-0000-0000-0000-0000000000f1";
const fresh = async () => {
  const db = new PGlite();
  await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create table public.jobs (id uuid primary key, customer_id uuid, helper_id uuid, title text, date_needed date, start_time time,
  helper_completed_at timestamptz, helper_confirmed_at timestamptz, status text, is_group_job boolean, helpers_needed int, parent_job_id uuid,
  recurrence_days text[], response_deadline timestamptz, helper_dayof_confirmed_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
  dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz);
create table public.group_job_helpers (id uuid primary key, job_id uuid, helper_id uuid, helper_completed_at timestamptz, helper_confirmed_at timestamptz);
create table public.applications (id serial primary key, job_id uuid, helper_id uuid, status text, closed_reason text);
alter table public.applications add constraint applications_closed_reason_check
  check (closed_reason is null or closed_reason in ('job_cancelled', 'party_blocked', 'offer_expired', 'not_confirmed', 'no_show'));
create table public.notifications (id serial primary key, user_id uuid, title text, message text, type text, link text, job_id uuid);
create table public.strikes (user_id uuid, job_id uuid);
create function public.is_late_cancellation(p_committed boolean, p_hours numeric) returns boolean language sql as $$ select p_committed and p_hours < 24 $$;
create function public.apply_job_denial_consequence(p_user uuid, p_job uuid, p_desc text) returns jsonb language plpgsql as $$
  begin insert into public.strikes values (p_user, p_job); return jsonb_build_object('action','warning'); end $$;
create function public.series_release_dates(uuid, uuid, date[], text, text, uuid) returns date[] language sql as $$ select array[]::date[] $$;
`);
  await db.exec(oldBody);
  return db;
};
const seed = async (db, startsIn) => db.exec(`
insert into jobs (id, customer_id, helper_id, title, date_needed, start_time, helper_confirmed_at, status, is_group_job)
  select '${J}','${P}','${H}','t', ((now() + interval '${startsIn}') at time zone 'America/Chicago')::date,
         ((now() + interval '${startsIn}') at time zone 'America/Chicago')::time, now() - interval '3 days','accepted', false;
insert into applications (job_id, helper_id, status) values ('${J}','${H}','accepted');`);
const call = async (db, uid) => {
  await db.exec(`select set_config('test.uid','${uid}',false)`);
  try { return (await db.query(`select public.helper_cancel_booking('${J}') as r`)).rows[0].r; } catch (e) { return e.message; }
};
const app = async (db) => (await db.query(`select status, closed_reason from applications order by id limit 1`)).rows[0];
let fail = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(got)}`); };

// Phase A: old body only (the defect). NEW_MIGRATION=skip runs the new-state checks against it, and must go red.
{
  const db = await fresh(); await seed(db, "3 days");
  await call(db, H);
  const a = await app(db);
  console.log(`A old body: application = ${JSON.stringify(a)} -> ${a.closed_reason === "helper_cancelled" ? "UNEXPECTED (defect absent)" : "RED as expected: reads Not selected this time"}`);
}
// Phase B: new migration 3x, more than 24 hours out
{
  const db = await fresh();
  if (NEW_MIGRATION !== "skip") {
    for (let i = 0; i < 3; i++) await db.exec(migText);
    console.log("B applied new migration 3x: no error");
  }
  await seed(db, "3 days");
  check("B another member refused", await call(db, X), "not_authorized");
  check("B another member left the application alone", await app(db), { status: "accepted", closed_reason: null });
  const r = await call(db, H);
  check("B over 24 hours: no strike", r?.action, "none");
  check("B application says why", await app(db), { status: "rejected", closed_reason: "helper_cancelled" });
  check("B job reopened", (await db.query(`select status, helper_id from jobs`)).rows[0], { status: "open", helper_id: null });
  check("B no strike row", (await db.query(`select count(*)::int c from strikes`)).rows[0].c, 0);
  check("B poster told", (await db.query(`select title from notifications where user_id='${P}'`)).rows[0]?.title, "Your Helpr cancelled");
  let bogus; try { await db.exec(`insert into applications (job_id, helper_id, status, closed_reason) values ('${J}','${X}','rejected','bogus')`); bogus = "allowed"; } catch { bogus = "refused"; }
  check("B constraint still refuses an unknown reason", bogus, "refused");
  const acl = (await db.query(`select proacl::text as acl, prosecdef from pg_proc where proname = 'helper_cancel_booking'`)).rows;
  check("B one definition", acl.length, 1);
  check("B security definer", acl[0].prosecdef, true);
  if (NEW_MIGRATION !== "skip") {
    check("B anon/PUBLIC have no EXECUTE", /(^|[{,])anon=/.test(acl[0].acl) || /(^|[{,])=X/.test(acl[0].acl), false);
    check("B authenticated + service_role EXECUTE", /authenticated=X/.test(acl[0].acl) && /service_role=X/.test(acl[0].acl), true);
    console.log("B proacl:", acl[0].acl);
  }
}
// Phase C: inside 24 hours the ladder still runs
{
  const db = await fresh();
  if (NEW_MIGRATION !== "skip") await db.exec(migText);
  await seed(db, "3 hours");
  const r = await call(db, H);
  check("C inside 24 hours: the ladder", r?.action, "warning");
  check("C strike row", (await db.query(`select count(*)::int c from strikes`)).rows[0].c, 1);
  check("C application says why", await app(db), { status: "rejected", closed_reason: "helper_cancelled" });
}
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
