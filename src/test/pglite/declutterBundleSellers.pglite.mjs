#!/usr/bin/env node
/**
 * PGlite proof for 20261030135334_declutter_bundle_sellers (D-NEW12: the Browse card's "Bundle deal" chip).
 *
 *   node src/test/pglite/declutterBundleSellers.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBundleSellers.pglite.mjs  # RED: no such function
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterBundleSellers.pglite.mjs
 *
 * declutter_bundle_rules is created by 20261027211754_declutter_bundle_discount.sql's own CREATE TABLE (read verbatim
 * from that file); auth.uid() and require_feature() are stubs (said so inline).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261030135334_declutter_bundle_sellers.sql`, "utf8");
const bundle = readFileSync(`${MIG_DIR}20261027211754_declutter_bundle_discount.sql`, "utf8");
const rulesTable = bundle.match(/CREATE TABLE IF NOT EXISTS public\.declutter_bundle_rules \([\s\S]*?\n\);/)[0];

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const ME = "44444444-4444-4444-8444-444444444444", OTHER = "55555555-5555-4555-8555-555555555555";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
-- Stub of the shared switch check: a key listed in off_keys is off.
create table off_keys(k text);
create function public.require_feature(k text) returns void language plpgsql as $$ begin if exists(select 1 from off_keys where off_keys.k = require_feature.k) then raise exception 'feature_disabled' using errcode='42501'; end if; end $$;
-- The seller_id foreign key needs a users table; a stub auth.users with the ids used here.
create table auth.users(id uuid primary key);
insert into auth.users values ('${A}'), ('${B}'), ('${C}'), ('${ME}'), ('${OTHER}');
`);
await db.exec(rulesTable);
await db.exec(`insert into public.declutter_bundle_rules (seller_id, percent) values ('${A}', 10), ('${C}', 25), ('${OTHER}', 50)`);

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const call = async (uid, arr) => {
  try { return { v: (await as(uid, `select public.declutter_bundle_sellers(${arr}) v`)).rows[0].v }; } catch (e) { return { err: e.message }; }
};

const r1 = await call(ME, `array['${A}','${B}','${C}']::uuid[]`);
ok(JSON.stringify(r1.v) === JSON.stringify([A, C].sort()), `only the sellers asked about that have a rule (${JSON.stringify(r1.v ?? r1.err)})`);
ok(Array.isArray(r1.v) && !r1.v.includes(OTHER), "never a seller the caller did not ask about");
const r2 = await call(ME, `array['${A}','${A}']::uuid[]`);
ok(JSON.stringify(r2.v) === JSON.stringify([A]), "each seller once");
ok(JSON.stringify((await call(ME, `'{}'::uuid[]`)).v) === "[]", "nothing asked: an empty list");
ok(JSON.stringify((await call(ME, `null::uuid[]`)).v) === "[]", "null: an empty list, never every seller");
ok(JSON.stringify((await call(ME, `array['${B}']::uuid[]`)).v) === "[]", "no rule: an empty list");
const many = `(select array_agg(gen_random_uuid()) from generate_series(1, 201))`;
ok((await call(ME, many)).err?.includes("invalid_request"), "more than 200 sellers: invalid_request");
ok(Array.isArray((await call(ME, `(select array_agg(gen_random_uuid()) from generate_series(1, 200))`)).v), "200 sellers: answered");
ok((await call(null, `array['${A}']::uuid[]`)).err?.includes("not_authenticated"), "no caller: not_authenticated");
await db.exec(`insert into off_keys values ('declutter')`);
ok((await call(ME, `array['${A}']::uuid[]`)).err?.includes("feature_disabled"), "Declutter off: feature_disabled");
await db.exec(`delete from off_keys`);

const fn = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c, provolatile v from pg_proc where proname = 'declutter_bundle_sellers'`)).rows[0];
ok(fn?.d === true && /search_path=public, pg_temp/.test(fn?.c ?? "") && fn?.v === "s", "SECURITY DEFINER, STABLE, search_path public, pg_temp");
ok(!!fn && !/(^|[{,])anon=/.test(fn.a) && !/(^|[{,])=X/.test(fn.a), `anon and PUBLIC cannot run it (${fn?.a})`);
ok(!!fn && /authenticated=X/.test(fn.a) && /service_role=X/.test(fn.a), "members and service_role can");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
