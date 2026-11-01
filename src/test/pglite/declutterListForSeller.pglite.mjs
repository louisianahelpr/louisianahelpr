#!/usr/bin/env node
/**
 * PGlite proof for *_declutter_list_for_seller (LEAD-LIST-FOR-SELLER, owner 10-31 ~10:30 PM, POST-H3): on a "Have a
 * Helpr list it" job the hired Helpr writes listings ON THE SELLER'S ACCOUNT; the seller approves each (or all) before
 * any goes live; the job is done for the Helpr once the listings are SENT for approval (lead decision).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/declutterListForSeller.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterListForSeller.pglite.mjs   # RED: the newest bodies before it
 *
 * World: jobs, profiles, the declutter tables the path touches, storage.objects, and the NEWEST definitions before the
 * migration of is_server_context, enforce_helper_completion_gates (attached as the real BEFORE UPDATE trigger),
 * rpc_helper_mark_done, declutter_attest_item, declutter_publish_item and declutter_area_label_problem, read from the
 * migrations, never retyped; the newest declutter_items read policy, read the same way. Stubs: require_feature,
 * feature_enabled_for and declutter_assert_member (true), is_caller_banned (false), declutter_notify (records).
 * The migration then runs verbatim 3x.
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_list_for_seller.sql"));
if (!FILE) throw new Error("migration *_declutter_list_for_seller.sql not found");
const VERSION = FILE.slice(0, 14);
const FIX = readMigration(FILE);
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running against the newest bodies before it (expect FAILs)");
const { P, A, B } = USERS; // P = seller (the job's poster), A = the hired Helpr, B = another Helpr
const X = "44444444-4444-4444-4444-444444444444";
const { check, failures } = checker();

/** The newest declutter_items read policy before VERSION, from the migrations. */
function newestReadPolicy() {
  let found = "";
  for (const f of readdirSync(MIG_DIR).filter((n) => n.endsWith(".sql") && n.slice(0, 14) < VERSION).sort()) {
    for (const m of readMigration(f).matchAll(/CREATE\s+POLICY\s+"declutter items: seller or switched-on members read live"[\s\S]*?;/gi)) found = m[0];
  }
  if (!found) throw new Error("read policy not found");
  return found;
}

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${P}'), ('${A}'), ('${B}'), ('${X}');
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function auth.role() returns text language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
  grant usage on schema auth, public, storage to authenticated, anon, service_role;
  create table storage.objects (bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
  grant select on storage.objects to authenticated;
  create table public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, full_name text);
  insert into public.profiles (user_id, full_name) values ('${A}', 'Dana Helpr'), ('${P}', 'Sam Seller');
  create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  create type public.job_category as enum ('cleaning','moving','declutter_help','errands');
  create table public.jobs (id uuid primary key default gen_random_uuid(), title text, customer_id uuid, helper_id uuid,
    category public.job_category not null default 'moving', created_at timestamptz not null default now(),
    status public.job_status not null default 'in_progress', location text, latitude numeric, longitude numeric,
    helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz,
    poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz, helper_completed_at timestamptz,
    poster_completed_at timestamptz, require_photo_proof boolean default true, proof_before_urls text[], proof_after_urls text[],
    is_group_job boolean default false);
  create table public.declutter_items (id uuid primary key default gen_random_uuid(), seller_id uuid not null references auth.users(id),
    sale_mode text not null default 'offers', status text not null default 'draft', title text not null,
    description text not null default '', category text not null, condition_stars smallint not null, delivery_size text not null,
    price_cents integer not null, current_price_cents integer not null, area_label text not null, area_lat numeric(5,2) not null,
    area_lng numeric(6,2) not null, is_seed boolean not null default false, seller_hidden boolean not null default false,
    admin_approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    submitted_at timestamptz, live_at timestamptz);
  alter table public.declutter_items add constraint declutter_items_status_check check (status in (
    'draft', 'pending_review', 'live', 'paused', 'reserved', 'sold', 'completed',
    'ended', 'withdrawn', 'rejected', 'removed', 'sold_elsewhere'));
  create table public.declutter_item_private (item_id uuid primary key references public.declutter_items(id) on delete cascade,
    seller_id uuid not null, floor_price_cents integer, pickup_address text, pickup_lat numeric, pickup_lng numeric,
    ai_checked_at timestamptz, ai_flag_reason text, updated_at timestamptz not null default now());
  create table public.declutter_item_photos (id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.declutter_items(id) on delete cascade, seller_id uuid not null,
    storage_path text not null unique, position smallint not null, created_at timestamptz not null default now(),
    unique (item_id, position));
  create table public.declutter_tax_attestations (item_id uuid primary key references public.declutter_items(id) on delete cascade,
    seller_id uuid not null, bought_for_personal_use boolean not null, not_in_the_business boolean not null,
    not_a_frequent_seller boolean not null, keeps_item_until_handover boolean not null,
    wording_version text not null default '2026-10-14', attested_at timestamptz not null default now());
  create table public.declutter_pickup_windows (id uuid primary key default gen_random_uuid(), seller_id uuid not null);
  create table public.declutter_cart_items (item_id uuid, buyer_id uuid, status text);
  create table public.notices (user_id uuid, kind text, title text, body text, link text);
  alter table public.declutter_items enable row level security;
  grant select on public.declutter_items, public.declutter_item_photos, public.declutter_cart_items to authenticated;
  grant select, update on public.jobs to authenticated;
  grant all on all tables in schema public to service_role;
  create function public.require_feature(text) returns void language sql as $f$ select $f$;
  create function public.feature_enabled_for(text) returns boolean language sql stable as $f$ select true $f$;
  create function public.seed_hidden_in_discovery() returns boolean language sql stable as $f$ select true $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select coalesce(current_setting('t.banned', true), '') = 'on' $f$;
  create function public.declutter_assert_member(boolean) returns void language sql as $f$ select $f$;
  create function public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_actor uuid)
    returns void language sql security definer as $f$ insert into public.notices values (p_user, p_kind, p_title, p_body, p_link) $f$;
`;
const OLD = ["is_server_context", "enforce_helper_completion_gates", "rpc_helper_mark_done", "declutter_area_label_problem",
  "declutter_attest_item", "declutter_publish_item"].map((n) => newestFunctionSql(n, VERSION).sql).join("\n");
const AFTER = `
  drop trigger if exists trg_helper_completion_gates on public.jobs;
  create trigger trg_helper_completion_gates before update of helper_completed_at, status on public.jobs
    for each row execute function public.enforce_helper_completion_gates();
  ${newestReadPolicy()}
`;

const db = new PGlite();
await db.exec(WORLD + OLD + AFTER);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);

/** A declutter_help job (or another category) Helpr A is working, arrival confirmed an hour ago, with photos. */
async function job(category = "declutter_help", status = "in_progress", helper = A) {
  return (await db.query(`insert into public.jobs (title, customer_id, helper_id, category, status, location, latitude, longitude,
      helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at, proof_before_urls, proof_after_urls)
    values ('j', '${P}', ${helper ? `'${helper}'` : "null"}, '${category}', '${status}', '12 Oak St, Baton Rouge, LA', 30.45, -91.18,
      now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour', array['b.jpg'], array['a.jpg']) returning id`)).rows[0].id;
}
const create = (uid, j, title = "Oak dresser") => as(db, "authenticated", uid,
  `select public.declutter_helpr_create_listing('${j}', '${title}', 'Solid oak, six drawers', 'furniture', 4, 'large', 12000, 8000, 'Mid City') as id`);
const upload = (uid, item, name = "p1.jpg") => db.query(`insert into storage.objects values ('job-photos', '${uid}/declutter/${item}/${name}',
  '${uid}', '${uid}', '{"mimetype":"image/jpeg","size":"1000"}')`);
const addPhoto = (uid, item, name = "p1.jpg") => as(db, "authenticated", uid,
  `select public.declutter_helpr_add_listing_photo('${item}', '${uid}/declutter/${item}/${name}') as id`);
const send = (uid, j) => as(db, "authenticated", uid, `select public.declutter_helpr_send_listings('${j}') as n`);
const markDone = (j) => as(db, "authenticated", A, `select public.rpc_helper_mark_done('${j}') as out`);
const stampDirect = (j) => as(db, "authenticated", A, `update public.jobs set helper_completed_at = now() where id = '${j}' returning id`);
const statusOf = async (id) => (await db.query(`select status from public.declutter_items where id = '${id}'`)).rows[0]?.status;

// ── The seller's own listing the Helpr must never see ────────────────────────────
const sellersOwn = (await db.query(`insert into public.declutter_items (seller_id, status, title, category, condition_stars, delivery_size,
    price_cents, current_price_cents, area_label, area_lat, area_lng) values ('${P}', 'draft', 'Private draft', 'decor', 3, 'small',
    500, 500, 'Mid City', 30.45, -91.18) returning id`)).rows[0].id;

// ── The Helpr creates a listing on the seller's account ──────────────────────────
const j1 = await job();
let r = await create(A, j1);
check("the job's Helpr creates a draft for the seller", r.ok && !!r.rows?.[0]?.id, r.err);
const item1 = r.rows?.[0]?.id;
if (item1) {
  const row = (await db.query(`select seller_id, status from public.declutter_items where id = '${item1}'`)).rows[0];
  check("it is ON THE SELLER'S ACCOUNT (seller_id = the job's poster), a draft", row.seller_id === P && row.status === "draft", JSON.stringify(row));
  const pv = (await db.query(`select pickup_address, floor_price_cents from public.declutter_item_private where item_id = '${item1}'`)).rows[0];
  check("its pickup place is the job's own address, its lowest price the Helpr's", pv?.pickup_address === "12 Oak St, Baton Rouge, LA" && pv?.floor_price_cents === 8000, JSON.stringify(pv));
}

// ── Who else can't ───────────────────────────────────────────────────────────────
r = await create(B, j1);
check("another Helpr can't create a listing on this job", refused(r, /not_your_job/), r.err ?? "allowed");
r = await create(P, j1);
check("the poster can't use the Helpr door", refused(r, /not_your_job/), r.err ?? "allowed");
r = await create(A, await job("moving"));
check("not on a job that isn't Have a Helpr list it", refused(r, /not_your_job/), r.err ?? "allowed");
r = await create(A, await job("declutter_help", "completed"));
check("not once the job is closed", refused(r, /job_not_open/), r.err ?? "allowed");
r = await create(A, await job("declutter_help", "open", null));
check("not before they're hired (no Helpr on the job)", refused(r, /not_your_job/), r.err ?? "allowed");
r = await as(db, "anon", null, `select public.declutter_helpr_create_listing('${j1}', 'x', '', 'furniture', 4, 'large', 12000, 8000, 'Mid City')`);
check("anon can't call it", refused(r, /permission denied/), r.err ?? "allowed");

// ── The Helpr never sees the seller's other listings ─────────────────────────────
r = await as(db, "authenticated", A, `select id from public.declutter_items where id = '${sellersOwn}'`);
check("a direct read of the seller's other draft returns nothing (read policy unchanged)", r.ok && r.rows.length === 0, r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", A, `select item_id, title from public.declutter_helpr_job_listings('${j1}')`);
check("the job's list shows only this job's listing", r.ok && r.rows.length === 1 && r.rows[0].item_id === item1, r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", B, `select * from public.declutter_helpr_job_listings('${j1}')`);
check("another Helpr can't read the job's list", refused(r, /not_your_job/), r.err ?? "allowed");
r = await as(db, "authenticated", A, `select public.declutter_helpr_update_listing('${sellersOwn}', 'Mine now', '', 'decor', 3, 'small', 500, 100)`);
check("the Helpr can't edit the seller's own draft", refused(r, /item_not_found/), r.err ?? "allowed");
r = await as(db, "authenticated", A, `select public.declutter_helpr_delete_listing('${sellersOwn}')`);
check("the Helpr can't delete the seller's own draft", refused(r, /item_not_found/) && (await statusOf(sellersOwn)) === "draft", r.err ?? "allowed");

// ── Edits and photos on the Helpr's own draft ────────────────────────────────────
r = await as(db, "authenticated", A, `select public.declutter_helpr_update_listing('${item1}', 'Oak dresser, six drawers', 'Solid', 'furniture', 4, 'large', 15000, 9000)`);
check("the Helpr edits their draft", r.ok && (await db.query(`select price_cents from public.declutter_items where id = '${item1}'`)).rows[0]?.price_cents === 15000, r.err);
r = await addPhoto(A, item1);
check("a photo the Helpr never uploaded is refused", refused(r, /photo_not_uploaded/), r.err ?? "allowed");
await upload(A, item1);
r = await addPhoto(A, item1);
check("the Helpr adds their own uploaded photo", r.ok, r.err);
const photo1 = r.rows?.[0]?.id;
// lh-authz-rls review (11-01): a banned Helpr can't remove a photo or delete a draft either.
await db.exec("set t.banned = 'on'");
r = await as(db, "authenticated", A, `select public.declutter_helpr_remove_listing_photo('${photo1}')`);
const photoKept = (await db.query(`select 1 from public.declutter_item_photos where id = '${photo1}'`)).rows.length === 1;
check("a banned Helpr can't remove a photo (account_restricted)", refused(r, /account_restricted/) && photoKept, r.err ?? "allowed");
r = await as(db, "authenticated", A, `select public.declutter_helpr_delete_listing('${item1}')`);
check("a banned Helpr can't delete a draft (account_restricted)", refused(r, /account_restricted/) && (await statusOf(item1)) === "draft", r.err ?? "allowed");
await db.exec("set t.banned = ''");
await upload(B, item1, "b.jpg");
r = await as(db, "authenticated", B, `select public.declutter_helpr_add_listing_photo('${item1}', '${B}/declutter/${item1}/b.jpg')`);
check("another Helpr can't add a photo to it", refused(r, /item_not_found/), r.err ?? "allowed");

// ── The Helpr can never publish ──────────────────────────────────────────────────
r = await as(db, "authenticated", A, `select public.declutter_publish_item('${item1}')`);
check("the Helpr can't publish it (normal publish path asks the seller)", refused(r, /item_not_found/) && (await statusOf(item1)) === "draft", r.err ?? "allowed");

// ── The done gate, before sending ────────────────────────────────────────────────
r = await markDone(j1);
check("Mark done before anything is sent -> completion_requires_listings_sent", refused(r, /completion_requires_listings_sent/), r.err ?? "taken");
r = await stampDirect(j1);
check("the jobs trigger refuses the direct stamp the same", refused(r, /completion_requires_listings_sent/), r.err ?? "taken");

// ── Sending ──────────────────────────────────────────────────────────────────────
const r2 = await create(A, j1, "Brass lamp");
const item2 = r2.rows?.[0]?.id;
r = await send(A, j1);
check("a listing with no photo can't be sent", refused(r, /photos_required/) && (await statusOf(item1)) === "draft", r.err ?? "allowed");
if (item2) { await upload(A, item2); await addPhoto(A, item2); }
r = await send(B, j1);
check("another Helpr can't send them", refused(r, /not_your_job/), r.err ?? "allowed");
r = await send(A, j1);
check("the Helpr sends both for approval", r.ok && r.rows[0].n === 2, r.err ?? JSON.stringify(r.rows));
check("both are now awaiting the seller's approval, not live", (await statusOf(item1)) === "pending_seller_approval" && (await statusOf(item2)) === "pending_seller_approval");
const told = (await db.query(`select count(*)::int n from public.notices where user_id = '${P}' and link = '/declutter?tab=selling'`)).rows[0].n;
check("the seller is told", told === 1, `notices=${told}`);
r = await as(db, "authenticated", A, `select public.declutter_helpr_update_listing('${item1}', 'Changed after', '', 'furniture', 4, 'large', 15000, 9000)`);
check("once sent, the Helpr can't edit it", refused(r, /item_not_a_draft/), r.err ?? "allowed");
r = await as(db, "authenticated", A, `select public.declutter_publish_item('${item1}')`);
check("once sent, the Helpr still can't publish it", refused(r, /item_not_found/), r.err ?? "allowed");

// ── The done gate, after sending (lead: done once SENT, never stranded) ──────────
r = await markDone(j1);
check("Mark done once the listings are sent -> taken (not waiting for live)", r.ok && r.rows[0].out.already_done === false, r.err);
const j2 = await job();
r = await stampDirect(j2);
check("another declutter_help job with nothing sent: the trigger still refuses", refused(r, /completion_requires_listings_sent/), r.err ?? "taken");
r = await markDone(await job("moving"));
check("every other job is unchanged (a moving job with photos -> taken)", r.ok, r.err);
r = await as(db, "authenticated", X, `select public.rpc_helper_mark_done('${j2}')`);
check("a stranger is still refused on authorization", refused(r, /not_the_assigned_helper/), r.err ?? "allowed");
if (!SKIP) {
  const ask = async (uid) => (await as(db, "authenticated", uid, `select public.sell_for_me_listings_sent('${j1}') as v`)).rows?.[0]?.v;
  check("sell_for_me_listings_sent answers the job's Helpr, poster and the server", (await ask(A)) === true && (await ask(P)) === true
    && (await db.query(`select public.sell_for_me_listings_sent('${j1}') as v`)).rows[0].v === true);
  check("a stranger gets false, never a probe", (await ask(X)) === false);
} else {
  check("sell_for_me_listings_sent exists", false, "not before the migration");
}

// ── The seller's approval: the normal publish path ───────────────────────────────
r = await as(db, "authenticated", P, `select item_id, helpr_first_name from public.declutter_listed_for_me()`);
check("the seller's approval card lists both, with the Helpr's first name", r.ok && r.rows.length === 2 && r.rows.every((x) => x.helpr_first_name === "Dana"), r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", P, `select floor_price_cents from public.declutter_listed_for_me() where item_id = '${item1}'`);
check("the approval card carries the lowest price the Helpr set", r.ok && r.rows[0]?.floor_price_cents === 9000, r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", A, `select * from public.declutter_listed_for_me()`);
check("the Helpr's own call lists nothing of the seller's", r.ok && r.rows.length === 0, r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", A, `select public.declutter_approve_listed_for_me(array['${item1}']::uuid[], true, true, true, true) as out`);
check("the Helpr can't approve them", r.ok && r.rows[0].out[0]?.error === "item_not_found" && (await statusOf(item1)) === "pending_seller_approval", r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", P, `select public.declutter_approve_listed_for_me(array['${item1}']::uuid[], true, true, true, true) as out`);
check("no pickup times yet: approval stays waiting and says why", r.ok && /pickup_windows_required/.test(r.rows[0].out[0]?.error ?? "") && (await statusOf(item1)) === "pending_seller_approval", r.err ?? JSON.stringify(r.rows));
await db.query(`insert into public.declutter_pickup_windows (seller_id) values ('${P}')`);
r = await as(db, "authenticated", P, `select public.declutter_approve_listed_for_me(array['${item1}']::uuid[], true, false, true, true) as out`);
check("the seller's attestation is asked (incomplete -> stays waiting)", r.ok && /attestation_incomplete/.test(r.rows[0].out[0]?.error ?? "") && (await statusOf(item1)) === "pending_seller_approval", r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", P, `select public.declutter_approve_listed_for_me(array['${item1}', '${item2}', '${sellersOwn}']::uuid[], true, true, true, true) as out`);
const out = r.rows?.[0]?.out ?? [];
check("approve all: both go live through the normal publish path", r.ok && out[0]?.status === "live" && out[1]?.status === "live" && (await statusOf(item1)) === "live" && (await statusOf(item2)) === "live", r.err ?? JSON.stringify(out));
check("approve all never publishes a listing the Helpr didn't send (the seller's own draft)", out[2]?.error === "item_not_found" && (await statusOf(sellersOwn)) === "draft", JSON.stringify(out[2]));
const att = (await db.query(`select seller_id from public.declutter_tax_attestations where item_id = '${item1}'`)).rows[0];
check("the attestation is the seller's own", att?.seller_id === P, JSON.stringify(att));
r = await as(db, "authenticated", A, `select status from public.declutter_helpr_job_listings('${j1}')`);
check("the Helpr sees only 'approved', not the listing's later life", r.ok && r.rows.every((x) => x.status === "approved"), r.err ?? JSON.stringify(r.rows));

// ── Decline ──────────────────────────────────────────────────────────────────────
const j3 = await job();
const item3 = (await create(A, j3, "Wicker chair")).rows?.[0]?.id;
if (item3) { await upload(A, item3); await addPhoto(A, item3); await send(A, j3); }
const unsent = (await create(A, j3, "Pine shelf")).rows?.[0]?.id;
if (unsent) { await upload(A, unsent); await addPhoto(A, unsent); }
r = await as(db, "authenticated", P, `select public.declutter_approve_listed_for_me(array['${unsent}']::uuid[], true, true, true, true) as out`);
check("the seller can't approve a draft the Helpr hasn't sent yet", r.ok && r.rows[0].out[0]?.error === "item_not_found" && (await statusOf(unsent)) === "draft", r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", A, `select item_id from public.declutter_helpr_job_listings('${j1}')`);
check("the job's list never shows another job's listings", r.ok && r.rows.length === 2 && !r.rows.some((x) => x.item_id === item3 || x.item_id === unsent), r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", A, `select public.declutter_decline_listed_for_me('${item3}')`);
check("the Helpr can't decline it", refused(r, /item_not_found/), r.err ?? "allowed");
r = await as(db, "authenticated", P, `select public.declutter_decline_listed_for_me('${item3}')`);
check("the seller declines one: it never goes on sale", r.ok && (await statusOf(item3)) === "withdrawn", r.err);

// ── Grants ───────────────────────────────────────────────────────────────────────
if (!SKIP) {
  const acl = (await db.query(`select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') a, has_function_privilege('anon', p.oid, 'EXECUTE') n
    from pg_proc p where p.proname like 'declutter_helpr_%' or p.proname like 'declutter_%listed_for_me%' or p.proname like 'declutter_list_for_seller_%'
      or p.proname = 'sell_for_me_listings_sent' order by 1`)).rows;
  const inner = new Set(["declutter_list_for_seller_job", "declutter_list_for_seller_draft"]);
  check("grants: client RPCs for signed-in users only; the two inner gates for nobody; anon none", acl.length === 13
    && acl.every((x) => x.n === false && x.a === !inner.has(x.proname)), JSON.stringify(acl));
  const t = (await db.query(`select has_table_privilege('authenticated', 'public.declutter_listed_for_seller', 'SELECT') a,
    has_table_privilege('anon', 'public.declutter_listed_for_seller', 'SELECT') n`)).rows[0];
  check("the link table is private (no client read)", t.a === false && t.n === false, JSON.stringify(t));
} else {
  check("grants", false, "not before the migration");
}

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
