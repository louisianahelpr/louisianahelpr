#!/usr/bin/env node
/**
 * PGlite proof for 20261008203441_arrival_gps_or_poster_and_step_order (owner,
 * 2026-10-08: the job's steps happen in order; job 28f8cff5 reached On My Way
 * with nobody confirming, and its poster confirmed "working" 32 s before the
 * Helpr started; "GPS skips it").
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/jobStepOrder.pglite.mjs
 *
 * OLD STATE (the newest definitions before this migration): On My Way with no
 * day-before confirm is taken; the poster's working stamp before the Helpr's
 * Working is taken; a GPS-verified arrival without the poster's tap cannot
 * start working. NEW STATE: each is the other way round; the seed and server
 * exemptions hold; applied 3x.
 */
import { PGlite, readMigration, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const VERSION = "20261008203441";
const FIX = readMigration(`${VERSION}_arrival_gps_or_poster_and_step_order.sql`);
const { P, A, X } = USERS;
const { check, failures, fail } = checker();

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function auth.role() returns text language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  create table public.profiles (user_id uuid primary key, is_seed boolean default false);
  insert into public.profiles (user_id) values ('${P}'), ('${A}'), ('${X}');
  create table public.jobs (id uuid primary key default gen_random_uuid(), title text, customer_id uuid, helper_id uuid,
    status public.job_status not null default 'accepted', date_needed date, start_time time,
    helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, helper_on_the_way_at timestamptz,
    helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz, poster_confirmed_arrival_at timestamptz,
    poster_confirmed_working_at timestamptz, helper_completed_at timestamptz, poster_completed_at timestamptz,
    require_photo_proof boolean default false, proof_before_urls text[], proof_after_urls text[],
    is_group_job boolean default false);
  create table public.job_tracking (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid,
    status text, latitude double precision, longitude double precision, created_at timestamptz default now(), updated_at timestamptz);
  create table public.group_job_helpers (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid,
    helper_arrived_at timestamptz, poster_confirmed_arrival_at timestamptz, helper_completed_at timestamptz,
    proof_before_urls text[], proof_after_urls text[], helper_arrival_verified_at timestamptz,
    poster_confirmed_working_at timestamptz);
  grant select, update on public.jobs to authenticated; grant all on public.jobs, public.job_tracking to service_role;
  grant select, insert, update on public.job_tracking to authenticated;
`;
const OLD = ["is_server_context", "helper_mark_on_the_way", "enforce_job_tracking_arrival_gate", "enforce_helper_completion_gates", "rpc_helper_mark_done"]
  .map((n) => newestFunctionSql(n, VERSION).sql).join("\n");
const TRIGGERS = `
  drop trigger if exists trg_job_tracking_arrival_gate on public.job_tracking;
  create trigger trg_job_tracking_arrival_gate before insert or update on public.job_tracking
    for each row execute function public.enforce_job_tracking_arrival_gate();
  drop trigger if exists trg_helper_completion_gates on public.jobs;
  create trigger trg_helper_completion_gates before update of helper_completed_at, status on public.jobs
    for each row execute function public.enforce_helper_completion_gates();
`;
// A job starting `offset` from now, Central.
const job = (title, offset, extra = "") => `insert into public.jobs (title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at ${extra ? "," + extra.split("=")[0] : ""})
  values ('${title}', '${P}', '${A}', 'accepted', ((now() + interval '${offset}') at time zone 'America/Chicago')::date,
  date_trunc('minute', (now() + interval '${offset}') at time zone 'America/Chicago')::time, now() - interval '3 days' ${extra ? "," + extra.split("=")[1] : ""}) returning id`;
const id = async (db, sql) => (await db.query(sql)).rows[0].id;
const onTheWay = (db, j) => as(db, "authenticated", A, `select public.helper_mark_on_the_way('${j}')`);
const posterWorking = (db, j) => as(db, "authenticated", P, `update public.jobs set poster_confirmed_working_at = now() where id = '${j}' returning id`);
const startWorking = (db, j) => as(db, "authenticated", A, `insert into public.job_tracking (job_id, helper_id, status) values ('${j}', '${A}', 'working') returning id`);

async function world(withFix) {
  const db = new PGlite();
  await db.exec(WORLD + OLD + TRIGGERS);
  if (withFix) for (let i = 0; i < 3; i++) await db.exec(FIX);
  return db;
}

{
  const db = await world(false);
  const j1 = await id(db, job("old-otw", "1 hour"));
  const r1 = await onTheWay(db, j1);
  const j2 = await id(db, job("old-poster", "1 hour", "helper_arrived_at=now() - interval '5 minutes'"));
  const r2 = await posterWorking(db, j2);
  const j3 = await id(db, job("old-gps", "1 hour", "helper_arrival_verified_at=now()"));
  await db.exec(`update public.jobs set helper_arrived_at = now() where id = '${j3}'`);
  const r3 = await startWorking(db, j3);
  const red = r1.ok && r2.ok && !r3.ok;
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: on-the-way unconfirmed ${r1.ok ? "taken" : "refused"}; poster working first ${r2.ok ? "taken" : "refused"}; GPS-verified start ${r3.ok ? "taken" : "refused"}`);
  if (!red) fail();
  await db.close();
}

const db = await world(true);
check("applies 3x (replay-safe)", true);

// 1. ON MY WAY
let j = await id(db, job("otw-unconfirmed", "1 hour"));
let r = await onTheWay(db, j);
check("On My Way with no day-before confirm is refused: helper_not_dayof_confirmed", refused(r, /helper_not_dayof_confirmed/), r.err);
j = await id(db, job("otw-early", "5 hours", "helper_dayof_confirmed_at=now()"));
r = await onTheWay(db, j);
check("confirmed but 5 hours before the start is refused: on_the_way_too_early", refused(r, /on_the_way_too_early/), r.err);
j = await id(db, job("otw-ok", "90 minutes", "helper_dayof_confirmed_at=now()"));
r = await onTheWay(db, j);
check("confirmed and 90 minutes before the start is taken", r.ok, r.err);
r = await onTheWay(db, j);
check("a second tap after heading out is still taken (no-op)", r.ok, r.err);
r = await as(db, "authenticated", X, `select public.helper_mark_on_the_way('${j}')`);
check("a stranger is still refused on authorization", refused(r, /not_the_assigned_helper/), r.err);
await db.exec(`update public.profiles set is_seed = true where user_id = '${P}'`);
j = await id(db, job("otw-seed", "5 hours"));
r = await onTheWay(db, j);
check("a seed poster's job is not judged (the nightly journeys)", r.ok, r.err);
await db.exec(`update public.profiles set is_seed = false where user_id = '${P}'`);

// 2. THE POSTER'S WORKING CONFIRM
j = await id(db, job("pw", "1 hour", "helper_arrived_at=now() - interval '5 minutes'"));
await db.exec(`update public.jobs set poster_confirmed_arrival_at = now() where id = '${j}'`);
r = await posterWorking(db, j);
check("the poster's working confirm before the Helpr's Start Working is refused: working_confirm_before_working", refused(r, /working_confirm_before_working/), r.err);
r = await startWorking(db, j);
check("the Helpr starts working (arrival confirmed by the poster)", r.ok, r.err);
r = await posterWorking(db, j);
check("then the poster's working confirm is taken", r.ok && r.rows.length === 1, r.err);
j = await id(db, job("pw-server", "1 hour", "helper_arrived_at=now() - interval '5 minutes'"));
r = await as(db, "service_role", null, `update public.jobs set poster_confirmed_working_at = now() where id = '${j}' returning id`);
check("server context is not judged", r.ok && r.rows.length === 1, r.err);

// 3. GPS SKIPS THE POSTER'S TAP
j = await id(db, job("gps", "1 hour", "helper_arrival_verified_at=now() - interval '40 minutes'"));
await db.exec(`update public.jobs set helper_arrived_at = now() - interval '40 minutes' where id = '${j}'`);
r = await startWorking(db, j);
check("a GPS-verified arrival starts working without the poster's tap", r.ok, r.err);
r = await as(db, "authenticated", A, `select public.rpc_helper_mark_done('${j}') as out`);
check("and can mark the job done (30 minutes in, photos off)", r.ok && r.rows[0].out.already_done === false, r.err);
j = await id(db, job("nogps", "1 hour", "helper_arrived_at=now() - interval '40 minutes'"));
r = await startWorking(db, j);
check("an arrival the location did NOT verify still needs the poster's tap", refused(r, /tracker_requires_arrival/), r.err);
r = await as(db, "authenticated", A, `select public.rpc_helper_mark_done('${j}')`);
check("and cannot mark done either: completion_requires_confirmed_arrival", refused(r, /completion_requires_confirmed_arrival/), r.err);

const acl = (await db.query(`select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') a, has_function_privilege('anon', p.oid, 'EXECUTE') n
  from pg_proc p where p.proname in ('job_posted_by_seed','enforce_poster_working_confirm_order','helper_mark_on_the_way','rpc_helper_mark_done') order by 1`)).rows;
const want = { enforce_poster_working_confirm_order: false, helper_mark_on_the_way: true, job_posted_by_seed: false, rpc_helper_mark_done: true };
check("grants: the two RPCs for signed-in users only; the helpers for nobody", acl.every((x) => x.a === want[x.proname] && x.n === false), JSON.stringify(acl));

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
