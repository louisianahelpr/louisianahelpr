#!/usr/bin/env node
/**
 * PGlite proof for 20261110162335_declutter_popular_items_two_per_seller (D018, landing design audit 11-10: one seller
 * filled the landing's Popular on Declutter grid).
 *
 *   node src/test/pglite/declutterPopularItemsTwoPerSeller.pglite.mjs                     # ALL PASS (old, then new 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPopularItemsTwoPerSeller.pglite.mjs  # RED: the old definition
 *
 * The tables are trimmed stand-ins with only the columns the function reads (the same as declutterPopularItems.pglite.mjs).
 * declutter_open_to_guests() is a stub driven by a setting. pglite is not a dependency (CLAUDE.md): ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const oldMig = readFileSync(`${MIG_DIR}20261110054539_declutter_popular_items.sql`, "utf8");
const newMig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261110162335_declutter_popular_items_two_per_seller.sql`, "utf8");

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const U1 = "55555555-5555-4555-8555-555555555555";
const it = (n) => `aaaaaaaa-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create function public.declutter_open_to_guests() returns boolean language sql stable as $$ select coalesce(nullif(current_setting('t.guests', true), ''), 'on') = 'on' $$;
create table public.test_accounts(user_id uuid primary key);
create table public.profiles(user_id uuid primary key, is_seed boolean);
create function public.is_test_member(p_user_id uuid) returns boolean language sql stable as $$
  select p_user_id is not null and (exists (select 1 from public.profiles p where p.user_id = p_user_id and p.is_seed is true)
    or exists (select 1 from public.test_accounts t where t.user_id = p_user_id)) $$;
create table public.declutter_items(id uuid primary key, seller_id uuid not null, status text not null, title text not null,
  category text not null, condition_stars smallint not null default 4, porch_ok boolean not null default false,
  price_cents integer not null, current_price_cents integer not null, area_label text, live_at timestamptz,
  seller_hidden boolean not null default false, is_seed boolean not null default false);
create table public.declutter_item_photos(id uuid primary key default gen_random_uuid(), item_id uuid not null, storage_path text not null, position smallint not null);
create table public.declutter_watchlist(user_id uuid not null, item_id uuid not null, primary key (user_id, item_id));
create table public.declutter_offers(id uuid primary key default gen_random_uuid(), item_id uuid not null, buyer_id uuid not null, is_seed boolean not null default false);
create table public.declutter_item_views(id bigserial primary key, item_id uuid not null, viewer_id uuid, device_id uuid, created_at timestamptz not null default now());
create table public.declutter_orders(id uuid primary key default gen_random_uuid(), status text not null, is_seed boolean not null default false);
create table public.declutter_cart_items(id uuid primary key default gen_random_uuid(), item_id uuid not null, order_id uuid);
`);
// Seller A lists the six NEWEST items (1-6), B two (7, 8), C one (9). live_at counts down, so 1 is the newest.
const seller = (n) => (n <= 6 ? A : n <= 8 ? B : C);
for (let n = 1; n <= 9; n++) {
  await db.exec(`insert into public.declutter_items values ('${it(n)}', '${seller(n)}', 'live', 'Item ${n}', 'tools', 4, false,
    500, 500, 'Delcambre', now() - interval '${n} hours', false, false)`);
  await db.exec(`insert into public.declutter_item_photos(item_id, storage_path, position) values ('${it(n)}', 'p/${n}.jpg', 0)`);
}

await db.exec(oldMig);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(newMig);

const ids = async (limit = 8) => (await db.query(`select id from public.declutter_popular_items(${limit})`)).rows.map((x) => Number(x.id.slice(-2)));

let r = await ids();
// Before (old definition): 1..6 (all seller A) then 7, 8. After, round by round: every seller's best (1 A, 7 B, 9 C),
// then every seller's second (2 A, 8 B), then A's others in the old order (3, 4, 5).
ok(JSON.stringify(r) === JSON.stringify([1, 7, 9, 2, 8, 3, 4, 5]), `each seller's best first, then each one's second, then the rest in the old order (${r})`);

// The score still decides WHICH two of a seller come first: a save on A's item 6 lifts it into A's two and to the top.
await db.exec(`insert into public.declutter_watchlist values ('${U1}', '${it(6)}')`);
r = await ids();
ok(JSON.stringify(r) === JSON.stringify([6, 7, 9, 1, 8, 2, 3, 4]), `a seller's best-scored items are their two, and the best seller leads (${r})`);
await db.exec(`delete from public.declutter_watchlist`);

// Three sellers over the cap (B and C get three more items each, all older than A's): the first tier is still one per
// seller per round, and nobody's third item comes before everyone's second.
for (let n = 10; n <= 15; n++) {
  await db.exec(`insert into public.declutter_items values ('${it(n)}', '${n <= 12 ? B : C}', 'live', 'Item ${n}', 'tools', 4, false,
    500, 500, 'Delcambre', now() - interval '${n} hours', false, false)`);
  await db.exec(`insert into public.declutter_item_photos(item_id, storage_path, position) values ('${it(n)}', 'p/${n}.jpg', 0)`);
}
const owner = (n) => (n <= 6 ? A : n <= 8 || (n >= 10 && n <= 12) ? B : C);
r = await ids(24);
const tier = r.slice(0, 6).map(owner);
ok(JSON.stringify(tier) === JSON.stringify([A, B, C, A, B, C]), `three sellers over the cap: rounds of one each (${r})`);
ok(r.length === 15 && new Set(r).size === 15, `nothing dropped, nothing twice (${r})`);
await db.exec(`delete from public.declutter_item_photos where item_id in (${[10, 11, 12, 13, 14, 15].map((n) => `'${it(n)}'`).join(",")})`);
await db.exec(`delete from public.declutter_items where id in (${[10, 11, 12, 13, 14, 15].map((n) => `'${it(n)}'`).join(",")})`);

// The eligibility and signal rules, re-checked on THIS body (code-review 11-10, note 1): a hidden seller, a seed item,
// a Free item and an item with no photo never show; a test member's save and a seller's own save never count; guest
// device views count at most 10.
const TEST = "99999999-9999-4999-8999-999999999999";
await db.exec(`insert into public.test_accounts values ('${TEST}')`);
await db.exec(`update public.declutter_items set seller_hidden = true where id = '${it(3)}'`);
await db.exec(`update public.declutter_items set is_seed = true where id = '${it(4)}'`);
await db.exec(`update public.declutter_items set current_price_cents = 0 where id = '${it(5)}'`);
await db.exec(`delete from public.declutter_item_photos where item_id = '${it(6)}'`);
r = await ids(24);
ok(![3, 4, 5, 6].some((n) => r.includes(n)), `hidden, seed, Free and photo-less items never show (${r})`);
await db.exec(`insert into public.declutter_watchlist values ('${TEST}', '${it(9)}'), ('${C}', '${it(9)}')`);
r = await ids(24);
ok(JSON.stringify(r.slice(0, 3)) === JSON.stringify([1, 7, 9]), `a test member's and the seller's own saves never count (${r})`);
await db.exec(`insert into public.declutter_item_views(item_id, device_id) select '${it(8)}', gen_random_uuid() from generate_series(1, 500)`);
await db.exec(`insert into public.declutter_watchlist values ('${U1}', '${it(2)}'), ('55555555-5555-4555-8555-000000000002', '${it(2)}'), ('55555555-5555-4555-8555-000000000003', '${it(2)}'), ('55555555-5555-4555-8555-000000000004', '${it(2)}')`);
r = await ids(24);
// Item 2: four real saves = 12; item 8: 500 guest views count as 10. Each leads its seller; A (12) before B (10).
ok(JSON.stringify(r.slice(0, 3)) === JSON.stringify([2, 8, 9]), `500 guest views count as 10, under four saves (12) (${r})`);
await db.exec(`delete from public.declutter_watchlist; delete from public.declutter_item_views`);
await db.exec(`update public.declutter_items set seller_hidden = false, is_seed = false, current_price_cents = 500`);
await db.exec(`insert into public.declutter_item_photos(item_id, storage_path, position) values ('${it(6)}', 'p/6.jpg', 0)`);

// One seller only (prod on 11-10: 1 seller, 242 items): nothing is dropped, the grid still fills.
await db.exec(`update public.declutter_items set status = 'sold' where seller_id <> '${A}'`);
r = await ids();
ok(r.length === 6 && r.every((n) => seller(n) === A), `one seller still fills the grid with all their items (${r})`);
await db.exec(`update public.declutter_items set status = 'live'`);

// Unchanged rules: the limit clamp, the guest switch, no seller or count in the result, the grants.
ok((await ids(100)).length === 9, "limit 100: every eligible item (9 here, at most 24)");
ok((await ids(0)).length === 1, "limit 0: at least one");
await db.exec(`select set_config('t.guests', 'off', false)`);
ok((await ids()).length === 0, "Declutter closed to guests: nothing");
await db.exec(`select set_config('t.guests', 'on', false)`);
const cols = (await db.query(`select pg_get_function_result('public.declutter_popular_items(integer)'::regprocedure) r`)).rows[0].r;
ok(!/seller|score|rank|saves|views|offers|buyer|viewer/.test(cols), `returns no seller, rank or count (${cols})`);
const fn = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c, provolatile v from pg_proc where proname = 'declutter_popular_items'`)).rows[0];
ok(fn?.d === true && /search_path=public, pg_temp/.test(fn?.c ?? "") && fn?.v === "s", "SECURITY DEFINER, STABLE, search_path public, pg_temp");
ok(!!fn && !/(^|[{,])=X/.test(fn.a), `PUBLIC cannot run it (${fn?.a})`);
ok(!!fn && /anon=X/.test(fn.a) && /authenticated=X/.test(fn.a) && /service_role=X/.test(fn.a), "guests, members and service_role can");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
