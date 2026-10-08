#!/usr/bin/env node
/**
 * PGlite proof for 20261008205730_confirm_reminders_nudge_and_repost (owner,
 * 2026-10-08: "helpr and poster can each nudge each other so they can confirm.
 * if they don't, 2 hrs before it's reposted. they should also be getting
 * notifications to confirm until they have confirmed.").
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/confirmRepost.pglite.mjs
 *
 * OLD STATE (backout_notices only): nothing reposts an unconfirmed Helpr's job
 * 90 minutes before the start, and there is no nudge. NEW STATE: reminders
 * every 3 hours, the repost at T-2h (Helpr off, application closed
 * 'not_confirmed', both told, the poster's banner says "didn't confirm"),
 * nudges either way once per 2 hours, and the exemptions; applied 3x.
 */
import { PGlite, readMigration, as, checker, refused, USERS } from "./seriesWorld.mjs";

const NOTICES = readMigration("20261008205118_backout_notices.sql");
const FIX = readMigration("20261008205730_confirm_reminders_nudge_and_repost.sql");
const STEP = readMigration("20261008203441_arrival_gps_or_poster_and_step_order.sql").split("-- ── 1. ON MY WAY")[0];
const { P, A, X } = USERS;
const { check, failures, fail } = checker();

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${P}'), ('${A}'), ('${X}');
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  create table public.profiles (user_id uuid primary key, full_name text, is_seed boolean default false);
  insert into public.profiles values ('${P}', 'Sam Smith', false), ('${A}', 'Lexi Lombas', false), ('${X}', 'Xavier', false);
  create table public.notification_preferences (user_id uuid primary key, email_job_updates boolean default true);
  create table public.notifications (id serial primary key, user_id uuid, title text, message text, type text, link text, job_id uuid, created_at timestamptz default now());
  create table public.jobs (id uuid primary key default gen_random_uuid(), title text, customer_id uuid, helper_id uuid,
    status public.job_status not null default 'accepted', date_needed date, start_time time, helper_confirmed_at timestamptz,
    helper_dayof_confirmed_at timestamptz, poster_confirmed_at timestamptz, response_deadline timestamptz,
    dayof_confirm_reminder_sent_at timestamptz, dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz,
    direct_offer_status text, offered_to_helper_id uuid, cancelled_by uuid, parent_job_id uuid, is_group_job boolean default false);
  create table public.applications (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, status text, closed_reason text,
    constraint applications_closed_reason_check check (closed_reason is null or closed_reason in ('job_cancelled','party_blocked','offer_expired')));
  grant select, update on public.jobs to authenticated; grant all on public.jobs, public.applications, public.notifications to service_role;
  create table public.banned (user_id uuid);
  create function public.is_caller_banned() returns boolean language sql stable as
    $f$ select exists (select 1 from public.banned where user_id = auth.uid()) $f$;
`;
const job = async (db, startsIn, extra = {}) => {
  const cols = Object.keys(extra), vals = Object.values(extra);
  const id = (await db.query(`insert into public.jobs (title, customer_id, helper_id, status, helper_confirmed_at, date_needed, start_time ${cols.map((c) => "," + c).join("")})
    values ('Mow', '${P}', '${A}', 'accepted', now() - interval '2 days', ((now() + interval '${startsIn}') at time zone 'America/Chicago')::date,
    date_trunc('minute', (now() + interval '${startsIn}') at time zone 'America/Chicago')::time ${vals.map((v) => "," + v).join("")}) returning id`)).rows[0].id;
  await db.query(`insert into public.applications (job_id, helper_id, status) values ('${id}', '${A}', 'accepted')`);
  return id;
};
const sweep = async (db) => (await db.query(`select public.sweep_confirm_reminders_and_repost() as r`)).rows[0].r;

{
  const db = new PGlite();
  await db.exec(WORLD + STEP + NOTICES);
  const j = await job(db, "90 minutes");
  const fn = (await db.query(`select to_regprocedure('public.sweep_confirm_reminders_and_repost()') as f`)).rows[0].f;
  const row = (await db.query(`select status, helper_id from public.jobs where id = '${j}'`)).rows[0];
  const red = fn === null && row.status === "accepted" && row.helper_id === A;
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: 90 minutes out, unconfirmed, still booked; nothing reposts it`);
  if (!red) fail();
  await db.close();
}

const db = new PGlite();
await db.exec(WORLD + STEP + NOTICES);
for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);

// Reminders.
const far = await job(db, "10 hours");
let r = await sweep(db);
check("unconfirmed 10 h out: reminded", r.reminded === 1 && r.reposted === 0, JSON.stringify(r));
r = await sweep(db);
check("not again within 3 hours", r.reminded === 0, JSON.stringify(r));
await db.exec(`update public.notifications set created_at = now() - interval '3 hours 5 minutes'`);
r = await sweep(db);
check("again after 3 hours (until they confirm)", r.reminded === 1, JSON.stringify(r));
await db.exec(`update public.jobs set helper_dayof_confirmed_at = now() where id = '${far}'; update public.notifications set created_at = now() - interval '4 hours'`);
r = await sweep(db);
check("confirmed: no more reminders", r.reminded === 0, JSON.stringify(r));

// The repost.
const near = await job(db, "90 minutes");
r = await sweep(db);
const row = (await db.query(`select status, helper_id, helper_confirmed_at from public.jobs where id = '${near}'`)).rows[0];
check("unconfirmed 90 minutes out: reposted (open, Helpr off)", r.reposted === 1 && row.status === "open" && row.helper_id === null && row.helper_confirmed_at === null, JSON.stringify({ r, row }));
const app = (await db.query(`select status, closed_reason from public.applications where job_id = '${near}'`)).rows[0];
check("their application closes as not_confirmed", app.status === "rejected" && app.closed_reason === "not_confirmed", JSON.stringify(app));
const told = (await db.query(`select user_id, title from public.notifications where job_id = '${near}'`)).rows;
check("the Helpr is told not to go", told.some((n) => n.user_id === A && n.title === "Job reposted"), JSON.stringify(told));
const notice = (await db.query(`select user_id, backout_kind as kind, actor_name from public.backout_notices where job_id = '${near}'`)).rows;
check("the poster's banner says the Helpr didn't confirm (not 'cancelled')", notice.length === 1 && notice[0].user_id === P && notice[0].kind === "helper_unconfirmed", JSON.stringify(notice));

const confirmedNear = await job(db, "90 minutes", { helper_dayof_confirmed_at: "now()" });
await sweep(db);
check("a confirmed Helpr 90 minutes out is not touched", (await db.query(`select helper_id from public.jobs where id = '${confirmedNear}'`)).rows[0].helper_id === A);
await db.exec(`update public.profiles set is_seed = true where user_id = '${P}'`);
const seedNear = await job(db, "90 minutes");
await sweep(db);
check("a test (is_seed) poster's job is not reposted", (await db.query(`select helper_id from public.jobs where id = '${seedNear}'`)).rows[0].helper_id === A);
await db.exec(`update public.profiles set is_seed = false where user_id = '${P}'`);

// Nudge.
const nj = await job(db, "20 hours");
r = await as(db, "authenticated", P, `select public.nudge_confirm('${nj}') as r`);
check("the poster nudges an unconfirmed Helpr: sent", r.ok && r.rows[0].r === "sent", r.err);
r = await as(db, "authenticated", P, `select public.nudge_confirm('${nj}') as r`);
check("again within 2 hours: too_soon", r.ok && r.rows[0].r === "too_soon", r.err);
r = await as(db, "authenticated", A, `select public.nudge_confirm('${nj}') as r`);
check("the Helpr nudges the poster (poster unconfirmed): sent", r.ok && r.rows[0].r === "sent", r.err);
await db.exec(`update public.jobs set poster_confirmed_at = now() where id = '${nj}'; delete from public.notifications where job_id = '${nj}'`);
r = await as(db, "authenticated", A, `select public.nudge_confirm('${nj}') as r`);
check("nothing to nudge once that side confirmed: already_confirmed", r.ok && r.rows[0].r === "already_confirmed", r.err);
r = await as(db, "authenticated", X, `select public.nudge_confirm('${nj}') as r`);
check("a stranger is refused", refused(r, /not_a_party/), r.err);
await db.exec(`insert into public.banned values ('${P}'); delete from public.notifications where job_id = '${nj}'; update public.jobs set poster_confirmed_at = null where id = '${nj}'`);
r = await as(db, "authenticated", P, `select public.nudge_confirm('${nj}') as r`);
check("a restricted (banned) account's nudge sends nothing", r.ok && r.rows[0].r === "account_restricted", r.err);
const acl = (await db.query(`select has_function_privilege('authenticated', 'public.nudge_confirm(uuid)', 'EXECUTE') n,
  has_function_privilege('authenticated', 'public.sweep_confirm_reminders_and_repost()', 'EXECUTE') s`)).rows[0];
check("grants: nudge for signed-in users; the sweep for nobody", acl.n && !acl.s, JSON.stringify(acl));

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
