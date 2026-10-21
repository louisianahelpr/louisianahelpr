#!/usr/bin/env node
/**
 * PGlite proof for 20261021031757_declutter_wanted_public_replies.sql (Q2267, board 117: sellers answer a public Wanted post with an offer).
 *
 *   node src/test/pglite/declutterWantedReplies.pglite.mjs                          # ALL OK (migration applied 3x over the old definitions)
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterWantedReplies.pglite.mjs
 *
 * A stub world (tables and helper functions shaped as the migration reads them, said so inline); the functions the
 * migration replaces are taken verbatim from the migration that defined them before. Ported from Builder 3c's
 * ~/.lh-pglite/b3c-wanted-replies.mjs into the repo (Declutter rework, 2026-10-21).
 * The members' table read of declutter_offers / declutter_offer_events is NOT taken away here: that REVOKE rides
 * ready/declutter-narrow-floor2 with client_compat_floor() 2, so `tableReadUnchangedHere` pins that this migration
 * leaves it as it was.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261021031757_declutter_wanted_public_replies.sql`, "utf8");
const old = readFileSync(`${MIG_DIR}20261016053541_declutter_wanted_price_hint.sql`, "utf8");
// The display-name helper the browse calls, verbatim from the migration that defines it (20261021061341).
const displayName = readFileSync(`${MIG_DIR}20261021061341_member_display_name.sql`, "utf8")
  .match(/CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?AS (\$fn\$)[\s\S]*?\1;/)[0];
const pick = (name) => old.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^)]*\\)\\s*RETURNS[\\s\\S]*?AS (\\$[a-z_]*\\$)\\n[\\s\\S]*?\\1;`))[0];
const db = new PGlite();
const P = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", X = "33333333-3333-4333-8333-333333333333", T = "44444444-4444-4444-8444-444444444444";
const ITEM = "a0000000-0000-4000-8000-000000000001", FIXED = "a0000000-0000-4000-8000-000000000002", XITEM = "a0000000-0000-4000-8000-000000000003", GONE = "a0000000-0000-4000-8000-000000000004";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table off_keys(k text);
create function require_feature(k text) returns void language plpgsql as $$ begin if exists(select 1 from off_keys where off_keys.k = require_feature.k) then raise exception 'feature_disabled' using errcode='42501'; end if; end $$;
create table bad(user_id uuid); create table blocks(a uuid, b uuid); create table outs(user_id uuid); create table seedhide(on_ boolean); insert into seedhide values (true);
create table testers(user_id uuid);
create function is_caller_banned() returns boolean language sql as $$ select exists(select 1 from bad where user_id = auth.uid()) $$;
create function declutter_assert_member(p boolean) returns uuid language plpgsql as $$ begin if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if; return auth.uid(); end $$;
create function are_users_blocked(a uuid, b uuid) returns boolean language sql as $$ select exists(select 1 from blocks where (blocks.a=$1 and blocks.b=$2) or (blocks.a=$2 and blocks.b=$1)) $$;
create function declutter_member_out(u uuid) returns boolean language sql as $$ select exists(select 1 from outs where user_id = u) $$;
create function declutter_seller_out(u uuid) returns boolean language sql as $$ select exists(select 1 from outs where user_id = u) $$;
create function declutter_seller_hidden(u uuid) returns boolean language sql as $$ select false $$;
-- member_under_18 stub: the members listed in minors (the real one reads profiles.date_of_birth).
create table minors(user_id uuid);
create function member_under_18(u uuid) returns boolean language sql as $$ select exists(select 1 from minors where user_id = u) $$;
create function seed_hidden_from_caller() returns boolean language sql as $$ select (select on_ from seedhide) and not exists(select 1 from testers where user_id = auth.uid()) $$;
create function seed_hidden_for(u uuid) returns boolean language sql as $$ select (select on_ from seedhide) and not exists(select 1 from testers where user_id = u) $$;
create function declutter_wanted_pairs(a uuid, b uuid, c boolean) returns table(wanted_id uuid, item_id uuid, miles double precision) language sql as $$ select null::uuid, null::uuid, 0::double precision where false $$;
create function declutter_wanted_record_match(a uuid, b uuid, c boolean, d boolean) returns integer language sql as $$ select 0 $$;
create table notes(user_id uuid, title text, message text);
create function declutter_notify(u uuid, k text, t text, m text, l text, a uuid) returns void language sql as $$ insert into notes values (u, t, m) $$;
create table profiles(user_id uuid primary key, full_name text, anonymized_at timestamptz);
insert into profiles values ('${P}', 'Pat Thibodeaux'), ('${S}', 'Sam Guidry'), ('${X}', 'Xan'), ('${T}', 'Test Poster');
create table declutter_items(id uuid primary key, seller_id uuid, status text, sale_mode text, current_price_cents int, title text, is_seed boolean default false);
insert into declutter_items values ('${ITEM}', '${S}', 'live', 'offers', 3000, 'Kids bike', false), ('${FIXED}', '${S}', 'live', 'fixed', 2000, 'Trike', false),
  ('${XITEM}', '${X}', 'live', 'offers', 2000, 'Scooter', false), ('${GONE}', '${S}', 'sold', 'offers', 2000, 'Helmet', false);
create table declutter_wanted(id uuid primary key default gen_random_uuid(), user_id uuid, what text, category text, max_price_cents int, radius_miles smallint,
  area_lat numeric, area_lng numeric, status text default 'open', expires_at timestamptz default now() + interval '30 days', is_seed boolean default false,
  created_at timestamptz default now(), closed_at timestamptz);
create table declutter_offers(id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, amount_cents int, awaiting text, status text default 'open',
  respond_by timestamptz, counter_count int default 0, created_at timestamptz default now(), updated_at timestamptz default now(), closed_at timestamptz);
create unique index declutter_offers_one_open_per_buyer on declutter_offers(item_id, buyer_id) where status = 'open';
create table declutter_offer_events(offer_id uuid, actor_side text, action text, amount_cents int);
-- As on prod before the migration: members could read both tables.
grant select on declutter_offers, declutter_offer_events to authenticated;
`);
await db.exec(displayName);
await db.exec(pick("declutter_create_wanted"));
await db.exec(pick("declutter_my_wanted"));
const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const fails = async (uid, sql, code) => { try { await as(uid, sql); return `NO ERROR (wanted ${code})`; } catch (e) { return e.message.includes(code) ? "ok" : `wrong: ${e.message}`; } };
// A post made BEFORE the migration (the old 6-argument function).
const oldPost = (await as(P, `select declutter_create_wanted('Old crib', 'baby_kids', 5000, 10, 30.00, -92.00) id`)).rows[0].id;
for (let i = 1; i <= 3; i++) await db.exec(mig);
const r = {};
r.notRetroactive = (await db.query(`select public from declutter_wanted where id = '${oldPost}'`)).rows[0].public === false ? "ok" : "bad";
const pub = (await as(P, `select declutter_create_wanted('Kids bike 16 inch', 'baby_kids', 2500, 10, 30.00, -92.00, true) id`)).rows[0].id;
const priv = (await as(P, `select declutter_create_wanted('Rocking chair', 'furniture', 4000, 10, 30.00, -92.00) id`)).rows[0].id;
r.defaultPrivate = (await db.query(`select public from declutter_wanted where id = '${priv}'`)).rows[0].public === false ? "ok" : "bad";
const seen = (await as(S, `select * from declutter_wanted_browse(30.02, -92.01)`)).rows;
r.sellerSeesPublicOnly = seen.length === 1 && seen[0].id === pub ? "ok" : JSON.stringify(seen);
r.noCoordsNoUser = seen[0] && Object.keys(seen[0]).sort().join(",") === "category,expires_at,id,max_price_cents,miles,poster_name,replied,what" ? "ok" : Object.keys(seen[0] ?? {}).join(",");
r.firstL = seen[0]?.poster_name === "Pat T." ? "ok" : seen[0]?.poster_name;
r.wholeMiles = Number.isInteger(seen[0]?.miles) ? "ok" : "bad";
r.farAway = (await as(S, `select count(*)::int n from declutter_wanted_browse(31.50, -92.00)`)).rows[0].n === 0 ? "ok" : "bad";
r.ownExcluded = (await as(P, `select count(*)::int n from declutter_wanted_browse(30.00, -92.00)`)).rows[0].n === 0 ? "ok" : "bad";
r.anonBrowse = await fails(null, `select * from declutter_wanted_browse(30.0, -92.0)`, "not_authenticated");
await db.exec(`insert into blocks values ('${P}', '${S}')`);
r.blockedHidden = (await as(S, `select count(*)::int n from declutter_wanted_browse(30.02, -92.01)`)).rows[0].n === 0 ? "ok" : "bad";
r.blockedReply = await fails(S, `select declutter_wanted_reply('${pub}', '${ITEM}', 2500)`, "wanted_not_found");
await db.exec(`delete from blocks; insert into outs values ('${P}')`);
r.posterOutHidden = (await as(S, `select count(*)::int n from declutter_wanted_browse(30.02, -92.01)`)).rows[0].n === 0 ? "ok" : "bad";
await db.exec(`delete from outs`);
// Review note 4 (2026-10-21): a poster found to be under 18 after posting is neither listed nor answerable.
await db.exec(`insert into minors values ('${P}')`);
r.minorPosterHidden = (await as(S, `select count(*)::int n from declutter_wanted_browse(30.02, -92.01)`)).rows[0].n === 0 ? "ok" : "bad";
r.minorPosterReply = await fails(S, `select declutter_wanted_reply('${pub}', '${ITEM}', 2500)`, "wanted_not_found");
// (Should the reply wrongly go through, its offer is removed so the checks below still run and report.)
await db.exec(`delete from minors; delete from declutter_offer_events; delete from declutter_offers where wanted_id = '${pub}'`);
// Review note 2: any whitespace splits the name (member_display_name), so a tab never shows the full surname.
await db.exec(`update profiles set full_name = E'Pat\\tThibodeaux' where user_id = '${P}'`);
const tabbed = (await as(S, `select poster_name from declutter_wanted_browse(30.02, -92.01)`)).rows[0]?.poster_name;
r.firstLAnyWhitespace = tabbed === "Pat T." ? "ok" : JSON.stringify(tabbed);
await db.exec(`update profiles set full_name = 'Pat Thibodeaux' where user_id = '${P}'`);
await db.exec(`update declutter_wanted set is_seed = true where id = '${pub}'`);
r.seedHidden = (await as(S, `select count(*)::int n from declutter_wanted_browse(30.02, -92.01)`)).rows[0].n === 0 ? "ok" : "bad";
await db.exec(`insert into testers values ('${S}')`);
r.seedVisibleToTester = (await as(S, `select count(*)::int n from declutter_wanted_browse(30.02, -92.01)`)).rows[0].n === 1 ? "ok" : "bad";
await db.exec(`delete from testers; update declutter_wanted set is_seed = false`);
r.overMax = await fails(S, `select declutter_wanted_reply('${pub}', '${ITEM}', 2600)`, "invalid_reply_amount");
r.privatePost = await fails(S, `select declutter_wanted_reply('${priv}', '${ITEM}', 2000)`, "wanted_not_found");
r.ownPost = await fails(P, `select declutter_wanted_reply('${pub}', '${ITEM}', 2000)`, "item_not_found");
r.notMyItem = await fails(S, `select declutter_wanted_reply('${pub}', '${XITEM}', 2000)`, "item_not_found");
r.notLive = await fails(S, `select declutter_wanted_reply('${pub}', '${GONE}', 2000)`, "item_not_available");
r.fixedMode = await fails(S, `select declutter_wanted_reply('${pub}', '${FIXED}', 2000)`, "sale_mode_unavailable");
const offer = (await as(S, `select declutter_wanted_reply('${pub}', '${ITEM}', 2500) id`)).rows[0].id;
const o = (await db.query(`select * from declutter_offers where id = '${offer}'`)).rows[0];
r.offerShape = o.buyer_id === P && o.seller_id === S && o.awaiting === "buyer" && o.amount_cents === 2500 && o.wanted_id === pub && o.status === "open" && o.counter_count === 1 ? "ok" : JSON.stringify(o);
r.event = (await db.query(`select count(*)::int n from declutter_offer_events where offer_id = '${offer}' and actor_side = 'seller' and action = 'counter'`)).rows[0].n === 1 ? "ok" : "bad";
r.tableReadUnchangedHere = (await db.query(`select has_table_privilege('authenticated','declutter_offers','select') a, has_table_privilege('authenticated','declutter_offer_events','select') b`)).rows.every((x) => x.a && x.b) ? "ok" : "bad (this migration must not narrow the offers read; the floor-2 migration does)";
r.notified = (await db.query(`select count(*)::int n from notes where user_id = '${P}' and title = 'A seller has a match'`)).rows[0].n === 1 ? "ok" : "bad";
r.twice = await fails(S, `select declutter_wanted_reply('${pub}', '${ITEM}', 2400)`, "already_replied");
// The item now has an open offer: any post answered with it is refused the same way, whoever the poster is.
const other = (await as(T, `select declutter_create_wanted('Kids bike any size', 'baby_kids', 2500, 10, 30.00, -92.00, true) id`)).rows[0].id;
r.openOfferIndependentOfPoster = await fails(S, `select declutter_wanted_reply('${other}', '${ITEM}', 2000)`, "listing_has_open_offer");
r.repliedFlag = (await as(S, `select replied from declutter_wanted_browse(30.02, -92.01) where id = '${pub}'`)).rows[0]?.replied === true ? "ok" : "bad";
// Rate limit: 10 replies in 24 h.
for (let k = 0; k < 10; k++) {
  const wid = (await db.query(`insert into declutter_wanted(user_id, what, category, max_price_cents, radius_miles, area_lat, area_lng, public) values ('${X}', 'w${k}', 'toys', 5000, 10, 30, -92, true) returning id`)).rows[0].id;
  await db.exec(`insert into declutter_offers(item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, wanted_id, status) values ('${ITEM}', '${X}', '${S}', 100, 'buyer', now(), '${wid}', 'declined')`);
}
await db.exec(`update declutter_offers set status = 'declined' where id = '${offer}'`);
r.rateLimited = await fails(S, `select declutter_wanted_reply('${other}', '${ITEM}', 2000)`, "reply_rate_limited");
// N1: at most 5 answers a day per POST; another post by the SAME poster still takes answers (no linking).
await db.exec(`delete from declutter_offers where seller_id = '${S}' and wanted_id is not null and id <> '${offer}'`);
for (let k = 0; k < 5; k++) await db.exec(`insert into declutter_offers(item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, wanted_id, status) values ('${XITEM}', '${T}', gen_random_uuid(), 100, 'buyer', now(), '${other}', 'declined')`);
r.postCap = await fails(S, `select declutter_wanted_reply('${other}', '${ITEM}', 2000)`, "wanted_busy");
const sibling = (await as(T, `select declutter_create_wanted('Kids bike lock', 'baby_kids', 2500, 10, 30.00, -92.00, true) id`)).rows[0].id;
const sib = (await as(S, `select declutter_wanted_reply('${sibling}', '${ITEM}', 2000) id`)).rows[0]?.id;
r.siblingPostNotLinked = sib ? "ok" : "bad";
r.alertCapSilent = (await db.query(`select count(*)::int n from notes where user_id = '${T}' and title = 'A seller has a match'`)).rows[0].n === 0 ? "ok" : "bad (6th answer of the day: no alert)";
await db.exec(`update profiles set anonymized_at = now() where user_id = '${T}'`);
r.anonymizedHidden = (await as(S, `select count(*)::int n from declutter_wanted_browse(30.02, -92.01) where id = '${other}'`)).rows[0].n === 0 ? "ok" : "bad";
r.posterToggles = (await as(P, `select declutter_set_wanted_public('${pub}', false) v`)).rows[0].v === false ? "ok" : "bad";
r.hiddenAfterToggle = (await as(S, `select count(*)::int n from declutter_wanted_browse(30.02, -92.01) where id = '${pub}'`)).rows[0].n === 0 ? "ok" : "bad";
r.othersCannotToggle = await fails(S, `select declutter_set_wanted_public('${pub}', true)`, "wanted_not_found");
r.myWantedHasPublic = (await as(P, `select count(*)::int n from declutter_my_wanted() where public is not null`)).rows[0].n === 3 ? "ok" : "bad";
await db.exec(`insert into off_keys values ('declutter_wanted')`);
r.switchOff = await fails(S, `select * from declutter_wanted_browse(30.02, -92.01)`, "feature_disabled");
await db.exec(`delete from off_keys`);
const fns = ["declutter_wanted_browse(numeric,numeric)", "declutter_wanted_reply(uuid,uuid,integer)", "declutter_set_wanted_public(uuid,boolean)", "declutter_create_wanted(text,text,integer,integer,numeric,numeric,boolean)", "declutter_my_wanted()", "declutter_wanted_snap_miles(numeric,numeric,numeric,numeric)"];
const anon = [];
for (const f of fns) if ((await db.query(`select has_function_privilege('anon', '${f}', 'execute') v`)).rows[0].v) anon.push(f);
r.noAnon = anon.length === 0 ? "ok" : anon.join(",");
r.oldSigGone = (await db.query(`select to_regprocedure('declutter_create_wanted(text,text,integer,integer,numeric,numeric)') is null v`)).rows[0].v ? "ok" : "bad";
const bad = Object.entries(r).filter(([, v]) => v !== "ok");
console.log(JSON.stringify(r, null, 1));
console.log(bad.length ? `FAILED: ${bad.map(([k]) => k).join(", ")}` : "ALL OK (migration applied 3x over the old definitions)");
process.exit(bad.length ? 1 : 0);
