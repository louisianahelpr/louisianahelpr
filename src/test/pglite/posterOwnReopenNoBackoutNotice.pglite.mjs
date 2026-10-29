#!/usr/bin/env node
/**
 * PGlite proof for 20261029162907_poster_own_reopen_files_no_backout_notice
 * (audit 2026-10-29 A2-B15: after the poster reported a no-show, the poster's
 * own card said "Eli cancelled. They won't be coming.").
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/posterOwnReopenNoBackoutNotice.pglite.mjs
 *
 * OLD STATE (the newest record_backout_notice before this migration, equal to
 * the live body read 2026-10-29): the poster's no-show reopen (run inside a
 * definer RPC as the poster, as report_helper_no_show does) files
 * 'helper_cancelled' for the poster. NEW STATE: no notice and no email for
 * the poster's own reopen (no-show report or block); the Helpr cancelling a
 * confirmed job still files helper_cancelled; a server-side reopen of a
 * confirmed job (ban settle) still files helper_cancelled; the 2-hour repost
 * still files helper_unconfirmed even in the poster's session; the Helpr
 * declining and the server expiry still file theirs; the poster cancelling
 * still tells the Helpr; trigger function not callable by anon/authenticated;
 * applied 3x.
 */
import { PGlite, readMigration, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";

const MIG = "20261029162907_poster_own_reopen_files_no_backout_notice.sql";
const BASE = readMigration("20261008205118_backout_notices.sql");
const LIVE = newestFunctionSql("record_backout_notice", MIG.slice(0, 14));
const FIX = readMigration(MIG);
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
  insert into public.profiles values ('${P}', 'Sam Smith'), ('${A}', 'Eli Moss'), ('${X}', 'Xavier');
  create table public.notification_preferences (user_id uuid primary key, email_job_updates boolean default true);
  create table public.notifications (id serial primary key, user_id uuid, title text, message text, type text, link text, job_id uuid);
  create table public.jobs (id uuid primary key default gen_random_uuid(), title text, customer_id uuid, helper_id uuid,
    status public.job_status not null default 'accepted', date_needed date, start_time time, helper_confirmed_at timestamptz,
    direct_offer_status text, offered_to_helper_id uuid, cancelled_by uuid, parent_job_id uuid, is_group_job boolean default false,
    payment_status text default 'escrow');
  grant select, update on public.jobs to authenticated; grant all on public.jobs to service_role;
  create function public.job_payment_is_listed(p text) returns boolean language sql immutable as $f$ select p in ('escrow', 'paid') $f$;
  create function public.member_display_name(p_full text, p_x text) returns text language sql immutable as $f$ select p_full $f$;
`;
// report_helper_no_show's reopen (20261003193541), in a definer RPC that only the poster may call.
const RPC = `
  create function public.reopen_as_no_show(p_job uuid) returns void language plpgsql security definer set search_path to 'public' as $f$
  begin
    if (select customer_id from public.jobs where id = p_job) is distinct from auth.uid() then raise exception 'not_authorized'; end if;
    update public.jobs set status = 'open', helper_id = null, helper_confirmed_at = null where id = p_job;
  end $f$;
  grant execute on function public.reopen_as_no_show(uuid) to authenticated;
`;
const setup = async (db, fn) => {
  await db.exec(WORLD);
  await db.exec(BASE);
  // 20261008205730's constraint (helper_unconfirmed), as prod has it.
  await db.exec(`alter table public.backout_notices drop constraint if exists backout_notices_backout_kind_check;
    alter table public.backout_notices add constraint backout_notices_backout_kind_check
    check (backout_kind in ('offer_declined', 'offer_expired', 'helper_cancelled', 'poster_cancelled', 'helper_unconfirmed'));`);
  await db.exec(RPC);
  await db.exec(fn);
};
const newJob = async (db, confirmed = true) => (await db.query(`insert into public.jobs (title, customer_id, helper_id, status, helper_confirmed_at, date_needed, start_time)
  values ('Rake yard', '${P}', '${A}', 'accepted', ${confirmed ? "now()" : "null"}, ((now() + interval '6 hours') at time zone 'America/Chicago')::date,
  ((now() + interval '6 hours') at time zone 'America/Chicago')::time) returning id`)).rows[0].id;
const notices = async (db, j) => (await db.query(`select user_id, backout_kind as kind, actor_name from public.backout_notices where job_id = '${j}'`)).rows;

// OLD STATE: the body before this migration (the live one) files "Eli cancelled" for the poster's own report.
{
  const db = new PGlite();
  await setup(db, LIVE.sql);
  const j = await newJob(db);
  const r = await as(db, "authenticated", P, `select public.reopen_as_no_show('${j}')`);
  const n = await notices(db, j);
  const red = r.ok && n.length === 1 && n[0].user_id === P && n[0].kind === "helper_cancelled";
  console.log(`-- OLD STATE (${LIVE.file}) ${red ? "RED" : "NOT RED"}: the poster's no-show report files ${JSON.stringify(n)}`);
  if (!red) fail();
  await db.close();
}

const db = new PGlite();
await setup(db, FIX);
for (let i = 0; i < 2; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);

// The poster reports a no-show: the reopen runs as the poster inside a definer RPC.
let j = await newJob(db);
let r = await as(db, "authenticated", P, `select public.reopen_as_no_show('${j}')`);
let n = await notices(db, j);
check("the poster's no-show report reopens the job", r.ok, r.err);
check("the poster's no-show report -> no backout notice for anyone", n.length === 0, JSON.stringify(n));
const mails = (await db.query(`select count(*)::int c from public.notifications where user_id = '${P}'`)).rows[0].c;
check("and no notification row for the poster about their own report", mails === 0, String(mails));

// A stranger cannot use the RPC (the real one refuses with not_authorized too).
j = await newJob(db);
r = await as(db, "authenticated", X, `select public.reopen_as_no_show('${j}')`);
check("a stranger is refused", !r.ok && /not_authorized/.test(r.err), r.err);

// The poster's direct reopen (block_user_and_settle by the poster) -> no notice either.
j = await newJob(db);
await as(db, "authenticated", P, `update public.jobs set status = 'open', helper_id = null where id = '${j}'`);
n = await notices(db, j);
check("the poster blocking the Helpr (their own reopen) -> no notice", n.length === 0, JSON.stringify(n));

// The Helpr cancels a confirmed job: still "Eli cancelled" for the poster.
j = await newJob(db);
await as(db, "authenticated", A, `update public.jobs set status = 'open', helper_id = null, helper_confirmed_at = null where id = '${j}'`);
n = await notices(db, j);
check("the Helpr cancelling -> helper_cancelled for the poster, named", n.length === 1 && n[0].user_id === P && n[0].kind === "helper_cancelled" && n[0].actor_name === "Eli", JSON.stringify(n));

// A server-side reopen of a confirmed job (e.g. settling a banned Helpr's jobs): unchanged.
j = await newJob(db);
await as(db, "service_role", null, `update public.jobs set status = 'open', helper_id = null where id = '${j}'`);
n = await notices(db, j);
check("a server reopen of a confirmed job -> helper_cancelled (unchanged)", n.length === 1 && n[0].kind === "helper_cancelled", JSON.stringify(n));

// The 2-hour unconfirmed repost is not the poster's choice, even when their session ran the sweep.
j = await newJob(db);
await db.exec(`set app.repost_unconfirmed = '1'`);
r = await as(db, "authenticated", P, `update public.jobs set status = 'open', helper_id = null where id = '${j}'`);
await db.exec(`reset app.repost_unconfirmed`);
n = await notices(db, j);
check("the repost update itself is not refused", r.ok, r.err);
check("the unconfirmed repost in the poster's session -> helper_unconfirmed (unchanged)", n.length === 1 && n[0].kind === "helper_unconfirmed", JSON.stringify(n));

// The Helpr declines an unconfirmed offer; the server lets one expire.
j = await newJob(db, false);
await as(db, "authenticated", A, `update public.jobs set status = 'open', helper_id = null where id = '${j}'`);
n = await notices(db, j);
check("an offer declined -> offer_declined (unchanged)", n.length === 1 && n[0].kind === "offer_declined", JSON.stringify(n));
j = await newJob(db, false);
await as(db, "service_role", null, `update public.jobs set status = 'open', helper_id = null where id = '${j}'`);
n = await notices(db, j);
check("an offer expiring on the server -> offer_expired (unchanged)", n.length === 1 && n[0].kind === "offer_expired", JSON.stringify(n));

// The poster cancels a booked job: the Helpr is still told.
j = await newJob(db);
await as(db, "authenticated", P, `update public.jobs set status = 'cancelled', cancelled_by = '${P}' where id = '${j}'`);
n = await notices(db, j);
check("the poster cancelling -> poster_cancelled for the Helpr (unchanged)", n.length === 1 && n[0].user_id === A && n[0].kind === "poster_cancelled", JSON.stringify(n));

// Grants: nobody calls the trigger function directly.
const acl = (await db.query(`select has_function_privilege('anon', 'public.record_backout_notice()', 'execute') a,
  has_function_privilege('authenticated', 'public.record_backout_notice()', 'execute') u`)).rows[0];
check("anon and authenticated cannot execute the trigger function", !acl.a && !acl.u, JSON.stringify(acl));

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
