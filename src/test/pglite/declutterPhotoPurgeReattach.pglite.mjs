#!/usr/bin/env node
/**
 * PGlite proof for *_declutter_photo_purge_reattach (B67, lead review of B63's purge 11-01): a queued path that is
 * attached AGAIN must never be removed from Storage. (1) attaching a path drops its queue entry (AFTER INSERT
 * trigger, covers declutter_add_item_photo and declutter_helpr_add_listing_photo and any other insert);
 * (2) declutter_photo_purge_recheck, asked by the edge function right before each remove, returns only claimed,
 * still-queued paths no photo row names, and is service role only.
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/declutterPhotoPurgeReattach.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPhotoPurgeReattach.pglite.mjs   # RED: B63's purge alone
 *
 * World: the real columns of declutter_items' needed subset, declutter_item_photos (columns and CHECK of
 * 20261014193955), declutter_listed_for_seller (20261101034159), then B63's migration verbatim, then this one 3x.
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, as, checker, USERS } from "./seriesWorld.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const find = (suffix) => {
  const f = readdirSync(MIG_DIR).find((x) => x.endsWith(suffix));
  if (!f) throw new Error(`migration *${suffix} not found`);
  return readMigration(f);
};
const BASE = find("_declutter_photo_purge.sql");
const FIX = find("_declutter_photo_purge_reattach.sql");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: B63's purge alone (expect FAILs)");
const { P, A } = USERS;
const { check, failures } = checker();

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${P}'), ('${A}');
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  create table public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, full_name text, is_seed boolean not null default false);
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
  grant all on all tables in schema public to service_role;
`;

const db = new PGlite();
await db.exec(WORLD + BASE);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);

const I = (await db.query(`insert into public.declutter_items (seller_id) values ('${P}') returning id`)).rows[0].id;
const path = (n) => `${A}/declutter/${I}/${n}.jpg`;
const attach = (p, pos) => db.query(`insert into public.declutter_item_photos (item_id, seller_id, storage_path, position) values ('${I}', '${P}', '${p}', ${pos})`);
const detach = (p) => db.query(`delete from public.declutter_item_photos where storage_path = '${p}'`);
const queued = async () => (await db.query(`select storage_path from public.declutter_photo_purge_queue order by 1`)).rows.map((r) => r.storage_path);
const due = () => as(db, "service_role", null, `select storage_path from public.declutter_photo_purge_due(500, null) order by 1`);
const recheck = (paths, role = "service_role") =>
  as(db, role, role === "service_role" ? null : P, `select storage_path from public.declutter_photo_purge_recheck(array[${paths.map((p) => `'${p}'`).join(",")}]::text[]) order by 1`);

// 1. Queued, not yet claimed, attached again: the entry goes with the attach.
await attach(path("a"), 0);
await detach(path("a"));
check("a detached photo is queued (B63's trigger)", (await queued()).includes(path("a")));
await attach(path("a"), 0);
check("attaching the same path again drops its queue entry", !(await queued()).includes(path("a")), JSON.stringify(await queued()));

// 2. Claimed by a run, then attached again before that run's remove: the re-check refuses it.
await attach(path("b"), 1);
await attach(path("c"), 2);
await detach(path("b"));
await detach(path("c"));
let r = await due();
check("both detached paths are claimed", r.ok && r.rows.length === 2, JSON.stringify(r));
await attach(path("b"), 1);
r = await recheck([path("b"), path("c")]);
check("the re-check returns only the path still free (never the re-attached one)",
  r.ok && r.rows.length === 1 && r.rows[0].storage_path === path("c"), JSON.stringify(r));

// 3. A path claimed but whose entry another run already finished is not returned.
r = await as(db, "service_role", null, `select public.declutter_photo_purge_done(array['${path("c")}']) n`);
r = await recheck([path("c")]);
check("a path no longer queued is not returned", r.ok && r.rows.length === 0, JSON.stringify(r));

// 4. An unclaimed entry is not returned (only what this run claimed may go).
await detach(path("b"));
r = await recheck([path("b")]);
check("an unclaimed entry is not returned", r.ok && r.rows.length === 0, JSON.stringify(r));

// 5. Service role only.
r = await recheck([path("b")], "authenticated");
check("a member cannot call the re-check", !r.ok && /permission denied/.test(r.err), JSON.stringify(r));
r = await recheck([path("b")], "anon");
check("anon cannot call the re-check", !r.ok && /permission denied/.test(r.err), JSON.stringify(r));

await db.close();
if (failures()) { console.log(`${failures()} FAIL`); process.exit(1); }
console.log("ALL CHECKS PASSED");
