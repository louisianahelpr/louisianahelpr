#!/usr/bin/env node
/**
 * PGlite proof for 20261030221255_declutter_wanted_match_and_manage.sql (Declutter posting audit 10-30): Wanted matching (#4), the seller's alert link (#5),
 * edit / post again / remove / the ending-soon reminder (#9), ordinary words (#11), I have this's listing read (#12)
 * and the post and reply photos (#19).
 *
 *   node src/test/pglite/declutterWantedMatchManage.pglite.mjs                      # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterWantedMatchManage.pglite.mjs   # red: the checks need it
 *
 * The stub world follows declutterWantedPhotosReplies.pglite.mjs. Functions the migration restates are stubbed only
 * where it does not restate them. pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261030221255_declutter_wanted_match_and_manage.sql`, "utf8");
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
  wanted_id uuid, created_at timestamptz default now());
create function declutter_wanted_match_item(p uuid) returns int language sql as $$ select 0 $$;
`);
await db.exec(displayName);
await db.exec(pick(old, "declutter_miles"));
// The pre-migration behaviour NEW_MIGRATION=skip is measured against: the prod definitions of pairs and create, as
// they stood before this migration (every word required, identical category, ASCII only).
if (process.env.NEW_MIGRATION === "skip") {
  await db.exec(`
  create function declutter_wanted_pairs(p_item uuid, p_wanted uuid, p_with_blocked boolean) returns table(wanted_id uuid, item_id uuid, miles double precision) language sql as $$
    select w.id, i.id, 0::double precision from declutter_wanted w join declutter_items i on i.category = w.category and i.status='live' and i.seller_id <> w.user_id
     where (p_item is null or i.id = p_item) and (p_wanted is null or w.id = p_wanted) and w.status='open'
       and to_tsvector('english', i.title || ' ' || i.description) @@ plainto_tsquery('english', w.what) $$;
  create function declutter_create_wanted(p_what text, p_category text, p_max_price_cents int, p_radius_miles int, p_lat numeric, p_lng numeric, p_public boolean default false) returns uuid language plpgsql as $$
    declare v uuid; begin
    if p_what !~ '^[A-Za-z0-9 .,''&()/-]+$' then raise exception 'invalid_wanted_text'; end if;
    insert into declutter_wanted(user_id, what, category, max_price_cents, radius_miles, area_lat, area_lng, public) values (auth.uid(), p_what, p_category, p_max_price_cents, p_radius_miles, p_lat, p_lng, p_public) returning id into v;
    return v; end $$;`);
} else {
  for (let i = 1; i <= 3; i++) await db.exec(mig);
  // 20261031011531 restates declutter_my_reply_listings to read the caller itself; READS_CALLER=skip leaves it out.
  if (process.env.READS_CALLER !== "skip") for (let i = 1; i <= 3; i++) await db.exec(readsCaller);
}
const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const fails = async (uid, sql, code) => { try { await as(uid, sql); return `NO ERROR (wanted ${code})`; } catch (e) { return String(e.message).includes(code) ? "ok" : `wrong: ${e.message}`; } };
const results = {};
const ok = (name, v) => { results[name] = v === true || v === "ok" ? "ok" : `RED ${JSON.stringify(v)}`; };
const safe = async (name, fn) => { try { ok(name, await fn()); } catch (e) { ok(name, String(e.message ?? e)); } };

const item = (n, seller, title, category, desc = "", price = 3000) => db.exec(`insert into declutter_items(id, seller_id, current_price_cents, title, description, category) values ('${I(n)}', '${seller}', ${price}, $q$${title}$q$, $q$${desc}$q$, '${category}')`);
const post = async (what, category, max = 5000) => (await as(P, `select declutter_create_wanted($q$${what}$q$, '${category}', ${max}, 10, 30.00, -92.00, true) id`)).rows[0].id;
const pairs = async (id) => (await as(P, `select item_id::text i from declutter_wanted_pairs(null, '${id}', false)`)).rows.map((r) => r.i);

// #4: the audit's four measured misses.
await item(1, S, "Boys bike 16 inch. Blue. Training wheels included.", "baby_kids");
await item(2, S, "Boys 16 in bicycle, blue", "bikes");
await item(3, S, "Sofa, gray, three seats", "furniture");
await item(4, S, "Oak dresser with mirror", "furniture");
await item(5, S, "Kids table and two chairs", "baby_kids");
await item(6, S, "Kids bike helmet", "books_media");
const bike = await post("Kids bike, 16 inch", "baby_kids");
const couch = await post("couch", "furniture");
const dresser = await post("oak dresser under 40", "furniture");
await safe("kidsBikeFindsBoysBike", async () => (await pairs(bike)).includes(I(1)));
await safe("kidsBikeFindsBicycleInBikes", async () => (await pairs(bike)).includes(I(2)));
await safe("couchFindsSofa", async () => (await pairs(couch)).includes(I(3)));
await safe("oakDresserFindsDresser", async () => (await pairs(dresser)).includes(I(4)));
await safe("softWordAloneDoesNotMatch", async () => !(await pairs(bike)).includes(I(5)));
await safe("farCategoryDoesNotMatch", async () => !(await pairs(bike)).includes(I(6)));

// #11: ordinary words, and what stays refused.
for (const [n, w] of [["accent", "Niño's bike"], ["curly", "Niño’s bike"], ["quote", `TV stand for 55" TV`], ["hash", "Bike #2"], ["cream", "Crème brûlée dish"], ["plus", "Chair + ottoman"]]) {
  await safe(`allowed_${n}`, async () => { await db.exec("delete from declutter_wanted where user_id = '" + S + "'"); return !!(await as(S, `select declutter_create_wanted($q$${w}$q$, 'other', 2000, 10, 30.00, -92.00, true) id`)).rows[0].id; });
}
for (const [n, w] of [["link", "see shop.com now"], ["accentLink", "see niñ.com now"], ["at", "crib @ me"], ["phone", "crib 5 0 4 5 5 5 1"], ["words", "five zero four five"], ["cyrillic", "Сrib сhеар"]]) {
  await safe(`refused_${n}`, () => fails(S, `select declutter_create_wanted($q$${w}$q$, 'other', 2000, 10, 30.00, -92.00, true)`, "invalid_wanted_text"));
}
await db.exec(`delete from declutter_wanted where user_id = '${S}'`);

// #5: the seller's alert opens the answer on this post with this listing, and still never repeats the poster's words.
await db.exec(`insert into declutter_item_private values ('${I(3)}', 1000)`);
await db.exec(`delete from declutter_wanted_matches; delete from notes`);
await safe("alertLinksToTheAnswer", async () => {
  await as(P, `select declutter_wanted_record_match('${couch}', '${I(3)}', true, false)`);
  const n = (await db.query(`select link, message from notes where user_id = '${S}'`)).rows[0];
  return n?.link === `/declutter?tab=wanted&answer=${couch}&item=${I(3)}` && !n.message.includes("couch");
});

// #9: edit.
await safe("editChangesTheWords", async () => {
  await as(P, `select declutter_update_wanted('${couch}', 'loveseat', 'furniture', 6000, 25)`);
  const w = (await db.query(`select what, max_price_cents m, radius_miles r from declutter_wanted where id = '${couch}'`)).rows[0];
  return w.what === "loveseat" && w.m === 6000 && w.r === 25;
});
await safe("editNotYours", () => fails(S, `select declutter_update_wanted('${couch}', 'loveseat', 'furniture', 6000, 25)`, "wanted_not_found"));
await safe("editSignedOut", () => fails(null, `select declutter_update_wanted('${couch}', 'loveseat', 'furniture', 6000, 25)`, "not_authenticated"));
await safe("editRefusesALink", () => fails(P, `select declutter_update_wanted('${couch}', 'see shop.com', 'furniture', 6000, 25)`, "invalid_wanted_text"));
await safe("editRefusesCents", () => fails(P, `select declutter_update_wanted('${couch}', 'loveseat', 'furniture', 6050, 25)`, "invalid_max_price"));
await safe("editRefusesRadius", () => fails(P, `select declutter_update_wanted('${couch}', 'loveseat', 'furniture', 6000, 7)`, "invalid_radius"));
await db.exec(`insert into bad values ('${X}')`);
await safe("editBanned", () => fails(X, `select declutter_update_wanted('${couch}', 'loveseat', 'furniture', 6000, 25)`, "account_restricted"));
await db.exec(`delete from bad`);
await db.exec(`insert into off_keys values ('declutter_wanted')`);
await safe("editSwitchOff", () => fails(P, `select declutter_update_wanted('${couch}', 'loveseat', 'furniture', 6000, 25)`, "feature_disabled"));
await db.exec(`delete from off_keys`);
await safe("editRematches", async () => {
  await db.exec(`delete from declutter_wanted_matches; delete from notes`);
  await db.exec(`update declutter_items set title = 'Loveseat, gray' where id = '${I(3)}'`);
  await as(P, `select declutter_update_wanted('${couch}', 'loveseat', 'furniture', 6000, 25)`);
  return (await db.query(`select count(*)::int n from declutter_wanted_matches where wanted_id = '${couch}' and item_id = '${I(3)}'`)).rows[0].n === 1;
});

// #9: post again.
await safe("closedCantBeEdited", async () => {
  await db.exec(`update declutter_wanted set status = 'closed', closed_at = now() where id = '${couch}'`);
  return fails(P, `select declutter_update_wanted('${couch}', 'loveseat', 'furniture', 6000, 25)`, "wanted_not_open");
});
await safe("reopenClosed", async () => {
  await as(P, `select declutter_reopen_wanted('${couch}')`);
  const w = (await db.query(`select status, closed_at, expires_at > now() + interval '29 days' fresh from declutter_wanted where id = '${couch}'`)).rows[0];
  return w.status === "open" && w.closed_at === null && w.fresh === true;
});
await safe("reopenExpired", async () => {
  await db.exec(`update declutter_wanted set expires_at = now() - interval '1 day' where id = '${dresser}'`);
  await as(P, `select declutter_reopen_wanted('${dresser}')`);
  return (await db.query(`select expires_at > now() f from declutter_wanted where id = '${dresser}'`)).rows[0].f === true;
});
await safe("reopenNotYours", () => fails(S, `select declutter_reopen_wanted('${couch}')`, "wanted_not_found"));
await safe("reopenKeepsTheOpenCap", async () => {
  await db.exec(`update declutter_wanted set status = 'closed', closed_at = now() where id = '${couch}'`);
  await db.exec(`insert into declutter_wanted(user_id, what, category, max_price_cents, radius_miles, area_lat, area_lng) select '${P}', 'filler', 'other', 100, 10, 30, -92 from generate_series(1, 10)`);
  const r = await fails(P, `select declutter_reopen_wanted('${couch}')`, "wanted_open_limit");
  await db.exec(`delete from declutter_wanted where what = 'filler'`);
  return r;
});

// #9: remove.
await safe("removeNotYours", () => fails(S, `select declutter_remove_wanted('${dresser}')`, "wanted_not_found"));
await safe("removeLeavesTheList", async () => {
  await db.exec(`update declutter_wanted set photo_paths = ARRAY['a.jpg'] where id = '${dresser}'`);
  const paths = (await as(P, `select declutter_remove_wanted('${dresser}') p`)).rows[0].p;
  const list = (await as(P, `select id from declutter_my_wanted()`)).rows.map((r) => r.id);
  return paths[0] === "a.jpg" && !list.includes(dresser);
});
await safe("removedNeverReturns", () => fails(P, `select declutter_reopen_wanted('${dresser}')`, "wanted_not_found"));
await safe("removedIsNotBrowsed", async () => !(await as(S, `select id from declutter_wanted_browse(30.00, -92.00)`)).rows.some((r) => r.id === dresser));

// #9: the reminder comes once, only inside the last 3 days.
await safe("reminderOnce", async () => {
  await db.exec(`delete from notes; update declutter_wanted set expires_at = now() + interval '2 days', expiry_told_at = null where id = '${bike}'`);
  await db.query(`select declutter_wanted_sweep()`);
  await db.query(`select declutter_wanted_sweep()`);
  return (await db.query(`select count(*)::int n from notes where title = 'Your Wanted ends soon'`)).rows[0].n === 1;
});
await safe("noReminderYet", async () => {
  await db.exec(`delete from notes; update declutter_wanted set expires_at = now() + interval '20 days', expiry_told_at = null where id = '${bike}'`);
  await db.query(`select declutter_wanted_sweep()`);
  return (await db.query(`select count(*)::int n from notes`)).rows[0].n === 0;
});

// #12: the read marks what Send would refuse, and is no oracle.
await db.exec(`insert into declutter_items(id, seller_id, current_price_cents, title, category, area_lat) values ('${I(7)}', '${S}', 3000, 'Far bike', 'bikes', 31.00)`);
await db.exec(`insert into declutter_offers(item_id, buyer_id, seller_id, amount_cents, status) values ('${I(2)}', '${X}', '${S}', 100, 'open')`);
await safe("marksTooFar", async () => (await as(S, `select refuses from declutter_my_reply_listings('${bike}') where id = '${I(7)}'`)).rows[0]?.refuses === "too_far");
await safe("marksOpenOffer", async () => (await as(S, `select refuses from declutter_my_reply_listings('${bike}') where id = '${I(2)}'`)).rows[0]?.refuses === "open_offer");
await safe("fineListingHasNoMark", async () => (await as(S, `select refuses from declutter_my_reply_listings('${bike}') where id = '${I(1)}'`)).rows[0]?.refuses === null);
await safe("onlyYourListings", async () => (await as(X, `select count(*)::int n from declutter_my_reply_listings('${bike}')`)).rows[0].n === 0);
await safe("privateIsOneAnswer", async () => {
  await db.exec(`update declutter_wanted set public = false where id = '${bike}'`);
  const r = await fails(S, `select * from declutter_my_reply_listings('${bike}')`, "wanted_not_found");
  await db.exec(`update declutter_wanted set public = true where id = '${bike}'`);
  return r;
});
await safe("blockedIsOneAnswer", async () => {
  await db.exec(`insert into user_blocks values ('${P}', '${S}')`);
  const r = await fails(S, `select * from declutter_my_reply_listings('${bike}')`, "wanted_not_found");
  await db.exec(`delete from user_blocks`);
  return r;
});

// Q1284: the check on prod reads this function's own body for the caller. The same query, from the same file.
await safe("readsTheCaller", async () => {
  const inv = readFileSync(new URL("../../../scripts/ci/definer-exec-inventory.sql", import.meta.url), "utf8").replace(/^\s*--[^\n]*\n/gm, "").trim().replace(/;\s*$/, "");
  const rows = (await db.query(`select scoped from (${inv}) o where signature = 'declutter_my_reply_listings(uuid)' and role = 'authenticated'`)).rows;
  return rows.length === 1 && rows[0].scoped === true;
});
// The restatement adds that one line and nothing else: the original migration's body, line removed, is what's deployed.
await safe("restatementAddsOneLine", async () => {
  const live = (await db.query(`select prosrc from pg_proc where proname = 'declutter_my_reply_listings'`)).rows[0].prosrc;
  const first = mig.match(/FUNCTION public\.declutter_my_reply_listings[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/)[1];
  return live.replace("  v_uid := (SELECT auth.uid());\n", "") === first && live.includes("v_uid := (SELECT auth.uid());");
});

// #19: every photo for a seller; a reply's photo for the poster; still never a user id.
await safe("browseHasAllPhotos", async () => {
  await db.exec(`update declutter_wanted set photo_paths = ARRAY['1.jpg','2.jpg'] where id = '${bike}'`);
  const r = (await as(S, `select to_jsonb(b) j from declutter_wanted_browse(30.00, -92.00) b where id = '${bike}'`)).rows[0].j;
  return r.photo_path === "1.jpg" && r.photo_paths.length === 2 && !("user_id" in r);
});
await safe("replyHasItsPhoto", async () => {
  await db.exec(`insert into declutter_item_photos values ('${I(1)}', 'second.jpg', 1), ('${I(1)}', 'first.jpg', 0)`);
  await db.exec(`insert into declutter_offers(item_id, buyer_id, seller_id, amount_cents, wanted_id) values ('${I(1)}', '${P}', '${S}', 2000, '${bike}')`);
  const r = (await as(P, `select replies from declutter_my_wanted() where id = '${bike}'`)).rows[0].replies;
  return r[0].photo_path === "first.jpg";
});

// Permissions: none of the new functions reaches anon, and the helpers reach no member.
await safe("grants", async () => {
  const rows = (await db.query(`select p.proname n, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
    from pg_proc p where p.proname in ('declutter_update_wanted','declutter_reopen_wanted','declutter_remove_wanted','declutter_my_reply_listings','declutter_wanted_browse','declutter_wanted_text_problem','declutter_wanted_tsquery','declutter_wanted_category_near')`)).rows;
  const helpers = new Set(["declutter_wanted_text_problem", "declutter_wanted_tsquery", "declutter_wanted_category_near"]);
  return rows.length === 8 && rows.every((r) => r.a === false && r.u === !helpers.has(r.n));
});

const red = Object.entries(results).filter(([, v]) => v !== "ok");
console.log(JSON.stringify(results, null, 1));
console.log(red.length ? `RED ${red.length} of ${Object.keys(results).length}` : `ALL OK ${Object.keys(results).length}`);
process.exit(red.length ? 1 : 0);
