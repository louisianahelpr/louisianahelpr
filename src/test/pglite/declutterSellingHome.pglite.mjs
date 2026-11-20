#!/usr/bin/env node
/**
 * PGlite proof for 20261120012050_declutter_selling_home (Declutter top 5 #2, owner 11-19): Selling's to-do counts and
 * the last 7 days vs the 7 before, for the caller's own selling only.
 *
 *   node src/test/pglite/declutterSellingHome.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellingHome.pglite.mjs  # RED: no such function
 *   FIX_MIGRATION=skip node src/test/pglite/declutterSellingHome.pglite.mjs  # RED: 42804 COALESCE text/uuid (prod 2026-11-20)
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterSellingHome.pglite.mjs
 *
 * Tables are trimmed stand-ins with only the columns the function reads; declutter_watchlist is the real CREATE.
 * auth.uid() is a stub driven by a setting. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261120012050_declutter_selling_home.sql`, "utf8");
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
const ME = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-1111-4111-8111-111111111111", B = "bbbbbbbb-1111-4111-8111-111111111111";
const it = (n) => `90000000-0000-4000-8000-00000000000${n}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table auth.users(id uuid primary key);
insert into auth.users values ('${ME}'), ('${OTHER}'), ('${A}'), ('${B}');
create table public.declutter_items(id uuid primary key, seller_id uuid not null, status text not null, current_price_cents integer not null,
  live_at timestamptz, sale_mode text not null default 'offers', drop_pct smallint not null default 0);
create table public.declutter_item_private(item_id uuid primary key, drops_stopped boolean not null default false);
create table public.declutter_orders(id uuid primary key default gen_random_uuid(), seller_id uuid, status text not null, paid_at timestamptz,
  items_cents integer not null default 0, bundle_discount_cents integer not null default 0);
create table public.declutter_saver_offer_sends(id uuid primary key default gen_random_uuid(), item_id uuid not null, created_at timestamptz not null default now());
`);
await db.exec(watchTable.replace(/REFERENCES public\.declutter_items\(id\) ON DELETE CASCADE/, ""));
await db.exec(viewsTable);
await db.exec(`
insert into public.declutter_items values
  ('${it(1)}', '${ME}', 'live', 2000, now() - interval '20 days', 'offers', 0),   -- old, drops off: price drop due; saved
  ('${it(2)}', '${ME}', 'live', 3000, now() - interval '20 days', 'offers', 5),   -- drops on: not due; saved, sent today
  ('${it(3)}', '${ME}', 'paused', 1000, now() - interval '3 days', 'offers', 0),  -- to relist
  ('${it(4)}', '${ME}', 'live', 100, now() - interval '2 days', 'offers', 0),     -- too cheap for an offer; saved
  ('${it(5)}', '${OTHER}', 'paused', 1000, now(), 'offers', 0),                  -- someone else's
  ('${it(6)}', '${OTHER}', 'live', 5000, now() - interval '30 days', 'offers', 0);
insert into public.declutter_item_private values ('${it(1)}', false), ('${it(2)}', false), ('${it(3)}', false), ('${it(4)}', false), ('${it(6)}', false);
insert into public.declutter_orders (seller_id, status, paid_at, items_cents, bundle_discount_cents) values
  ('${ME}', 'paid', now() - interval '1 day', 2000, 0),
  ('${ME}', 'handed_over', now() - interval '2 days', 5000, 500),
  ('${ME}', 'refunded', now() - interval '2 days', 9000, 0),          -- not a sale
  ('${ME}', 'awaiting_payment', null, 7000, 0),                       -- not a sale
  ('${ME}', 'handed_over', now() - interval '10 days', 1500, 0),      -- last week
  ('${ME}', 'handed_over', now() - interval '20 days', 99999, 0),     -- too old
  ('${OTHER}', 'paid', now() - interval '1 day', 4000, 0);            -- someone else's
insert into public.declutter_item_views (item_id, viewer_id, device_id, created_at) values
  ('${it(1)}', '${A}', null, now() - interval '1 day'), ('${it(1)}', '${A}', null, now() - interval '2 days'), -- one person twice: 1
  ('${it(1)}', null, 'd0000000-0000-4000-8000-000000000001', now() - interval '1 day'),                                                      -- a guest device: 1
  ('${it(2)}', '${A}', null, now() - interval '1 day'),                                                       -- same person, other item: 1
  ('${it(2)}', '${B}', null, now() - interval '9 days'),                                                      -- last week
  ('${it(6)}', '${A}', null, now() - interval '1 day');                                                       -- someone else's item
insert into public.declutter_watchlist (user_id, item_id, created_at) values
  ('${A}', '${it(1)}', now() - interval '1 day'), ('${B}', '${it(1)}', now() - interval '8 days'),
  ('${A}', '${it(2)}', now() - interval '3 days'), ('${A}', '${it(4)}', now() - interval '1 day'),
  ('${ME}', '${it(6)}', now() - interval '1 day'), ('${A}', '${it(6)}', now() - interval '1 day');
insert into public.declutter_saver_offer_sends (item_id, created_at) values ('${it(2)}', now() - interval '2 hours');
`);

if (process.env.NEW_MIGRATION !== "skip") { for (let i = 0; i < 3; i++) await db.exec(mig); if (!process.env.MIGRATION_PATH && process.env.FIX_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(fixMig); }

const home = async (uid) => {
  await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`);
  try { return { v: (await db.query(`select public.declutter_selling_home() r`)).rows[0].r }; } catch (e) { return { err: e.message }; }
};
const r = await home(ME);
ok(r.err === undefined, `the seller's home reads with uuid device ids (prod 42804, 20261120121830) (${r.err ?? "ok"})`);
const h = r.v ?? {};
ok(h.week?.sales === 2 && h.week?.earnings_cents === 6500, `this week: 2 sales, $65 (a refund, an unpaid checkout and other sellers left out) (${JSON.stringify(h.week)})`);
ok(h.last_week?.sales === 1 && h.last_week?.earnings_cents === 1500, `last week: 1 sale, $15; older sales left out (${JSON.stringify(h.last_week)})`);
ok(h.week?.views === 3 && h.last_week?.views === 1, `views: unique per item per person or device, own items only (${h.week?.views} / ${h.last_week?.views})`);
ok(h.week?.saves === 3 && h.last_week?.saves === 1, `saves on own listings by others (${h.week?.saves} / ${h.last_week?.saves})`);
ok(h.todo?.to_relist === 1, `to relist: own paused listings only (${h.todo?.to_relist})`);
ok(h.todo?.price_drops === 1, `price drops: live 14+ days, priced, drops off (${h.todo?.price_drops})`);
ok(h.todo?.savers_to_offer === 1, `savers to offer: saved, $2+, no send in 24 hours (${h.todo?.savers_to_offer})`);
ok(h.live_count === 3 && h.live_value_cents === 5100, `live now: 3 worth $51 (${h.live_count} / ${h.live_value_cents})`);
ok(/not_authenticated/.test((await home(null)).err ?? ""), "signed out: refused");
const o = (await home(OTHER)).v;
ok(o?.week?.sales === 1 && o?.todo?.to_relist === 1 && o?.week?.saves === 2, `another seller sees only their own numbers (their two savers) (${JSON.stringify(o?.week)})`);

const fn = (await db.query(`select proacl::text a, prosecdef d, provolatile v from pg_proc where proname = 'declutter_selling_home'`)).rows[0];
ok(fn?.d === true && fn?.v === "s", "SECURITY DEFINER, STABLE");
ok(!!fn && !/(^|[{,])=X/.test(fn.a) && !/anon=X/.test(fn.a) && /authenticated=X/.test(fn.a), `members only (${fn?.a})`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
