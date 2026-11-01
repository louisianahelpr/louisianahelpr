#!/usr/bin/env node
/**
 * PGlite proof for 20261031224638_owner_daily_summary_stats (OPS-1 review fix, lead 10-31): every count in the
 * owner's daily summary leaves out test subjects, not only is_seed rows.
 *
 *   node src/test/pglite/ownerDailySummaryStats.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/ownerDailySummaryStats.pglite.mjs  # RED: before it (nothing exists)
 *
 * World: auth.users, profiles, test_accounts, jobs, declutter_items, declutter_orders, declutter_payouts, reports,
 * messages, error_logs, member_signup_sources, with the columns the function reads.
 * Stubbed, and said so: is_test_subject = a seed profile, a test_accounts row or an example.com login (the real one:
 * is_test_member OR a fixture/example email, 20261030143141). Each world has one real row and one or more test rows
 * per count, so a count that keeps a test row reads too high.
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261031224638_owner_daily_summary_stats.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const REAL = "11111111-1111-1111-1111-111111111111"; // a real member
const REAL2 = "22222222-2222-2222-2222-222222222222"; // a second real member
const SEED = "33333333-3333-3333-3333-333333333333"; // a seed profile
const LISTED = "44444444-4444-4444-4444-444444444444"; // a test_accounts row, profile NOT seed
const EMAIL = "55555555-5555-5555-5555-555555555555"; // an example.com login, profile NOT seed, not listed
const TESTS = [SEED, LISTED, EMAIL];

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false,
    created_at timestamptz not null default now());
  create table public.test_accounts (user_id uuid primary key);
  create function public.is_test_subject(p uuid) returns boolean language sql stable as $f$
    select p is not null and (
      exists (select 1 from public.profiles x where x.user_id = p and x.is_seed is true)
      or exists (select 1 from public.test_accounts t where t.user_id = p)
      or exists (select 1 from auth.users u where u.id = p and u.email like '%@example.com')) $f$;
  create table public.jobs (id uuid primary key default gen_random_uuid(), customer_id uuid, helper_id uuid,
    status text default 'open', is_seed boolean default false,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create table public.declutter_items (id uuid primary key default gen_random_uuid(), seller_id uuid,
    is_seed boolean default false, live_at timestamptz);
  create table public.declutter_orders (id uuid primary key default gen_random_uuid(), buyer_id uuid, seller_id uuid,
    total_cents integer, is_seed boolean default false, paid_at timestamptz);
  create table public.declutter_payouts (id uuid primary key default gen_random_uuid(), seller_id uuid, status text,
    is_seed boolean default false);
  create table public.reports (id uuid primary key default gen_random_uuid(), reporter_id uuid, reported_type text,
    reported_id uuid, status text default 'pending');
  create table public.messages (id uuid primary key default gen_random_uuid(), sender_id uuid);
  create table public.error_logs (id uuid primary key default gen_random_uuid(), user_id uuid, severity text,
    tags jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  create table public.member_signup_sources (user_id uuid primary key, source text, recorded_at timestamptz default now());

  insert into auth.users values ('${REAL}', 'ana@mail.la'), ('${REAL2}', 'ben@mail.la'), ('${SEED}', 'seed@mail.la'),
    ('${LISTED}', 'listed@mail.la'), ('${EMAIL}', 'audit@example.com');
  insert into public.profiles (user_id, is_seed) values ('${REAL}', false), ('${REAL2}', false), ('${SEED}', true),
    ('${LISTED}', false), ('${EMAIL}', false);
  insert into public.test_accounts values ('${LISTED}');
`);
// One real row per count, then the same row from each kind of test subject (none of which is is_seed-tagged on
// the row itself, which is exactly what is_seed = false let through).
await db.exec(`
  insert into public.jobs (customer_id, helper_id, status) values ('${REAL}', '${REAL2}', 'completed'),
    ${TESTS.map((t) => `('${t}', '${REAL2}', 'completed'), ('${REAL}', '${t}', 'completed')`).join(", ")};
  insert into public.jobs (customer_id, status, is_seed) values ('${REAL}', 'open', true);
  insert into public.declutter_items (seller_id, live_at) values ('${REAL}', now()), ${TESTS.map((t) => `('${t}', now())`).join(", ")};
  insert into public.declutter_orders (buyer_id, seller_id, total_cents, paid_at) values ('${REAL}', '${REAL2}', 2500, now()),
    ${TESTS.map((t) => `('${t}', '${REAL2}', 9900, now()), ('${REAL}', '${t}', 9900, now())`).join(", ")};
  insert into public.declutter_payouts (seller_id, status) values ('${REAL}', 'failed'), ${TESTS.map((t) => `('${t}', 'failed')`).join(", ")};
  insert into public.messages (id, sender_id) values ('aaaaaaaa-0000-0000-0000-000000000001', '${REAL}'),
    ('aaaaaaaa-0000-0000-0000-000000000002', '${EMAIL}');
  insert into public.reports (reporter_id, reported_type, reported_id) values
    ('${REAL}', 'user', '${REAL2}'),
    ${TESTS.map((t) => `('${t}', 'user', '${REAL2}'), ('${REAL}', 'user', '${t}')`).join(", ")},
    ('${REAL}', 'job', (select id from public.jobs where customer_id = '${LISTED}' limit 1)),
    ('${REAL}', 'job', (select id from public.jobs where is_seed limit 1)),
    ('${REAL}', 'message', 'aaaaaaaa-0000-0000-0000-000000000002'),
    ('${REAL2}', 'message', 'aaaaaaaa-0000-0000-0000-000000000001');
  insert into public.error_logs (user_id, severity, tags) values ('${REAL}', 'error', '{}'), ('${REAL}', 'fatal', '{"source":"app"}'),
    ('${REAL2}', 'error', '{"seed":"true"}'), ('${REAL2}', 'error', '{"source":"checkout-seed"}'), ('${REAL2}', 'warning', '{}'),
    ${TESTS.map((t) => `('${t}', 'error', '{}')`).join(", ")};
  insert into public.member_signup_sources (user_id, source) values ('${REAL}', 'facebook'), ('${REAL2}', 'direct'),
    ('${SEED}', 'facebook'), ('${LISTED}', 'facebook'), ('${EMAIL}', 'zzz');
`);

if (!SKIP) {
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times
  check(true, "[keep] applied three times without error");
}

const tryQ = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: e.message }; } };
const r = await tryQ(`select public.owner_daily_summary_stats(now() - interval '24 hours') as s`);
const s = r.error ? null : r[0].s;
check(!!s, `[fix] the function runs (${r.error ?? "ok"})`);
const n = (k) => (s ? Number(s[k]) : NaN);
check(n("new_users") === 2, `[fix] sign-ups: only the 2 real members (got ${n("new_users")})`);
check(n("jobs_posted") === 4, `[fix] jobs posted: the real poster's 4 (one with a test Helpr still posted by a real member; the seeded job left out) (got ${n("jobs_posted")})`);
check(n("jobs_completed") === 1, `[fix] jobs completed: only the one with a real poster AND a real Helpr (got ${n("jobs_completed")})`);
check(n("items_posted") === 1, `[fix] items posted: only the real seller's (got ${n("items_posted")})`);
check(n("items_sold") === 1 && n("sales_cents") === 2500, `[fix] sales: only the real buyer-and-seller order, $25 (got ${n("items_sold")}, ${n("sales_cents")})`);
check(n("failed_payouts") === 1, `[fix] failed payouts: only the real seller's (got ${n("failed_payouts")})`);
check(n("open_reports") === 2, `[fix] open reports: real reporter about a real user, and about a real member's message (got ${n("open_reports")})`);
check(n("member_errors") === 2 && n("members_with_errors") === 1,
  `[fix] member errors: the real member's 2, not seed-tagged rows, warnings or test accounts (got ${n("member_errors")}, ${n("members_with_errors")})`);
check(JSON.stringify(s?.top_sources) === JSON.stringify([{ source: "direct", signups: 1 }, { source: "facebook", signups: 1 }]),
  `[fix] top sources: real members only (got ${JSON.stringify(s?.top_sources)})`);
check(s && Object.keys(s).sort().join(",") ===
  "failed_payouts,items_posted,items_sold,jobs_completed,jobs_posted,member_errors,members_with_errors,new_users,open_reports,sales_cents,top_sources",
  "[fix] the answer holds counts only, under the names the edge function reads");

// Nothing but service_role may call it.
const acl = await tryQ(`select has_function_privilege('anon', 'public.owner_daily_summary_stats(timestamptz)', 'execute') as a,
  has_function_privilege('authenticated', 'public.owner_daily_summary_stats(timestamptz)', 'execute') as b,
  has_function_privilege('service_role', 'public.owner_daily_summary_stats(timestamptz)', 'execute') as c`);
check(!acl.error && acl[0].a === false && acl[0].b === false && acl[0].c === true,
  `[fix] only service_role can call it (${JSON.stringify(acl.error ?? acl[0])})`);
const vol = await tryQ(`select provolatile, prosecdef from pg_proc where proname = 'owner_daily_summary_stats'`);
check(!vol.error && vol[0]?.provolatile === "s" && vol[0]?.prosecdef === true, `[fix] STABLE and SECURITY DEFINER (${JSON.stringify(vol.error ?? vol[0])})`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
