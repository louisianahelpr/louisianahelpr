#!/usr/bin/env node
/**
 * PGlite proof for 20260925052618_prune_retention_tables (CJ-003, CS-003).
 *
 *   node src/test/pglite/pruneRetentionTables.pglite.mjs
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Seeds each
 * table with one row just past its window and one just inside it, prints
 * "OLD STATE RED" when nothing prunes them before the migration, then applies
 * the migration 3x (replay-safe) and exits 1 unless prune_retention_tables()
 * deletes exactly the rows past each window, keeps each user's newest
 * login_history row however old, and keeps a W-9 signed under 4 years ago.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const sql = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260925052618_prune_retention_tables.sql", import.meta.url)), "utf8");
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create table public.login_history(id serial primary key, user_id uuid, created_at timestamptz default now());
  create table public.notification_logs(id serial primary key, created_at timestamptz default now());
  create table public.profile_views(id serial primary key, viewed_at timestamp default LOCALTIMESTAMP);
  create table public.job_views(id serial primary key, first_viewed_at timestamptz default now());
  create table public.application_rate_log(id serial primary key, created_at timestamptz default now());
  create table public.profile_search_rate_log(id serial primary key, created_at timestamptz default now());
  create table public.helper_w9_records(id serial primary key, signed_at timestamptz default now());
  create table public.cron_catchup_policy(jobname text primary key, catch_up boolean, max_late interval, reason text, updated_at timestamptz);
  create table public.cron_work_expectations(jobname text primary key, expected_max_gap interval, note text);
`);

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
await db.exec(`
  -- U1: two rows past 365d; the newer of them is U1's newest and must stay.
  insert into public.login_history(user_id, created_at) values
    ('${U1}', now() - interval '500 days'), ('${U1}', now() - interval '400 days'),
  -- U2: one old row and one fresh one; only the old goes.
    ('${U2}', now() - interval '366 days'), ('${U2}', now() - interval '1 day');
  insert into public.notification_logs(created_at) values (now() - interval '181 days'), (now() - interval '179 days');
  insert into public.profile_views(viewed_at) values (LOCALTIMESTAMP - interval '181 days'), (LOCALTIMESTAMP - interval '179 days');
  insert into public.job_views(first_viewed_at) values (now() - interval '366 days'), (now() - interval '364 days');
  insert into public.application_rate_log(created_at) values (now() - interval '8 days'), (now() - interval '6 days');
  insert into public.profile_search_rate_log(created_at) values (now() - interval '8 days'), (now() - interval '6 days');
  insert into public.helper_w9_records(signed_at) values (now() - interval '4 years 1 day'), (now() - interval '3 years 364 days');
`);

const TABLES = ["login_history", "notification_logs", "profile_views", "job_views", "application_rate_log", "profile_search_rate_log", "helper_w9_records"];
const counts = async () => {
  const out = {};
  for (const t of TABLES) out[t] = Number((await db.query(`select count(*)::int n from public.${t}`)).rows[0].n);
  return out;
};

const before = await counts();
const fnBefore = (await db.query(`select to_regprocedure('public.prune_retention_tables()') is not null as f`)).rows[0].f;
if (!fnBefore && Object.values(before).every((n) => n >= 2)) {
  console.log("OLD STATE RED: no pruner exists; every past-window row is kept", JSON.stringify(before));
} else {
  console.error("unexpected old state", fnBefore, before);
  process.exit(1);
}

for (let i = 0; i < 3; i++) await db.exec(sql);

const res = (await db.query(`select public.prune_retention_tables() as r`)).rows[0].r;
const after = await counts();
const expected = { login_history: 2, notification_logs: 1, profile_views: 1, job_views: 1, application_rate_log: 1, profile_search_rate_log: 1, helper_w9_records: 1 };
const fails = [];
for (const t of TABLES) if (after[t] !== expected[t]) fails.push(`${t}: ${after[t]} left, want ${expected[t]}`);

const lh = (await db.query(`select user_id, (now() - created_at) > interval '365 days' as old from public.login_history order by user_id`)).rows;
if (!(lh.length === 2 && lh[0].user_id === U1 && lh[0].old === true && lh[1].user_id === U2 && lh[1].old === false)) {
  fails.push(`login_history kept the wrong rows: ${JSON.stringify(lh)}`);
}
if (res.login_history !== 2 || res.helper_w9_records !== 1) fails.push(`returned counts wrong: ${JSON.stringify(res)}`);

const pol = (await db.query(`select catch_up from public.cron_catchup_policy where jobname = 'prune-retention-tables'`)).rows;
const exp = (await db.query(`select expected_max_gap::text g from public.cron_work_expectations where jobname = 'prune-retention-tables'`)).rows;
if (pol.length !== 1 || pol[0].catch_up !== true) fails.push("no catch-up policy row");
if (exp.length !== 1) fails.push("no liveness expectation row");

// A second run deletes nothing more.
const again = (await db.query(`select public.prune_retention_tables() as r`)).rows[0].r;
if (Object.values(again).some((n) => n !== 0)) fails.push(`second run not idempotent: ${JSON.stringify(again)}`);

if (fails.length) {
  console.error("FAIL\n" + fails.join("\n"));
  process.exit(1);
}
console.log("GREEN after 3x apply:", JSON.stringify(res), JSON.stringify(after));
