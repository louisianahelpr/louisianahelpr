#!/usr/bin/env node
/**
 * PGlite proof for docs/OPEN.md Q46 + Q65:
 *   20260926040523_seed_flag_derived_at_birth  (is_seed set at birth, server context)
 *   20260926041023_purge_old_seed_data         (bounded, dry-run-first seed purge)
 *
 *   node src/test/pglite/seedPurge.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/seedPurge.pglite.mjs   # RED: the live (unfixed) state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). Both migrations are applied 3x (replay-safe).
 *
 * Fixture: the prod shape each function reads. auth.uid()/auth.role() read
 * request.jwt.claim.sub / .role exactly as Supabase's do; is_server_context()
 * is the live body (20260915101102). jobs' child tables carry prod's ON DELETE
 * action (messages CASCADE, notifications SET NULL, payment_refunds SET NULL).
 * No cron schema: the cron.schedule call is guarded and skipped.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const BIRTH = mig("20260926040523_seed_flag_derived_at_birth.sql");
const PURGE = mig("20260926041023_purge_old_seed_data.sql");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running against the LIVE (unfixed) state (expect FAILs)");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;
create table public.profiles(user_id uuid primary key, email text, is_seed boolean not null default false);
create table public.jobs(id uuid primary key default gen_random_uuid(), customer_id uuid, title text,
  status text default 'open', payment_status text default 'unpaid', parent_job_id uuid references public.jobs(id),
  is_seed boolean not null default false, created_at timestamptz not null default now());
create table public.messages(id serial primary key, job_id uuid references public.jobs(id) on delete cascade);
create table public.notifications(id serial primary key, user_id uuid, job_id uuid references public.jobs(id) on delete set null, created_at timestamptz not null default now());
create table public.payment_refunds(id serial primary key, job_id uuid references public.jobs(id) on delete set null);
create table public.platform_settings(id int primary key, feature_flags jsonb not null default '{}', updated_at timestamptz default now());
insert into public.platform_settings values (1, '{"seed_jobs_hidden_publicly": false}', now());
create table public.cron_catchup_policy(jobname text primary key, catch_up boolean, max_late interval, reason text, updated_at timestamptz);
create table public.cron_work_expectations(jobname text primary key, expected_max_gap interval, note text);
`);

const server = () => db.exec(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false)`);
const client = (uid) => db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false), set_config('request.jwt.claim.role', 'authenticated', false)`);
const one = async (q) => (await db.query(q)).rows[0];

// ── Q46: is_seed at birth ────────────────────────────────────────────────
const SEED_P = "10000000-0000-4000-8000-000000000001";
const REAL_P = "10000000-0000-4000-8000-000000000002";
const NEW_FIX = "10000000-0000-4000-8000-000000000003";
const CLIENT_FIX = "10000000-0000-4000-8000-000000000004";

async function birth(label) {
  await server();
  await db.exec(`insert into public.profiles values ('${SEED_P}', 'seed@mailinator.com', true), ('${REAL_P}', 'owner@gmail.com', false)`);
  await db.exec(`insert into public.profiles(user_id, email) values ('${NEW_FIX}', 'helpr-new-0926@Mailinator.com ')`);
  const j1 = await one(`insert into public.jobs(customer_id, title) values ('${SEED_P}', 'service-role job by a seed poster') returning is_seed`);
  const j2 = await one(`insert into public.jobs(customer_id, title) values ('${REAL_P}', 'service-role job by a real poster') returning is_seed`);
  const j3 = await one(`insert into public.jobs(customer_id, title, is_seed) values ('${REAL_P}', 'explicit seed', true) returning is_seed`);
  const p1 = await one(`select is_seed from public.profiles where user_id = '${NEW_FIX}'`);
  const p2 = await one(`select is_seed from public.profiles where user_id = '${REAL_P}'`);
  await client(CLIENT_FIX);
  await db.exec(`insert into public.profiles(user_id, email) values ('${CLIENT_FIX}', 'x@mailinator.com')`);
  const p3 = await one(`select is_seed from public.profiles where user_id = '${CLIENT_FIX}'`);
  const j4 = await one(`insert into public.jobs(customer_id, title) values ('${SEED_P}', 'client insert (the lock''s to judge)') returning is_seed`);
  await server();
  await db.exec(`delete from public.jobs; delete from public.profiles;`);
  return { label, j1: j1.is_seed, j2: j2.is_seed, j3: j3.is_seed, j4: j4.is_seed, p1: p1.is_seed, p2: p2.is_seed, p3: p3.is_seed };
}

const before = await birth("before");
console.log(`BEFORE: seed-poster service job is_seed=${before.j1}, new @mailinator profile is_seed=${before.p1}`);
check("OLD STATE RED: a service-role job of a seed poster is born is_seed=false", before.j1 === false);
check("OLD STATE RED: a new @mailinator.com account is born is_seed=false", before.p1 === false);

if (!SKIP) {
  for (let i = 0; i < 3; i++) await db.exec(BIRTH);
}
const after = await birth("after");
check("a service-role job of a seed poster is born is_seed=true", after.j1 === true, `got ${after.j1}`);
check("a service-role job of a real poster stays is_seed=false", after.j2 === false, `got ${after.j2}`);
check("an explicit is_seed=true is kept (the trigger only raises)", after.j3 === true, `got ${after.j3}`);
check("a new fixture-inbox account (case/space-insensitive) is born is_seed=true", after.p1 === true, `got ${after.p1}`);
check("a real account stays is_seed=false", after.p2 === false, `got ${after.p2}`);
check("a CLIENT insert of a profile is left alone (RLS's to judge)", after.p3 === false, `got ${after.p3}`);
check("a CLIENT insert of a job is left alone (enforce_jobs_insert_column_lock's to judge)", after.j4 === false, `got ${after.j4}`);

// ── Q65: the purge ───────────────────────────────────────────────────────
await server();
const J = (n, version = "4") => `20000000-0000-${version}000-8000-0000000000${String(n).padStart(2, "0")}`;
const OLD = "now() - interval '20 days'";
const NEWISH = "now() - interval '3 days'";
await db.exec(`
insert into public.profiles values ('${SEED_P}', 'seed@mailinator.com', true), ('${REAL_P}', 'owner@gmail.com', false);
insert into public.jobs(id, customer_id, title, payment_status, is_seed, created_at) values
  ('${J(1)}', '${SEED_P}', 'a old unpaid seed',          'unpaid',         true,  ${OLD}),
  ('${J(2)}', '${SEED_P}', 'b old escrow seed',          'escrow',         true,  ${OLD}),
  ('${J(3)}', '${SEED_P}', 'c old payout_pending seed',  'payout_pending', true,  ${OLD}),
  ('${J(4, "5")}', '${SEED_P}', 'd prod-seed v5 fixture','unpaid',         true,  ${OLD}),
  ('${J(5)}', '${SEED_P}', 'e new unpaid seed',          'unpaid',         true,  ${NEWISH}),
  ('${J(6)}', '${REAL_P}', 'f old real job',             'unpaid',         false, ${OLD}),
  ('${J(7)}', '${SEED_P}', 'g old cancelled + refund',   'cancelled',      true,  ${OLD}),
  ('${J(8)}', '${REAL_P}', 'h flagged but real poster',  'unpaid',         true,  ${OLD}),
  ('${J(9)}', '${SEED_P}', 'i old abandoned w/ messages','abandoned',      true,  ${OLD}),
  ('${J(10)}', null,        'k ownerless old seed',      null,             true,  ${OLD}),
  ('${J(11)}', '${SEED_P}', 'l parent of a visit',       'unpaid',         true,  ${OLD});
insert into public.jobs(id, customer_id, title, payment_status, is_seed, created_at, parent_job_id) values
  ('${J(12)}', '${SEED_P}', 'm the visit (new)', 'unpaid', true, ${NEWISH}, '${J(11)}');
insert into public.payment_refunds(job_id) values ('${J(7)}');
insert into public.messages(job_id) values ('${J(9)}'), ('${J(9)}'), ('${J(6)}');
insert into public.notifications(user_id, job_id, created_at) values
  ('${SEED_P}', '${J(1)}', ${OLD}), ('${SEED_P}', null, ${OLD}), ('${SEED_P}', null, ${NEWISH}),
  ('${REAL_P}', null, ${OLD});
`);
const ids = async () => (await db.query(`select title from public.jobs order by title`)).rows.map((r) => r.title[0]).join("");
const counts = async () => ({
  jobs: await ids(),
  messages: (await one(`select count(*)::int n from public.messages`)).n,
  notifications: (await one(`select count(*)::int n from public.notifications`)).n,
});
const start = await counts();
const hasFn = (await one(`select to_regprocedure('public.purge_old_seed_data(boolean,interval,integer)') is not null f`)).f;
check("OLD STATE RED: nothing purges old seed jobs (no purge function; 11 old/new rows all present)", !hasFn && start.jobs === "abcdefghiklm", start.jobs);

if (!SKIP) {
  for (let i = 0; i < 3; i++) await db.exec(PURGE);
}
if (SKIP) {
  check("purge function exists", false, "migration not applied");
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

// Dry run by default; also through the cron entry point with no switch.
const dry = (await one(`select public.purge_old_seed_data() r`)).r;
const dryCron = (await one(`select public.run_seed_purge() r`)).r;
const dryNull = (await one(`select public.purge_old_seed_data(null) r`)).r;
const afterDry = await counts();
check("dry run changes nothing", JSON.stringify(afterDry) === JSON.stringify(start), JSON.stringify(afterDry));
check("dry run reports exactly the jobs a live run deletes (a, i, k)", dry.dry_run === true && dry.jobs_would_delete === 3, JSON.stringify(dry));
check("cron entry point is DRY until seed_purge_live = true", dryCron.dry_run === true && dryCron.jobs_would_delete === 3);
check("p_dry_run NULL is a dry run", dryNull.dry_run === true);
check("dry run counts the seed notifications past the window (2)", dry.notifications_would_delete === 2, String(dry.notifications_would_delete));
check("money is LISTED, not deleted: b (escrow) and c (payout_pending)",
  dry.money_held_count === 2 && dry.money_held.map((m) => m.payment_status).sort().join(",") === "escrow,payout_pending", JSON.stringify(dry.money_held));
const heldBy = Object.fromEntries(dry.jobs_skipped.map((s) => [s.id, s.held_by ?? s.error]));
check("a refunded job is skipped, held by payment_refunds", heldBy[J(7)] === "public.payment_refunds:job_id", JSON.stringify(heldBy));
check("a job with a child visit is skipped, held by jobs.parent_job_id", heldBy[J(11)] === "public.jobs:parent_job_id", JSON.stringify(heldBy));
const runs1 = (await one(`select count(*)::int n, bool_and(dry_run) d from public.seed_purge_runs`));
check("every run is recorded in seed_purge_runs", runs1.n === 3 && runs1.d === true, JSON.stringify(runs1));

// Batch bound.
const one1 = (await one(`select public.purge_old_seed_data(false, interval '14 days', 1) r`)).r;
check("the batch bounds a live run (p_batch 1 deletes 1)", one1.jobs_deleted === 1 && one1.jobs_eligible_not_reached === 4, JSON.stringify(one1));

// Live through the cron entry point once the switch is written.
await db.exec(`update public.platform_settings set feature_flags = feature_flags || '{"seed_purge_live": true}'::jsonb`);
const live = (await one(`select public.run_seed_purge() r`)).r;
const afterLive = await counts();
check("live run deletes only a, i, k", afterLive.jobs === "bcdefghlm", afterLive.jobs);
check("the purged job's messages go with it (cascade); a real job's stay", afterLive.messages === 1, String(afterLive.messages));
check("seed notifications past the window go; new seed and real ones stay", afterLive.notifications === 2, String(afterLive.notifications));
check("live result says live", live.dry_run === false, JSON.stringify(live));

// A window under 7 days is floored: the 3-day-old seed job survives.
const tiny = (await one(`select public.purge_old_seed_data(false, interval '1 day') r`)).r;
check("a window under 7 days is floored at 7 (e survives)", (await ids()).includes("e") && tiny.jobs_deleted === 0, JSON.stringify(tiny));
const again = (await one(`select public.purge_old_seed_data(false) r`)).r;
check("a second live run deletes nothing more", again.jobs_deleted === 0 && again.notifications_deleted === 0);

// Profiles are never touched.
const prof = (await one(`select count(*)::int n from public.profiles`)).n;
check("profiles are never purged", prof === 2, String(prof));

// Grants.
for (const fn of ["public.purge_old_seed_data(boolean,interval,integer)", "public.run_seed_purge()", "public.is_fixture_email(text)", "public.jobs_seed_from_poster()", "public.profiles_seed_from_fixture_email()"]) {
  const g = await one(`select has_function_privilege('anon', '${fn}', 'EXECUTE') a, has_function_privilege('authenticated', '${fn}', 'EXECUTE') u`);
  check(`${fn}: no EXECUTE for anon / authenticated`, !g.a && !g.u, JSON.stringify(g));
}
const t = await one(`select has_table_privilege('anon', 'public.seed_purge_runs', 'SELECT') a, has_table_privilege('authenticated', 'public.seed_purge_runs', 'SELECT') u, relrowsecurity r from pg_class where oid = 'public.seed_purge_runs'::regclass`);
check("seed_purge_runs: RLS on, no anon/authenticated SELECT", t.r && !t.a && !t.u, JSON.stringify(t));
const pol = await one(`select count(*)::int n from public.cron_catchup_policy where jobname = 'purge-old-seed-data'`);
const exp = await one(`select count(*)::int n from public.cron_work_expectations where jobname = 'purge-old-seed-data'`);
check("cron catch-up policy and liveness expectation rows", pol.n === 1 && exp.n === 1);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
