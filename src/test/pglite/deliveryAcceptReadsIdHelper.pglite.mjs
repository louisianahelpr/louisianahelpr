#!/usr/bin/env node
/**
 * PGlite proof for 20261020044552_delivery_accept_reads_id_helper (owner,
 * 2026-10-20: ID once, at every accept, by ONE helper).
 *
 *   node src/test/pglite/deliveryAcceptReadsIdHelper.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/deliveryAcceptReadsIdHelper.pglite.mjs  # RED: prod before it
 *
 * World: helpr_task_accept at its newest CREATE before this migration (md5 of
 * its body measured equal to prod 2026-10-20), the real ID-once helper chain
 * (identity_is_verified, helper_accept_missing, helper_accept_block_reason),
 * and a helpr_tasks table with the columns the accept reads. Stubbed, and said
 * so (not under test here; declutterDelivery.pglite.mjs proves them):
 * helpr_task_assert_helpr (returns the caller: its ban, age, strike and payout
 * refusals are unchanged), the source/feature/vehicle/slot/lock/log helpers,
 * is_caller_banned and are_users_blocked (false).
 *
 * Every Helpr has payouts READY; only the ID differs.
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261020044552_delivery_accept_reads_id_helper.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const NOID = "22222222-2222-2222-2222-222222222222";
const IDV = "33333333-3333-3333-3333-333333333333";
const CONNECT = "44444444-4444-4444-4444-444444444444";
const SELLER = "11111111-1111-1111-1111-111111111111";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false, stripe_account_id text,
    stripe_payouts_enabled boolean, idv_status text, stripe_identity_verified boolean);
  insert into public.profiles (user_id, stripe_account_id, stripe_payouts_enabled, idv_status, stripe_identity_verified) values
    ('${SELLER}', 'acct_s', true, 'verified', null), ('${NOID}', 'acct_n', true, null, false),
    ('${IDV}', 'acct_i', true, 'verified', false), ('${CONNECT}', 'acct_c', true, null, true);
  create table public.helpr_tasks (id uuid primary key default gen_random_uuid(), source_kind text not null default 'declutter_delivery',
    source_id uuid not null default gen_random_uuid(), status text not null default 'open', size text not null default 'small',
    customer_id uuid, pickup_contact_id uuid, helpr_id uuid, open_until timestamptz not null default now() + interval '3 days',
    latest_pickup_at timestamptz not null default now() + interval '7 days', accepted_at timestamptz,
    pickup_slot_start timestamptz, updated_at timestamptz default now());
  create table public.helpr_task_events (task_id uuid, actor_id uuid, task_event text, created_at timestamptz default now());
  -- prod's test_accounts (20261007033530): the ID-once helper reads it since the
  -- review fix in 20261020043346; empty here, so no Helpr is a test account.
  create table public.test_accounts (user_id uuid primary key, enrolled_at timestamptz not null default now(), note text);
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select false $f$;
  create function public.are_users_blocked(uuid, uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.helpr_task_assert_helpr() returns uuid language sql stable as $f$ select auth.uid() $f$;
  create function public.helpr_task_source_require_feature(text) returns void language sql as $f$ select $f$;
  create function public.helpr_task_same_stripe_mode(uuid, uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.helpr_task_vehicle_fits(uuid, text) returns boolean language sql stable as $f$ select true $f$;
  create function public.helpr_task_lock(p uuid) returns public.helpr_tasks language sql as
    $f$ select * from public.helpr_tasks where id = p for update $f$;
  create function public.helpr_task_source_held(text, uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.helpr_task_source_slot_ok(text, uuid, timestamptz) returns boolean language sql stable as $f$ select true $f$;
  create function public.helpr_task_log(uuid, text, uuid, text) returns void language sql as $f$ select $f$;
  create function public.helpr_task_source_event(uuid, text, text) returns void language sql as $f$ select $f$;
  ${["identity_is_verified", "helper_accept_missing", "helper_accept_block_reason", "helpr_task_accept"].map((n) => newest(n)).join("\n")}
  grant select, update on public.helpr_tasks to authenticated;
`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readFileSync(MIG_DIR + THIS, "utf8"));

const as = async (uid, sql) => {
  try {
    await db.exec(`set request.jwt.claim.sub = '${uid}'; set role authenticated;`);
    const out = await db.query(sql);
    return { ok: true, rows: out.rows };
  } catch (e) {
    return { ok: false, err: String(e.message).split("\n")[0] };
  } finally {
    await db.exec("reset role; reset request.jwt.claim.sub;");
  }
};
const task = async () => (await db.query(`insert into public.helpr_tasks (customer_id, pickup_contact_id) values ('${SELLER}', '${SELLER}') returning id`)).rows[0].id;
const helprOf = async (id) => (await db.query(`select helpr_id from public.helpr_tasks where id='${id}'`)).rows[0].helpr_id;
const slot = "now() + interval '1 day'";

const t1 = await task();
const r1 = await as(NOID, `select public.helpr_task_accept('${t1}', ${slot}) r`);
check(!r1.ok && /helper_identity_unverified/.test(r1.err) && (await helprOf(t1)) === null,
  `[fix] T1: an unverified Helpr cannot take a delivery (refused helper_identity_unverified, not assigned) (${r1.ok ? "taken" : r1.err})`);
const t2 = await task();
const r2 = await as(IDV, `select public.helpr_task_accept('${t2}', ${slot}) r`);
check(r2.ok && (await helprOf(t2)) === IDV, `[keep] T2: an Identity-verified Helpr takes it (${r2.ok ? "ok" : r2.err})`);
const t3 = await task();
const r3 = await as(CONNECT, `select public.helpr_task_accept('${t3}', ${slot}) r`);
check(r3.ok && (await helprOf(t3)) === CONNECT, `[keep] T3: a Connect-verified Helpr takes it (${r3.ok ? "ok" : r3.err})`);
if (!SKIP) {
  const acl = (await db.query(`select coalesce(array_to_string(proacl, ','), '') a from pg_proc where proname = 'helpr_task_accept'`)).rows[0].a;
  check(/authenticated=X/.test(acl) && !/(^|,)anon=/.test(acl) && !/(^|,)=X/.test(acl),
    `[fix] G1: grants restated: authenticated may call it, anon and PUBLIC may not (${acl})`);
}

console.log(failures ? `\n${failures} FAILED${SKIP ? " (expected on the before state: the [fix] checks)" : ""}` : "\nALL PASS");
process.exit(failures ? 1 : 0);
