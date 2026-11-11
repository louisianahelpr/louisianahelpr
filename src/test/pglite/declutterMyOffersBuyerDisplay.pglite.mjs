#!/usr/bin/env node
/**
 * PGlite proof for 20261111223500_declutter_my_offers_buyer_display (audit 11-10 F356, owner 11-11: the seller sees
 * the buyer of an offer as first name + last initial, nothing else; Wanted-post privacy kept).
 *
 *   node src/test/pglite/declutterMyOffersBuyerDisplay.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMyOffersBuyerDisplay.pglite.mjs  # RED: the old function, no buyer_display
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterMyOffersBuyerDisplay.pglite.mjs
 *
 * The function before is the newest on main, 20261101175510_declutter_buying_lists_hide_seed.sql, read verbatim from
 * that file; member_display_name is read verbatim from 20261021131322. The tables are stubs with only the columns
 * the bodies read. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261111223500_declutter_my_offers_buyer_display.sql`, "utf8");
const base = readFileSync(`${MIG_DIR}20261101175510_declutter_buying_lists_hide_seed.sql`, "utf8");
const oldFn = base.match(/CREATE OR REPLACE FUNCTION public\.declutter_my_offers\(\)[\s\S]*?AS (\$[a-z_]*\$)\n[\s\S]*?\1;/)[0];
const names = readFileSync(`${MIG_DIR}20261021131322_member_names_first_and_initial.sql`, "utf8");
const nameFn = names.match(/CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?AS (\$[a-z_]*\$)\n[\s\S]*?\1;/)[0];

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const B = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", G = "44444444-4444-4444-8444-444444444444";
const I1 = "a0000000-0000-4000-8000-000000000001", I2 = "a0000000-0000-4000-8000-000000000002";
const W = "b0000000-0000-4000-8000-000000000001";
const OFFER = "c0000000-0000-4000-8000-000000000001", REPLY = "c0000000-0000-4000-8000-000000000002", GONE = "c0000000-0000-4000-8000-000000000003";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function public.seed_hidden_in_discovery() returns boolean language sql stable as $$ select true $$;
create table public.profiles(user_id uuid primary key, full_name text, avatar_url text, email text);
create table public.declutter_items(id uuid primary key, seller_id uuid, title text, current_price_cents int, is_seed boolean default false);
create table public.declutter_item_private(item_id uuid primary key, floor_price_cents int);
create table public.declutter_wanted(id uuid primary key, user_id uuid, status text);
create table public.declutter_offers(id uuid primary key, item_id uuid, buyer_id uuid, seller_id uuid, amount_cents int, awaiting text,
  status text, respond_by timestamptz, counter_count int, updated_at timestamptz, wanted_id uuid);
insert into profiles values ('${B}', 'Ann Marie Smith', 'https://example.invalid/ann.jpg', 'ann@example.invalid'), ('${S}', 'Sam Seller', null, 'sam@example.invalid');
insert into declutter_items values ('${I1}', '${S}', 'Blue enamel mug', 1500), ('${I2}', '${S}', 'Oak chair', 4000);
insert into declutter_item_private values ('${I1}', 1000), ('${I2}', 3000);
insert into declutter_wanted values ('${W}', '${B}', 'open');
insert into declutter_offers values
  ('${OFFER}', '${I2}', '${B}', '${S}', 3500, 'seller', 'open', now() + interval '2 days', 0, now() - interval '1 hour', null),
  ('${REPLY}', '${I1}', '${B}', '${S}', 1200, 'buyer', 'open', now() + interval '2 days', 1, now(), '${W}'),
  ('${GONE}', '${I1}', '${G}', '${S}', 900, 'seller', 'open', now() + interval '2 days', 0, now() - interval '2 hours', null);
`);
await db.exec(nameFn);
await db.exec(oldFn);
const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const cols = "offer_id, item_id, item_title, my_side, amount_cents, awaiting, status, respond_by, counter_count, current_price_cents, floor_price_cents, updated_at, from_wanted, open_wanted_id";
const before = { B: (await as(B, `select ${cols} from declutter_my_offers()`)).rows, S: (await as(S, `select ${cols} from declutter_my_offers()`)).rows };

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const outCols = (await db.query(`select pg_get_function_result('public.declutter_my_offers()'::regprocedure) r`)).rows[0].r;
ok(/buyer_display text\s*\)?$/.test(outCols), `the list carries buyer_display last: ${outCols.slice(-40)}`);

let rowsB = [], rowsS = [];
try {
  rowsB = (await as(B, `select * from declutter_my_offers()`)).rows;
  rowsS = (await as(S, `select * from declutter_my_offers()`)).rows;
} catch (e) { console.log(`  (read failed: ${e.message})`); }
const byId = (rows, id) => rows.find((r) => r.offer_id === id);
ok(byId(rowsS, OFFER)?.buyer_display === "Ann S.", `the seller sees the buyer as first name + last initial (${byId(rowsS, OFFER)?.buyer_display})`);
ok(byId(rowsB, OFFER) && byId(rowsB, OFFER).buyer_display === null, "the buyer's own row carries no buyer_display");
ok(byId(rowsS, REPLY) && byId(rowsS, REPLY).buyer_display === null, "a seller's answer to a Wanted post never names the Wanted poster");
ok(byId(rowsS, GONE) && byId(rowsS, GONE).buyer_display === null, "a buyer with no profile left: null, never a made-up name");
const leaked = JSON.stringify(rowsS);
ok(!leaked.includes("Smith") && !leaked.includes("ann@") && !leaked.includes("ann.jpg") && !leaked.includes(B), "no full name, email, photo or buyer id reaches the seller");

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pickOld = (rows) => rows.map((r) => Object.fromEntries(cols.split(", ").map((c) => [c, r[c]])));
ok(rowsB.length === before.B.length && same(pickOld(rowsB), before.B), `buyer: every old column unchanged (${rowsB.length} rows)`);
ok(rowsS.length === before.S.length && same(pickOld(rowsS), before.S), `seller: every old column unchanged (${rowsS.length} rows)`);

let anonErr = "";
try { await as(null, `select * from declutter_my_offers()`); } catch (e) { anonErr = e.message; }
ok(anonErr.includes("not_authenticated"), "no caller: not_authenticated");

const acl = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c from pg_proc where oid = 'public.declutter_my_offers()'::regprocedure`)).rows[0];
ok(acl.d === true && /search_path=public, pg_temp/.test(acl.c ?? ""), "still SECURITY DEFINER with search_path public, pg_temp");
ok(!/(^|[{,])anon=/.test(acl.a) && !/(^|[{,])=X/.test(acl.a), `anon and PUBLIC cannot run it (${acl.a})`);
ok(/authenticated=X/.test(acl.a) && /service_role=X/.test(acl.a), "members and service_role can");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
