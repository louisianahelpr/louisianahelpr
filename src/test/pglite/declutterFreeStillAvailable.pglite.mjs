#!/usr/bin/env node
/**
 * PGlite proof for 20261030232231_declutter_free_still_available: the "still available?" ask on a free listing.
 *
 *   node src/test/pglite/declutterFreeStillAvailable.pglite.mjs                     # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFreeStillAvailable.pglite.mjs  # red: the checks need it
 *
 * pglite is loaded from ~/.lh-pglite. The notice and the feature checks are stubs that record what they were asked.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261030232231_declutter_free_still_available.sql`, "utf8");

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };
const safe = async (what, fn) => { try { ok(await fn(), what); } catch (e) { ok(false, `${what}: ${e.message}`); } };

const db = new PGlite();
const S = "11111111-1111-4111-8111-111111111111", TEST = "22222222-2222-4222-8222-222222222222", SEEDP = "33333333-3333-4333-8333-333333333333";
const OUT = "44444444-4444-4444-8444-444444444444", OFF = "55555555-5555-4555-8555-555555555555", MUTED = "66666666-6666-4666-8666-666666666666", X = "77777777-7777-4777-8777-777777777777";
const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table public.profiles(user_id uuid primary key, is_seed boolean not null default false);
create table public.test_accounts(user_id uuid primary key);
create table public.notification_preferences(user_id uuid primary key, declutter_listings boolean not null default true);
create table public.declutter_items(id uuid primary key, seller_id uuid, title text, status text, current_price_cents int, live_at timestamptz, is_seed boolean not null default false);
create table public.declutter_cart_items(id uuid primary key default gen_random_uuid(), item_id uuid, status text);
create table off_keys(k text); create table banned(user_id uuid);
create function public.require_feature(k text) returns void language plpgsql as $$ begin if exists(select 1 from off_keys where off_keys.k = require_feature.k) then raise exception 'feature_disabled' using errcode='42501'; end if; end $$;
create function public.is_caller_banned() returns boolean language sql as $$ select exists(select 1 from banned where user_id = auth.uid()) $$;
create function public.feature_enabled_for_user(k text, u uuid) returns boolean language sql as $$ select u <> '${OFF}'::uuid $$;
create function public.declutter_member_out(u uuid) returns boolean language sql as $$ select u = '${OUT}'::uuid $$;
create table notes(user_id uuid, type text, title text, message text, link text);
create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language sql as $$ insert into notes values (p_user, p_type, p_title, p_message, p_link) $$;
create table defects(src text, k text, msg text);
create function public.log_cron_defect(a text, b text, c text) returns void language sql as $$ insert into defects values (a, b, c) $$;
insert into profiles values ('${S}', false), ('${TEST}', false), ('${SEEDP}', true), ('${OUT}', false), ('${OFF}', false), ('${MUTED}', false), ('${X}', false);
insert into test_accounts values ('${TEST}');
insert into notification_preferences values ('${MUTED}', false);
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 1; i <= 3; i++) await db.exec(mig);

const old = "now() - interval '15 days'";
// n, seller, title, status, cents, live_at, is_seed
const items = [
  [1, S, "Free box", "live", 0, old, false],                                // asked
  [2, S, "New free box", "live", 0, "now() - interval '13 days'", false],
  [3, S, "Priced chair", "live", 4000, old, false],
  [4, S, "Seed box", "live", 0, old, true],
  [5, TEST, "Test account box", "live", 0, old, false],
  [6, SEEDP, "Seed profile box", "live", 0, old, false],
  [7, S, "In a cart", "live", 0, old, false],
  [8, OUT, "Out seller", "live", 0, old, false],
  [9, OFF, "Switch off", "live", 0, old, false],
  [10, S, "Reserved", "reserved", 0, old, false],
  [11, MUTED, "Listings notice off", "live", 0, old, false],
  [12, S, "Paused box", "paused", 0, old, false],
];
for (const [n, s, t, st, c, at, seed] of items) await db.exec(`insert into declutter_items values ('${id(n)}', '${s}', '${t}', '${st}', ${c}, ${at}, ${seed})`);
await db.exec(`insert into declutter_cart_items(item_id, status) values ('${id(7)}', 'in_cart')`);

const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const refused = async (uid, sql, code) => { try { await as(uid, sql); return false; } catch (e) { return String(e.message).includes(code); } };
const sweep = async () => (await as(null, `select declutter_free_still_available_sweep() r`)).rows[0].r;
const notes = async () => (await db.query(`select * from notes order by title`)).rows;

await safe("the sweep tells exactly one listing", async () => (await sweep()).told === 1);
await safe("only the due free listing is asked (never test data, muted, out, off, new, priced, reserved, paused, in a cart)", async () => {
  const n = await notes();
  return n.length === 1 && n[0].user_id === S && n[0].link === `/declutter?tab=selling&still=${id(1)}`;
});
await safe("the notice names the item, in the Listings type", async () => {
  const [n] = await notes();
  return n.title === 'Is "Free box" still available?' && n.type === "declutter_listings";
});
await safe("a second run tells nobody", async () => (await sweep()).told === 0 && (await notes()).length === 1);
await safe("unanswered, it comes round again 14 days later", async () => {
  await db.exec(`update declutter_free_still_asks set asked_at = now() - interval '14 days 1 minute' where item_id = '${id(1)}'`);
  return (await sweep()).told === 1 && (await notes()).length === 2;
});
await safe("an unanswered ask ends nothing", async () => (await db.query(`select status from declutter_items where id = '${id(1)}'`)).rows[0].status === "live");
await safe("13 days after the last ask, nothing", async () => {
  await db.exec(`update declutter_free_still_asks set asked_at = now() - interval '13 days' where item_id = '${id(1)}'`);
  return (await sweep()).told === 0;
});

await safe("Still available puts the next ask 14 days out", async () => {
  await db.exec(`update declutter_free_still_asks set asked_at = now() - interval '20 days' where item_id = '${id(1)}'`);
  const r = (await as(S, `select declutter_free_still_available('${id(1)}') r`)).rows[0].r;
  return r === "still_available" && (await sweep()).told === 0;
});
await safe("14 days after Still available, it asks again", async () => {
  await db.exec(`update declutter_free_still_asks set answered_at = now() - interval '14 days 1 minute' where item_id = '${id(1)}'`);
  return (await sweep()).told === 1;
});
await safe("answering twice is calm", async () => (await as(S, `select declutter_free_still_available('${id(1)}') r`)).rows[0].r === "still_available");
await safe("another person can't answer", () => refused(X, `select declutter_free_still_available('${id(1)}')`, "item_not_found"));
await safe("signed out can't answer", () => refused(null, `select declutter_free_still_available('${id(1)}')`, "not_authenticated"));
await safe("a banned member can't answer", async () => {
  await db.exec(`insert into banned values ('${S}')`);
  const r = await refused(S, `select declutter_free_still_available('${id(1)}')`, "account_restricted");
  await db.exec(`delete from banned`);
  return r;
});
await safe("a priced listing can't be answered", () => refused(S, `select declutter_free_still_available('${id(3)}')`, "item_not_editable"));
await safe("a reserved listing can't be answered", () => refused(S, `select declutter_free_still_available('${id(10)}')`, "item_not_editable"));
await safe("switch off refuses the answer", async () => {
  await db.exec(`insert into off_keys values ('declutter')`);
  const r = await refused(S, `select declutter_free_still_available('${id(1)}')`, "feature_disabled");
  await db.exec(`delete from off_keys`);
  return r;
});
await safe("one failed notice doesn't stop the run, and it's logged", async () => {
  await db.exec(`update declutter_free_still_asks set asked_at = null, answered_at = null;
    create or replace function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null) returns void language plpgsql as $$ begin raise exception 'boom'; end $$`);
  const r = await sweep();
  const d = (await db.query(`select count(*)::int n from defects`)).rows[0].n;
  return r.errors === 1 && d === 1;
});
await safe("grants: the sweep is the server's, the answer is a member's, the marks are nobody's", async () => {
  const f = (await db.query(`select p.proname n, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u, has_function_privilege('service_role', p.oid, 'execute') s
    from pg_proc p where p.proname in ('declutter_free_still_available', 'declutter_free_still_available_sweep')`)).rows;
  const t = (await db.query(`select has_table_privilege('authenticated', 'public.declutter_free_still_asks', 'select') u, has_table_privilege('anon', 'public.declutter_free_still_asks', 'select') a`)).rows[0];
  return f.length === 2 && f.every((r) => r.a === false && r.s === true && r.u === (r.n === "declutter_free_still_available")) && t.u === false && t.a === false;
});

console.log(fail ? `RED ${fail} of ${pass + fail}` : `ALL OK ${pass}`);
process.exit(fail ? 1 : 0);
