#!/usr/bin/env node
/**
 * PGlite proof for 20261120015456_declutter_bulk_and_away (Declutter top 5 #5, owner 11-19): bulk discount and away
 * mode.
 *
 *   node src/test/pglite/declutterBulkAndAway.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBulkAndAway.pglite.mjs  # RED: no such function
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterBulkAndAway.pglite.mjs
 *
 * declutter_pause_listing is its REAL newest body (cut from 20261103052255), so "away" pauses exactly as Pause does
 * (open offers close, buyers told). declutter_offers / _events are the real CREATEs. The rest are trimmed stand-ins and
 * setting-driven stubs. pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261120015456_declutter_bulk_and_away.sql`, "utf8");
const cut = (src, re) => { const m = src.match(re); if (!m) throw new Error(`not found: ${re}`); return m[0]; };
const slice3 = readFileSync(`${MIG_DIR}20261014210518_declutter_slice3_offers_checkout.sql`, "utf8");
const pauseFn = cut(readFileSync(`${MIG_DIR}20261103052255_declutter_wanted_homes_admin_not_found_is_404.sql`, "utf8"),
  /CREATE OR REPLACE FUNCTION public\.declutter_pause_listing\(p_item_id uuid\)[\s\S]*?\n\$fn\$;/);

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const S = "11111111-1111-4111-8111-111111111111", S2 = "22222222-2222-4222-8222-222222222222", B = "bbbbbbbb-1111-4111-8111-111111111111";
const it = (n) => `90000000-0000-4000-8000-00000000000${n}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table auth.users(id uuid primary key);
insert into auth.users values ('${S}'), ('${S2}'), ('${B}');
create function public.require_feature(k text) returns void language sql as $$ select $$;
create function public.is_caller_banned() returns boolean language sql stable as $$ select current_setting('t.banned', true) = 'on' $$;
create function public.declutter_assert_member(b boolean) returns uuid language plpgsql as $$ begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if; return auth.uid(); end $$;
create function public.declutter_seller_out(u uuid) returns boolean language sql stable as $$ select coalesce(u::text = nullif(current_setting('t.out', true), ''), false) $$;
create table public.cron_defects(fn text, ref text, msg text);
create function public.log_cron_defect(f text, r text, m text) returns void language sql as $$ insert into public.cron_defects values (f, r, m) $$;
create table public.notices(user_id uuid, title text, message text);
create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language sql as $$ insert into public.notices values (p_user, p_title, p_message) $$;
create table public.declutter_items(id uuid primary key, seller_id uuid not null references auth.users(id), title text not null default 'x',
  status text not null, current_price_cents integer not null, updated_at timestamptz not null default now());
create table public.declutter_item_private(item_id uuid primary key references public.declutter_items(id), floor_price_cents integer);
create table public.declutter_pickup_windows(seller_id uuid not null);
`);
await db.exec(cut(slice3, /CREATE TABLE IF NOT EXISTS public\.declutter_offers \([\s\S]*?\n\);/));
await db.exec(cut(slice3, /CREATE TABLE IF NOT EXISTS public\.declutter_offer_events \([\s\S]*?\n\);/));
await db.exec(pauseFn);
await db.exec(`
insert into public.declutter_items (id, seller_id, status, current_price_cents) values
  ('${it(1)}', '${S}', 'live', 2000), ('${it(2)}', '${S}', 'live', 4000), ('${it(3)}', '${S}', 'paused', 1000),
  ('${it(4)}', '${S}', 'live', 150), ('${it(5)}', '${S}', 'sold', 3000), ('${it(6)}', '${S2}', 'live', 5000);
insert into public.declutter_item_private values ('${it(2)}', 3500);
insert into public.declutter_pickup_windows values ('${S}');
insert into public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by)
  values ('${it(1)}', '${B}', '${S}', 1500, 'seller', now() + interval '48 hours');
`);

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const set = async (k, v) => db.exec(`select set_config('t.${k}', '${v ?? ""}', false)`);
const call = async (uid, sql) => { await set("uid", uid); try { return { v: (await db.query(sql)).rows[0] }; } catch (e) { return { err: e.message }; } };
const row = async (n) => (await db.query(`select status, current_price_cents c from public.declutter_items where id = '${it(n)}'`)).rows[0];
const ALL = `array['${[1, 2, 3, 4, 5, 6].map(it).join("','")}']::uuid[]`;

// Bulk discount.
let r = await call(S, `select public.declutter_bulk_discount(${ALL}, 20) n`);
ok(r.v?.n === 3, `20% off: 3 prices changed (live $20, live $40 at its floor, paused $10) (${r.v?.n ?? r.err})`);
ok((await row(1)).c === 1600 && (await row(2)).c === 3500 && (await row(3)).c === 800, "$20 -> $16, $40 stops at its $35 lowest, paused $10 -> $8");
ok((await row(4)).c === 150 && (await row(5)).c === 3000 && (await row(6)).c === 5000, "a $1.50 listing, a sold one and someone else's are untouched");
ok(/invalid_input/.test((await call(S, `select public.declutter_bulk_discount(${ALL}, 60)`)).err ?? ""), "more than 50%: refused");
ok(/invalid_input/.test((await call(S, `select public.declutter_bulk_discount((select array_agg(gen_random_uuid()) from generate_series(1, 101)), 10)`)).err ?? ""), "more than 100 listings: refused");
ok(/not_authenticated/.test((await call(null, `select public.declutter_bulk_discount(${ALL}, 10)`)).err ?? ""), "signed out: refused");

// Away.
ok(/invalid_away_date/.test((await call(S, `select public.declutter_go_away(((now() AT TIME ZONE 'America/Chicago')::date))`)).err ?? ""), "away until today: refused");
ok(/invalid_away_date/.test((await call(S, `select public.declutter_go_away(((now() AT TIME ZONE 'America/Chicago')::date + 91))`)).err ?? ""), "more than 90 days: refused");
r = await call(S, `select public.declutter_go_away(((now() AT TIME ZONE 'America/Chicago')::date + 7)) n`);
ok(r.v?.n === 3, `away a week: the 3 live listings pause (${r.v?.n ?? r.err})`);
ok((await row(1)).status === "paused" && (await row(4)).status === "paused" && (await row(6)).status === "live", "the seller's live listings are paused; another seller's are not");
const off = (await db.query(`select status from public.declutter_offers where item_id = '${it(1)}'`)).rows[0];
const told = (await db.query(`select title from public.notices where user_id = '${B}'`)).rows;
ok(off?.status === "voided" && told.length === 1 && told[0].title === "Item paused", "the open offer closes and the buyer is told, exactly as Pause");
const until = (await call(null, `select public.declutter_seller_away_until('${S}') d`)).v?.d;
ok(!!until, `a guest reads "Away until ..." on the seller's page (${until})`);
ok((await call(null, `select public.declutter_seller_away_until('${S2}') d`)).v?.d === null, "a seller who is not away: no date");

// Again while away: a new listing pauses too and the date moves.
await db.exec(`insert into public.declutter_items (id, seller_id, status, current_price_cents) values ('${it(7)}', '${S}', 'live', 900)`);
r = await call(S, `select public.declutter_go_away(((now() AT TIME ZONE 'America/Chicago')::date + 3)) n`);
ok(r.v?.n === 1 && (await row(7)).status === "paused", "going away again pauses what was listed since");
const ids = (await db.query(`select cardinality(paused_item_ids) n from public.declutter_seller_away where seller_id = '${S}'`)).rows[0].n;
ok(ids === 4, `and remembers all 4 it paused (${ids})`);

// The return date comes: the sweep puts back what the away paused, never the listing that was paused before.
await db.exec(`update public.declutter_seller_away set back_on = (now() AT TIME ZONE 'America/Chicago')::date`);
const s = (await db.query(`select public.declutter_away_sweep() r`)).rows[0].r;
ok(s.sellers_back === 1 && s.listings_back === 4, `the sweep returns the seller and 4 listings (${JSON.stringify(s)})`);
ok((await row(1)).status === "live" && (await row(7)).status === "live", "the listings the away paused are on sale again");
ok((await row(3)).status === "paused", "a listing the seller had paused before stays paused");
ok((await call(null, `select public.declutter_seller_away_until('${S}') d`)).v?.d === null, "the page no longer says away");

// "I'm back" early; a seller with no pickup time keeps their listings paused (Relist's own rule).
await call(S, `select public.declutter_go_away(((now() AT TIME ZONE 'America/Chicago')::date + 5))`);
await db.exec(`delete from public.declutter_pickup_windows`);
r = await call(S, `select public.declutter_come_back() n`);
ok(r.v?.n === 0 && (await row(1)).status === "paused", `no pickup time on file: nothing goes live, as Relist (${r.v?.n ?? r.err})`);
ok(/not_away/.test((await call(S, `select public.declutter_come_back()`)).err ?? ""), "not away: not_away");
await db.exec(`insert into public.declutter_pickup_windows values ('${S}'); update public.declutter_items set status = 'live' where seller_id = '${S}' and id <> '${it(5)}'`);
await call(S, `select public.declutter_go_away(((now() AT TIME ZONE 'America/Chicago')::date + 5))`);
r = await call(S, `select public.declutter_come_back() n`);
ok(r.v?.n === 5 && (await row(1)).status === "live", `"I'm back" puts them all back at once (${r.v?.n ?? r.err})`);

for (const [fn, members, guests] of [["declutter_bulk_discount", true, false], ["declutter_go_away", true, false], ["declutter_come_back", true, false],
  ["declutter_away_return", false, false], ["declutter_away_sweep", false, false], ["declutter_seller_away_until", true, true]]) {
  const a = (await db.query(`select proacl::text a from pg_proc where proname = '${fn}'`)).rows[0]?.a ?? "";
  ok(!/(^|[{,])=X/.test(a) && /anon=X/.test(a) === guests && /authenticated=X/.test(a) === members, `${fn}: ${guests ? "anyone" : members ? "members" : "service role only"} (${a})`);
}
ok((await db.query(`select relrowsecurity r from pg_class where relname = 'declutter_seller_away'`)).rows[0]?.r === true, "the away table has RLS on");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
