#!/usr/bin/env node
/**
 * PGlite proof for 20261030134231_declutter_my_offers_from_wanted (audit 1d D4-3: a seller's answer to a Wanted post
 * read as "their counter" with "Take back my offer" in Buying).
 *
 *   node src/test/pglite/declutterMyOffersFromWanted.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMyOffersFromWanted.pglite.mjs  # RED: the old function, no from_wanted
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterMyOffersFromWanted.pglite.mjs
 *
 * The function before is prod's: pg_get_functiondef on fncmgoasalhdgfwzhsqa (2026-10-30, md5
 * 69d6c3e4fcb091f455a9107a8e948407) is 20261014224914_declutter_slice3b_payments.sql's body, read verbatim from
 * that file here. The tables are stubs shaped as both bodies read them (said so inline).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261030134231_declutter_my_offers_from_wanted.sql";
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
const base = readFileSync(`${MIG_DIR}20261014224914_declutter_slice3b_payments.sql`, "utf8");
const oldFn = base.match(/CREATE OR REPLACE FUNCTION public\.declutter_my_offers\(\)[\s\S]*?AS (\$[a-z_]*\$)\n[\s\S]*?\1;/)[0];
const oldGrants = base.match(/REVOKE ALL ON FUNCTION public\.declutter_my_offers\(\)[^\n]*\nGRANT EXECUTE ON FUNCTION public\.declutter_my_offers\(\)[^\n]*/)[0];

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const B = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", X = "33333333-3333-4333-8333-333333333333";
const I1 = "a0000000-0000-4000-8000-000000000001", I2 = "a0000000-0000-4000-8000-000000000002";
const W = "b0000000-0000-4000-8000-000000000001";
const OFFER = "c0000000-0000-4000-8000-000000000001", REPLY = "c0000000-0000-4000-8000-000000000002", OLDCLOSED = "c0000000-0000-4000-8000-000000000003";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
-- Stubs: only the columns the two bodies read (prod's declutter_offers has these plus is_seed/created_at/closed_at).
create table public.declutter_items(id uuid primary key, seller_id uuid, title text, current_price_cents int);
create table public.declutter_item_private(item_id uuid primary key, floor_price_cents int);
create table public.declutter_offers(id uuid primary key, item_id uuid, buyer_id uuid, seller_id uuid, amount_cents int, awaiting text,
  status text, respond_by timestamptz, counter_count int, updated_at timestamptz, wanted_id uuid);
insert into declutter_items values ('${I1}', '${S}', 'Blue enamel mug', 1500), ('${I2}', '${S}', 'Oak chair', 4000);
insert into declutter_item_private values ('${I1}', 1000), ('${I2}', 3000);
insert into declutter_offers values
  ('${OFFER}', '${I2}', '${B}', '${S}', 3500, 'seller', 'open', now() + interval '2 days', 0, now() - interval '1 hour', null),
  ('${REPLY}', '${I1}', '${B}', '${S}', 1200, 'buyer', 'open', now() + interval '2 days', 1, now(), '${W}'),
  ('${OLDCLOSED}', '${I1}', '${X}', '${S}', 900, 'seller', 'declined', now(), 0, now() - interval '40 days', null);
`);
await db.exec(oldFn);
await db.exec(oldGrants);
const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const cols = "offer_id, item_id, item_title, my_side, amount_cents, awaiting, status, respond_by, counter_count, current_price_cents, floor_price_cents, updated_at";
const before = { B: (await as(B, `select ${cols} from declutter_my_offers()`)).rows, S: (await as(S, `select ${cols} from declutter_my_offers()`)).rows };

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const outCols = (await db.query(`select pg_get_function_result('public.declutter_my_offers()'::regprocedure) r`)).rows[0].r;
ok(/from_wanted boolean\s*\)?$/.test(outCols), `the list says which offers answer a Wanted post (from_wanted last): ${outCols.slice(-40)}`);

let rowsB = [], rowsS = [];
try {
  rowsB = (await as(B, `select * from declutter_my_offers()`)).rows;
  rowsS = (await as(S, `select * from declutter_my_offers()`)).rows;
} catch (e) { console.log(`  (read failed: ${e.message})`); }
const byId = (rows, id) => rows.find((r) => r.offer_id === id);
ok(byId(rowsB, REPLY)?.from_wanted === true, "the buyer's row for a seller's Wanted reply: from_wanted true");
ok(byId(rowsS, REPLY)?.from_wanted === true, "the seller's row for their Wanted reply: from_wanted true");
ok(byId(rowsB, OFFER)?.from_wanted === false, "an ordinary offer: from_wanted false, never null");
ok(rowsB.every((r) => !("wanted_id" in r)), "the Wanted post's id never leaves the function (a yes/no only)");

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
