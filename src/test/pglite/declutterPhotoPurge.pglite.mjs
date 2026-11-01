#!/usr/bin/env node
/**
 * PGlite proof for *_declutter_photo_purge (B63, B59 open finding 2): a seller who removes, withdraws or declines a
 * listing photo a Helpr uploaded could not delete its object (it sits in the HELPR's folder; storage RLS refuses, and
 * Storage reports that as success), so it stayed public by URL. Every deleted declutter_item_photos row now queues
 * its own path; the service-role edge function (declutter-photo-purge) claims and removes them.
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/declutterPhotoPurge.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPhotoPurge.pglite.mjs   # RED: the newest bodies before it
 *
 * World: auth.users, profiles, notifications, jobs (the columns the link table needs), declutter_items,
 * declutter_item_photos (the real columns and CHECK of 20261014193955), declutter_listed_for_seller (the real columns
 * of 20261101034159), and the NEWEST declutter_decline_listed_for_me before the migration, read from the migrations,
 * never retyped. Stubs: require_feature (no-op), is_caller_banned (false), member_display_name, log_cron_defect
 * (records into t_defects). The migration then runs verbatim 3x.
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_photo_purge.sql"));
if (!FILE) throw new Error("migration *_declutter_photo_purge.sql not found");
const VERSION = FILE.slice(0, 14);
const FIX = readMigration(FILE);
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running against the newest bodies before it (expect FAILs)");
const { P, A, X } = USERS; // P = seller, A = the Helpr who uploaded, X = another seller
const { check, failures } = checker();

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${P}'), ('${A}'), ('${X}');
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  create table public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, full_name text, is_seed boolean not null default false);
  insert into public.profiles (user_id, full_name) values ('${A}', 'Dana Helpr'), ('${P}', 'Sam Seller');
  create table public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid);
  create table public.t_defects (fn text, ref text, err text);
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_context jsonb default '{}'::jsonb) returns void
    language sql security definer as $f$ insert into public.t_defects values (p_fn, p_ref, p_err) $f$;
  create function public.member_display_name(text, text default 'Someone') returns text language sql immutable as $f$ select coalesce($1, $2) $f$;
  create function public.require_feature(text) returns void language sql as $f$ select $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select false $f$;
  create table public.jobs (id uuid primary key default gen_random_uuid(), customer_id uuid, helper_id uuid);
  create table public.declutter_items (id uuid primary key default gen_random_uuid(), seller_id uuid not null references auth.users(id),
    status text not null default 'live', title text not null default 'Lamp', updated_at timestamptz not null default now());
  create table public.declutter_item_photos (
    id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.declutter_items(id) on delete cascade,
    seller_id uuid not null references auth.users(id) on delete cascade,
    storage_path text not null unique
      check (storage_path ~ '^[0-9a-f-]{36}/declutter/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
    position smallint not null check (position between 0 and 11),
    created_at timestamptz not null default now(),
    constraint declutter_item_photos_position_key unique (item_id, position));
  create table public.declutter_listed_for_seller (
    item_id uuid primary key references public.declutter_items(id) on delete cascade,
    job_id uuid not null references public.jobs(id) on delete cascade,
    helpr_id uuid not null references auth.users(id) on delete cascade,
    seller_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(), sent_at timestamptz, decided_at timestamptz);
  grant select on public.declutter_item_photos to authenticated;
  grant all on all tables in schema public to service_role;
`;
const OLD = newestFunctionSql("declutter_decline_listed_for_me", VERSION).sql;

const db = new PGlite();
await db.exec(WORLD + OLD);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);

const J = (await db.query(`insert into public.jobs (customer_id, helper_id) values ('${P}', '${A}') returning id`)).rows[0].id;
async function item(seller, status = "live") {
  return (await db.query(`insert into public.declutter_items (seller_id, status) values ('${seller}', '${status}') returning id`)).rows[0].id;
}
/** A photo row on `it` (of `seller`) whose object sits in `folder`'s folder. */
async function photo(it, seller, folder, pos, name = `p${pos}.jpg`) {
  const path = `${folder}/declutter/${it}/${name}`;
  await db.query(`insert into public.declutter_item_photos (item_id, seller_id, storage_path, position) values ('${it}', '${seller}', '${path}', ${pos})`);
  return path;
}
const queued = async () => (await db.query(`select storage_path, item_id, seller_id, attempts, claimed_at from public.declutter_photo_purge_queue order by storage_path`)).rows;
const due = (seller) => as(db, "service_role", null,
  `select storage_path from public.declutter_photo_purge_due(500, ${seller ? `'${seller}'::uuid` : "null"}) order by 1`);

// 1. The finding: the seller removes a photo the Helpr uploaded (into the Helpr's folder).
const I1 = await item(P);
const helprPath = await photo(I1, P, A, 0);
const ownPath = await photo(I1, P, P, 1);
await db.query(`delete from public.declutter_item_photos where storage_path = '${helprPath}'`);
let q = SKIP ? [] : await queued();
check("a removed photo row (Helpr's folder) queues its own path with its item and seller",
  q.length === 1 && q[0].storage_path === helprPath && q[0].item_id === I1 && q[0].seller_id === P, JSON.stringify(q));

// 2. Withdraw / sold elsewhere / a cascade (item deleted) take the same trigger.
const I2 = await item(X);
const xPath = await photo(I2, X, A, 0);
await db.query(`delete from public.declutter_items where id = '${I2}'`);
q = SKIP ? [] : await queued();
check("a cascaded delete (item gone) queues its photo too", q.some((r) => r.storage_path === xPath && r.seller_id === X), JSON.stringify(q));

// 3. The app's call (p_seller = the verified caller) hands out ONLY that seller's own paths and claims them.
let r = await due(P);
check("due(seller P) hands out P's queued path only, never another seller's",
  r.ok && r.rows.length === 1 && r.rows[0].storage_path === helprPath, JSON.stringify(r));
r = await due(P);
check("a fresh claim is not handed out twice", r.ok && r.rows.length === 0, JSON.stringify(r));

// 4. done drops only CLAIMED entries.
r = await as(db, "service_role", null, `select public.declutter_photo_purge_done(array['${helprPath}', '${xPath}']) n`);
q = SKIP ? [] : await queued();
check("done drops the claimed entry and keeps the unclaimed one", r.ok && r.rows[0].n === 1
  && q.length === 1 && q[0].storage_path === xPath, JSON.stringify({ r, q }));

// 5. A path a photo row still names is never handed out (and its entry is dropped).
const I3 = await item(P);
const livePath = await photo(I3, P, A, 0);
if (!SKIP) await db.query(`insert into public.declutter_photo_purge_queue (storage_path, item_id, seller_id) values ('${livePath}', '${I3}', '${P}')`);
r = await due(null);
check("the cron's call never hands out a path a photo row still names",
  r.ok && !r.rows.some((x) => x.storage_path === livePath) && r.rows.some((x) => x.storage_path === xPath), JSON.stringify(r));
q = SKIP ? [] : await queued();
check("…and drops that entry", !SKIP && !q.some((x) => x.storage_path === livePath), JSON.stringify(q));

// 6. A stale claim (a run that died) is handed out again; the 5th failure is told to ops once.
if (!SKIP) await db.query(`update public.declutter_photo_purge_queue set claimed_at = now() - interval '16 minutes', attempts = 5 where storage_path = '${xPath}'`);
r = await due(null);
const d = (await db.query(`select * from public.t_defects where fn = 'declutter-photo-purge'`)).rows;
q = SKIP ? [] : await queued();
check("a stale claim is handed out again (attempts counted)", r.ok && r.rows.some((x) => x.storage_path === xPath)
  && q.find((x) => x.storage_path === xPath)?.attempts === 6, JSON.stringify({ r, q }));
check("the 5th failed try is logged as a defect with its path", d.length === 1 && d[0].ref === xPath, JSON.stringify(d));

// 7. Decline: the seller declines a listing the Helpr wrote; its photos are detached and queued.
const I4 = await item(P, "pending_seller_approval");
await db.query(`insert into public.declutter_listed_for_seller (item_id, job_id, helpr_id, seller_id, sent_at) values ('${I4}', '${J}', '${A}', '${P}', now())`);
const dPath = await photo(I4, P, A, 0);
r = await as(db, "authenticated", P, `select public.declutter_decline_listed_for_me('${I4}')`);
const left = (await db.query(`select count(*)::int n from public.declutter_item_photos where item_id = '${I4}'`)).rows[0].n;
q = SKIP ? [] : await queued();
check("decline works and detaches the declined listing's photos", r.ok && left === 0, JSON.stringify({ r, left }));
check("…which queues them for the seller", q.some((x) => x.storage_path === dPath && x.seller_id === P), JSON.stringify(q));

// 8. Nobody but the service role reads or runs the queue.
for (const role of ["authenticated", "anon"]) {
  r = await as(db, role, role === "anon" ? null : P, `select * from public.declutter_photo_purge_due(10, '${P}'::uuid)`);
  check(`${role} cannot claim the queue`, refused(r, /permission denied|does not exist/), JSON.stringify(r));
  r = await as(db, role, role === "anon" ? null : P, `select public.declutter_photo_purge_done(array['${ownPath}'])`);
  check(`${role} cannot mark entries done`, refused(r, /permission denied|does not exist/), JSON.stringify(r));
  r = await as(db, role, role === "anon" ? null : P, `select * from public.declutter_photo_purge_queue`);
  check(`${role} cannot read the queue`, refused(r, /permission denied|does not exist/), JSON.stringify(r));
}

// 9. Only the trigger writes the queue, and the table's own check keeps every entry inside its item's folder.
r = await as(db, "service_role", null, `insert into public.declutter_photo_purge_queue (storage_path, item_id, seller_id)
  values ('${P}/declutter/${I3}/z.jpg', '${I1}', '${P}')`);
check("an entry whose path is not in its item's folder is refused", refused(r, /declutter_photo_purge_queue_item_folder|does not exist/), JSON.stringify(r));

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
