#!/usr/bin/env node
/**
 * PGlite proof for 20261030141656_declutter_price_nudge_sweep (CMP-5: "<item> hasn't sold yet. Drop the price?").
 *
 *   node src/test/pglite/declutterPriceNudgeSweep.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPriceNudgeSweep.pglite.mjs  # RED: no sweep
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterPriceNudgeSweep.pglite.mjs
 *
 * A stub world: the tables carry only the columns the sweep reads (prod's names and types, information_schema
 * 2026-10-30); feature_enabled_for_user, declutter_member_out, declutter_notify and log_cron_defect are stubs that
 * record what they were asked (said so inline). cron, cron_work_expectations and cron_catchup_policy are absent, so
 * the migration's guarded blocks skip, as they do on a fresh rebuild.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261030141656_declutter_price_nudge_sweep.sql`, "utf8");

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const S = "11111111-1111-4111-8111-111111111111", TEST = "22222222-2222-4222-8222-222222222222", SEEDP = "33333333-3333-4333-8333-333333333333";
const OUT = "44444444-4444-4444-8444-444444444444", OFF = "55555555-5555-4555-8555-555555555555";
const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table public.profiles(user_id uuid primary key, is_seed boolean not null default false);
create table public.test_accounts(user_id uuid primary key);
create table public.declutter_items(id uuid primary key, seller_id uuid, title text, status text, current_price_cents int,
  live_at timestamptz, is_seed boolean not null default false, sale_mode text, drop_pct smallint not null default 5);
create table public.declutter_item_private(item_id uuid primary key, floor_price_cents int, drops_stopped boolean not null default false);
create table public.declutter_offers(id uuid primary key default gen_random_uuid(), item_id uuid, status text);
create table public.declutter_cart_items(id uuid primary key default gen_random_uuid(), item_id uuid, status text);
-- Stubs: the switch (off for OFF), "out" (OUT), the notice (recorded), the defect log (recorded).
create function public.feature_enabled_for_user(k text, u uuid) returns boolean language sql as $$ select u <> '${OFF}'::uuid $$;
create function public.declutter_member_out(u uuid) returns boolean language sql as $$ select u = '${OUT}'::uuid $$;
create table notes(user_id uuid, type text, title text, message text, link text);
create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language sql as $$ insert into notes values (p_user, p_type, p_title, p_message, p_link) $$;
create table defects(src text, k text, msg text);
create function public.log_cron_defect(a text, b text, c text) returns void language sql as $$ insert into defects values (a, b, c) $$;
insert into profiles values ('${S}', false), ('${TEST}', false), ('${SEEDP}', true), ('${OUT}', false), ('${OFF}', false);
insert into test_accounts values ('${TEST}');
`);
const old = "now() - interval '15 days'";
// n, seller, title, status, cents, live_at, is_seed, sale_mode, drop_pct, floor, stopped
const items = [
  [1, S, "Oak chair", "live", 4000, old, false, "offers", 0, null, false],      // due: $34
  [2, S, "New lamp", "live", 4000, "now() - interval '13 days'", false, "offers", 0, null, false],
  [3, S, "Free box", "live", 0, old, false, "offers", 0, null, false],
  [4, S, "Dropping desk", "live", 4000, old, false, "offers", 5, 1000, false],
  [5, S, "Stopped desk", "live", 4000, old, false, "offers", 5, 1000, true],  // drops stopped: due
  [6, S, "Seed mug", "live", 4000, old, true, "offers", 0, null, false],
  [7, TEST, "Test account rug", "live", 4000, old, false, "offers", 0, null, false],
  [8, SEEDP, "Seed profile rug", "live", 4000, old, false, "offers", 0, null, false],
  [9, S, "In a cart", "live", 4000, old, false, "offers", 0, null, false],
  [10, S, "At the floor", "live", 4000, old, false, "offers", 0, 4000, false],
  [11, OUT, "Out seller", "live", 4000, old, false, "offers", 0, null, false],
  [12, OFF, "Switch off", "live", 4000, old, false, "offers", 0, null, false],
  [13, S, "Reserved", "reserved", 4000, old, false, "offers", 0, null, false],
  [14, S, "Floor 35.50", "live", 4000, old, false, "offers", 0, 3550, false], // $36
];
for (const [n, s, t, st, c, at, seed, mode, pct, floor, stop] of items) {
  await db.exec(`insert into declutter_items values ('${id(n)}', '${s}', '${t}', '${st}', ${c}, ${at}, ${seed}, '${mode}', ${pct});
    insert into declutter_item_private values ('${id(n)}', ${floor ?? "null"}, ${stop});`);
}
await db.exec(`insert into declutter_cart_items (item_id, status) values ('${id(9)}', 'in_cart')`);

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const hasMark = (await db.query(`select to_regclass('public.declutter_price_nudges')::text t`)).rows[0].t;
ok(!!hasMark, "the told-at mark table exists");
if (!hasMark) { console.log(`\n${pass} PASS / ${fail + 1} FAIL (no sweep: nothing else to check)`); process.exit(1); }
const run = async () => { try { return (await db.query(`select public.declutter_price_nudge_sweep() r`)).rows[0].r; } catch (e) { return { err: e.message }; } };
const r1 = await run();
const told = (await db.query(`select * from notes order by link`)).rows;
const toldIds = told.map((n) => n.link.match(/manage=([0-9a-f-]+)/)?.[1]);
ok(r1?.told === 3 && r1?.errors === 0, `first run tells 3 listings, no errors (${JSON.stringify(r1)})`);
ok(JSON.stringify(toldIds.sort()) === JSON.stringify([id(1), id(5), id(14)].sort()), `exactly the due listings: Oak chair, Stopped desk, Floor 35.50 (${toldIds.join(",")})`);
const oak = told.find((n) => n.link.includes(id(1)));
ok(oak?.title === "Oak chair hasn't sold yet. Drop the price?", `the owner's words, with the item (${oak?.title})`);
ok(oak?.message?.includes("Try $34, about 15% less."), `about 15% lower, whole dollars ($34 from $40) (${oak?.message})`);
ok(told.find((n) => n.link.includes(id(14)))?.message?.includes("Try $36,"), "never below the lowest price ($35.50 -> $36)");
ok(oak?.link === `/declutter?tab=selling&manage=${id(1)}&drop=1` && oak?.type === "declutter_listings", "links to Manage with the price filled in; a Declutter listings notice");
for (const [n, why] of [[2, "13 days"], [3, "free"], [4, "drops on"], [6, "seed listing"], [7, "test account"], [8, "seed profile"], [9, "in a cart"],
  [10, "at its lowest price"], [11, "member out"], [12, "Declutter off"], [13, "not live"]]) {
  ok(!toldIds.includes(id(n)), `never told: ${why}`);
}
ok((await db.query(`select count(*)::int c from declutter_price_nudges where item_id = '${id(10)}'`)).rows[0].c === 0, "a listing that cannot go lower is not marked");

const r2 = await run();
ok(r2?.told === 0 && (await db.query(`select count(*)::int c from notes`)).rows[0].c === 3, "a second run tells nobody (once per 14 days)");
await db.exec(`update declutter_price_nudges set notified_at = now() - interval '13 days' where item_id = '${id(1)}'`);
ok((await run())?.told === 0, "13 days after the last nudge: still not again");
await db.exec(`update declutter_price_nudges set notified_at = now() - interval '15 days' where item_id = '${id(1)}'`);
const r4 = await run();
ok(r4?.told === 1 && (await db.query(`select count(*)::int c from notes where link like '%${id(1)}%'`)).rows[0].c === 2, "14+ days later and still unsold: told once more");

ok((await db.query(`select public.declutter_price_nudge_cents(4000, null) a, public.declutter_price_nudge_cents(100, null) b, public.declutter_price_nudge_cents(4000, 4000) c, public.declutter_price_nudge_cents(150, null) d`)).rows
  .every((x) => x.a === 3400 && x.b === null && x.c === null && x.d === 100), "the price rule matches priceNudge.ts (4000->3400, 100->none, at floor->none, 150->100)");

const acl = (await db.query(`select proname, proacl::text a, prosecdef d, proconfig::text c from pg_proc where proname in ('declutter_price_nudge_sweep','declutter_price_nudge_cents') order by proname`)).rows;
ok(acl.length === 2 && acl.every((f) => !/(^|[{,])(anon|authenticated)=/.test(f.a ?? "") && !/(^|[{,])=X/.test(f.a ?? "") && /service_role=X/.test(f.a ?? "")),
  `service role only (${acl.map((f) => `${f.proname}:${f.a}`).join(" ")})`);
ok(acl.find((f) => f.proname === "declutter_price_nudge_sweep")?.d === true && /search_path=public, pg_temp/.test(acl.find((f) => f.proname === "declutter_price_nudge_sweep")?.c ?? ""), "the sweep is SECURITY DEFINER with search_path public, pg_temp");
const tacl = (await db.query(`select relacl::text a, relrowsecurity r from pg_class where relname = 'declutter_price_nudges'`)).rows[0];
ok(tacl?.r === true && !/(anon|authenticated)=/.test(tacl?.a ?? ""), `the mark table: RLS on, no client privilege (${tacl?.a})`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
