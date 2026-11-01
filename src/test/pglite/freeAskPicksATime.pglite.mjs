#!/usr/bin/env node
/**
 * PGlite proof for *_free_ask_picks_a_pickup_time (owner 11-01, Mockup 3): the asker of a free item picks the pickup
 * time WHEN THEY ASK, from the giver's saved pickup times; the giver's list of askers shows each chosen time.
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/freeAskPicksATime.pglite.mjs
 *   MUTANT=past|window|places|order|list node src/test/pglite/freeAskPicksATime.pglite.mjs   # each must FAIL
 *
 * World: the tables the functions read and the NEWEST definitions before the migration of member_display_name,
 * declutter_slot_in_windows, declutter_place_windows_valid, declutter_place_windows_fill, declutter_request_free and
 * declutter_free_requests_for_item, read from the migrations, never retyped. Stubs: require_feature,
 * is_caller_banned (false), declutter_assert_member (auth.uid()), are_users_blocked, declutter_seller_out,
 * seed_hidden_for (false), declutter_free_rules, get_public_profile_stats, declutter_notify (records).
 * The migration then runs verbatim 3x (or once with the named mutant applied).
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const FILE = readdirSync(new URL("../../../supabase/migrations/", import.meta.url).pathname).find((f) => f.endsWith("_free_ask_picks_a_pickup_time.sql"));
if (!FILE) throw new Error("migration *_free_ask_picks_a_pickup_time.sql not found");
const VERSION = FILE.slice(0, 14);
let FIX = readMigration(FILE);
const MUTANTS = {
  // The past is let through.
  past: ["p_pickup_at IS NULL OR p_pickup_at <= now() OR", "p_pickup_at IS NULL OR"],
  // The giver's hours are never checked.
  window: ["IF NOT public.declutter_seller_slot_open(v_seller, p_pickup_at) THEN", "IF false THEN"],
  // A giver with places is checked against the usual times instead.
  places: ["IF NOT EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller) THEN", "IF true THEN"],
  // The time is checked before the ask's own guards: a hidden item answers with a time error.
  order: ["  v_id := public.declutter_request_free(p_item_id);\n  SELECT i.seller_id INTO v_seller", "  SELECT i.seller_id INTO v_seller"],
  // The giver's list leaves the time out.
  list: ["r.created_at, r.pickup_at\n", "r.created_at, NULL::timestamptz\n"],
};
const MUTANT = process.env.MUTANT;
if (MUTANT) {
  const [find, repl] = MUTANTS[MUTANT] ?? [];
  if (!find || !FIX.includes(find)) throw new Error(`mutant ${MUTANT}: text not found in the migration`);
  FIX = FIX.replace(find, repl);
  if (MUTANT === "order") FIX = FIX.replace("  RAISE EXCEPTION 'pickup_time_unavailable' USING ERRCODE = '22023',\n      HINT = 'Pick one of the giver''s pickup times in the next week.';\n  END IF;\n  UPDATE",
    "  RAISE EXCEPTION 'pickup_time_unavailable' USING ERRCODE = '22023',\n      HINT = 'Pick one of the giver''s pickup times in the next week.';\n  END IF;\n  v_id := public.declutter_request_free(p_item_id);\n  UPDATE");
  console.log(`MUTANT=${MUTANT}: expect FAILs`);
}
const { P: GIVER, A: ASKER, B: GIVER2, C: ASKER2, X: STRANGER } = USERS;
const { check, failures } = checker();

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  create table public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique not null, full_name text);
  insert into public.profiles (user_id, full_name) values ('${GIVER}', 'Gina Giver'), ('${ASKER}', 'Avery Asker'),
    ('${GIVER2}', 'Pat Places'), ('${ASKER2}', 'Cole Second');
  create table public.declutter_items (id uuid primary key default gen_random_uuid(), seller_id uuid, current_price_cents integer,
    status text, sale_mode text default 'offers', is_seed boolean default false, title text);
  create table public.declutter_free_pauses (user_id uuid, free_blocked_until timestamptz);
  create table public.declutter_free_requests (id uuid primary key default gen_random_uuid(), item_id uuid, requester_id uuid,
    seller_id uuid, status text not null default 'open', created_at timestamptz not null default now(), closed_at timestamptz);
  create table public.declutter_cart_items (buyer_id uuid, price_cents integer, status text, checkout_by timestamptz, order_id uuid);
  create table public.declutter_orders (id uuid, status text, paid_with text);
  create table public.declutter_pickup_windows (id uuid primary key default gen_random_uuid(), seller_id uuid, weekday smallint,
    starts_local time, ends_local time);
  create table public.declutter_porch_places (id uuid primary key default gen_random_uuid(), seller_id uuid, position smallint,
    label text, area text, weekdays smallint[], windows jsonb);
  create table public.notices (user_id uuid, title text, body text);
  create function public.require_feature(text) returns void language sql as $f$ select $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_assert_member(boolean) returns uuid language sql as $f$ select auth.uid() $f$;
  create function public.are_users_blocked(uuid, uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_seller_out(uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.seed_hidden_for(uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_free_rules() returns jsonb language sql stable as $f$ select '{"max_open_claims": 3}'::jsonb $f$;
  create function public.get_public_profile_stats(uuid[]) returns table (avg_rating numeric, review_count integer)
    language sql stable as $f$ select null::numeric, 0 $f$;
  create function public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_actor uuid)
    returns void language sql security definer as $f$ insert into public.notices values (p_user, p_title, p_body) $f$;
`;
const OLD = ["member_display_name", "declutter_slot_in_windows", "declutter_place_windows_valid", "declutter_place_windows_fill",
  "declutter_request_free", "declutter_free_requests_for_item"].map((n) => newestFunctionSql(n, VERSION).sql).join("\n");

const db = new PGlite();
await db.exec(WORLD + OLD);
await db.exec(`grant execute on all functions in schema public to authenticated;`);
for (let i = 0; i < (MUTANT ? 1 : 3); i++) await db.exec(FIX);
check(MUTANT ? "applies (mutant)" : "applies 3x (replay-safe)", true);

// Chicago wall-clock instants: tomorrow at HH:MM local.
const at = (days, hhmm) => `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '${days} days' + time '${hhmm}') AT TIME ZONE 'America/Chicago')`;
const tomorrowDow = (await db.query(`select extract(dow from (now() AT TIME ZONE 'America/Chicago') + interval '1 day')::int d`)).rows[0].d;

// GIVER: usual times every day 7 AM - 9 PM, no places. GIVER2: usual times all day too, but ONE place open only
// tomorrow 10 AM - 12 PM (places govern pickup, LEAD-PLACE-TIMES).
await db.exec(`insert into public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  select s, d, '07:00', '21:00' from unnest(array['${GIVER}','${GIVER2}']::uuid[]) s, generate_series(0, 6) d;
  insert into public.declutter_porch_places (seller_id, position, label, area, weekdays, windows)
  values ('${GIVER2}', 0, 'Home', 'Delcambre', array[${tomorrowDow}]::smallint[],
    '[{"weekday": ${tomorrowDow}, "starts": "10:00", "ends": "12:00"}]'::jsonb);`);
const item = (await db.query(`insert into public.declutter_items (seller_id, current_price_cents, status, title)
  values ('${GIVER}', 0, 'live', 'Purse strap') returning id`)).rows[0].id;
const placeItem = (await db.query(`insert into public.declutter_items (seller_id, current_price_cents, status, title)
  values ('${GIVER2}', 0, 'live', 'Lamp') returning id`)).rows[0].id;
const hiddenItem = (await db.query(`insert into public.declutter_items (seller_id, current_price_cents, status, title)
  values ('${GIVER}', 0, 'withdrawn', 'Gone') returning id`)).rows[0].id;
const notices = async () => Number((await db.query(`select count(*) n from public.notices`)).rows[0].n);

// ── 1. Refusals ────────────────────────────────────────────────────────────────────
let r = await as(db, "authenticated", ASKER, `select public.declutter_request_free_at('${item}', now() - interval '1 hour') id`);
check("a time in the past is refused", refused(r, /pickup_time_unavailable/), r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", ASKER, `select public.declutter_request_free_at('${item}', ${at(10, "15:00")}) id`);
check("a time more than 8 days ahead is refused", refused(r, /pickup_time_unavailable/), r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", ASKER, `select public.declutter_request_free_at('${item}', null) id`);
check("no time is refused", refused(r, /pickup_time_unavailable/), r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", ASKER, `select public.declutter_request_free_at('${item}', ${at(1, "22:00")}) id`);
check("a time outside the giver's hours (10 PM) is refused", refused(r, /pickup_time_unavailable/), r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", ASKER, `select public.declutter_request_free_at('${item}', ${at(1, "20:45")}) id`);
check("a 30-minute pickup that would end after the hours (8:45 PM) is refused", refused(r, /pickup_time_unavailable/), r.err ?? JSON.stringify(r.rows));
let n = (await db.query(`select count(*) n from public.declutter_free_requests`)).rows[0].n;
check("a refused time leaves no ask behind and no notice", Number(n) === 0 && (await notices()) === 0, `asks ${n}`);
r = await as(db, "authenticated", ASKER, `select public.declutter_request_free_at('${placeItem}', ${at(1, "15:00")}) id`);
check("a giver with a pickup place: a time outside the place's hours is refused (even inside the usual times)", refused(r, /pickup_time_unavailable/), r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", ASKER, `select public.declutter_request_free_at('${hiddenItem}', ${at(1, "22:00")}) id`);
check("an item no longer up answers item_not_found, never a time error", refused(r, /item_not_found/), r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", GIVER, `select public.declutter_request_free_at('${item}', ${at(1, "15:00")}) id`);
check("the giver cannot ask for their own item", refused(r, /own_item/), r.err ?? JSON.stringify(r.rows));
r = await as(db, "anon", null, `select public.declutter_request_free_at('${item}', ${at(1, "15:00")}) id`);
check("a signed-out caller is refused", !r.ok, r.err);
r = await as(db, "authenticated", ASKER, `select public.declutter_seller_slot_open('${GIVER}', now()) ok`);
check("the hours check is internal (members cannot call it)", refused(r, /permission denied/), r.err ?? JSON.stringify(r.rows));

// ── 2. A good time is stored on the ask ───────────────────────────────────────────
r = await as(db, "authenticated", ASKER, `select public.declutter_request_free_at('${item}', ${at(1, "15:00")}) id`);
check("a time inside the giver's hours asks", r.ok, r.err);
const reqId = r.rows?.[0]?.id;
let row = (await db.query(`select pickup_at = ${at(1, "15:00")} same, status from public.declutter_free_requests where id = '${reqId}'`)).rows[0];
check("the chosen time is stored on the ask", row?.same === true && row?.status === "open", JSON.stringify(row));
check("the giver is told, once", (await notices()) === 1);
r = await as(db, "authenticated", ASKER, `select public.declutter_request_free_at('${item}', ${at(2, "09:00")}) id`);
row = (await db.query(`select count(*) n, bool_and(pickup_at = ${at(2, "09:00")}) moved from public.declutter_free_requests where requester_id = '${ASKER}'`)).rows[0];
check("asking again moves the time on the same open ask", r.ok && r.rows[0].id === reqId && Number(row.n) === 1 && row.moved === true, r.err ?? JSON.stringify(row));
r = await as(db, "authenticated", ASKER2, `select public.declutter_request_free_at('${placeItem}', ${at(1, "10:30")}) id`);
check("a giver with a pickup place: a time inside the place's hours asks", r.ok, r.err);
r = await as(db, "authenticated", ASKER2, `select public.declutter_request_free('${item}') id`);
check("an older build's ask (no time) still works, with no time stored", r.ok
  && (await db.query(`select pickup_at from public.declutter_free_requests where id = '${r.rows?.[0]?.id}'`)).rows[0]?.pickup_at === null, r.err);

// ── 3. The giver sees each asker's time ───────────────────────────────────────────
r = await as(db, "authenticated", GIVER, `select display_name, pickup_at is not null has_time, pickup_at = ${at(2, "09:00")} same
  from public.declutter_free_requests_for_item('${item}') order by created_at`);
check("the giver's list shows the first asker's chosen time", r.ok && r.rows.length === 2 && r.rows[0].same === true, r.err ?? JSON.stringify(r.rows));
check("an ask with no time shows none", r.ok && r.rows[1]?.has_time === false, JSON.stringify(r.rows));
r = await as(db, "authenticated", STRANGER, `select * from public.declutter_free_requests_for_item('${item}')`);
check("someone else cannot read the giver's list", refused(r, /item_not_found/), r.err ?? JSON.stringify(r.rows));

// ── Grants ─────────────────────────────────────────────────────────────────────────
const acl = (await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') u from pg_proc p
  where p.proname in ('declutter_request_free_at','declutter_free_requests_for_item','declutter_seller_slot_open')`)).rows;
check("anon can call none of them", acl.length === 3 && acl.every((x) => x.a === false), JSON.stringify(acl));

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
