#!/usr/bin/env node
/**
 * PGlite proof for 20261029042735_done_floor_from_arrival (audit 2026-10-28, Part 4 half 2, F12): the
 * 30-minute "Mark done" floor counts from the Helpr's own arrival, so the
 * poster's late "Confirm they're working" no longer restarts it.
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/doneFloorFromArrival.pglite.mjs
 *
 * OLD STATE (the newest definitions before this migration, 20261008203441):
 * a Helpr who arrived 40 minutes ago, started working, and whose poster
 * confirmed "working" 5 minutes ago is refused completion_min_work_time by
 * rpc_helper_mark_done, by the jobs trigger on a direct stamp, and a crew
 * member the same by the roster trigger. NEW STATE: each is taken; a Helpr who
 * arrived 10 minutes ago is still refused (the floor stands); the nightly
 * journeys' back-dated poster stamp still clears it; NULL stamps still mean
 * no floor; grants unchanged; applied 3x.
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const FILE = readdirSync(new URL("../../../supabase/migrations/", import.meta.url).pathname).find((f) => f.endsWith("_done_floor_from_arrival.sql"));
if (!FILE) throw new Error("migration *_done_floor_from_arrival.sql not found");
const VERSION = FILE.slice(0, 14);
const FIX = readMigration(FILE);
const { P, A, B, X } = USERS;
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
  create table public.jobs (id uuid primary key default gen_random_uuid(), title text, customer_id uuid, helper_id uuid,
    status public.job_status not null default 'in_progress', helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz,
    poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz, helper_completed_at timestamptz,
    poster_completed_at timestamptz, require_photo_proof boolean default false, proof_before_urls text[], proof_after_urls text[],
    is_group_job boolean default false);
  create table public.group_job_helpers (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid,
    helper_arrived_at timestamptz, poster_confirmed_arrival_at timestamptz, helper_completed_at timestamptz,
    proof_before_urls text[], proof_after_urls text[], helper_arrival_verified_at timestamptz,
    poster_confirmed_working_at timestamptz);
  grant select, update on public.jobs, public.group_job_helpers to authenticated;
  grant all on public.jobs, public.group_job_helpers to service_role;
`;
const OLD = ["is_server_context", "enforce_helper_completion_gates", "enforce_group_member_completion_gates", "rpc_helper_mark_done"]
  .map((n) => newestFunctionSql(n, VERSION).sql).join("\n");
const TRIGGERS = `
  drop trigger if exists trg_helper_completion_gates on public.jobs;
  create trigger trg_helper_completion_gates before update of helper_completed_at, status on public.jobs
    for each row execute function public.enforce_helper_completion_gates();
  drop trigger if exists trg_group_member_completion_gates on public.group_job_helpers;
  create trigger trg_group_member_completion_gates before update on public.group_job_helpers
    for each row execute function public.enforce_group_member_completion_gates();
`;

/** A job Helpr A is working: arrived `arrived` ago (GPS-verified), poster confirmed working `working` ago (or never). */
async function job(db, arrived, working) {
  const w = working ? `now() - interval '${working}'` : "null";
  const a = arrived ? `now() - interval '${arrived}'` : "null";
  return (await db.query(`insert into public.jobs (title, customer_id, helper_id, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_working_at)
    values ('j', '${P}', '${A}', ${a}, ${arrived ? a : "now()"}, ${w}) returning id`)).rows[0].id;
}
/** A crew job with member B's slot in the same state. */
async function crewSlot(db, arrived, working) {
  const j = (await db.query(`insert into public.jobs (title, customer_id, is_group_job) values ('crew', '${P}', true) returning id`)).rows[0].id;
  const w = working ? `now() - interval '${working}'` : "null";
  return (await db.query(`insert into public.group_job_helpers (job_id, helper_id, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_working_at)
    values ('${j}', '${B}', now() - interval '${arrived}', now() - interval '${arrived}', ${w}) returning id`)).rows[0].id;
}
const markDone = (db, j) => as(db, "authenticated", A, `select public.rpc_helper_mark_done('${j}') as out`);
const stampDirect = (db, j) => as(db, "authenticated", A, `update public.jobs set helper_completed_at = now() where id = '${j}' returning id`);
const crewDone = (db, s) => as(db, "authenticated", B, `update public.group_job_helpers set helper_completed_at = now() where id = '${s}' returning id`);

async function world(withFix) {
  const db = new PGlite();
  await db.exec(WORLD + OLD + TRIGGERS);
  if (withFix) for (let i = 0; i < 3; i++) await db.exec(FIX);
  return db;
}

// ── OLD STATE: the late poster tap moves the floor ─────────────────────────────
{
  const db = await world(false);
  const r1 = await markDone(db, await job(db, "40 minutes", "5 minutes"));
  const r2 = await stampDirect(db, await job(db, "40 minutes", "5 minutes"));
  const r3 = await crewDone(db, await crewSlot(db, "40 minutes", "5 minutes"));
  const red = [r1, r2, r3].every((r) => refused(r, /completion_min_work_time/));
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: arrived 40 min ago, poster confirmed working 5 min ago: rpc ${r1.ok ? "taken" : r1.err}; direct stamp ${r2.ok ? "taken" : r2.err}; crew ${r3.ok ? "taken" : r3.err}`);
  if (!red) fail();
  await db.close();
}

const db = await world(true);
check("applies 3x (replay-safe)", true);

let r = await markDone(db, await job(db, "40 minutes", "5 minutes"));
check("rpc_helper_mark_done: arrived 40 min ago, late poster confirm 5 min ago -> taken", r.ok && r.rows[0].out.already_done === false, r.err);
r = await stampDirect(db, await job(db, "40 minutes", "5 minutes"));
check("jobs trigger: the same on a direct stamp -> taken", r.ok && r.rows.length === 1, r.err);
r = await crewDone(db, await crewSlot(db, "40 minutes", "5 minutes"));
check("crew trigger: a member who arrived 40 min ago, poster confirmed 5 min ago -> taken", r.ok && r.rows.length === 1, r.err);

r = await markDone(db, await job(db, "10 minutes", null));
check("the floor stands: arrived 10 min ago -> completion_min_work_time", refused(r, /completion_min_work_time/), r.err);
r = await markDone(db, await job(db, "10 minutes", "5 minutes"));
check("the floor stands with a poster confirm too (arrived 10 min ago)", refused(r, /completion_min_work_time/), r.err);
check("the refusal names the arrival", /30 minutes after you arrived/.test((await db.query(`select pg_get_functiondef('public.rpc_helper_mark_done(uuid)'::regprocedure) d`)).rows[0].d));
r = await stampDirect(db, await job(db, "10 minutes", null));
check("jobs trigger: arrived 10 min ago -> refused", refused(r, /completion_min_work_time/), r.err);
r = await crewDone(db, await crewSlot(db, "10 minutes", null));
check("crew trigger: arrived 10 min ago -> refused", refused(r, /completion_min_work_time/), r.err);

r = await markDone(db, await job(db, "10 minutes", "40 minutes"));
check("the nightly journeys' back-dated poster stamp still clears it (seed harness)", r.ok, r.err);
r = await markDone(db, await job(db, null, null));
check("no arrival stamp and no poster stamp -> no floor (as before)", r.ok, r.err);
r = await as(db, "authenticated", X, `select public.rpc_helper_mark_done('${await job(db, "40 minutes", null)}')`);
check("a stranger is still refused on authorization", refused(r, /not_the_assigned_helper/), r.err);

const acl = (await db.query(`select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') a, has_function_privilege('anon', p.oid, 'EXECUTE') n
  from pg_proc p where p.proname in ('enforce_helper_completion_gates','enforce_group_member_completion_gates','rpc_helper_mark_done') order by 1`)).rows;
const want = { enforce_group_member_completion_gates: false, enforce_helper_completion_gates: false, rpc_helper_mark_done: true };
check("grants: rpc_helper_mark_done for signed-in users only; the triggers for nobody", acl.length === 3 && acl.every((x) => x.a === want[x.proname] && x.n === false), JSON.stringify(acl));

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
