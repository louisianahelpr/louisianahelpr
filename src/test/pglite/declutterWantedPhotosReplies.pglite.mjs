#!/usr/bin/env node
/**
 * PGlite proof for 20261030041359_declutter_wanted_photos_and_replies.sql (the Wanted hub, owner 2026-10-30):
 * up to 3 photos on a Wanted post (owner-only, own folder, the object really there and an image), the replies on
 * your own posts in declutter_my_wanted, and the first photo on declutter_wanted_browse.
 *
 *   node src/test/pglite/declutterWantedPhotosReplies.pglite.mjs                      # ALL OK (new migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterWantedPhotosReplies.pglite.mjs   # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterWantedPhotosReplies.pglite.mjs
 *
 * The stub world is declutterWantedReplies.pglite.mjs's (tables and helpers shaped as the migrations read them),
 * plus a storage.objects stub with storage.foldername. The functions this migration replaces come verbatim from the
 * migrations that defined them (20261016053541, then 20261021031757). pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261030041359_declutter_wanted_photos_and_replies.sql`, "utf8");
const replies = readFileSync(`${MIG_DIR}20261021031757_declutter_wanted_public_replies.sql`, "utf8");
const old = readFileSync(`${MIG_DIR}20261016053541_declutter_wanted_price_hint.sql`, "utf8");
const displayName = readFileSync(`${MIG_DIR}20261021061341_member_display_name.sql`, "utf8")
  .match(/CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?AS (\$fn\$)[\s\S]*?\1;/)[0];
const pick = (name) => old.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^)]*\\)\\s*RETURNS[\\s\\S]*?AS (\\$[a-z_]*\\$)\\n[\\s\\S]*?\\1;`))[0];
const db = new PGlite();
const P = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", X = "33333333-3333-4333-8333-333333333333";
const ITEM = "a0000000-0000-4000-8000-000000000001";
const FAR = "a0000000-0000-4000-8000-000000000002", AUC = "a0000000-0000-4000-8000-000000000003";
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
create table minors(user_id uuid);
create function member_under_18(u uuid) returns boolean language sql as $$ select exists(select 1 from minors where user_id = u) $$;
create function seed_hidden_from_caller() returns boolean language sql as $$ select (select on_ from seedhide) and not exists(select 1 from testers where user_id = auth.uid()) $$;
create function seed_hidden_for(u uuid) returns boolean language sql as $$ select (select on_ from seedhide) and not exists(select 1 from testers where user_id = u) $$;
create function declutter_wanted_pairs(a uuid, b uuid, c boolean) returns table(wanted_id uuid, item_id uuid, miles double precision) language sql as $$ select null::uuid, null::uuid, 0::double precision where false $$;
create function declutter_wanted_record_match(a uuid, b uuid, c boolean, d boolean) returns integer language sql as $$ select 0 $$;
create table notes(user_id uuid, title text, message text);
create function declutter_notify(u uuid, k text, t text, m text, l text, a uuid) returns void language sql as $$ insert into notes values (u, t, m) $$;
create table profiles(user_id uuid primary key, full_name text, anonymized_at timestamptz);
insert into profiles values ('${P}', 'Pat Thibodeaux'), ('${S}', 'Sam Guidry'), ('${X}', 'Xan Broussard');
create table declutter_items(id uuid primary key, seller_id uuid, status text, sale_mode text, current_price_cents int, title text, is_seed boolean default false,
  area_lat numeric(5,2) not null default 30.00, area_lng numeric(6,2) not null default -92.00);
insert into declutter_items values ('${ITEM}', '${S}', 'live', 'offers', 3000, 'Kids bike', false);
-- W6: one degree of latitude north (~69 mi) of a 10-mile post. W7: an 'auction'-mode listing, close by.
insert into declutter_items values ('${FAR}', '${S}', 'live', 'offers', 3000, 'Kids bike far', false, 31.00, -92.00);
insert into declutter_items values ('${AUC}', '${S}', 'live', 'auction', 3000, 'Kids bike auction', false);
create table declutter_wanted(id uuid primary key default gen_random_uuid(), user_id uuid, what text, category text, max_price_cents int, radius_miles smallint,
  area_lat numeric, area_lng numeric, status text default 'open', expires_at timestamptz default now() + interval '30 days', is_seed boolean default false,
  created_at timestamptz default now(), closed_at timestamptz);
create table declutter_offers(id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, amount_cents int, awaiting text, status text default 'open',
  respond_by timestamptz, counter_count int default 0, created_at timestamptz default now(), updated_at timestamptz default now(), closed_at timestamptz);
create unique index declutter_offers_one_open_per_buyer on declutter_offers(item_id, buyer_id) where status = 'open';
create table declutter_offer_events(offer_id uuid, actor_side text, action text, amount_cents int);
grant select on declutter_offers, declutter_offer_events to authenticated;
-- storage stub: the columns the photo checks read, and foldername() as Supabase defines it (the folders, not the file).
create schema storage;
create table storage.objects(bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`);
await db.exec(displayName);
await db.exec(pick("declutter_miles"));
await db.exec(pick("declutter_create_wanted"));
await db.exec(pick("declutter_my_wanted"));
await db.exec(replies);
const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) for (let i = 1; i <= 3; i++) await db.exec(mig);

const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const fails = async (uid, sql, code) => { try { await as(uid, sql); return `NO ERROR (wanted ${code})`; } catch (e) { return e.message.includes(code) ? "ok" : `wrong: ${e.message}`; } };
const tryRows = async (uid, sql) => { try { return (await as(uid, sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; } };
const obj = (name, owner, mime = "image/jpeg", size = 1000) =>
  db.exec(`insert into storage.objects values ('job-photos', '${name}', '${owner}', '${owner}', '{"mimetype":"${mime}","size":"${size}"}')`);
const r = {};

const post = (await as(P, `select declutter_create_wanted('Kids bike 16 inch', 'baby_kids', 2500, 10, 30.00, -92.00, true) id`)).rows[0].id;
const path = (n) => `${P}/wanted/${post}/p${n}.jpg`;
for (const n of [1, 2, 3, 4]) await obj(path(n), P);
await obj(`${S}/wanted/${post}/s.jpg`, S);
await obj(`${P}/wanted/${post}/v.mov`, P, "video/quicktime");
await obj(`${P}/wanted/00000000-0000-4000-8000-00000000dead/x.jpg`, P);
const add = (uid, p) => tryRows(uid, `select declutter_add_wanted_photo('${post}', '${p}') n`);

// A. Photos: owner only, own folder for THIS post, the object really there and an image, at most 3.
const a1 = await add(P, path(1));
r.addFirst = Array.isArray(a1) && a1[0]?.n === 1 ? "ok" : JSON.stringify(a1);
r.addSameAgainIsNoop = JSON.stringify(await add(P, path(1))) === JSON.stringify([{ n: 1 }]) ? "ok" : "bad";
await add(P, path(2)); await add(P, path(3));
r.fourthRefused = await fails(P, `select declutter_add_wanted_photo('${post}', '${path(4)}')`, "wanted_too_many_photos");
r.notTheOwner = await fails(S, `select declutter_add_wanted_photo('${post}', '${S}/wanted/${post}/s.jpg')`, "wanted_not_found");
await as(null, `select 1`);
// Soft: with NEW_MIGRATION=skip the column is missing, and the checks report instead of crashing.
await db.exec(`update declutter_wanted set photo_paths = '{}' where id = '${post}'`).catch(() => {});
r.otherFolder = await fails(P, `select declutter_add_wanted_photo('${post}', '${S}/wanted/${post}/s.jpg')`, "photo_not_uploaded");
r.otherPostFolder = await fails(P, `select declutter_add_wanted_photo('${post}', '${P}/wanted/00000000-0000-4000-8000-00000000dead/x.jpg')`, "photo_not_uploaded");
r.noSuchObject = await fails(P, `select declutter_add_wanted_photo('${post}', '${P}/wanted/${post}/missing.jpg')`, "photo_not_uploaded");
r.videoRefused = await fails(P, `select declutter_add_wanted_photo('${post}', '${P}/wanted/${post}/v.mov')`, "photo_not_uploaded");
r.deeperPathRefused = await fails(P, `select declutter_add_wanted_photo('${post}', '${P}/wanted/${post}/a/b.jpg')`, "photo_not_uploaded");
r.anonRefused = await fails(null, `select declutter_add_wanted_photo('${post}', '${path(1)}')`, "not_authenticated");
await add(P, path(1)); await add(P, path(2));
const rm = await tryRows(P, `select declutter_remove_wanted_photo('${post}', '${path(1)}') n`);
r.removeOwn = Array.isArray(rm) && rm[0]?.n === 1 ? "ok" : JSON.stringify(rm);
r.removeOthersRefused = await fails(S, `select declutter_remove_wanted_photo('${post}', '${path(2)}')`, "wanted_not_found");
r.capInTheTable = await fails(null, `update declutter_wanted set photo_paths = array['a','b','c','d'] where id = '${post}'`, "declutter_wanted_photo_paths_max3");
const closed = (await as(P, `select declutter_create_wanted('Crib', 'baby_kids', 4000, 10, 30.00, -92.00, true) id`)).rows[0].id;
await db.exec(`update declutter_wanted set status = 'closed' where id = '${closed}'`);
await obj(`${P}/wanted/${closed}/c.jpg`, P);
r.closedPostRefused = await fails(P, `select declutter_add_wanted_photo('${closed}', '${P}/wanted/${closed}/c.jpg')`, "wanted_not_open");

// B. Replies on your own posts: which seller (First L.), which listing, what price; only the poster's own.
const offer = (await as(S, `select declutter_wanted_reply('${post}', '${ITEM}', 2500) id`)).rows[0].id;
const mine = await tryRows(P, `select id, photo_paths, replies from declutter_my_wanted() where id = '${post}'`);
const rep = Array.isArray(mine) ? mine[0]?.replies?.[0] : null;
r.myWantedHasPhotos = Array.isArray(mine) && JSON.stringify(mine[0]?.photo_paths) === JSON.stringify([path(2)]) ? "ok" : JSON.stringify(mine);
r.myWantedHasReply = rep && rep.offer_id === offer && rep.item_id === ITEM && rep.item_title === "Kids bike" && rep.seller_name === "Sam G."
  && rep.amount_cents === 2500 && rep.status === "open" && rep.awaiting === "buyer" ? "ok" : JSON.stringify(rep ?? mine);
r.replyHasNoSellerId = rep && !Object.keys(rep).some((k) => /seller_id|user_id/.test(k)) ? "ok" : JSON.stringify(rep);
const xs = await tryRows(X, `select count(*)::int n from declutter_my_wanted()`);
r.othersSeeNone = Array.isArray(xs) && xs[0].n === 0 ? "ok" : JSON.stringify(xs);
await db.exec(`insert into blocks values ('${P}', '${S}')`);
const blocked = await tryRows(P, `select replies from declutter_my_wanted() where id = '${post}'`);
r.blockedSellerLeftOut = Array.isArray(blocked) && JSON.stringify(blocked[0]?.replies) === "[]" ? "ok" : JSON.stringify(blocked);
await db.exec(`delete from blocks`);

// B2. "I have this" (W6 + W7): a listing outside the post's distance is refused; any listing for sale now answers.
// A fresh post, so the far refusal cannot be any other refusal (the seller has not answered it yet).
const crib = (await as(P, `select declutter_create_wanted('Kids bike', 'baby_kids', 2500, 10, 30.00, -92.00, true) id`)).rows[0].id;
r.farListingRefused = await fails(S, `select declutter_wanted_reply('${crib}', '${FAR}', 2000)`, "listing_too_far");
const auc = await tryRows(S, `select declutter_wanted_reply('${crib}', '${AUC}', 2000) id`);
r.auctionListingAnswers = Array.isArray(auc) && typeof auc[0]?.id === "string" ? "ok" : JSON.stringify(auc);
r.privatePostStillOneAnswer = await (async () => {
  await db.exec(`update declutter_wanted set public = false where id = '${crib}'`);
  const v = await fails(S, `select declutter_wanted_reply('${crib}', '${FAR}', 2000)`, "wanted_not_found");
  await db.exec(`update declutter_wanted set public = true where id = '${crib}'`);
  return v;
})();

// C. Wanted near you: the post's first photo, still no coordinates or ids.
const seen = await tryRows(X, `select * from declutter_wanted_browse(30.02, -92.01) where id = '${post}'`);
r.browseFirstPhoto = Array.isArray(seen) && seen[0]?.photo_path === path(2) ? "ok" : JSON.stringify(seen);
r.browseNoCoordsNoUser = Array.isArray(seen) && seen[0] && Object.keys(seen[0]).sort().join(",") === "category,expires_at,id,max_price_cents,miles,photo_path,poster_name,replied,what" ? "ok" : JSON.stringify(seen);

// D. Switch, grants, delete policy.
await db.exec(`insert into off_keys values ('declutter_wanted')`);
r.switchOff = await fails(P, `select declutter_add_wanted_photo('${post}', '${path(3)}')`, "feature_disabled");
await db.exec(`delete from off_keys`);
const fns = ["declutter_wanted_reply(uuid,uuid,integer)", "declutter_add_wanted_photo(uuid,text)", "declutter_remove_wanted_photo(uuid,text)", "declutter_my_wanted()", "declutter_wanted_browse(numeric,numeric)"];
const anonCan = [], authCannot = [];
for (const f of fns) {
  const q = await tryRows(null, `select has_function_privilege('anon', '${f}', 'execute') a, has_function_privilege('authenticated', '${f}', 'execute') u`);
  if (!Array.isArray(q)) { anonCan.push(`${f}: ${q.error}`); continue; }
  if (q[0].a) anonCan.push(f);
  if (!q[0].u) authCannot.push(f);
}
r.noAnon = anonCan.length === 0 ? "ok" : anonCan.join(",");
r.membersCanCall = authCannot.length === 0 ? "ok" : authCannot.join(",");
const pol = (await db.query(`select cmd, qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Owners delete own unattached wanted photos'`)).rows[0];
r.deletePolicy = pol && /DELETE/i.test(pol.cmd) && /'wanted'/.test(pol.qual) && /photo_paths/.test(pol.qual) && /auth\.uid\(\)/.test(pol.qual) ? "ok" : JSON.stringify(pol ?? null);

const bad = Object.entries(r).filter(([, v]) => v !== "ok");
console.log(JSON.stringify(r, null, 1));
console.log(bad.length ? `FAILED (${bad.length}): ${bad.map(([k]) => k).join(", ")}` : `ALL OK (${Object.keys(r).length} checks; new migration applied 3x)`);
process.exit(bad.length ? 1 : 0);
