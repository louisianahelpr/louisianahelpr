#!/usr/bin/env node
/**
 * PGlite proof for 20261107232700_declutter_item_save_counts (owner 11-07: each Browse heart shows its save count).
 *
 *   node src/test/pglite/declutterItemSaveCounts.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterItemSaveCounts.pglite.mjs  # RED: no such function
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterItemSaveCounts.pglite.mjs
 *
 * The tables are trimmed stand-ins with only the columns the function reads (declutter_items: id, seller_id, status,
 * seller_hidden, is_seed; declutter_watchlist as created by 20261014193955). auth.uid() and the four visibility
 * helpers are stubs driven by settings (said so inline), so each rule can be switched on and off.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261107232700_declutter_item_save_counts.sql`, "utf8");
const foundation = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");
const watchTable = foundation.match(/CREATE TABLE IF NOT EXISTS public\.declutter_watchlist \([\s\S]*?\n\);/)[0];

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const S1 = "11111111-1111-4111-8111-111111111111", S2 = "22222222-2222-4222-8222-222222222222";
const ME = "44444444-4444-4444-8444-444444444444", W1 = "55555555-5555-4555-8555-555555555555", W2 = "66666666-6666-4666-8666-666666666666";
const it = (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table auth.users(id uuid primary key);
insert into auth.users values ('${S1}'), ('${S2}'), ('${ME}'), ('${W1}'), ('${W2}');
-- Stubs of the visibility helpers the row policies use, each driven by a setting.
create function public.declutter_open_to_guests() returns boolean language sql stable as $$ select coalesce(nullif(current_setting('t.guests', true), ''), 'on') = 'on' $$;
create function public.feature_enabled_for(k text) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('t.feature', true), ''), 'on') = 'on' $$;
create function public.seed_hidden_in_discovery() returns boolean language sql stable as $$ select coalesce(nullif(current_setting('t.seedhidden', true), ''), 'on') = 'on' $$;
create function public.declutter_my_block_partners() returns uuid[] language sql stable as $$ select nullif(current_setting('t.blocked', true), '')::uuid[] $$;
-- Trimmed declutter_items: only the columns the function reads.
create table public.declutter_items(id uuid primary key, seller_id uuid not null references auth.users(id), status text not null, seller_hidden boolean not null default false, is_seed boolean not null default false);
`);
await db.exec(watchTable);
await db.exec(`
insert into public.declutter_items values
  ('${it(1)}', '${S1}', 'live', false, false),     -- 3 saves
  ('${it(2)}', '${S1}', 'reserved', false, false), -- 1 save
  ('${it(3)}', '${S1}', 'live', false, false),     -- no saves
  ('${it(4)}', '${S2}', 'live', true, false),      -- seller hidden, 2 saves
  ('${it(5)}', '${S2}', 'live', false, true),      -- seed, 2 saves
  ('${it(6)}', '${S2}', 'sold', false, false),     -- ended, 2 saves
  ('${it(7)}', '${ME}', 'live', false, true);      -- my own seed item, 1 save
insert into public.declutter_watchlist (user_id, item_id) values
  ('${ME}', '${it(1)}'), ('${W1}', '${it(1)}'), ('${W2}', '${it(1)}'),
  ('${W1}', '${it(2)}'),
  ('${W1}', '${it(4)}'), ('${W2}', '${it(4)}'),
  ('${W1}', '${it(5)}'), ('${W2}', '${it(5)}'),
  ('${W1}', '${it(6)}'), ('${W2}', '${it(6)}'),
  ('${W1}', '${it(7)}');
`);

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const ALL = `array['${[1, 2, 3, 4, 5, 6, 7].map(it).join("','")}']::uuid[]`;
const set = async (k, v) => db.exec(`select set_config('t.${k}', '${v ?? ""}', false)`);
const counts = async (uid, arr = ALL) => {
  await set("uid", uid);
  try {
    const rows = (await db.query(`select item_id, saves from public.declutter_item_save_counts(${arr}) order by item_id`)).rows;
    return { v: Object.fromEntries(rows.map((r) => [r.item_id.slice(-1), r.saves])) };
  } catch (e) { return { err: e.message }; }
};
const j = (x) => JSON.stringify(x.v ?? x.err);

// A guest: live/reserved, open to guests, not hidden, not seed.
let r = await counts(null);
ok(j(r) === JSON.stringify({ 1: 3, 2: 1 }), `guest: counts for visible items only, none with no saves (${j(r)})`);
await set("guests", "off");
ok(j(await counts(null)) === "{}", "guest while Declutter is closed to guests: nothing");
await set("guests", "on");

// A member with seed hidden: like a guest, plus their own seed item.
r = await counts(ME);
ok(j(r) === JSON.stringify({ 1: 3, 2: 1, 7: 1 }), `member: visible items and their own item (${j(r)})`);
ok(r.v && r.v[4] === undefined && r.v[6] === undefined, "member: a hidden seller's and an ended item's saves never show");
// Seed showing in discovery (test accounts): seed counts show.
await set("seedhidden", "off");
ok(JSON.stringify((await counts(ME)).v) === JSON.stringify({ 1: 3, 2: 1, 5: 2, 7: 1 }), "member with seed shown in discovery: the seed item's count shows");
await set("seedhidden", "on");
// A seller in a block with the caller: their items' counts are left out.
await set("blocked", `{${S1}}`);
ok(JSON.stringify((await counts(ME)).v) === JSON.stringify({ 7: 1 }), "a blocked seller's items: left out");
await set("blocked", "");
// Declutter off for the member: only their own item.
await set("feature", "off");
ok(JSON.stringify((await counts(ME)).v) === JSON.stringify({ 7: 1 }), "Declutter off for the member: only their own item");
await set("feature", "on");

// Caps and empty asks.
ok(j(await counts(ME, `'{}'::uuid[]`)) === "{}", "nothing asked: nothing");
ok(j(await counts(ME, `null::uuid[]`)) === "{}", "null: nothing, never every item");
ok((await counts(ME, `(select array_agg(gen_random_uuid()) from generate_series(1, 201))`)).err?.includes("invalid_request"), "more than 200 items: invalid_request");
ok(j(await counts(ME, `(select array_agg(gen_random_uuid()) from generate_series(1, 200))`)) === "{}", "200 items: answered");
ok(JSON.stringify((await counts(ME, `array['${it(1)}','${it(1)}']::uuid[]`)).v) === JSON.stringify({ 1: 3 }), "an id asked twice: counted once");

// Only a number: the result has no user column.
const cols = (await db.query(`select pg_get_function_result('public.declutter_item_save_counts(uuid[])'::regprocedure) r`)).rows[0].r;
ok(cols === "TABLE(item_id uuid, saves integer)", `returns only item_id and a count (${cols})`);

const fn = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c, provolatile v from pg_proc where proname = 'declutter_item_save_counts'`)).rows[0];
ok(fn?.d === true && /search_path=public, pg_temp/.test(fn?.c ?? "") && fn?.v === "s", "SECURITY DEFINER, STABLE, search_path public, pg_temp");
ok(!!fn && !/(^|[{,])=X/.test(fn.a), `PUBLIC cannot run it (${fn?.a})`);
ok(!!fn && /anon=X/.test(fn.a) && /authenticated=X/.test(fn.a) && /service_role=X/.test(fn.a), "guests, members and service_role can");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
