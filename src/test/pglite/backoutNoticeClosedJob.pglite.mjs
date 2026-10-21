#!/usr/bin/env node
/**
 * PGlite proof for 20261019020032_backout_notices_close_on_closed_job
 * (owner-reported 2026-10-19: a cancelled job's "Offer expired" notice was
 * re-pushed every 2 hours until its start time).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/backoutNoticeClosedJob.pglite.mjs
 *
 * OLD STATE (20261008205118 only): a cancelled job with an unacknowledged
 * offer_expired notice inside the 24 h window gets a push from the sweep.
 * NEW STATE: the same world sends 0 and the notice is closed; a poster_cancelled
 * notice (the cancel itself, "Don't go.") still reminds the Helpr; a live job's
 * notice still reminds; cancelling or completing a job closes its moot notices
 * at once (trigger); the data step closes ones already moot; Got it history is
 * untouched; grants as before; applied 3x.
 */
import { PGlite, readMigration, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";

// The table, sweep and email from 20261008205118, then the NEWEST
// record_backout_notice (funding gate, declutter skip), as prod runs it.
const BASE = readMigration("20261008205118_backout_notices.sql");
const RECORD = newestFunctionSql("record_backout_notice", "20261019020032");
const FIX = readMigration("20261019020032_backout_notices_close_on_closed_job.sql");
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
  create table public.profiles (user_id uuid primary key, full_name text);
  insert into public.profiles values ('${P}', 'Sam Smith'), ('${A}', 'Lexi Lombas'), ('${X}', 'Xavier');
  create table public.notification_preferences (user_id uuid primary key, email_job_updates boolean default true);
  create table public.notifications (id serial primary key, user_id uuid, title text, message text, type text, link text, job_id uuid);
  create table public.jobs (id uuid primary key default gen_random_uuid(), title text, customer_id uuid, helper_id uuid,
    status public.job_status not null default 'accepted', date_needed date, start_time time, helper_confirmed_at timestamptz,
    direct_offer_status text, offered_to_helper_id uuid, cancelled_by uuid, parent_job_id uuid, is_group_job boolean default false,
    payment_status text default 'paid');
  grant select, update on public.jobs to authenticated; grant all on public.jobs to service_role;
  create function public.job_payment_is_funded(p text) returns boolean language sql immutable as $f$ select p = 'paid' $f$;
`;
const setup = async (db) => {
  await db.exec(WORLD);
  await db.exec(BASE);
  await db.exec(RECORD.sql);
};
// A booked job starting in 6 hours (inside the 24 h push window).
const newJob = async (db) => (await db.query(`insert into public.jobs (title, customer_id, helper_id, status, date_needed, start_time)
  values ('Mow & Weed Eat Yard', '${P}', '${A}', 'accepted', ((now() + interval '6 hours') at time zone 'America/Chicago')::date,
  ((now() + interval '6 hours') at time zone 'America/Chicago')::time) returning id`)).rows[0].id;
// The offer runs out (server context): the job reopens and the poster gets offer_expired.
const expireOffer = (db, j) => as(db, "service_role", null, `update public.jobs set status = 'open', helper_id = null where id = '${j}'`);
const ageNotices = (db) => db.exec(`update public.backout_notices set created_at = now() - interval '1 hour', last_push_at = null`);
const sweep = async (db) => (await db.query(`select public.sweep_backout_notice_reminders() as n`)).rows[0].n;
const pushesTo = async (db, u) => (await db.query(`select count(*)::int c from public.notifications where type = 'warning' and user_id = '${u}'`)).rows[0].c;
const openNotice = async (db, j, kind) =>
  (await db.query(`select count(*)::int c from public.backout_notices where job_id = '${j}' and backout_kind = '${kind}' and acknowledged_at is null`)).rows[0].c;

// THE ORIGINAL BUG: offer expired, then the poster cancelled the reopened job.
async function originalBug(db) {
  const j = await newJob(db);
  await expireOffer(db, j);
  await as(db, "authenticated", P, `update public.jobs set status = 'cancelled', cancelled_by = '${P}' where id = '${j}'`);
  return j;
}

{
  const db = new PGlite();
  await setup(db);
  await originalBug(db);
  await ageNotices(db);
  const sent = await sweep(db);
  console.log(`-- OLD STATE ${sent === 1 ? "RED" : "NOT RED"}: a cancelled job's offer_expired notice is re-pushed (sent ${sent})`);
  if (sent !== 1) fail();
  await db.close();
}

const db = new PGlite();
await setup(db);
check(`world runs the newest record_backout_notice (${RECORD.file})`, RECORD.file >= "20261018050953", RECORD.file);

// Rows written BEFORE the fix ships: the trigger cannot have closed them.
const stale = await originalBug(db);
const ackedEarlier = await newJob(db);
await expireOffer(db, ackedEarlier);
await db.exec(`update public.backout_notices set acknowledged_at = '2026-10-10T00:00:00Z' where job_id = '${ackedEarlier}'`);
await as(db, "authenticated", P, `update public.jobs set status = 'cancelled', cancelled_by = '${P}' where id = '${ackedEarlier}'`);
check("old world: the stale notice is open before the fix", (await openNotice(db, stale, "offer_expired")) === 1);

for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);
check("data step: the notice already moot on a cancelled job is closed", (await openNotice(db, stale, "offer_expired")) === 0);
const earlier = (await db.query(`select acknowledged_at = '2026-10-10T00:00:00Z' ok, acknowledged_at::text t from public.backout_notices where job_id = '${ackedEarlier}'`)).rows[0];
check("data step: an earlier Got it keeps its own time", earlier?.ok === true, earlier?.t);

// The sweep itself closes a moot notice (one the trigger did not see: written
// with triggers off, as a row from any other path would be).
const viaSweep = await newJob(db);
await expireOffer(db, viaSweep);
await db.exec(`set session_replication_role = replica; update public.jobs set status = 'cancelled' where id = '${viaSweep}'; set session_replication_role = origin;`);
check("setup: the notice is still open with the job cancelled", (await openNotice(db, viaSweep, "offer_expired")) === 1);
await ageNotices(db);
let before = await pushesTo(db, P);
let sent = await sweep(db);
check("cancelled job + unacknowledged notice inside the window -> 0 notifications", sent === 0 && (await pushesTo(db, P)) === before, `sent ${sent}`);
check("and the sweep closes that notice", (await openNotice(db, viaSweep, "offer_expired")) === 0);

// Going forward: the cancel closes it at once (the trigger).
const live = await newJob(db);
await expireOffer(db, live);
check("a live (reopened) job's notice stays open", (await openNotice(db, live, "offer_expired")) === 1);
await ageNotices(db);
sent = await sweep(db);
check("a live job's notice is still reminded", sent === 1, `sent ${sent}`);
await as(db, "authenticated", P, `update public.jobs set status = 'cancelled', cancelled_by = '${P}' where id = '${live}'`);
check("cancelling the job closes its notice at once", (await openNotice(db, live, "offer_expired")) === 0);

const done = await newJob(db);
await expireOffer(db, done);
await as(db, "service_role", null, `update public.jobs set status = 'completed' where id = '${done}'`);
check("completing the job closes its notice too", (await openNotice(db, done, "offer_expired")) === 0);

// One UPDATE that cancels AND declines a direct offer (settle_one_off_jobs_
// for_banned_account): the notice record_backout_notice writes in that same
// statement is closed too (the close trigger runs after it).
const both = (await db.query(`insert into public.jobs (title, customer_id, status, direct_offer_status, offered_to_helper_id)
  values ('Walk', '${P}', 'open', 'pending', '${A}') returning id`)).rows[0].id;
await as(db, "service_role", null, `update public.jobs set status = 'cancelled', direct_offer_status = 'declined' where id = '${both}'`);
const bothRows = (await db.query(`select count(*)::int c from public.backout_notices where job_id = '${both}'`)).rows[0].c;
check("cancel + decline in one statement: the notice it writes is closed at once", bothRows === 1 && (await openNotice(db, both, "offer_declined")) === 0, `rows ${bothRows}`);

// The cancel itself still warns the Helpr until Got it.
const posterCancel = await newJob(db);
await as(db, "authenticated", P, `update public.jobs set status = 'cancelled', cancelled_by = '${P}' where id = '${posterCancel}'`);
check("a poster_cancelled notice survives its own cancel", (await openNotice(db, posterCancel, "poster_cancelled")) === 1);
await ageNotices(db);
before = await pushesTo(db, A);
sent = await sweep(db);
check("and the Helpr is still reminded (\"Don't go.\")", sent === 1 && (await pushesTo(db, A)) === before + 1, `sent ${sent}`);

const acl = (await db.query(`select has_function_privilege('authenticated', 'public.sweep_backout_notice_reminders()', 'EXECUTE') s,
  has_function_privilege('anon', 'public.sweep_backout_notice_reminders()', 'EXECUTE') sa,
  has_function_privilege('authenticated', 'public.close_backout_notices_on_closed_job()', 'EXECUTE') t,
  has_function_privilege('anon', 'public.backout_notice_applies(text, text)', 'EXECUTE') f`)).rows[0];
check("grants: the sweep, trigger and rule for nobody but the server", !acl.s && !acl.sa && !acl.t && !acl.f, JSON.stringify(acl));

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
