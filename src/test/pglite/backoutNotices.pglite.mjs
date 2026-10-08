#!/usr/bin/env node
/**
 * PGlite proof for 20261008205118_backout_notices (owner, 2026-10-08, Q1575:
 * a decline or a cancel must be impossible to miss for the other person).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/backoutNotices.pglite.mjs
 *
 * OLD STATE: no backout_notices table at all (nothing keeps the card in Needs
 * You). NEW STATE: each back-out writes one notice for the OTHER person, named;
 * a crew job and a non-back-out update write none; Got It clears only your
 * own; the sweep re-pushes inside 24 h of the start and not outside it; the
 * email failing (no net schema here) never fails the back-out; applied 3x.
 */
import { PGlite, readMigration, as, checker, refused, USERS } from "./seriesWorld.mjs";

const FIX = readMigration("20261008205118_backout_notices.sql");
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
    direct_offer_status text, offered_to_helper_id uuid, cancelled_by uuid, parent_job_id uuid, is_group_job boolean default false);
  grant select, update on public.jobs to authenticated; grant all on public.jobs to service_role;
`;
const newJob = async (db, over = "") => (await db.query(`insert into public.jobs (title, customer_id, helper_id, status, helper_confirmed_at, date_needed, start_time ${over ? "," + over.split("|")[0] : ""})
  values ('Mow', '${P}', '${A}', 'accepted', now(), ((now() + interval '6 hours') at time zone 'America/Chicago')::date,
  ((now() + interval '6 hours') at time zone 'America/Chicago')::time ${over ? "," + over.split("|")[1] : ""}) returning id`)).rows[0].id;
const notices = async (db, j) => (await db.query(`select user_id, backout_kind as kind, actor_name from public.backout_notices where job_id = '${j}'`)).rows;

{
  const db = new PGlite();
  await db.exec(WORLD);
  const r = await db.query(`select to_regclass('public.backout_notices') as t`);
  console.log(`-- OLD STATE ${r.rows[0].t === null ? "RED" : "NOT RED"}: nothing records a back-out for the other person`);
  if (r.rows[0].t !== null) fail();
  await db.close();
}

const db = new PGlite();
await db.exec(WORLD);
for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);

// The Helpr cancels a booked job (helper_cancel_booking's write).
let j = await newJob(db);
let r = await as(db, "authenticated", A, `update public.jobs set status = 'open', helper_id = null, helper_confirmed_at = null where id = '${j}'`);
check("the Helpr's cancel itself is not refused (email failure is swallowed)", r.ok, r.err);
let n = await notices(db, j);
check("a booked Helpr cancelling -> one notice for the POSTER, named", n.length === 1 && n[0].user_id === P && n[0].kind === "helper_cancelled" && n[0].actor_name === "Lexi", JSON.stringify(n));

// The Helpr declines an offer (decline_job_offer's write).
j = await newJob(db);
await db.exec(`update public.jobs set helper_confirmed_at = null where id = '${j}'`);
await as(db, "authenticated", A, `update public.jobs set status = 'open', helper_id = null where id = '${j}'`);
n = await notices(db, j);
check("an offer declined -> offer_declined for the poster", n.length === 1 && n[0].kind === "offer_declined" && n[0].user_id === P, JSON.stringify(n));

// The offer runs out (the sweep, server context).
j = await newJob(db);
await db.exec(`update public.jobs set helper_confirmed_at = null where id = '${j}'`);
await as(db, "service_role", null, `update public.jobs set status = 'open', helper_id = null where id = '${j}'`);
n = await notices(db, j);
check("an offer that expires -> offer_expired for the poster", n.length === 1 && n[0].kind === "offer_expired", JSON.stringify(n));

// The poster cancels a booked job (poster_cancel_job's write).
j = await newJob(db);
await as(db, "authenticated", P, `update public.jobs set status = 'cancelled', cancelled_by = '${P}' where id = '${j}'`);
n = await notices(db, j);
check("the poster cancelling -> poster_cancelled for the HELPR, named", n.length === 1 && n[0].user_id === A && n[0].kind === "poster_cancelled" && n[0].actor_name === "Sam", JSON.stringify(n));

// A direct offer declined.
j = (await db.query(`insert into public.jobs (title, customer_id, status, direct_offer_status, offered_to_helper_id) values ('Walk', '${P}', 'open', 'pending', '${A}') returning id`)).rows[0].id;
await as(db, "service_role", null, `update public.jobs set direct_offer_status = 'declined' where id = '${j}'`);
n = await notices(db, j);
check("a direct offer declined -> offer_declined for the poster", n.length === 1 && n[0].kind === "offer_declined", JSON.stringify(n));

// Not back-outs.
j = await newJob(db);
await as(db, "service_role", null, `update public.jobs set status = 'in_progress' where id = '${j}'`);
check("an ordinary step (accepted -> in_progress) writes nothing", (await notices(db, j)).length === 0);
j = await newJob(db, "is_group_job|true");
await as(db, "service_role", null, `update public.jobs set status = 'open', helper_id = null where id = '${j}'`);
check("a crew job writes nothing (its own notices, Q1409)", (await notices(db, j)).length === 0);

// Got It.
const mine = (await db.query(`select id from public.backout_notices where user_id = '${P}' limit 1`)).rows[0].id;
r = await as(db, "authenticated", X, `select public.ack_backout_notice('${mine}') as ok`);
check("someone else's Got It changes nothing", r.ok && r.rows[0].ok === false, r.err);
r = await as(db, "authenticated", P, `select public.ack_backout_notice('${mine}') as ok`);
check("the recipient's Got It clears it", r.ok && r.rows[0].ok === true, r.err);
r = await as(db, "authenticated", A, `select count(*)::int c from public.backout_notices`);
check("a recipient reads only their own notices", r.ok && r.rows[0].c === 1, JSON.stringify(r.rows));

// The repeat push.
await db.exec(`update public.backout_notices set created_at = now() - interval '1 hour'`);
const swept = (await db.query(`select public.sweep_backout_notice_reminders() as n`)).rows[0].n;
const pushes = (await db.query(`select count(*)::int c from public.notifications where type = 'warning'`)).rows[0].c;
check("the sweep re-pushes every unacknowledged notice inside 24 h of the start (3: one acked, one with no date)", swept === 3 && pushes === swept, `swept ${swept}, pushes ${pushes}`);
const again = (await db.query(`select public.sweep_backout_notice_reminders() as n`)).rows[0].n;
check("and not again within 2 hours", again === 0, `again ${again}`);
await db.exec(`update public.backout_notices set last_push_at = null; update public.jobs set date_needed = date_needed + 5`);
check("nothing is pushed for a start more than 24 h away", (await db.query(`select public.sweep_backout_notice_reminders() as n`)).rows[0].n === 0);

r = await as(db, "authenticated", A, `insert into public.backout_notices (job_id, user_id, backout_kind) values ('${j}', '${A}', 'offer_declined')`);
check("a client cannot write a notice", refused(r, /permission denied/), r.err);
const acl = (await db.query(`select has_function_privilege('authenticated', 'public.ack_backout_notice(uuid)', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.sweep_backout_notice_reminders()', 'EXECUTE') s,
  has_function_privilege('anon', 'public.ack_backout_notice(uuid)', 'EXECUTE') n`)).rows[0];
check("grants: Got It for signed-in users; the sweep for nobody", acl.a && !acl.s && !acl.n, JSON.stringify(acl));

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
