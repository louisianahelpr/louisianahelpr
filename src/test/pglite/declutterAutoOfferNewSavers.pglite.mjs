#!/usr/bin/env node
/**
 * PGlite proof for 20261126002822_declutter_auto_offer_new_likers (owner 2026-11-25, Depop-style): the seller turns on
 * "Auto-offer new savers" and each new save gets one private offer.
 *
 *   node src/test/pglite/declutterAutoOfferNewSavers.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAutoOfferNewSavers.pglite.mjs  # RED: no such function
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterAutoOfferNewSavers.pglite.mjs
 *
 * declutter_offers, declutter_offer_events and declutter_watchlist are the real CREATEs (cut from their migrations);
 * the saver-offer migration (20261120010630) runs first, as on prod. declutter_items / declutter_item_private / profiles
 * are trimmed to the columns the functions read. auth.uid() and the membership/visibility helpers are stubs driven by
 * settings; declutter_notify records the notice so who was told, with which kind and words, can be read back.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261126002822_declutter_auto_offer_new_likers.sql`, "utf8");
const savers = readFileSync(`${MIG_DIR}20261120010630_declutter_offer_to_savers.sql`, "utf8");
const foundation = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");
const slice3 = readFileSync(`${MIG_DIR}20261014210518_declutter_slice3_offers_checkout.sql`, "utf8");
const cut = (src, re) => { const m = src.match(re); if (!m) throw new Error(`not found: ${re}`); return m[0]; };
const watchTable = cut(foundation, /CREATE TABLE IF NOT EXISTS public\.declutter_watchlist \([\s\S]*?\n\);/);
const offersTable = cut(slice3, /CREATE TABLE IF NOT EXISTS public\.declutter_offers \([\s\S]*?\n\);/);
const oneOpen = cut(slice3, /CREATE UNIQUE INDEX IF NOT EXISTS declutter_offers_one_open_per_buyer[\s\S]*?;/);
const eventsTable = cut(slice3, /CREATE TABLE IF NOT EXISTS public\.declutter_offer_events \([\s\S]*?\n\);/);

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const SELLER = "11111111-1111-4111-8111-111111111111", TSELLER = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-1111-4111-8111-111111111111", B = "bbbbbbbb-1111-4111-8111-111111111111", C = "cccccccc-1111-4111-8111-111111111111";
const D = "dddddddd-1111-4111-8111-111111111111", E = "eeeeeeee-1111-4111-8111-111111111111", T = "ffffffff-1111-4111-8111-111111111111";
const it = (n) => `90000000-0000-4000-8000-00000000000${n}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table auth.users(id uuid primary key);
insert into auth.users values ('${SELLER}'), ('${TSELLER}'), ('${A}'), ('${B}'), ('${C}'), ('${D}'), ('${E}'), ('${T}');
create table public.profiles(user_id uuid primary key, full_name text, is_seed boolean not null default false);
insert into public.profiles values ('${SELLER}', 'Sam Seller', false), ('${TSELLER}', 'Test Seller', true),
  ('${A}', 'Ann A', false), ('${B}', 'Bo B', false), ('${C}', 'Cy C', false), ('${D}', 'Di D', false), ('${E}', 'Ed E', false), ('${T}', 'Tess T', true);
create table public.test_accounts(user_id uuid primary key);
create function public.require_feature(k text) returns void language plpgsql as $$ begin
  if current_setting('t.feature', true) = 'off' then raise exception 'feature_disabled' using errcode = '42501'; end if; end $$;
create function public.is_caller_banned() returns boolean language sql stable as $$ select current_setting('t.banned', true) = 'on' $$;
create function public.declutter_assert_member(b boolean) returns uuid language plpgsql as $$ begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if; return auth.uid(); end $$;
create function public.are_users_blocked(a uuid, b uuid) returns boolean language sql stable as $$
  select coalesce(a::text = nullif(current_setting('t.blocked', true), '') or b::text = nullif(current_setting('t.blocked', true), ''), false) $$;
create function public.declutter_member_out(u uuid) returns boolean language sql stable as $$ select coalesce(u::text = nullif(current_setting('t.out', true), ''), false) $$;
create function public.declutter_seller_out(u uuid) returns boolean language sql stable as $$ select coalesce(u::text = nullif(current_setting('t.sellerout', true), ''), false) $$;
create function public.feature_enabled_for_user(k text, u uuid) returns boolean language sql stable as $$ select not coalesce(u::text = nullif(current_setting('t.nofeature', true), ''), false) $$;
create function public.declutter_names_hidden(a uuid, b uuid) returns boolean language sql stable as $$ select false $$;
create function public.member_display_name(n text, d text) returns text language sql immutable as $$ select split_part(n, ' ', 1) || ' ' || left(split_part(n, ' ', 2), 1) || '.' $$;
create function public.declutter_price_text(c integer) returns text language sql immutable as $$ select '$' || (c / 100)::text $$;
create table public.notices(user_id uuid, type text, title text, message text, link text, other uuid, ref text);
create function public.declutter_notice_ref(id uuid) returns void language sql as $$ select set_config('t.ref', id::text, true) $$;
create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language sql as $$ insert into public.notices values (p_user, p_type, p_title, p_message, p_link, p_other, current_setting('t.ref', true)) $$;
create table public.declutter_items(id uuid primary key, seller_id uuid not null references auth.users(id), title text not null,
  status text not null, seller_hidden boolean not null default false, is_seed boolean not null default false, current_price_cents integer);
create table public.declutter_item_private(item_id uuid primary key references public.declutter_items(id), floor_price_cents integer);
`);
await db.exec(watchTable);
await db.exec(offersTable);
await db.exec(oneOpen);
await db.exec(eventsTable);
await db.exec(savers);
await db.exec(`
insert into public.declutter_items values
  ('${it(1)}', '${SELLER}', 'Lamp', 'live', false, false, 2000),
  ('${it(2)}', '${SELLER}', 'Chair', 'live', false, false, 4000),
  ('${it(3)}', '${SELLER}', 'Paused', 'paused', false, false, 2000),
  ('${it(4)}', '${TSELLER}', 'Test thing', 'live', false, true, 2000),
  ('${it(5)}', '${SELLER}', 'No rule', 'live', false, false, 2000),
  ('${it(6)}', '${SELLER}', 'Free', 'live', false, false, 0),
  ('${it(7)}', '${SELLER}', 'Sold', 'sold', false, false, 2000);
insert into public.declutter_item_private values ('${it(2)}', 3500);
`);

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const set = async (k, v) => db.exec(`select set_config('t.${k}', '${v ?? ""}', false)`);
const rule = async (uid, item, pct) => {
  await set("uid", uid);
  try {
    return { v: (await db.query(`select public.declutter_set_auto_liker_offer('${item}', ${pct ?? "null"}) r`)).rows[0].r };
  } catch (e) { return { err: e.message }; }
};
const save = async (user, item) => {
  try { await db.exec(`insert into public.declutter_watchlist (user_id, item_id) values ('${user}', '${item}')`); return { ok: true }; }
  catch (e) { return { err: e.message }; }
};
const unsave = (user, item) => db.exec(`delete from public.declutter_watchlist where user_id = '${user}' and item_id = '${item}'`);
const offersFor = async (item) => (await db.query(`select buyer_id, amount_cents, awaiting, counter_count, status, auto_liker,
  respond_by > now() + interval '47 hours' and respond_by <= now() + interval '48 hours' d from public.declutter_offers where item_id = '${item}' and auto_liker order by created_at`)).rows;

// The seller turns it on.
let r = await rule(SELLER, it(1), 15);
ok(r.v?.percent_off === 15 && r.v?.amount_cents === 1700, `15% off $20 is on, at $17 (${JSON.stringify(r.v ?? r.err)})`);
const row = (await db.query(`select seller_id, percent_off from public.declutter_auto_liker_offers where item_id = '${it(1)}'`)).rows;
ok(row.length === 1 && row[0].seller_id === SELLER && row[0].percent_off === 15, "one rule row, the seller's, 15%");

// A new save gets the offer.
ok((await save(A, it(1))).ok, "A saves the Lamp (the save stands)");
let o = await offersFor(it(1));
ok(o.length === 1 && o[0].buyer_id === A && o[0].amount_cents === 1700, `A got one automatic offer at $17 (${JSON.stringify(o)})`);
ok(o[0]?.awaiting === "buyer" && o[0]?.counter_count === 0 && o[0]?.status === "open" && o[0]?.d, "it waits on the BUYER, counter_count 0, open, 48 hours");
const ev = (await db.query(`select e.actor_side, e.action, e.amount_cents from public.declutter_offer_events e join public.declutter_offers o on o.id = e.offer_id where o.auto_liker`)).rows;
ok(ev.length === 1 && ev[0].actor_side === "seller" && ev[0].action === "offer" && ev[0].amount_cents === 1700, "its first event is the seller's offer");
let n = (await db.query(`select * from public.notices`)).rows;
ok(n.length === 1 && n[0].user_id === A && n[0].type === "declutter_offers" && n[0].other === SELLER,
  "one notice, to A, of the Offers kind (A's own Offers switches decide push/email), naming the seller");
ok(/Sam S\. offered you "Lamp" for \$17\.00 \(was \$20\.00\)/.test(n[0]?.message ?? ""), `the notice says who, what, the price and the old price (${n[0]?.message})`);
const offerId = (await db.query(`select id from public.declutter_offers where auto_liker`)).rows[0]?.id;
ok(n[0]?.ref === offerId && n[0]?.link === "/declutter?tab=buying", "the notice opens this offer on Buying");

// Unsave + save again: never a second automatic offer (even after the first is closed).
await db.exec(`update public.declutter_offers set status = 'expired' where auto_liker`);
await unsave(A, it(1));
ok((await save(A, it(1))).ok, "A saves again (the save stands)");
ok((await offersFor(it(1))).length === 1, "no second automatic offer to the same saver on the same item");

// Who never gets one: an open offer already, blocked, out, Declutter off; and the save still stands for each.
await db.exec(`insert into public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by)
  values ('${it(1)}', '${B}', '${SELLER}', 1500, 'seller', now() + interval '48 hours')`);
await set("blocked", C); await set("out", D); await set("nofeature", E);
for (const [who, name] of [[B, "B (open offer)"], [C, "C (blocked)"], [D, "D (out of Declutter)"], [E, "E (Declutter off)"]]) {
  ok((await save(who, it(1))).ok, `${name} saves: the save stands`);
}
o = await offersFor(it(1));
ok(o.length === 1 && o[0].buyer_id === A, `no automatic offer to B, C, D or E (${o.map((x) => x.buyer_id).join(",")})`);
await set("blocked", ""); await set("out", ""); await set("nofeature", "");

// A seller out of Declutter (banned, strikes) sends nothing; the save stands.
await set("sellerout", SELLER);
await unsave(B, it(1));
await db.exec(`delete from public.declutter_offers where buyer_id = '${B}' and item_id = '${it(1)}'`);
ok((await save(B, it(1))).ok, "B saves while the seller is out of Declutter: the save stands");
ok(!(await offersFor(it(1))).some((x) => x.buyer_id === B), "and no automatic offer goes out in an out seller's name");
await set("sellerout", "");
await unsave(B, it(1));

// The save always stands: an error inside the send (here the notice) undoes only the offer.
await set("failnotify", "on");
await db.exec(`create or replace function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language plpgsql as $$ begin
    if current_setting('t.failnotify', true) = 'on' then raise exception 'notify broke'; end if;
    insert into public.notices values (p_user, p_type, p_title, p_message, p_link, p_other, current_setting('t.ref', true)); end $$`);
ok((await save(B, it(1))).ok, "a failing notice never fails the save");
ok((await db.query(`select count(*)::int c from public.declutter_watchlist where user_id = '${B}' and item_id = '${it(1)}'`)).rows[0].c === 1, "the save row is there");
ok(!(await offersFor(it(1))).some((x) => x.buyer_id === B), "and the half-made offer was undone with it (no offer without its notice)");
await set("failnotify", "");

// No rule: nothing.
ok((await save(A, it(5))).ok && (await offersFor(it(5))).length === 0, "a listing without the rule sends nothing");

// Turned off: nothing more.
r = await rule(SELLER, it(1), null);
ok(r.v === null && !r.err, `turned off (${JSON.stringify(r)})`);
ok((await db.query(`select count(*)::int c from public.declutter_auto_liker_offers where item_id = '${it(1)}'`)).rows[0].c === 0, "the rule row is gone");
await db.exec(`delete from public.notices`);
await save(T, it(1));
ok((await offersFor(it(1))).length === 1 && (await db.query(`select count(*)::int c from public.notices`)).rows[0].c === 0, "a save after it is off sends nothing");

// The lowest price: refused when set, and a price drop below it later sends nothing.
r = await rule(SELLER, it(2), 20);
ok(/below_your_lowest/.test(r.err ?? ""), `$40 at 20% off = $32, below the $35 lowest: refused (${r.err})`);
r = await rule(SELLER, it(2), 10);
ok(r.v?.amount_cents === 3600, `10% off $40 = $36: on (${JSON.stringify(r.v ?? r.err)})`);
await db.exec(`update public.declutter_items set current_price_cents = 3800 where id = '${it(2)}'`);
await save(B, it(2));
ok((await offersFor(it(2))).length === 0, "after a price drop to $38, 10% off ($34.20) is below the $35 lowest: no offer, the save stands");

// The listing no longer live: nothing.
r = await rule(SELLER, it(3), 10);
ok(r.v?.percent_off === 10, "a paused listing can have the rule set");
await save(A, it(3));
ok((await offersFor(it(3))).length === 0, "a save on a paused listing sends nothing");

// Refusals.
ok(/item_not_found/.test((await rule(A, it(1), 10)).err ?? ""), "someone else's listing: item_not_found");
ok(/invalid_offer_amount/.test((await rule(SELLER, it(6), 10)).err ?? ""), "a free listing: refused");
ok(/item_not_available/.test((await rule(SELLER, it(7), 10)).err ?? ""), "a sold listing: refused");
ok(/invalid_input/.test((await rule(SELLER, it(1), 60)).err ?? ""), "more than 50% off: refused");
ok(/invalid_input/.test((await rule(SELLER, it(1), 2)).err ?? ""), "less than 5% off: refused");
await set("banned", "on");
ok(/account_restricted/.test((await rule(SELLER, it(1), 10)).err ?? ""), "a banned seller: refused");
await set("banned", "");
ok(/not_authenticated/.test((await rule(null, it(1), 10)).err ?? ""), "signed out: refused");
await set("feature", "off");
ok(/feature_disabled/.test((await rule(SELLER, it(1), 10)).err ?? ""), "Declutter off: refused");
await set("feature", "");

// Q137: a test listing auto-offers only to test people.
await db.exec(`delete from public.notices`);
r = await rule(TSELLER, it(4), 10);
await save(A, it(4));
await save(T, it(4));
const tn = (await db.query(`select user_id from public.notices`)).rows.map((x) => x.user_id);
ok(r.v?.percent_off === 10 && tn.length === 1 && tn[0] === T, `a test listing's automatic offer reaches the seed saver only, never real A (${tn.join(",")})`);
ok((await db.query(`select count(*)::int c from public.declutter_offers where item_id = '${it(4)}' and buyer_id = '${A}'`)).rows[0].c === 0, "no offer row for the real saver either");

// Permissions and RLS.
const fn = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c from pg_proc where proname = 'declutter_set_auto_liker_offer'`)).rows[0];
ok(fn?.d === true && /search_path=public, pg_temp/.test(fn?.c ?? ""), "the setter: SECURITY DEFINER, search_path public, pg_temp");
ok(!!fn && !/(^|[{,])=X/.test(fn.a) && !/anon=X/.test(fn.a) && /authenticated=X/.test(fn.a), `the setter: PUBLIC and anon cannot run it; members can (${fn?.a})`);
const tg = (await db.query(`select proacl::text a, prosecdef d from pg_proc where proname = 'declutter_auto_offer_new_saver'`)).rows[0];
ok(tg?.d === true && !/(^|[{,])=X/.test(tg.a) && !/anon=X/.test(tg.a) && !/authenticated=X/.test(tg.a), `the trigger function: nobody but service_role may call it directly (${tg?.a})`);
const rls = (await db.query(`select relrowsecurity r from pg_class where relname = 'declutter_auto_liker_offers'`)).rows[0];
ok(rls?.r === true, "the rule table has RLS on");
const pol = (await db.query(`select cmd, qual from pg_policies where tablename = 'declutter_auto_liker_offers'`)).rows;
ok(pol.length === 1 && pol[0].cmd === "SELECT" && /seller_id = \( SELECT auth\.uid\(\)/.test(pol[0].qual ?? ""), `one policy: the seller reads own (${JSON.stringify(pol)})`);
const tbl = (await db.query(`select string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_name = 'declutter_auto_liker_offers' and grantee = 'authenticated'`)).rows[0];
ok(tbl?.p === "SELECT", `members may only read it (writes go through the setter) (${tbl?.p})`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
