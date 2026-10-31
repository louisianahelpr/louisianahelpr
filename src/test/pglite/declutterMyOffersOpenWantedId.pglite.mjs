#!/usr/bin/env node
/**
 * PGlite proof for 20261031095146_declutter_my_offers_open_wanted_id (BUY-29: after accepting a seller's reply to
 * their Wanted post, the buyer is asked "Close your Wanted post?"; the app needs the post's id to close it).
 *
 *   node src/test/pglite/declutterMyOffersOpenWantedId.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMyOffersOpenWantedId.pglite.mjs  # RED: the old function, no id
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterMyOffersOpenWantedId.pglite.mjs
 *
 * The function before is origin/main's newest CREATE, 20261030134231_declutter_my_offers_from_wanted.sql, read
 * verbatim from that file here. The tables are stubs shaped as both bodies read them (said so inline).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261031095146_declutter_my_offers_open_wanted_id.sql";
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
const base = readFileSync(`${MIG_DIR}20261030134231_declutter_my_offers_from_wanted.sql`, "utf8");
const oldSql = base.slice(base.indexOf("DROP FUNCTION IF EXISTS public.declutter_my_offers();"));

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const B = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", X = "33333333-3333-4333-8333-333333333333";
const I1 = "a0000000-0000-4000-8000-000000000001", I2 = "a0000000-0000-4000-8000-000000000002", I3 = "a0000000-0000-4000-8000-000000000003";
const W = "b0000000-0000-4000-8000-000000000001", WCLOSED = "b0000000-0000-4000-8000-000000000002";
const OFFER = "c0000000-0000-4000-8000-000000000001", REPLY = "c0000000-0000-4000-8000-000000000002";
const REPLY_CLOSED = "c0000000-0000-4000-8000-000000000003", OLDCLOSED = "c0000000-0000-4000-8000-000000000004";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
-- Stubs: only the columns the two bodies read (prod's tables have more).
create table public.declutter_items(id uuid primary key, seller_id uuid, title text, current_price_cents int);
create table public.declutter_item_private(item_id uuid primary key, floor_price_cents int);
create table public.declutter_wanted(id uuid primary key, user_id uuid, status text);
create table public.declutter_offers(id uuid primary key, item_id uuid, buyer_id uuid, seller_id uuid, amount_cents int, awaiting text,
  status text, respond_by timestamptz, counter_count int, updated_at timestamptz, wanted_id uuid);
insert into declutter_items values ('${I1}', '${S}', 'Blue enamel mug', 1500), ('${I2}', '${S}', 'Oak chair', 4000), ('${I3}', '${S}', 'Lamp', 2000);
insert into declutter_item_private values ('${I1}', 1000), ('${I2}', 3000);
insert into declutter_wanted values ('${W}', '${B}', 'open'), ('${WCLOSED}', '${B}', 'closed');
insert into declutter_offers values
  ('${OFFER}', '${I2}', '${B}', '${S}', 3500, 'seller', 'open', now() + interval '2 days', 0, now() - interval '1 hour', null),
  ('${REPLY}', '${I1}', '${B}', '${S}', 1200, 'buyer', 'open', now() + interval '2 days', 1, now(), '${W}'),
  ('${REPLY_CLOSED}', '${I3}', '${B}', '${S}', 1800, 'buyer', 'accepted', now(), 1, now() - interval '2 hours', '${WCLOSED}'),
  ('${OLDCLOSED}', '${I1}', '${X}', '${S}', 900, 'seller', 'declined', now(), 0, now() - interval '40 days', null);
`);
await db.exec(oldSql);
const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const cols = "offer_id, item_id, item_title, my_side, amount_cents, awaiting, status, respond_by, counter_count, current_price_cents, floor_price_cents, updated_at, from_wanted";
const before = { B: (await as(B, `select ${cols} from declutter_my_offers()`)).rows, S: (await as(S, `select ${cols} from declutter_my_offers()`)).rows };

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const outCols = (await db.query(`select pg_get_function_result('public.declutter_my_offers()'::regprocedure) r`)).rows[0].r;
ok(/from_wanted boolean, open_wanted_id uuid\s*\)?$/.test(outCols), `open_wanted_id is the last column, after from_wanted: ${outCols.slice(-50)}`);

let rowsB = [], rowsS = [], rowsX = [];
try {
  rowsB = (await as(B, `select * from declutter_my_offers()`)).rows;
  rowsS = (await as(S, `select * from declutter_my_offers()`)).rows;
  rowsX = (await as(X, `select * from declutter_my_offers()`)).rows;
} catch (e) { console.log(`  (read failed: ${e.message})`); }
const byId = (rows, id) => rows.find((r) => r.offer_id === id);
ok(byId(rowsB, REPLY)?.open_wanted_id === W, "the poster's row for a reply to their open Wanted: its id, so the app can offer to close it");
ok(byId(rowsS, REPLY) !== undefined && byId(rowsS, REPLY).open_wanted_id === null, "the seller who replied never gets the Wanted post's id");
ok(byId(rowsB, REPLY_CLOSED) !== undefined && byId(rowsB, REPLY_CLOSED).open_wanted_id === null, "a reply to an already closed Wanted: null (nothing to ask)");
ok(byId(rowsB, OFFER) !== undefined && byId(rowsB, OFFER).open_wanted_id === null, "an ordinary offer: null");
ok(rowsX.every((r) => r.open_wanted_id === null), "another member's rows never carry it");

// Every column the old function returned is unchanged, row for row, in the same order, for both sides.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pickOld = (rows) => rows.map((r) => Object.fromEntries(cols.split(", ").map((c) => [c, r[c]])));
ok(rowsB.length === before.B.length && same(pickOld(rowsB), before.B), `buyer: every old column unchanged (${rowsB.length} rows)`);
ok(rowsS.length === before.S.length && same(pickOld(rowsS), before.S), `seller: every old column unchanged, floor kept to the seller (${rowsS.length} rows)`);
ok(byId(rowsB, REPLY)?.floor_price_cents === null && byId(rowsS, REPLY)?.floor_price_cents === 1000, "the seller's floor stays hidden from the buyer");
ok(!byId(rowsS, OLDCLOSED), "a closed offer older than 30 days stays out");

let anonErr = "";
try { await as(null, `select * from declutter_my_offers()`); } catch (e) { anonErr = e.message; }
ok(anonErr.includes("not_authenticated"), "no caller: not_authenticated");

const acl = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c from pg_proc where oid = 'public.declutter_my_offers()'::regprocedure`)).rows[0];
ok(acl.d === true && /search_path=public, pg_temp/.test(acl.c ?? ""), "still SECURITY DEFINER with search_path public, pg_temp");
ok(!/(^|[{,])anon=/.test(acl.a) && !/(^|[{,])=X/.test(acl.a), `anon and PUBLIC cannot run it (${acl.a})`);
ok(/authenticated=X/.test(acl.a) && /service_role=X/.test(acl.a), "members and service_role can");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
