#!/usr/bin/env node
/**
 * PGlite proof for 20261021030654_declutter_moving_sale_name.sql (Q2269, board 164: a moving sale's name and start date).
 *
 *   node src/test/pglite/declutterMovingSaleName.pglite.mjs                          # ALL OK (migration applied 3x over the old definitions)
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterMovingSaleName.pglite.mjs
 *
 * A stub world (tables and helper functions shaped as the migration reads them, said so inline); the functions the
 * migration replaces are taken verbatim from the migration that defined them before. Ported from Builder 3c's
 * ~/.lh-pglite/b3c-moving-sale-name.mjs into the repo (Declutter rework, 2026-10-21).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261021030654_declutter_moving_sale_name.sql`, "utf8");
const old = readFileSync(`${MIG_DIR}20261016053625_declutter_moving_out.sql`, "utf8");
const pick = (name) => old.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^)]*\\)\\s*RETURNS[\\s\\S]*?AS (\\$[a-z_]*\\$)\\n[\\s\\S]*?\\1;`))[0];
const db = new PGlite();
const S = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", X = "33333333-3333-4333-8333-333333333333", N = "77777777-7777-4777-8777-777777777777";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table off_keys(k text);
create function require_feature(k text) returns void language plpgsql as $$ begin if exists(select 1 from off_keys where off_keys.k = require_feature.k) then raise exception 'feature_disabled' using errcode='42501'; end if; end $$;
create table bad(user_id uuid); create table blocks(a uuid, b uuid); create table hidden(user_id uuid);
create function is_caller_banned() returns boolean language sql as $$ select exists(select 1 from bad where user_id = auth.uid()) $$;
create function declutter_assert_member(p boolean) returns uuid language plpgsql as $$ begin if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if; return auth.uid(); end $$;
create function are_users_blocked(a uuid, b uuid) returns boolean language sql as $$ select exists(select 1 from blocks where (blocks.a=$1 and blocks.b=$2) or (blocks.a=$2 and blocks.b=$1)) $$;
create function declutter_seller_hidden(u uuid) returns boolean language sql as $$ select exists(select 1 from hidden where user_id = u) $$;
create function contact_leak_reason(t text) returns text language sql as $$ select case when t ~ '\\d{3}[- ]?\\d{4}' or t ~* 'https?://' then 'contact' end $$;
create function shop_contact_leak_reason(t text) returns text language sql as $$ select case when t ~* '@|\\.com|facebook' then 'handle' end $$;
create table seed_switch(on_ boolean); insert into seed_switch values (true);
create function seed_hidden_in_discovery() returns boolean language sql as $$ select on_ from seed_switch $$;
create table declutter_items(id uuid primary key default gen_random_uuid(), seller_id uuid, status text, in_moving_sale boolean default false, is_seed boolean default false);
create table declutter_item_private(item_id uuid primary key, seller_id uuid, move_out_on date, updated_at timestamptz default now());
alter table declutter_item_private enable row level security;
insert into declutter_items(id, seller_id, status, in_moving_sale) values
  ('a0000000-0000-4000-8000-000000000001', '${S}', 'live', true), ('a0000000-0000-4000-8000-000000000002', '${S}', 'draft', true),
  ('a0000000-0000-4000-8000-000000000003', '${S}', 'live', false), ('a0000000-0000-4000-8000-000000000004', '${S}', 'sold', true);
insert into declutter_item_private(item_id, seller_id, move_out_on) select id, seller_id, case when in_moving_sale then current_date + 10 end from declutter_items;
`);
await db.exec(pick("declutter_seller_moving_sale"));
for (let i = 1; i <= 3; i++) await db.exec(mig);
const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const fails = async (uid, sql, code) => { try { await as(uid, sql); return `NO ERROR (wanted ${code})`; } catch (e) { return e.message.includes(code) ? "ok" : `wrong: ${e.message}`; } };
const r = {};
r.sets = (await as(S, `select declutter_set_moving_sale('  Moving to   Lafayette · everything goes ', current_date + 2) n`)).rows[0].n === 3 ? "ok" : "bad (every moving-sale item)";
// Every moving-sale item of the seller, any status (a sold one too, so a later clear reaches it); never a non-sale item.
r.notOnOther = (await db.query(`select count(*)::int n from declutter_item_private where sale_name is not null and item_id = 'a0000000-0000-4000-8000-000000000003'`)).rows[0].n === 0 ? "ok" : "bad";
r.soldOneToo = (await db.query(`select sale_name is not null v from declutter_item_private where item_id = 'a0000000-0000-4000-8000-000000000004'`)).rows[0].v ? "ok" : "bad";
r.myReader = (await as(S, `select sale_name from declutter_my_moving_sale()`)).rows[0]?.sale_name === "Moving to Lafayette · everything goes" ? "ok" : "bad";
const row = (await as(B, `select * from declutter_seller_moving_sale('${S}')`)).rows[0];
r.buyerReads = row?.sale_name === "Moving to Lafayette · everything goes" && row?.sale_starts_on ? "ok" : JSON.stringify(row);
await db.exec(`insert into blocks values ('${B}', '${S}')`);
r.blockedSeesNothing = (await as(B, `select count(*)::int n from declutter_seller_moving_sale('${S}')`)).rows[0].n === 0 ? "ok" : "bad";
await db.exec(`delete from blocks`);
r.anonRead = await fails(null, `select * from declutter_seller_moving_sale('${S}')`, "not_authenticated");
r.contact = await fails(S, `select declutter_set_moving_sale('Call 555-1234 everything goes', null)`, "sale_name_contact_info");
r.handle = await fails(S, `select declutter_set_moving_sale('IG @movingjoe sale', null)`, "sale_name_contact_info");
r.address = await fails(S, `select declutter_set_moving_sale('123 Main St sale', null)`, "sale_name_contact_info");
r.addressLong = await fails(S, `select declutter_set_moving_sale('Everything at 42 Old Spanish Trail', null)`, "sale_name_contact_info");
r.notAnAddress = (await as(S, `select declutter_set_moving_sale('3 rooms, 2 days, everything goes', current_date + 2) n`)).rows[0].n === 3 ? "ok" : "bad";
await as(S, `select declutter_set_moving_sale('Moving to Lafayette · everything goes', current_date + 2)`);
r.short = await fails(S, `select declutter_set_moving_sale('ab', null)`, "invalid_sale_name");
r.long = await fails(S, `select declutter_set_moving_sale(repeat('a', 61), null)`, "invalid_sale_name");
r.huge = await fails(S, `select declutter_set_moving_sale(repeat('a', 600), null)`, "invalid_sale_name");
r.afterMove = await fails(S, `select declutter_set_moving_sale('Moving sale', current_date + 11)`, "invalid_sale_dates");
r.tooEarly = await fails(S, `select declutter_set_moving_sale('Moving sale', current_date - 31)`, "invalid_sale_dates");
r.noSale = await fails(X, `select declutter_set_moving_sale('Moving sale', null)`, "no_moving_sale");
r.anonWrite = await fails(null, `select declutter_set_moving_sale('Moving sale', null)`, "not_authenticated");
await db.exec(`insert into bad values ('${S}')`);
r.banned = await fails(S, `select declutter_set_moving_sale('Moving sale', null)`, "account_restricted");
await db.exec(`delete from bad; insert into off_keys values ('declutter_moving_out')`);
r.switchOff = await fails(S, `select declutter_set_moving_sale('Moving sale', null)`, "feature_disabled");
await db.exec(`delete from off_keys`);
// Seed: a test seller's sale is hidden from a member the switch hides it from, never from the seller.
await db.exec(`update declutter_items set is_seed = true where seller_id = '${S}'`);
r.seedHidden = (await as(B, `select count(*)::int n from declutter_seller_moving_sale('${S}')`)).rows[0].n === 0 ? "ok" : "bad";
r.seedOwn = (await as(S, `select count(*)::int n from declutter_seller_moving_sale('${S}')`)).rows[0].n === 1 ? "ok" : "bad";
await db.exec(`update declutter_items set is_seed = false`);
// A start after a moved-up move-out date is not shown.
await db.exec(`update declutter_item_private set move_out_on = current_date + 1 where move_out_on is not null`);
r.startAfterMoveHidden = (await as(B, `select sale_starts_on from declutter_seller_moving_sale('${S}')`)).rows[0]?.sale_starts_on === null ? "ok" : "bad";
await db.exec(`update declutter_item_private set move_out_on = current_date + 10 where move_out_on is not null`);
r.clears = (await as(S, `select declutter_set_moving_sale('   ', null) n`)).rows[0].n === 3 && (await as(B, `select sale_name from declutter_seller_moving_sale('${S}')`)).rows[0].sale_name === null ? "ok" : "bad";
r.checkConstraint = await fails(null, `update declutter_item_private set sale_name = 'ab'`, "declutter_item_private_sale_name_len");
await db.exec(`update declutter_item_private set move_out_on = current_date - 1`);
r.pastMoveHidden = (await as(B, `select count(*)::int n from declutter_seller_moving_sale('${S}')`)).rows[0].n === 0 ? "ok" : "bad";
const priv = (await db.query(`select has_function_privilege('anon','declutter_set_moving_sale(text,date)','execute') a1, has_function_privilege('anon','declutter_seller_moving_sale(uuid)','execute') a2, has_function_privilege('authenticated','declutter_seller_moving_sale(uuid)','execute') u`)).rows[0];
r.grants = !priv.a1 && !priv.a2 && priv.u ? "ok" : JSON.stringify(priv);
const bad = Object.entries(r).filter(([, v]) => v !== "ok");
console.log(JSON.stringify(r, null, 1));
console.log(bad.length ? `FAILED: ${bad.map(([k]) => k).join(", ")}` : "ALL OK (migration applied 3x over the old definition)");
process.exit(bad.length ? 1 : 0);
