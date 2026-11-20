#!/usr/bin/env node
/**
 * PGlite proof for 20261120012729_declutter_item_demand (Declutter top 5 #3, owner 11-19): saves, offers this week and
 * views today per visible item, numbers only, test people not counted.
 *
 *   node src/test/pglite/declutterItemDemand.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterItemDemand.pglite.mjs  # RED: no such function
 *   FIX_MIGRATION=skip node src/test/pglite/declutterItemDemand.pglite.mjs  # RED: 42804 COALESCE text/uuid (prod 2026-11-20)
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterItemDemand.pglite.mjs
 *
 * Trimmed stand-in tables; declutter_watchlist is the real CREATE. auth.uid() and the visibility helpers are stubs
 * driven by settings, as in declutterItemSaveCounts.pglite.mjs. pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261120012729_declutter_item_demand.sql`, "utf8");
const foundation = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");
const watchTable = foundation.match(/CREATE TABLE IF NOT EXISTS public\.declutter_watchlist \([\s\S]*?\n\);/)[0];

const viewsMig = readFileSync(`${MIG_DIR}20261105163501_declutter_item_views.sql`, "utf8");
// The REAL declutter_item_views CREATE (device_id is uuid). A text stand-in hid the 42804 that broke prod (20261120121830).
const viewsTable = viewsMig.match(/CREATE TABLE IF NOT EXISTS public\.declutter_item_views \([\s\S]*?\n\);/)[0]
  .replace(/ REFERENCES public\.declutter_items\(id\) ON DELETE CASCADE/, "").replace(/ REFERENCES auth\.users\(id\) ON DELETE CASCADE/, "");
const fixMig = readFileSync(`${MIG_DIR}20261120121830_declutter_views_coalesce_uuid.sql`, "utf8");

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const S = "11111111-1111-4111-8111-111111111111", S2 = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-1111-4111-8111-111111111111", B = "bbbbbbbb-1111-4111-8111-111111111111", C = "cccccccc-1111-4111-8111-111111111111";
const T = "ffffffff-1111-4111-8111-111111111111", Q = "eeeeeeee-1111-4111-8111-111111111111";
const it = (n) => `90000000-0000-4000-8000-00000000000${n}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table auth.users(id uuid primary key);
insert into auth.users values ('${S}'), ('${S2}'), ('${A}'), ('${B}'), ('${C}'), ('${T}'), ('${Q}');
create function public.declutter_open_to_guests() returns boolean language sql stable as $$ select coalesce(nullif(current_setting('t.guests', true), ''), 'on') = 'on' $$;
create function public.feature_enabled_for(k text) returns boolean language sql stable as $$ select true $$;
create function public.seed_hidden_in_discovery() returns boolean language sql stable as $$ select true $$;
create function public.declutter_my_block_partners() returns uuid[] language sql stable as $$ select nullif(current_setting('t.blocked', true), '')::uuid[] $$;
create table public.profiles(user_id uuid primary key, is_seed boolean not null default false);
insert into public.profiles values ('${A}', false), ('${B}', false), ('${C}', false), ('${T}', true), ('${Q}', false);
create table public.test_accounts(user_id uuid primary key);
insert into public.test_accounts values ('${Q}');
create table public.declutter_items(id uuid primary key, seller_id uuid not null, status text not null, seller_hidden boolean not null default false, is_seed boolean not null default false, current_price_cents integer not null default 1000);
create table public.declutter_offers(id uuid primary key default gen_random_uuid(), item_id uuid not null, buyer_id uuid not null, created_at timestamptz not null default now());
`);
await db.exec(watchTable.replace(/REFERENCES public\.declutter_items\(id\) ON DELETE CASCADE/, ""));
await db.exec(viewsTable);
await db.exec(`
insert into public.declutter_items values
  ('${it(1)}', '${S}', 'live', false, false), ('${it(2)}', '${S}', 'live', true, false),
  ('${it(3)}', '${S2}', 'sold', false, false), ('${it(4)}', '${S2}', 'live', false, true);
insert into public.declutter_watchlist (user_id, item_id) values ('${A}', '${it(1)}'), ('${B}', '${it(1)}'), ('${S}', '${it(1)}'), ('${A}', '${it(2)}'), ('${A}', '${it(3)}');
insert into public.declutter_offers (item_id, buyer_id, created_at) values
  ('${it(1)}', '${A}', now() - interval '1 day'), ('${it(1)}', '${A}', now() - interval '2 days'), -- same buyer twice: 1
  ('${it(1)}', '${B}', now() - interval '6 days'),                                                -- 2
  ('${it(1)}', '${C}', now() - interval '8 days'),                                                -- too old
  ('${it(1)}', '${T}', now() - interval '1 day'), ('${it(1)}', '${Q}', now() - interval '1 day'); -- test people: not counted
insert into public.declutter_item_views (item_id, viewer_id, device_id, created_at) values
  ('${it(1)}', '${A}', null, now()), ('${it(1)}', '${A}', null, now()),   -- one person: 1
  ('${it(1)}', null, 'd0000000-0000-4000-8000-000000000001', now()), ('${it(1)}', null, 'd0000000-0000-4000-8000-000000000002', now()), -- two devices: 3
  ('${it(1)}', '${S}', null, now()),                                      -- the seller: not counted
  ('${it(1)}', '${T}', null, now()), ('${it(1)}', '${Q}', null, now()),   -- test people: not counted
  ('${it(1)}', '${B}', null, now() - interval '3 days');                  -- not today
`);

// And the newest definition: 20261120014036 (shop sale, #4) restates it with the sale columns; the counts must not move.
const saleMig = readFileSync(`${MIG_DIR}20261120014036_declutter_shop_sale.sql`, "utf8");
if (process.env.NEW_MIGRATION !== "skip") { for (let i = 0; i < 3; i++) await db.exec(mig); if (!process.env.MIGRATION_PATH) for (let i = 0; i < 3; i++) await db.exec(saleMig); if (!process.env.MIGRATION_PATH && process.env.FIX_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(fixMig); }

const ALL = `array['${[1, 2, 3, 4].map(it).join("','")}']::uuid[]`;
const set = async (k, v) => db.exec(`select set_config('t.${k}', '${v ?? ""}', false)`);
const demand = async (uid, arr = ALL) => {
  await set("uid", uid);
  try {
    const rows = (await db.query(`select item_id, saves, offers_week, views_today from public.declutter_item_demand(${arr}) order by item_id`)).rows;
    return { v: Object.fromEntries(rows.map((r) => [r.item_id.slice(-1), [r.saves, r.offers_week, r.views_today]])) };
  } catch (e) { return { err: e.message }; }
};

let r = await demand(A);
ok(JSON.stringify(r.v) === JSON.stringify({ 1: [2, 2, 3] }), `member: saves 2 (not the seller's), offers 2 buyers this week, views 3 today (${JSON.stringify(r.v ?? r.err)})`);
r = await demand(null);
ok(JSON.stringify(r.v) === JSON.stringify({ 1: [2, 2, 3] }), `guest: the same visible item only (${JSON.stringify(r.v ?? r.err)})`);
await set("guests", "off");
ok(JSON.stringify((await demand(null)).v) === "{}", "guest while Declutter is closed to guests: nothing");
await set("guests", "on");
r = await demand(S);
ok(r.v?.[2] !== undefined && r.v?.[1] !== undefined, "the seller sees their own hidden listing's numbers too");
await set("blocked", `{${S}}`);
ok(JSON.stringify((await demand(A)).v) === "{}", "a blocked seller's items: left out");
await set("blocked", "");
ok((await demand(A, `(select array_agg(gen_random_uuid()) from generate_series(1, 201))`)).err?.includes("invalid_request"), "more than 200: refused");
ok(JSON.stringify((await demand(A, `null::uuid[]`)).v) === "{}", "null: nothing");
const cols = (await db.query(`select pg_get_function_result('public.declutter_item_demand(uuid[])'::regprocedure) r`)).rows[0].r;
ok(cols === "TABLE(item_id uuid, saves integer, offers_week integer, views_today integer, sale_pct integer, sale_ends_at timestamp with time zone)", `numbers only (and the sale, 20261120014036) (${cols})`);
const fn = (await db.query(`select proacl::text a, prosecdef d, provolatile v from pg_proc where proname = 'declutter_item_demand'`)).rows[0];
ok(fn?.d === true && fn?.v === "s" && !/(^|[{,])=X/.test(fn.a) && /anon=X/.test(fn.a), `definer, stable, PUBLIC cannot, guests can (${fn?.a})`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
