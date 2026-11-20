#!/usr/bin/env node
/**
 * PGlite proof for 20261120010630_declutter_offer_to_savers (Declutter top 5 #1, owner 11-19): the seller sends one
 * private offer to everyone who saved a listing.
 *
 *   node src/test/pglite/declutterOfferToSavers.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOfferToSavers.pglite.mjs  # RED: no such function
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterOfferToSavers.pglite.mjs
 *
 * declutter_offers, declutter_offer_events and declutter_watchlist are the real CREATEs (cut from their migrations).
 * declutter_items / declutter_item_private / profiles are trimmed to the columns the function reads. auth.uid() and the
 * membership/visibility helpers are stubs driven by settings (said so inline); declutter_notify is a stub that records
 * the notice, so who was told, with which kind and words, can be read back.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261120010630_declutter_offer_to_savers.sql`, "utf8");
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
-- Stubs: feature switch, ban, membership, blocks, out-of-Declutter, per-user feature, names, price words.
create function public.require_feature(k text) returns void language plpgsql as $$ begin
  if current_setting('t.feature', true) = 'off' then raise exception 'feature_disabled' using errcode = '42501'; end if; end $$;
create function public.is_caller_banned() returns boolean language sql stable as $$ select current_setting('t.banned', true) = 'on' $$;
create function public.declutter_assert_member(b boolean) returns uuid language plpgsql as $$ begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if; return auth.uid(); end $$;
create function public.are_users_blocked(a uuid, b uuid) returns boolean language sql stable as $$
  select coalesce(a::text = nullif(current_setting('t.blocked', true), '') or b::text = nullif(current_setting('t.blocked', true), ''), false) $$;
create function public.declutter_member_out(u uuid) returns boolean language sql stable as $$ select coalesce(u::text = nullif(current_setting('t.out', true), ''), false) $$;
create function public.feature_enabled_for_user(k text, u uuid) returns boolean language sql stable as $$ select not coalesce(u::text = nullif(current_setting('t.nofeature', true), ''), false) $$;
create function public.declutter_names_hidden(a uuid, b uuid) returns boolean language sql stable as $$ select false $$;
create function public.member_display_name(n text, d text) returns text language sql immutable as $$ select split_part(n, ' ', 1) || ' ' || left(split_part(n, ' ', 2), 1) || '.' $$;
create function public.declutter_price_text(c integer) returns text language sql immutable as $$ select '$' || (c / 100)::text $$;
create table public.notices(user_id uuid, type text, title text, message text, link text, other uuid, ref text);
create function public.declutter_notice_ref(id uuid) returns void language sql as $$ select set_config('t.ref', id::text, true) $$;
create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language sql as $$ insert into public.notices values (p_user, p_type, p_title, p_message, p_link, p_other, current_setting('t.ref', true)) $$;
-- Trimmed items / private rows.
create table public.declutter_items(id uuid primary key, seller_id uuid not null references auth.users(id), title text not null,
  status text not null, seller_hidden boolean not null default false, is_seed boolean not null default false, current_price_cents integer);
create table public.declutter_item_private(item_id uuid primary key references public.declutter_items(id), floor_price_cents integer);
`);
await db.exec(watchTable);
await db.exec(offersTable);
await db.exec(oneOpen);
await db.exec(eventsTable);
await db.exec(`
insert into public.declutter_items values
  ('${it(1)}', '${SELLER}', 'Lamp', 'live', false, false, 2000),
  ('${it(2)}', '${SELLER}', 'Chair', 'live', false, false, 4000),
  ('${it(3)}', '${SELLER}', 'Paused', 'paused', false, false, 2000),
  ('${it(4)}', '${TSELLER}', 'Test thing', 'live', false, true, 2000),
  ('${it(5)}', '${SELLER}', 'Nobody', 'live', false, false, 2000),
  ('${it(6)}', '${SELLER}', 'Free', 'live', false, false, 0);
insert into public.declutter_item_private values ('${it(2)}', 3500);
-- Lamp: A, B (already has an open offer), C (blocked), D (out), E (Declutter off), and the seller's own save.
insert into public.declutter_watchlist (user_id, item_id) values
  ('${A}', '${it(1)}'), ('${B}', '${it(1)}'), ('${C}', '${it(1)}'), ('${D}', '${it(1)}'), ('${E}', '${it(1)}'), ('${SELLER}', '${it(1)}'),
  ('${A}', '${it(2)}'), ('${A}', '${it(3)}'),
  ('${A}', '${it(4)}'), ('${T}', '${it(4)}'),
  ('${B}', '${it(5)}');
insert into public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by)
  values ('${it(1)}', '${B}', '${SELLER}', 1500, 'seller', now() + interval '48 hours'),
         ('${it(5)}', '${B}', '${SELLER}', 1500, 'seller', now() + interval '48 hours');
`);

if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const set = async (k, v) => db.exec(`select set_config('t.${k}', '${v ?? ""}', false)`);
const send = async (uid, item, pct, amt) => {
  await set("uid", uid);
  try {
    return { v: (await db.query(`select public.declutter_send_saver_offer('${item}', ${pct ?? "null"}, ${amt ?? "null"}) r`)).rows[0].r };
  } catch (e) { return { err: e.message }; }
};

await set("blocked", C); await set("out", D); await set("nofeature", E);
let r = await send(SELLER, it(1), 15, null);
ok(r.v?.sent === 1 && r.v?.amount_cents === 1700, `15% off $20: sent to the one eligible saver at $17 (${JSON.stringify(r.v ?? r.err)})`);
const offers = (await db.query(`select buyer_id, seller_id, amount_cents, awaiting, counter_count, status, saver_offer_id is not null s,
  respond_by > now() + interval '47 hours' and respond_by <= now() + interval '48 hours' d from public.declutter_offers where item_id = '${it(1)}' and saver_offer_id is not null`)).rows;
ok(offers.length === 1 && offers[0].buyer_id === A, `only A got an offer (not B with one open, blocked C, out D, E without Declutter, or the seller) (${offers.map((o) => o.buyer_id).join(",")})`);
ok(offers[0]?.awaiting === "buyer" && offers[0]?.counter_count === 0 && offers[0]?.status === "open" && offers[0]?.s && offers[0]?.d,
  "the thread waits on the BUYER, counter_count 0, open, 48 hours, tied to its send");
const ev = (await db.query(`select e.actor_side, e.action, e.amount_cents from public.declutter_offer_events e join public.declutter_offers o on o.id = e.offer_id where o.saver_offer_id is not null`)).rows;
ok(ev.length === 1 && ev[0].actor_side === "seller" && ev[0].action === "offer" && ev[0].amount_cents === 1700, "its first event is the seller's offer");
const n = (await db.query(`select * from public.notices`)).rows;
ok(n.length === 1 && n[0].user_id === A && n[0].type === "declutter_offers" && n[0].other === SELLER,
  "one notice, to A, of the Offers kind (the member's Offers switches decide push/email), naming the seller as counterpart");
ok(/Sam S\. offered you "Lamp" for \$17\.00 \(was \$20\.00\)/.test(n[0]?.message ?? ""), `the notice says who, what, the price and the old price (${n[0]?.message})`);
ok(n[0]?.link === "/declutter?tab=buying", "the notice opens Buying");
const offerId = (await db.query(`select id from public.declutter_offers where saver_offer_id is not null`)).rows[0].id;
ok(n[0]?.ref === offerId, "declutter_notice_ref names the offer (it opens it and retires once answered)");
const log = (await db.query(`select seller_id, percent_off, amount_cents, price_cents, sent_count from public.declutter_saver_offer_sends`)).rows;
ok(log.length === 1 && log[0].sent_count === 1 && log[0].percent_off === 15 && log[0].price_cents === 2000, "one send logged with what was sent");

r = await send(SELLER, it(1), 10, null);
ok(/saver_offer_rate_limited/.test(r.err ?? ""), `a second send on the same item within 24 hours: refused (${r.err})`);
await db.exec(`update public.declutter_saver_offer_sends set created_at = now() - interval '25 hours'`);
await db.exec(`update public.declutter_offers set status = 'expired' where saver_offer_id is not null`);
r = await send(SELLER, it(1), 10, null);
ok(r.v?.sent === 1 && r.v?.amount_cents === 1800, `after 24 hours it can send again (${JSON.stringify(r.v ?? r.err)})`);

r = await send(SELLER, it(5), 10, null);
ok(/no_savers/.test(r.err ?? ""), `nobody eligible: refused no_savers (${r.err})`);
ok((await db.query(`select count(*)::int c from public.declutter_saver_offer_sends where item_id = '${it(5)}'`)).rows[0].c === 0, "and nothing is logged, so the 24 hours are not spent");

r = await send(SELLER, it(2), 20, null);
ok(/below_your_lowest/.test(r.err ?? ""), `$40 at 20% off = $32, below the seller's $35 lowest price: refused (${r.err})`);
r = await send(SELLER, it(2), null, 3600);
ok(r.v?.sent === 1 && r.v?.amount_cents === 3600, `a price ($36) at or above the lowest: sent (${JSON.stringify(r.v ?? r.err)})`);

ok(/item_not_available/.test((await send(SELLER, it(3), 10, null)).err ?? ""), "a paused listing: refused");
ok(/item_not_found/.test((await send(A, it(1), 10, null)).err ?? ""), "someone else's listing: item_not_found");
ok(/invalid_offer_amount/.test((await send(SELLER, it(6), 10, null)).err ?? ""), "a free listing: refused");
ok(/invalid_input/.test((await send(SELLER, it(1), 60, null)).err ?? ""), "more than 50% off: refused");
ok(/invalid_input/.test((await send(SELLER, it(1), 10, 1500)).err ?? ""), "both a percent and a price: refused");
ok(/invalid_input/.test((await send(SELLER, it(1), null, null)).err ?? ""), "neither: refused");
await set("banned", "on");
ok(/account_restricted/.test((await send(SELLER, it(1), 10, null)).err ?? ""), "a banned seller: refused");
await set("banned", "");
ok(/not_authenticated/.test((await send(null, it(1), 10, null)).err ?? ""), "signed out: refused");

// Q137: a test listing reaches only test people.
await set("blocked", ""); await set("out", ""); await set("nofeature", "");
await db.exec(`delete from public.notices`);
r = await send(TSELLER, it(4), 10, null);
const tn = (await db.query(`select user_id from public.notices`)).rows.map((x) => x.user_id);
ok(r.v?.sent === 1 && tn.length === 1 && tn[0] === T, `a test listing's offer reaches the seed saver only, never real A (${tn.join(",")})`);
ok((await db.query(`select count(*)::int c from public.declutter_offers where item_id = '${it(4)}' and buyer_id = '${A}'`)).rows[0].c === 0, "no offer row for the real saver either");

const fn = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c from pg_proc where proname = 'declutter_send_saver_offer'`)).rows[0];
ok(fn?.d === true && /search_path=public, pg_temp/.test(fn?.c ?? ""), "SECURITY DEFINER, search_path public, pg_temp");
ok(!!fn && !/(^|[{,])=X/.test(fn.a) && !/anon=X/.test(fn.a) && /authenticated=X/.test(fn.a), `PUBLIC and anon cannot run it; members can (${fn?.a})`);
const pol = (await db.query(`select relrowsecurity r from pg_class where relname = 'declutter_saver_offer_sends'`)).rows[0];
ok(pol?.r === true, "the send log has RLS on");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
