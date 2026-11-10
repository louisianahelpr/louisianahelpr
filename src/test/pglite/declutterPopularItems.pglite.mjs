#!/usr/bin/env node
/**
 * PGlite proof for 20261110054539_declutter_popular_items (owner 11-09: the landing's Declutter preview shows popular
 * items, the kind that sell easily, not just the newest).
 *
 *   node src/test/pglite/declutterPopularItems.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPopularItems.pglite.mjs  # RED: no such function
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterPopularItems.pglite.mjs
 *
 * The tables are trimmed stand-ins with only the columns the function reads. declutter_open_to_guests() is a stub
 * driven by a setting (said so inline), so the guest switch can be turned on and off.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261110054539_declutter_popular_items.sql`, "utf8");

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const S1 = "11111111-1111-4111-8111-111111111111", S2 = "22222222-2222-4222-8222-222222222222";
const U1 = "55555555-5555-4555-8555-555555555555", U2 = "66666666-6666-4666-8666-666666666666";
const U3 = "77777777-7777-4777-8777-777777777777", TEST = "99999999-9999-4999-8999-999999999999";
const it = (n) => `aaaaaaaa-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
-- Stub of the guest switch the anon row policy uses, driven by a setting.
create function public.declutter_open_to_guests() returns boolean language sql stable as $$ select coalesce(nullif(current_setting('t.guests', true), ''), 'on') = 'on' $$;
create table public.test_accounts(user_id uuid primary key);
create table public.profiles(user_id uuid primary key, is_seed boolean);
-- is_test_member as prod defines it (20261030015205, pg_get_functiondef 11-09): a seed profile or a test_accounts row.
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
insert into public.test_accounts values ('${TEST}');
`);
// Items: live_at counts down, so item 1 is the NEWEST. Without signals the order is 1, 2, 3, ...
const items = [
  [1, "live", "kitchen", 500], [2, "live", "kitchen", 500], [3, "live", "toys", 500], [4, "live", "toys", 500],
  [5, "live", "tools", 500], [6, "live", "tools", 0],          // 6: Free
  [7, "reserved", "tools", 500],                              // 7: reserved
  [8, "live", "tools", 500],                                  // 8: seller hidden
  [9, "live", "tools", 500],                                  // 9: seed
  [10, "live", "tools", 500],                                 // 10: no photo
  [11, "sold", "tools", 500],                                 // 11: sold (orders below)
];
for (const [n, status, cat, price] of items) {
  await db.exec(`insert into public.declutter_items values ('${it(n)}', '${n % 2 ? S1 : S2}', '${status}', 'Item ${n}', '${cat}', 4, false,
    ${price}, ${price}, 'Delcambre', now() - interval '${n} hours', ${n === 8}, ${n === 9})`);
  if (n !== 10) await db.exec(`insert into public.declutter_item_photos(item_id, storage_path, position) values ('${it(n)}', 'p/${n}/b.jpg', 1), ('${it(n)}', 'p/${n}/a.jpg', 0)`);
}

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const top = async (limit = 24) => {
  try { return { v: (await db.query(`select * from public.declutter_popular_items(${limit})`)).rows }; } catch (e) { return { err: e.message }; }
};
const ids = (r) => (r.v ?? []).map((x) => Number(x.id.slice(-2)));

let r = await top();
ok(!r.err, `callable (${r.err ?? "ok"})`);
ok(JSON.stringify(ids(r)) === JSON.stringify([1, 2, 3, 4, 5]), `no signals: newest first; never Free, reserved, hidden, seed, unphotographed or sold (${ids(r)})`);
ok(r.v?.[0]?.photo_path === "p/1/a.jpg", `the cover photo is the lowest position (${r.v?.[0]?.photo_path})`);

// Signals: item 5 gets one view, item 4 one save (3), item 3 one offer (3) + one view (4 in all).
await db.exec(`insert into public.declutter_item_views(item_id, viewer_id) values ('${it(5)}', '${U1}')`);
await db.exec(`insert into public.declutter_watchlist values ('${U1}', '${it(4)}')`);
await db.exec(`insert into public.declutter_offers(item_id, buyer_id) values ('${it(3)}', '${U2}')`);
await db.exec(`insert into public.declutter_item_views(item_id, device_id) values ('${it(3)}', '${U3}')`);
r = await top();
ok(JSON.stringify(ids(r)) === JSON.stringify([3, 4, 5, 1, 2]), `offer + view, then save, then view, then newest (${ids(r)})`);

// Noise never counts: the seller's own save, a test account's save/offer/view, a seed offer, a view older than 30 days,
// the same viewer twice.
await db.exec(`insert into public.declutter_watchlist values ('${S2}', '${it(2)}'), ('${TEST}', '${it(2)}')`);
await db.exec(`insert into public.declutter_offers(item_id, buyer_id) values ('${it(2)}', '${TEST}')`);
await db.exec(`insert into public.declutter_offers(item_id, buyer_id, is_seed) values ('${it(2)}', '${U1}', true)`);
await db.exec(`insert into public.declutter_item_views(item_id, viewer_id) values ('${it(2)}', '${TEST}'), ('${it(2)}', '${S2}')`);
await db.exec(`insert into public.declutter_item_views(item_id, viewer_id, created_at) values ('${it(1)}', '${U1}', now() - interval '31 days')`);
await db.exec(`insert into public.declutter_item_views(item_id, viewer_id) values ('${it(5)}', '${U1}')`);
r = await top();
ok(JSON.stringify(ids(r)) === JSON.stringify([3, 4, 5, 1, 2]), `seller, test-account, seed, stale and repeat signals never count (${ids(r)})`);

// Category sales break ties among items without signals: a real paid order of a toys item lifts... nothing with a
// score, but puts the toys/kitchen order among the zero-score items. Items 1, 2 are kitchen; make kitchen 0 and tools 2.
await db.exec(`insert into public.declutter_orders(id, status) values ('bbbbbbbb-0000-4000-8000-000000000001', 'paid'), ('bbbbbbbb-0000-4000-8000-000000000002', 'handed_over')`);
await db.exec(`insert into public.declutter_cart_items(item_id, order_id) values ('${it(11)}', 'bbbbbbbb-0000-4000-8000-000000000001'), ('${it(11)}', 'bbbbbbbb-0000-4000-8000-000000000002')`);
await db.exec(`update public.declutter_items set category = 'tools' where id = '${it(2)}'`);
r = await top();
ok(JSON.stringify(ids(r)) === JSON.stringify([3, 4, 5, 2, 1]), `the best-selling category breaks a tie before recency (${ids(r)})`);
// A seed or expired order never counts as a sale.
await db.exec(`update public.declutter_orders set is_seed = true where id = 'bbbbbbbb-0000-4000-8000-000000000001'`);
await db.exec(`update public.declutter_orders set status = 'expired' where id = 'bbbbbbbb-0000-4000-8000-000000000002'`);
r = await top();
ok(JSON.stringify(ids(r)) === JSON.stringify([3, 4, 5, 1, 2]), `seed and expired orders are not sales (${ids(r)})`);

// A seed-profile member's save never counts either (is_test_member, not only test_accounts).
const SEEDP = "88888888-8888-4888-8888-888888888888";
await db.exec(`insert into public.profiles values ('${SEEDP}', true); insert into public.declutter_watchlist values ('${SEEDP}', '${it(1)}')`);
r = await top();
ok(JSON.stringify(ids(r)) === JSON.stringify([3, 4, 5, 1, 2]), `a seed profile's save never counts (${ids(r)})`);

// A flood of signed-out views with made-up device ids (anon may record views) counts at most 10: it never beats
// two real saves (6) plus an offer (3)... and a member's views count in full. Item 2 gets 500 guest views -> 10.
await db.exec(`insert into public.declutter_item_views(item_id, device_id) select '${it(2)}', gen_random_uuid() from generate_series(1, 500)`);
await db.exec(`insert into public.declutter_watchlist values ('${U2}', '${it(4)}'), ('${U3}', '${it(4)}')`);
await db.exec(`insert into public.declutter_offers(item_id, buyer_id) values ('${it(4)}', '${U1}')`);
r = await top();
ok(JSON.stringify(ids(r).slice(0, 2)) === JSON.stringify([4, 2]), `500 guest views count as 10, under 3 saves + an offer (12) (${ids(r)})`);

// Limit is clamped.
await db.exec(`insert into public.declutter_items select ('aaaaaaaa-0000-4000-8000-9' || lpad(g::text, 11, '0'))::uuid, '${S1}', 'live', 'Bulk', 'kitchen', 4, false, 500, 500, null, now() - interval '200 hours', false, false from generate_series(1, 30) g`);
await db.exec(`insert into public.declutter_item_photos(item_id, storage_path, position) select ('aaaaaaaa-0000-4000-8000-9' || lpad(g::text, 11, '0'))::uuid, 'b.jpg', 0 from generate_series(1, 30) g`);
ok(ids(await top(100)).length === 24, "limit 100: at most 24");
ok(ids(await top(2)).length === 2, "limit 2: two");
ok(ids(await top(0)).length === 1, "limit 0: at least one");
ok((await db.query(`select count(*)::int n from public.declutter_popular_items(null)`)).rows[0].n === 8, "limit null: the default 8");

// Declutter closed to guests: nothing.
await db.exec(`select set_config('t.guests', 'off', false)`);
ok(ids(await top()).length === 0, "Declutter closed to guests: nothing");
await db.exec(`select set_config('t.guests', 'on', false)`);

// Only the card's columns and the photo path: never a count, a seller or a viewer.
const cols = (await db.query(`select pg_get_function_result('public.declutter_popular_items(integer)'::regprocedure) r`)).rows[0].r;
ok(!/seller|score|saves|views|offers|buyer|viewer/.test(cols), `returns no seller, viewer or count (${cols})`);

const fn = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c, provolatile v from pg_proc where proname = 'declutter_popular_items'`)).rows[0];
ok(fn?.d === true && /search_path=public, pg_temp/.test(fn?.c ?? "") && fn?.v === "s", "SECURITY DEFINER, STABLE, search_path public, pg_temp");
ok(!!fn && !/(^|[{,])=X/.test(fn.a), `PUBLIC cannot run it (${fn?.a})`);
ok(!!fn && /anon=X/.test(fn.a) && /authenticated=X/.test(fn.a) && /service_role=X/.test(fn.a), "guests, members and service_role can");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
