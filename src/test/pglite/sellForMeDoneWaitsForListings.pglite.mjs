#!/usr/bin/env node
/**
 * PGlite proof for *_sell_for_me_done_waits_for_listings (POST-H3, owner pop-up 10-31 ~9:35 PM: "the job can't be
 * marked done until the listings are live (the listings are the proof)").
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/sellForMeDoneWaitsForListings.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/sellForMeDoneWaitsForListings.pglite.mjs   # RED: the newest bodies before it
 *
 * World: jobs + declutter_items, and the NEWEST definitions before the migration of is_server_context,
 * enforce_helper_completion_gates (attached as the real BEFORE UPDATE trigger) and rpc_helper_mark_done, read from
 * the migrations, never retyped. The migration then runs verbatim 3x.
 *
 * Holds: a declutter_help job is refused Mark done (RPC and direct stamp) with no live listing of the seller's since
 * the job was posted (none, a draft, one in review, one withdrawn, one from before the job, another member's), and
 * taken once one is live (or reserved / sold); its photo rule is unchanged (still asked when the poster asked);
 * every other job is unchanged; the helper answers only the job's own two people; grants.
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const FILE = readdirSync(new URL("../../../supabase/migrations/", import.meta.url).pathname).find((f) => f.endsWith("_sell_for_me_done_waits_for_listings.sql"));
if (!FILE) throw new Error("migration *_sell_for_me_done_waits_for_listings.sql not found");
const VERSION = FILE.slice(0, 14);
const FIX = readMigration(FILE);
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running against the newest bodies before it (expect FAILs)");
const { P, A, X } = USERS;
const OTHER = USERS.B;
const { check, failures } = checker();

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function auth.role() returns text language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  create type public.job_category as enum ('cleaning','moving','declutter_help','errands');
  create table public.jobs (id uuid primary key default gen_random_uuid(), title text, customer_id uuid, helper_id uuid,
    category public.job_category not null default 'moving', created_at timestamptz not null default now(),
    status public.job_status not null default 'in_progress', helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz,
    poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz, helper_completed_at timestamptz,
    poster_completed_at timestamptz, require_photo_proof boolean default true, proof_before_urls text[], proof_after_urls text[],
    is_group_job boolean default false);
  create table public.declutter_items (id uuid primary key default gen_random_uuid(), seller_id uuid not null,
    status text not null default 'draft', title text not null default 'item', created_at timestamptz not null default now());
  grant select, update on public.jobs to authenticated;
  grant all on public.jobs, public.declutter_items to service_role;
`;
const OLD = ["is_server_context", "enforce_helper_completion_gates", "rpc_helper_mark_done"]
  .map((n) => newestFunctionSql(n, VERSION).sql).join("\n");
const TRIGGERS = `
  drop trigger if exists trg_helper_completion_gates on public.jobs;
  create trigger trg_helper_completion_gates before update of helper_completed_at, status on public.jobs
    for each row execute function public.enforce_helper_completion_gates();
`;

/** A job Helpr A is working: arrival confirmed an hour ago, posted two days ago; photos when asked. */
async function job(db, category, { photos = false } = {}) {
  const p = photos ? "array['b.jpg'], array['a.jpg']" : "null, null";
  return (await db.query(`insert into public.jobs (title, customer_id, helper_id, category, created_at, helper_arrived_at,
      helper_arrival_verified_at, poster_confirmed_arrival_at, proof_before_urls, proof_after_urls)
    values ('j', '${P}', '${A}', '${category}', now() - interval '2 days', now() - interval '1 hour', now() - interval '1 hour',
      now() - interval '1 hour', ${p}) returning id`)).rows[0].id;
}
const listing = (db, seller, status, age = "1 hour") =>
  db.query(`insert into public.declutter_items (seller_id, status, created_at) values ('${seller}', '${status}', now() - interval '${age}')`);
const markDone = (db, j) => as(db, "authenticated", A, `select public.rpc_helper_mark_done('${j}') as out`);
const stampDirect = (db, j) => as(db, "authenticated", A, `update public.jobs set helper_completed_at = now() where id = '${j}' returning id`);

const db = new PGlite();
await db.exec(WORLD + OLD + TRIGGERS);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);

// ── A Have-a-Helpr-list-it job: nothing live yet ────────────────────────────────
const j1 = await job(db, "declutter_help", { photos: true });
let r = await markDone(db, j1);
check("declutter_help, photos but no listing at all -> completion_requires_live_listings", refused(r, /completion_requires_live_listings/), r.err ?? "taken");
await listing(db, P, "draft");
await listing(db, P, "pending_review");
await listing(db, P, "withdrawn");
await listing(db, P, "live", "5 days"); // before the job was posted
await listing(db, OTHER, "live"); // someone else's
r = await markDone(db, j1);
check("a draft, one in review, one withdrawn, one live from before the job, another member's -> still refused", refused(r, /completion_requires_live_listings/), r.err ?? "taken");
r = await stampDirect(db, j1);
check("the jobs trigger refuses the direct stamp the same", refused(r, /completion_requires_live_listings/), r.err ?? "taken");

// ── One goes live: done, and no photos asked ────────────────────────────────────
await listing(db, P, "live");
r = await markDone(db, await job(db, "declutter_help", { photos: true }));
check("a live listing since the job -> taken", r.ok && r.rows[0].out.already_done === false, r.err);
r = await stampDirect(db, await job(db, "declutter_help", { photos: true }));
check("the jobs trigger takes the direct stamp too", r.ok && r.rows.length === 1, r.err);
r = await markDone(db, await job(db, "declutter_help"));
check("the photo rule is unchanged: live listing but no photos -> completion_requires_proof_photos", refused(r, /completion_requires_proof_photos/), r.err ?? "taken");
await db.query(`update public.declutter_items set status = 'sold' where seller_id = '${P}' and status = 'live' and created_at > now() - interval '2 hours'`);
r = await markDone(db, await job(db, "declutter_help", { photos: true }));
check("already sold since -> still counts as gone live", r.ok, r.err);

// ── Every other job keeps its photo rule ─────────────────────────────────────────
r = await markDone(db, await job(db, "moving"));
check("a moving job with no photos -> completion_requires_proof_photos (unchanged)", refused(r, /completion_requires_proof_photos/), r.err ?? "taken");
r = await markDone(db, await job(db, "moving", { photos: true }));
check("a moving job with photos -> taken (unchanged)", r.ok, r.err);
r = await as(db, "authenticated", X, `select public.rpc_helper_mark_done('${await job(db, "declutter_help")}')`);
check("a stranger is still refused on authorization", refused(r, /not_the_assigned_helper/), r.err);

// ── The helper answers only the job's own two people ─────────────────────────────
if (!SKIP) {
  const j3 = await job(db, "declutter_help");
  const ask = async (uid) => (await as(db, "authenticated", uid, `select public.sell_for_me_listings_live('${j3}') as v`));
  check("the job's Helpr and poster get the answer", (await ask(A)).rows?.[0]?.v === true && (await ask(P)).rows?.[0]?.v === true);
  check("a stranger gets false, never a probe of the seller's listings", (await ask(X)).rows?.[0]?.v === false);
  const anon = await as(db, "anon", null, `select public.sell_for_me_listings_live('${j3}')`);
  check("anon cannot call it", refused(anon, /permission denied/), anon.err ?? "allowed");
} else {
  check("sell_for_me_listings_live exists", false, "not before the migration");
}

const acl = (await db.query(`select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') a, has_function_privilege('anon', p.oid, 'EXECUTE') n
  from pg_proc p where p.proname in ('enforce_helper_completion_gates','rpc_helper_mark_done') order by 1`)).rows;
const want = { enforce_helper_completion_gates: false, rpc_helper_mark_done: true };
check("grants: rpc_helper_mark_done for signed-in users only; the trigger for nobody", acl.length === 2 && acl.every((x) => x.a === want[x.proname] && x.n === false), JSON.stringify(acl));

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
