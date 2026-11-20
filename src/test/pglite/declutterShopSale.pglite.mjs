#!/usr/bin/env node
/**
 * PGlite proof for 20261120014036_declutter_shop_sale (Declutter top 5 #4, owner 11-19): X% off every live listing for
 * a date range, put back by itself.
 *
 *   node src/test/pglite/declutterShopSale.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterShopSale.pglite.mjs  # RED: no such function
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterShopSale.pglite.mjs
 *
 * The migration runs on top of 20261120012729 (declutter_item_demand's first definition, which it restates).
 * Trimmed stand-in tables; auth.uid() and the membership helpers are stubs driven by settings. No cron schema here, so
 * the schedule step is skipped (as on any database without pg_cron). pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261120014036_declutter_shop_sale.sql`, "utf8");
const demandMig = readFileSync(`${MIG_DIR}20261120012729_declutter_item_demand.sql`, "utf8");
const foundation = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");
const watchTable = foundation.match(/CREATE TABLE IF NOT EXISTS public\.declutter_watchlist \([\s\S]*?\n\);/)[0];

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const S = "11111111-1111-4111-8111-111111111111", S2 = "22222222-2222-4222-8222-222222222222";
const it = (n) => `90000000-0000-4000-8000-00000000000${n}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table auth.users(id uuid primary key);
insert into auth.users values ('${S}'), ('${S2}');
create function public.require_feature(k text) returns void language sql as $$ select $$;
create function public.is_caller_banned() returns boolean language sql stable as $$ select current_setting('t.banned', true) = 'on' $$;
create function public.declutter_assert_member(b boolean) returns uuid language plpgsql as $$ begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if; return auth.uid(); end $$;
create table public.cron_defects(fn text, ref text, msg text);
create function public.log_cron_defect(f text, r text, m text) returns void language sql as $$ insert into public.cron_defects values (f, r, m) $$;
create function public.declutter_open_to_guests() returns boolean language sql stable as $$ select true $$;
create function public.feature_enabled_for(k text) returns boolean language sql stable as $$ select true $$;
create function public.seed_hidden_in_discovery() returns boolean language sql stable as $$ select true $$;
create function public.declutter_my_block_partners() returns uuid[] language sql stable as $$ select null::uuid[] $$;
create table public.profiles(user_id uuid primary key, is_seed boolean not null default false);
create table public.test_accounts(user_id uuid primary key);
create table public.declutter_items(id uuid primary key, seller_id uuid not null references auth.users(id), status text not null,
  price_cents integer not null, current_price_cents integer not null, seller_hidden boolean not null default false, is_seed boolean not null default false, updated_at timestamptz not null default now(),
  sale_mode text not null default 'offers', drop_pct smallint not null default 0, live_at timestamptz default now() - interval '1 day', last_price_drop_on date, price_dropped_at timestamptz, title text not null default 'x');
create function public.declutter_auto_free_due() returns integer language sql as $$ select 0 $$;
create table public.declutter_item_private(item_id uuid primary key references public.declutter_items(id), floor_price_cents integer, drop_stop_cents integer);
create table public.declutter_offers(id uuid primary key default gen_random_uuid(), item_id uuid not null, buyer_id uuid not null, created_at timestamptz not null default now());
create table public.declutter_item_views(id bigserial primary key, item_id uuid not null, viewer_id uuid, device_id text, created_at timestamptz not null default now());
`);
await db.exec(watchTable);
await db.exec(`
insert into public.declutter_items values
  ('${it(1)}', '${S}', 'live', 2000, 2000, false, false, now()),   -- 20% off -> $16
  ('${it(2)}', '${S}', 'live', 4000, 4000, false, false, now()),   -- floor $35 -> $35, not $32
  ('${it(3)}', '${S}', 'live', 100, 100, false, false, now()),     -- too cheap: untouched
  ('${it(4)}', '${S}', 'paused', 3000, 3000, false, false, now()), -- paused: untouched until it is live
  ('${it(5)}', '${S}', 'live', 1000, 1000, false, false, now()),   -- will be reserved at the end
  ('${it(6)}', '${S2}', 'live', 5000, 5000, false, false, now());  -- someone else's
insert into public.declutter_item_private values ('${it(1)}', null), ('${it(2)}', 3500), ('${it(5)}', null);
`);
await db.exec(demandMig);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const set = async (k, v) => db.exec(`select set_config('t.${k}', '${v ?? ""}', false)`);
const call = async (uid, sql) => { await set("uid", uid); try { return { v: (await db.query(sql)).rows[0] }; } catch (e) { return { err: e.message }; } };
const price = async (n) => (await db.query(`select current_price_cents c from public.declutter_items where id = '${it(n)}'`)).rows[0].c;
const sweep = async () => (await db.query(`select public.declutter_shop_sale_sweep() r`)).rows[0].r;

let r = await call(S, `select public.declutter_start_shop_sale(20, now(), now() + interval '3 days') id`);
ok(!!r.v?.id, `the seller starts 20% off now (${r.err ?? "ok"})`);
ok(await price(1) === 1600, "a $20 listing is $16 at once");
ok(await price(2) === 3500, "never below the seller's lowest price ($35, not $32)");
ok(await price(3) === 100 && await price(4) === 3000, "a $1 listing and a paused one are untouched");
ok(await price(6) === 5000, "another seller's listing is untouched");
const dem = (await call(null, `select item_id, sale_pct, sale_ends_at is not null e from public.declutter_item_demand(array['${it(1)}','${it(3)}']::uuid[]) order by item_id`)).v;
const demAll = (await db.query(`select item_id, sale_pct from public.declutter_item_demand(array['${it(1)}','${it(3)}']::uuid[]) order by item_id`)).rows;
ok(demAll.length === 2 && demAll[0].sale_pct === 20 && demAll[1].sale_pct === null && dem?.e === true, `buyers read "20% off, ends ..." only on a discounted listing (${JSON.stringify(demAll)})`);

ok(/sale_already_set/.test((await call(S, `select public.declutter_start_shop_sale(10, now(), now() + interval '1 day')`)).err ?? ""), "a second sale while one runs: refused");
ok(/invalid_sale_dates/.test((await call(S2, `select public.declutter_start_shop_sale(10, now(), now() + interval '20 days')`)).err ?? ""), "longer than 2 weeks: refused");
ok(/invalid_input/.test((await call(S2, `select public.declutter_start_shop_sale(70, now(), now() + interval '1 day')`)).err ?? ""), "more than 50% off: refused");
ok(/not_authenticated/.test((await call(null, `select public.declutter_start_shop_sale(10, now(), now() + interval '1 day')`)).err ?? ""), "signed out: refused");

// During the sale: the paused listing comes back and the sweep discounts it; the seller changes one price; one is reserved.
await db.exec(`update public.declutter_items set status = 'live' where id = '${it(4)}'`);
await sweep();
ok(await price(4) === 2400, "a listing that goes live during the sale gets the discount on the next sweep");
await db.exec(`update public.declutter_items set current_price_cents = 1500 where id = '${it(1)}'`); // the seller's own change
await db.exec(`update public.declutter_items set status = 'reserved' where id = '${it(5)}'`);

r = await call(S, `select public.declutter_end_shop_sale() s`);
ok(r.v?.s === "ended", `the seller ends it (${r.err ?? r.v?.s})`);
ok(await price(2) === 4000 && await price(4) === 3000, "prices go back to what they were");
ok(await price(1) === 1500, "a price the seller changed during the sale is kept");
ok(await price(5) === 800, "a reserved listing keeps its agreed sale price for now");
await db.exec(`update public.declutter_items set status = 'live' where id = '${it(5)}'`); // the hold ran out
await sweep();
ok(await price(5) === 1000, "once it is back on sale after the sale ended, the sweep puts its price back");
ok((await db.query(`select count(*)::int c from public.declutter_item_demand(array['${it(2)}']::uuid[]) where sale_pct is not null`)).rows[0].c === 0, "after the end no listing reads as on sale");

// A scheduled sale starts and ends by itself.
r = await call(S, `select public.declutter_start_shop_sale(10, now() + interval '1 day', now() + interval '2 days') id`);
ok(!!r.v?.id && await price(2) === 4000, "a sale set for tomorrow changes nothing today");
await db.exec(`update public.declutter_shop_sales set starts_at = now() - interval '1 minute' where status = 'scheduled'`);
let s = await sweep();
ok(s.started === 1 && await price(2) === 3600, `the sweep starts it when it is due (${JSON.stringify(s)})`);
await db.exec(`update public.declutter_shop_sales set ends_at = now() - interval '1 minute', starts_at = now() - interval '2 minutes' where status = 'on'`);
s = await sweep();
ok(s.ended === 1 && await price(2) === 4000, `and ends it when it is due (${JSON.stringify(s)})`);
ok((await call(S, `select public.declutter_end_shop_sale()`)).err?.includes("sale_not_found"), "nothing left to end: sale_not_found");

r = await call(S, `select public.declutter_start_shop_sale(10, now() + interval '1 day', now() + interval '2 days') id`);
ok((await call(S, `select public.declutter_end_shop_sale() s`)).v?.s === "cancelled", "a scheduled sale can be cancelled");
ok((await db.query(`select count(*)::int c from public.cron_defects`)).rows[0].c === 0, "no sweep step logged a defect");

// Lead 11-19: the nightly drop never stacks on a sale, and the end puts back the EXACT price (odd cents included).
await db.exec(`
insert into public.declutter_items (id, seller_id, status, price_cents, current_price_cents, drop_pct) values
  ('${it(7)}', '${S}', 'live', 1999, 1999, 5),     -- drops on, odd cents
  ('${it(8)}', '${S2}', 'live', 3000, 3000, 5);    -- drops on, no sale: drops tonight
insert into public.declutter_item_private (item_id, floor_price_cents) values ('${it(7)}', 500), ('${it(8)}', 500);
update public.declutter_items set last_price_drop_on = null;
`);
r = await call(S, `select public.declutter_start_shop_sale(15, now(), now() + interval '3 days') id`);
ok(!!r.v?.id && await price(7) === 1699, `15% off $19.99 is $16.99, to the cent (${await price(7)})`);
await db.query(`select public.declutter_price_drop_sweep()`);
ok(await price(7) === 1699, "the nightly drop skips a listing in a running sale (no 5% on top of the sale price)");
ok(await price(8) === 2800, `a listing outside any sale still drops as before ($30 -> $28) (${await price(8)})`);
await db.exec(`update public.declutter_items set last_price_drop_on = null`);
ok((await call(S, `select public.declutter_end_shop_sale() s`)).v?.s === "ended" && await price(7) === 1999, `the end puts back exactly $19.99 (${await price(7)})`);
await db.query(`select public.declutter_price_drop_sweep()`);
ok(await price(7) === 1800, `after the sale the nightly drop goes on from the restored price ($19.99 -> $18) (${await price(7)})`);
// A floor the "Answer offers for me" rule uses: the sale price is never below it, so an automatic answer never goes lower.
await db.exec(`update public.declutter_item_private set floor_price_cents = 1750 where item_id = '${it(7)}'; update public.declutter_items set current_price_cents = 1999 where id = '${it(7)}'`);
r = await call(S, `select public.declutter_start_shop_sale(30, now(), now() + interval '1 day') id`);
ok(await price(7) === 1750, `30% off stops at the seller's lowest price ($17.50), the floor offers answer at (${await price(7)})`);
await call(S, `select public.declutter_end_shop_sale()`);
ok(await price(7) === 1999, "and comes back to $19.99");

for (const [fn, sig, members] of [["declutter_start_shop_sale", "integer, timestamp with time zone, timestamp with time zone", true], ["declutter_end_shop_sale", "", true], ["declutter_shop_sale_sweep", "", false], ["declutter_shop_sale_apply", "uuid", false], ["declutter_shop_sale_restore", "uuid", false]]) {
  const a = (await db.query(`select proacl::text a from pg_proc where proname = '${fn}'`)).rows[0]?.a ?? "";
  ok(!/(^|[{,])=X/.test(a) && !/anon=X/.test(a) && (members ? /authenticated=X/.test(a) : !/authenticated=X/.test(a)), `${fn}(${sig}): ${members ? "members" : "service role only"} (${a})`);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
