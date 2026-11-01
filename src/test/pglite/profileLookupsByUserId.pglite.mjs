#!/usr/bin/env node
/**
 * PGlite proof for *_profile_lookups_by_user_id (lead 10-31): three lookups read a member's profile by
 * profiles.id = <the member's auth id>, but a member's id is profiles.user_id (profiles.id is the row's own uuid).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/profileLookupsByUserId.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/profileLookupsByUserId.pglite.mjs   # RED: the newest bodies before it
 *
 * World: profiles with a generated id and user_id (as handle_new_user writes them), the tables the three functions
 * read, and the NEWEST definitions before the migration of sms_phone_prompt_due, declutter_request_free,
 * declutter_free_requests_for_item and member_display_name, read from the migrations, never retyped. Stubs:
 * require_feature, is_caller_banned (false), declutter_assert_member (auth.uid()), are_users_blocked,
 * declutter_seller_out, seed_hidden_for (false), declutter_free_rules, get_public_profile_stats, declutter_notify
 * (records). The migration then runs verbatim 3x.
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";

const FILE = readdirSync(new URL("../../../supabase/migrations/", import.meta.url).pathname).find((f) => f.endsWith("_profile_lookups_by_user_id.sql"));
if (!FILE) throw new Error("migration *_profile_lookups_by_user_id.sql not found");
const VERSION = FILE.slice(0, 14);
const FIX = readMigration(FILE);
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running against the newest bodies before it (expect FAILs)");
const { P: GIVER, A: ASKER, B: NOPHONE } = USERS;
const { check, failures } = checker();

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  -- profiles.id is the row's own uuid; the member is user_id (handle_new_user).
  create table public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique not null,
    full_name text, phone text);
  insert into public.profiles (user_id, full_name, phone) values
    ('${GIVER}', 'Gina Giver', null), ('${ASKER}', 'Avery Asker', '225-555-0100'), ('${NOPHONE}', 'Nate Nophone', '  ');
  create table public.notification_preferences (user_id uuid, sms_phone_prompt_dismissed_at timestamptz);
  create table public.sms_consent (user_id uuid, sms_opt_in boolean, pending_phone text, pending_since timestamptz);
  create table public.jobs (id uuid primary key default gen_random_uuid(), customer_id uuid, helper_id uuid);
  create table public.group_job_helpers (helper_id uuid);
  create table public.declutter_items (id uuid primary key default gen_random_uuid(), seller_id uuid, current_price_cents integer,
    status text, sale_mode text default 'offers', is_seed boolean default false, title text);
  create table public.declutter_free_pauses (user_id uuid, free_blocked_until timestamptz);
  create table public.declutter_free_requests (id uuid primary key default gen_random_uuid(), item_id uuid, requester_id uuid,
    seller_id uuid, status text not null default 'open', created_at timestamptz not null default now());
  create table public.declutter_cart_items (buyer_id uuid, price_cents integer, status text, checkout_by timestamptz, order_id uuid);
  create table public.declutter_orders (id uuid, status text, paid_with text);
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
const OLD = ["member_display_name", "sms_phone_prompt_due", "declutter_request_free", "declutter_free_requests_for_item"]
  .map((n) => newestFunctionSql(n, VERSION).sql).join("\n");

const db = new PGlite();
await db.exec(WORLD + OLD);
await db.exec(`grant execute on all functions in schema public to authenticated;`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);

// ── 1. sms_phone_prompt_due('has_phone') ───────────────────────────────────────────
let r = await as(db, "authenticated", ASKER, `select public.sms_phone_prompt_due('has_phone') as due`);
check("a member who gave a phone on their profile gets the text-alerts prompt", r.ok && r.rows[0].due === true, r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", NOPHONE, `select public.sms_phone_prompt_due('has_phone') as due`);
check("a blank phone is still no phone (no prompt)", r.ok && r.rows[0].due === false, r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", GIVER, `select public.sms_phone_prompt_due('has_phone') as due`);
check("no phone at all: no prompt", r.ok && r.rows[0].due === false, r.err ?? JSON.stringify(r.rows));
await db.query(`insert into public.sms_consent values ('${ASKER}', true, null, null)`);
r = await as(db, "authenticated", ASKER, `select public.sms_phone_prompt_due('has_phone') as due`);
check("already opted in: no prompt (unchanged)", r.ok && r.rows[0].due === false, r.err ?? JSON.stringify(r.rows));

// ── 2. declutter_request_free names the asker ──────────────────────────────────────
const item = (await db.query(`insert into public.declutter_items (seller_id, current_price_cents, status, title)
  values ('${GIVER}', 0, 'live', 'Box fan') returning id`)).rows[0].id;
r = await as(db, "authenticated", ASKER, `select public.declutter_request_free('${item}') as id`);
check("the ask goes in", r.ok, r.err);
const bell = (await db.query(`select body from public.notices where user_id = '${GIVER}'`)).rows[0]?.body ?? "";
check("the giver's bell names the asker, never \"A neighbor\"", /^Avery A\.? asked for "Box fan"|^Avery[^"]* asked for "Box fan"/.test(bell) && !bell.startsWith("A neighbor"), bell);

// ── 3. declutter_free_requests_for_item names who asked ────────────────────────────
r = await as(db, "authenticated", GIVER, `select display_name from public.declutter_free_requests_for_item('${item}')`);
check("the giver's list of who asked shows the asker's name", r.ok && r.rows.length === 1 && /^Avery/.test(r.rows[0].display_name ?? ""), r.err ?? JSON.stringify(r.rows));

// ── Grants unchanged ───────────────────────────────────────────────────────────────
const acl = (await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') n
  from pg_proc p where p.proname in ('sms_phone_prompt_due','declutter_request_free','declutter_free_requests_for_item')`)).rows;
check("anon can call none of the three", acl.length === 3 && acl.every((x) => x.n === false), JSON.stringify(acl));

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
