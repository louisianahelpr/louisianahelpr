#!/usr/bin/env node
/**
 * PGlite proof for 20261107235110_declutter_seller_on_time_handovers (owner 11-07: the seller card's "On-time
 * handovers" badge, from real data, none when the data is thin).
 *
 *   node src/test/pglite/declutterSellerOnTimeHandovers.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerOnTimeHandovers.pglite.mjs  # RED: no such function
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterSellerOnTimeHandovers.pglite.mjs
 *
 * Trimmed stand-ins with only the columns the function reads (declutter_orders: seller_id, status, closed_at;
 * declutter_strikes: user_id, offender_side, reason, given_at, removed_at; profiles: user_id, is_seed). auth.uid(),
 * require_feature() and seed_hidden_for() are stubs driven by settings (said so inline).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261107235110_declutter_seller_on_time_handovers.sql`, "utf8");

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const GOOD = "11111111-1111-4111-8111-111111111111", THIN = "22222222-2222-4222-8222-222222222222";
const STRUCK = "33333333-3333-4333-8333-333333333333", OLD = "44444444-4444-4444-8444-444444444444";
const SEED = "55555555-5555-4555-8555-555555555555", ME = "66666666-6666-4666-8666-666666666666";
const CLEARED = "77777777-7777-4777-8777-777777777777", BUYERSIDE = "88888888-8888-4888-8888-888888888888";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
-- Stubs: the switch check (off when t.feature = off) and the seed rule (hidden when t.seedhidden = on).
create function public.require_feature(k text) returns void language plpgsql as $$ begin if coalesce(nullif(current_setting('t.feature', true), ''), 'on') = 'off' then raise exception 'feature_disabled' using errcode='42501'; end if; end $$;
create function public.seed_hidden_for(u uuid) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('t.seedhidden', true), ''), 'on') = 'on' $$;
create table public.profiles(user_id uuid primary key, is_seed boolean not null default false);
create table public.declutter_orders(id uuid primary key default gen_random_uuid(), seller_id uuid not null, status text not null, closed_at timestamptz);
create table public.declutter_strikes(id uuid primary key default gen_random_uuid(), user_id uuid not null, offender_side text not null, reason text not null, given_at timestamptz not null default now(), removed_at timestamptz);
insert into public.profiles values ('${GOOD}', false), ('${THIN}', false), ('${STRUCK}', false), ('${OLD}', false), ('${SEED}', true), ('${ME}', false), ('${CLEARED}', false), ('${BUYERSIDE}', false);
`);
const handovers = (seller, n, ago = "10 days") => db.exec(`insert into public.declutter_orders (seller_id, status, closed_at) select '${seller}', 'handed_over', now() - interval '${ago}' from generate_series(1, ${n})`);
await handovers(GOOD, 5);
await db.exec(`insert into public.declutter_orders (seller_id, status, closed_at) values ('${GOOD}', 'expired', now()), ('${GOOD}', 'paid', null)`);
await handovers(THIN, 4);
await db.exec(`insert into public.declutter_orders (seller_id, status, closed_at) values ('${THIN}', 'expired', now()), ('${THIN}', 'refunded', now())`);
await handovers(STRUCK, 9);
await db.exec(`insert into public.declutter_strikes (user_id, offender_side, reason, given_at) values ('${STRUCK}', 'seller', 'seller_no_show', now() - interval '30 days')`);
await handovers(OLD, 3);
await handovers(OLD, 4, "400 days");
await handovers(SEED, 6);
await handovers(CLEARED, 6);
await db.exec(`insert into public.declutter_strikes (user_id, offender_side, reason, given_at, removed_at) values
  ('${CLEARED}', 'seller', 'item_gone_after_sale', now() - interval '20 days', now() - interval '5 days'),
  ('${CLEARED}', 'seller', 'not_as_described', now() - interval '400 days', null)`);
await handovers(BUYERSIDE, 5);
await db.exec(`insert into public.declutter_strikes (user_id, offender_side, reason) values ('${BUYERSIDE}', 'buyer', 'not_picked_up'), ('${BUYERSIDE}', 'buyer', 'not_as_described'), ('${BUYERSIDE}', 'seller', 'cancelled_after_offers')`);

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const set = (k, v) => db.exec(`select set_config('t.${k}', '${v ?? ""}', false)`);
const ask = async (seller, uid = ME) => {
  await set("uid", uid);
  try { return { v: (await db.query(`select public.declutter_seller_on_time_handovers(${seller ? `'${seller}'` : "null"}) v`)).rows[0].v }; } catch (e) { return { err: e.message }; }
};

ok((await ask(GOOD)).v === true, "5 handovers this year, no strike: true");
ok((await ask(THIN)).v === false, "4 handovers (thin data; expired and refunded orders don't count): false");
ok((await ask(STRUCK)).v === false, "9 handovers but a standing seller no-show strike: false");
ok((await ask(OLD)).v === false, "handovers older than a year don't count: false");
ok((await ask(CLEARED)).v === true, "a removed strike and one older than a year don't count: true");
ok((await ask(BUYERSIDE)).v === true, "a buyer-side strike or a non-handover seller strike doesn't count: true");
ok((await ask(SEED)).v === false, "a test seller, test accounts hidden from the caller: false");
await set("seedhidden", "off");
ok((await ask(SEED)).v === true, "a test seller, test accounts shown to the caller: true");
await set("seedhidden", "on");
ok((await ask(null)).v === false, "no seller: false");
ok((await ask(GOOD, "")).err?.includes("not_authenticated"), "no caller: not_authenticated");
await set("feature", "off");
ok((await ask(GOOD)).err?.includes("feature_disabled"), "Declutter off: feature_disabled");
await set("feature", "on");

const res = (await db.query(`select pg_get_function_result('public.declutter_seller_on_time_handovers(uuid)'::regprocedure) r`)).rows[0].r;
ok(res === "boolean", `returns one boolean, never counts (${res})`);
const fn = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c, provolatile v from pg_proc where proname = 'declutter_seller_on_time_handovers'`)).rows[0];
ok(fn?.d === true && /search_path=public, pg_temp/.test(fn?.c ?? "") && fn?.v === "s", "SECURITY DEFINER, STABLE, search_path public, pg_temp");
ok(!!fn && !/(^|[{,])anon=/.test(fn.a) && !/(^|[{,])=X/.test(fn.a), `anon and PUBLIC cannot run it (${fn?.a})`);
ok(!!fn && /authenticated=X/.test(fn.a) && /service_role=X/.test(fn.a), "members and service_role can");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
