#!/usr/bin/env node
/**
 * PGlite proof for 20261027165232_delivery_take_without_payout_setup (Q2416, owner 2026-10-27:
 * anyone eligible may take a Declutter delivery without payout setup; the pay waits for the account).
 *
 *   node src/test/pglite/deliveryTakeWithoutPayoutSetup.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/deliveryTakeWithoutPayoutSetup.pglite.mjs  # RED: prod before it
 *
 * World: helpr_task_assert_helpr at its newest CREATE before this migration (md5(prosrc) measured equal
 * to prod 2026-10-27: 9ca10758ce71d18481ccbdab653e023b), the REAL readiness chain it now reads
 * (helper_accept_missing from 20261025162003, identity_is_verified, helper_award_block_reason), and a
 * profiles table with the columns they read. Stubbed, and said so: feature_enabled_for_user (a table of
 * which member has which switch on; the real one reads feature_switches + roles), is_caller_banned,
 * member_under_18 and declutter_active_strike_count (each answered from the profile row so each refusal
 * can be driven).
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261027165232_delivery_take_without_payout_setup.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE of `name` in a migration before `before` (any dollar-quote tag). */
function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return { file: FILES[i], sql: src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";", body: src.slice(open + tag.length, src.indexOf(tag, open + tag.length)) };
  }
  throw new Error(`${name}: no definition before ${before}`);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

// The restated body starts from prod's: the newest before-body must hash to what prod runs.
const before = newest("helpr_task_assert_helpr");
check(createHash("md5").update(before.body).digest("hex") === "9ca10758ce71d18481ccbdab653e023b",
  `[keep] the before-body (${before.file}) is prod's (md5 9ca10758...)`);

const NOPAY = "22222222-2222-2222-2222-222222222222";
const READY = "33333333-3333-3333-3333-333333333333";
const OFFSW = "44444444-4444-4444-4444-444444444444";
const BANNED = "55555555-5555-5555-5555-555555555555";
const MINOR = "66666666-6666-6666-6666-666666666666";
const STRUCK = "77777777-7777-7777-7777-777777777777";
const GHOST = "88888888-8888-8888-8888-888888888888";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false, stripe_account_id text,
    stripe_payouts_enabled boolean, idv_status text, stripe_identity_verified boolean,
    banned boolean default false, minor boolean default false, strikes int default 0);
  insert into public.profiles (user_id, stripe_account_id, stripe_payouts_enabled, banned, minor, strikes) values
    ('${NOPAY}', null, null, false, false, 0), ('${READY}', 'acct_r', true, false, false, 0),
    ('${OFFSW}', null, null, false, false, 0), ('${BANNED}', null, null, true, false, 0),
    ('${MINOR}', null, null, false, true, 0), ('${STRUCK}', null, null, false, false, 3);
  create table public.test_accounts (user_id uuid primary key, enrolled_at timestamptz not null default now(), note text);
  -- payout_after_hire is at everyone on prod (measured 2026-10-27); OFFSW models a member it is off for.
  create table public.switch_on (key text, user_id uuid);
  insert into public.switch_on select 'payout_after_hire', user_id from public.profiles where user_id <> '${OFFSW}';
  create function public.feature_enabled_for_user(p_key text, p_user_id uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.switch_on s where s.key = p_key and s.user_id = p_user_id) $f$;
  create function public.is_caller_banned() returns boolean language sql stable as
    $f$ select coalesce((select banned from public.profiles where user_id = auth.uid()), false) $f$;
  create function public.member_under_18(p uuid) returns boolean language sql stable as
    $f$ select coalesce((select minor from public.profiles where user_id = p), false) $f$;
  create function public.declutter_active_strike_count(p uuid) returns int language sql stable as
    $f$ select coalesce((select strikes from public.profiles where user_id = p), 0) $f$;
`);
for (const fn of ["identity_is_verified", "helper_accept_missing", "helper_award_block_reason"]) await db.exec(newest(fn).sql);
await db.exec(before.sql);
await db.exec(`REVOKE ALL ON FUNCTION public.helpr_task_assert_helpr() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.helpr_task_assert_helpr() TO service_role;`);
if (!SKIP) {
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times
}

async function as(uid) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try {
    const r = await db.query("select public.helpr_task_assert_helpr()::text as u");
    return { ok: true, uid: r.rows[0].u };
  } catch (e) {
    return { ok: false, code: String(e.message) };
  }
}

const nopay = await as(NOPAY);
check(nopay.ok && nopay.uid === NOPAY, "[fix] a member with NO payout account may see and take deliveries while payout_after_hire is on");
const ready = await as(READY);
check(ready.ok && ready.uid === READY, "[keep] a member with payouts ready may deliver");
const off = await as(OFFSW);
check(!off.ok && off.code === "payout_setup_incomplete", "[keep] with payout_after_hire OFF for the member, no payout account is still refused (payout_setup_incomplete)");
const banned = await as(BANNED);
check(!banned.ok && banned.code === "account_restricted", "[keep] a banned member is refused (account_restricted)");
const minor = await as(MINOR);
check(!minor.ok && minor.code === "under_18", "[keep] a member under 18 is refused (under_18)");
const struck = await as(STRUCK);
check(!struck.ok && struck.code === "declutter_strikes_blocked", "[keep] 3 Declutter strikes are refused (declutter_strikes_blocked)");
const ghost = await as(GHOST);
check(!ghost.ok && ghost.code === "payout_setup_incomplete", "[keep] a caller with no profile row is refused");
const anon = await as(null);
check(!anon.ok && anon.code === "not_authenticated", "[keep] no session is refused (not_authenticated)");

const acl = await db.query(`select coalesce(proacl::text, '') as a from pg_proc where proname = 'helpr_task_assert_helpr'`);
check(!/(?:authenticated=)|(?:anon=)|(?:=X\/[a-z_]*,?$)/.test(acl.rows[0].a.replace(/service_role=X\/\w+|postgres=X\/\w+/g, "")) && /service_role=X/.test(acl.rows[0].a),
  `[keep] EXECUTE stays service_role only (${acl.rows[0].a})`);

console.log(failures === 0 ? `\nALL PASS${SKIP ? " (before state)" : " (after, 3x replay)"}` : `\n${failures} FAIL${SKIP ? " (before state: expected for [fix])" : ""}`);
process.exit(failures === 0 ? 0 : 1);
