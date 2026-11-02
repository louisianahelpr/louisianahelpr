#!/usr/bin/env node
/**
 * PGlite proof for 20261102013814_declutter_my_wanted_reply_deadlines.sql (A3-77 / A3-62, audit 11-01): the poster's
 * declutter_my_wanted replies carry the seller offer's respond_by, the accepted offer's in-cart checkout_by and paid,
 * read from the caller's own cart only.
 *
 *   node src/test/pglite/declutterMyWantedReplyDeadlines.pglite.mjs                      # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMyWantedReplyDeadlines.pglite.mjs   # red: the checks need it
 *   PLANT=any_buyer node src/test/pglite/declutterMyWantedReplyDeadlines.pglite.mjs      # red: a cart read not scoped to the caller
 *   PLANT=anon node src/test/pglite/declutterMyWantedReplyDeadlines.pglite.mjs           # red: anon keeps execute
 *
 * The stub world is declutterWantedMatchManage.pglite.mjs's, plus respond_by on offers and the cart table.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const prev = readFileSync(`${MIG_DIR}20261030221255_declutter_wanted_match_and_manage.sql`, "utf8");
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261102013814_declutter_my_wanted_reply_deadlines.sql`, "utf8");
const displayName = readFileSync(`${MIG_DIR}20261021061341_member_display_name.sql`, "utf8")
  .match(/CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?AS (\$fn\$)[\s\S]*?\1;/)[0];
const old = readFileSync(`${MIG_DIR}20261016053541_declutter_wanted_price_hint.sql`, "utf8");
const pick = (src, name) => src.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^)]*\\)\\s*RETURNS[\\s\\S]*?AS (\\$[a-z_]*\\$)\\n[\\s\\S]*?\\1;`))[0];
const readsCaller = readFileSync(`${MIG_DIR}20261031011531_declutter_my_reply_listings_reads_caller.sql`, "utf8");
const db = new PGlite();
const P = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", X = "33333333-3333-4333-8333-333333333333";
const I = (n) => `a0000000-0000-4000-8000-00000000000${n}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
-- Supabase gives anon an EXPLICIT execute on new functions; REVOKE FROM PUBLIC alone leaves it (CLAUDE.md).
alter default privileges grant execute on functions to anon, authenticated;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table off_keys(k text);
create function require_feature(k text) returns void language plpgsql as $$ begin if exists(select 1 from off_keys where off_keys.k = require_feature.k) then raise exception 'feature_disabled' using errcode='42501'; end if; end $$;
create function feature_enabled_for_user(k text, u uuid) returns boolean language sql as $$ select not exists(select 1 from off_keys where off_keys.k = $1) $$;
create table feature_switches(key text, audience text); insert into feature_switches values ('declutter','everyone'),('declutter_wanted','everyone');
create table bad(user_id uuid); create table user_blocks(blocker_id uuid, blocked_id uuid); create table outs(user_id uuid); create table seedhide(on_ boolean); insert into seedhide values (true);
create table testers(user_id uuid); create table minors(user_id uuid);
create function is_caller_banned() returns boolean language sql as $$ select exists(select 1 from bad where user_id = auth.uid()) $$;
create function declutter_assert_member(p boolean) returns uuid language plpgsql as $$ begin if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if; return auth.uid(); end $$;
create function are_users_blocked(a uuid, b uuid) returns boolean language sql as $$ select exists(select 1 from user_blocks where (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1)) $$;
create function declutter_member_out(u uuid) returns boolean language sql as $$ select exists(select 1 from outs where user_id = u) $$;
create function declutter_seller_out(u uuid) returns boolean language sql as $$ select exists(select 1 from outs where user_id = u) $$;
create function declutter_seller_hidden(u uuid) returns boolean language sql as $$ select false $$;
create function member_under_18(u uuid) returns boolean language sql as $$ select exists(select 1 from minors where user_id = u) $$;
create function seed_hidden_from_caller() returns boolean language sql as $$ select (select on_ from seedhide) and not exists(select 1 from testers where user_id = auth.uid()) $$;
create function seed_hidden_for(u uuid) returns boolean language sql as $$ select (select on_ from seedhide) and not exists(select 1 from testers where user_id = u) $$;
create function declutter_money_words(c int) returns text language sql as $$ select '$' || (c/100)::text $$;
create function declutter_wanted_snap_miles(a numeric, b numeric, c numeric, d numeric) returns int language sql as $$ select 1 $$;
create table cron_defects(src text, k text, msg text);
create function log_cron_defect(a text, b text, c text) returns void language sql as $$ insert into cron_defects values (a,b,c) $$;
create table notes(user_id uuid, title text, message text, link text);
create function declutter_wanted_alert_block(u uuid) returns text language sql as $$ select null::text $$;
create function declutter_wanted_notify(u uuid, t text, m text, l text) returns int language plpgsql as $$ begin insert into notes values (u,t,m,l); return 1; end $$;
create table profiles(user_id uuid primary key, full_name text, anonymized_at timestamptz, is_seed boolean default false);
insert into profiles values ('${P}', 'Pat Thibodeaux'), ('${S}', 'Sam Guidry'), ('${X}', 'Xan Broussard');
create table declutter_items(id uuid primary key, seller_id uuid, status text default 'live', current_price_cents int, title text, description text default '', category text, is_seed boolean default false,
  area_lat numeric(5,2) not null default 30.00, area_lng numeric(6,2) not null default -92.00, created_at timestamptz default now());
create table declutter_item_private(item_id uuid, floor_price_cents int);
create table declutter_item_photos(item_id uuid, storage_path text, position int);
create table declutter_wanted(id uuid primary key default gen_random_uuid(), user_id uuid, what text, category text, max_price_cents int, radius_miles smallint,
  area_lat numeric, area_lng numeric, status text default 'open', expires_at timestamptz default now() + interval '30 days', is_seed boolean default false,
  created_at timestamptz default now(), closed_at timestamptz, public boolean default false, photo_paths text[] not null default '{}',
  check ((status = 'closed') = (closed_at is not null)));
create table declutter_wanted_matches(wanted_id uuid, item_id uuid, seller_notified_at timestamptz, poster_notified_at timestamptz, primary key (wanted_id, item_id));
create table declutter_wanted_queue(item_id uuid primary key, attempts int default 0, queued_at timestamptz default now());
create table declutter_offers(id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, amount_cents int, awaiting text, status text default 'open',
  wanted_id uuid, created_at timestamptz default now(), respond_by timestamptz);
create table declutter_cart_items(id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, offer_id uuid, status text default 'in_cart',
  checkout_by timestamptz not null, created_at timestamptz default now());
create function declutter_wanted_match_item(p uuid) returns int language sql as $$ select 0 $$;
`);
await db.exec(displayName);
await db.exec(pick(old, "declutter_miles"));
await db.exec(prev);
let m = mig;
if (process.env.PLANT === "any_buyer") m = m.replaceAll("AND c.buyer_id = v_uid ", "");
if (process.env.PLANT === "anon") m = m.replace("FROM PUBLIC, anon;", "FROM PUBLIC;");
if (process.env.NEW_MIGRATION !== "skip") for (let i = 1; i <= 3; i++) await db.exec(m);
const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const results = {};
const ok = (name, v) => { results[name] = v === true || v === "ok" ? "ok" : `RED ${JSON.stringify(v)}`; };
const safe = async (name, fn) => { try { ok(name, await fn()); } catch (e) { ok(name, String(e.message ?? e)); } };

await db.exec(`insert into declutter_items(id, seller_id, current_price_cents, title, category) values ('${I(1)}', '${S}', 2500, 'Red 16-inch bike', 'bikes'), ('${I(2)}', '${S}', 900, 'Bike lock', 'bikes')`);
const W = (await db.query(`insert into declutter_wanted(user_id, what, category, max_price_cents, radius_miles, area_lat, area_lng, public) values ('${P}', 'kids bike', 'bikes', 3000, 10, 30, -92, true) returning id`)).rows[0].id;
const O1 = (await db.query(`insert into declutter_offers(item_id, buyer_id, seller_id, amount_cents, awaiting, wanted_id, respond_by) values ('${I(1)}', '${P}', '${S}', 2500, 'buyer', '${W}', '2026-11-03T20:00:00Z') returning id`)).rows[0].id;
const O2 = (await db.query(`insert into declutter_offers(item_id, buyer_id, seller_id, amount_cents, status, wanted_id, respond_by, created_at) values ('${I(2)}', '${P}', '${S}', 900, 'accepted', '${W}', '2026-11-02T20:00:00Z', now() - interval '1 hour') returning id`)).rows[0].id;
await db.exec(`insert into declutter_cart_items(item_id, buyer_id, seller_id, offer_id, checkout_by) values ('${I(2)}', '${P}', '${S}', '${O2}', '2026-11-03T02:00:00Z')`);
// Another member's cart line pointing at the same offer id must never show (scoped to the caller).
await db.exec(`insert into declutter_cart_items(item_id, buyer_id, seller_id, offer_id, checkout_by, created_at) values ('${I(2)}', '${X}', '${S}', '${O2}', '2030-01-01T00:00:00Z', now() + interval '1 minute')`);
const replies = async () => (await as(P, `select replies from declutter_my_wanted() where id = '${W}'`)).rows[0].replies;
const byOffer = async (o) => (await replies()).find((r) => r.offer_id === o);

await safe("openReplyHasRespondBy", async () => Date.parse((await byOffer(O1)).respond_by) === Date.parse("2026-11-03T20:00:00Z"));
await safe("acceptedReplyHasItsCheckoutBy", async () => Date.parse((await byOffer(O2)).checkout_by) === Date.parse("2026-11-03T02:00:00Z"));
await safe("openReplyHasNoCheckoutBy", async () => (await byOffer(O1)).checkout_by === null);
await safe("notPaidYet", async () => (await byOffer(O2)).paid === false);
await safe("paidOnceTheCartLineIsPaid", async () => {
  await db.exec(`update declutter_cart_items set status = 'paid' where offer_id = '${O2}' and buyer_id = '${P}'`);
  const r = await byOffer(O2);
  return r.paid === true && r.checkout_by === null;
});
await safe("anotherMembersPaidCartNeverCounts", async () => {
  await db.exec(`update declutter_cart_items set status = 'paid' where buyer_id = '${P}'`);
  await db.exec(`update declutter_cart_items set status = 'in_cart' where buyer_id = '${P}'`);
  await db.exec(`update declutter_cart_items set status = 'paid' where buyer_id = '${X}'`);
  return (await byOffer(O2)).paid === false;
});
await safe("othersSeeNoRows", async () => (await as(S, `select count(*)::int n from declutter_my_wanted()`)).rows[0].n === 0);
await safe("signedOutRefused", async () => { try { await as(null, `select * from declutter_my_wanted()`); return "no error"; } catch (e) { return /not_authenticated/.test(e.message) || e.message; } });
await safe("grants", async () => {
  const r = (await db.query(`select has_function_privilege('anon', 'public.declutter_my_wanted()', 'execute') a, has_function_privilege('authenticated', 'public.declutter_my_wanted()', 'execute') u`)).rows[0];
  return r.a === false && r.u === true;
});

const red = Object.entries(results).filter(([, v]) => v !== "ok");
console.log(JSON.stringify(results, null, 1));
console.log(red.length ? `RED ${red.length} of ${Object.keys(results).length}` : `ALL OK ${Object.keys(results).length}`);
process.exit(red.length ? 1 : 0);
