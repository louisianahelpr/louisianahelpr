#!/usr/bin/env node
/**
 * PGlite proof for 20261030012018_helpr_delivery_seller_handover (app audit 2026-10-28, report 1c #1 and #4).
 *
 *   node src/test/pglite/helprDeliverySellerHandover.pglite.mjs                     # GREEN (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/helprDeliverySellerHandover.pglite.mjs  # RED: the definitions before it
 *   MUTANT=<name> node src/test/pglite/helprDeliverySellerHandover.pglite.mjs       # a planted defect: must FAIL
 *
 * Checks: "Picked up" is refused 'too_early' before 30 minutes ahead of the booked pickup and taken from then;
 * the seller's "Handed over" (helpr_task_handed_over) lets THIS Helpr pick up early and nobody else; only the
 * seller can tap it, only while accepted, never while a problem is open; helpr_task_view returns handed_over_at
 * and problem_open to the parties and neither to a candidate; helpr_my_route leaves out a held pickup but keeps
 * a held item already in the car.
 *
 * World: a helpr_tasks table with prod's columns, helpr_task_events with prod's CHECK, declutter_problems, and the
 * REAL newest helpr_task_distance_m, helpr_task_log, helpr_task_source_held, helpr_payout_round_down_cents,
 * helpr_task_dropoff_shows_at, helpr_route_leg_miles, helpr_route_plan, helpr_task_items. Stubbed, and said so:
 * is_caller_banned (false), helpr_task_photo_ok (true: the photo rules have their own proofs),
 * declutter_lock_order (no-op), helpr_task_source_event (records the event), the view's candidate checks.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261030012018_helpr_delivery_seller_handover.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";

/** The newest CREATE of `name` in a migration before `before` (any dollar-quote tag). */
function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}

const MUTANTS = {
  // The time gate is dropped.
  gate: ["     AND (t.pickup_slot_start IS NULL OR now() < t.pickup_slot_start - interval '30 minutes') THEN", "     AND false THEN"],
  // Any seller confirmation counts, whoever it was for.
  anyhelpr: ["  IF t.handed_over_to IS DISTINCT FROM v_uid\n", "  IF t.handed_over_to IS NULL\n"],
  // Anyone on the task (the buyer too) can tap Handed over.
  whotaps: ["  IF t.pickup_contact_id IS DISTINCT FROM v_uid THEN", "  IF v_uid NOT IN (t.pickup_contact_id, t.customer_id) THEN"],
  // A held pickup stays on the route.
  route: ["              AND NOT (x.status = 'accepted' AND public.helpr_task_source_held(x.source_kind, x.source_id))\n", ""],
  // A candidate reads problem_open.
  candidate: ["    'problem_open', CASE WHEN v_role <> 'candidate' THEN", "    'problem_open', CASE WHEN true THEN"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
let passes = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (ok) passes++; else failures++; };

const H1 = "11111111-1111-1111-1111-111111111111";
const H2 = "22222222-2222-2222-2222-222222222222";
const BUYER = "33333333-3333-3333-3333-333333333333";
const SELLER = "44444444-4444-4444-4444-444444444444";
const OTHER = "55555555-5555-5555-5555-555555555555";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.helpr_tasks (
    id uuid primary key, source_kind text not null default 'declutter_delivery', source_id uuid not null,
    status text not null, size text not null default 'small', title text not null,
    pickup_area text not null default 'Mid City', dropoff_area text not null default 'Shenandoah',
    pickup_address text not null default '1 Seller St', pickup_lat numeric not null default 30.45, pickup_lng numeric not null default -91.15,
    dropoff_address text not null default '9 Buyer Ln', dropoff_lat numeric not null default 30.40, dropoff_lng numeric not null default -91.05,
    trip_miles integer not null default 5, pay_cents integer not null default 1800, fee_cents integer not null default 160,
    customer_id uuid, pickup_contact_id uuid, helpr_id uuid,
    open_until timestamptz not null default now() + interval '1 day', latest_pickup_at timestamptz not null default now() + interval '5 days',
    accepted_at timestamptz, pickup_slot_start timestamptz, releases smallint not null default 0,
    picked_up_at timestamptz, pickup_photo_path text, delivered_at timestamptz, dropoff_photo_path text,
    dropoff_distance_m integer, dropoff_code text, wrong_codes smallint not null default 0,
    confirmed_at timestamptz, confirmed_by text, closed_at timestamptz, close_note text, is_seed boolean not null default false,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), raised_cents integer not null default 0);
  create table public.helpr_task_events (id uuid primary key default gen_random_uuid(), task_id uuid not null,
    task_event text not null, actor_id uuid, detail text, created_at timestamptz not null default now());
  alter table public.helpr_task_events add constraint helpr_task_events_task_event_check check (task_event = any (array[
    'created', 'accepted', 'released', 'helpr_no_show', 'picked_up', 'delivered', 'wrong_code', 'confirmed', 'unfilled',
    'cancelled', 'failed', 'pickup_no_show']));
  create table public.declutter_problems (id uuid primary key default gen_random_uuid(), order_id uuid not null, status text not null);
  create table public.source_events (task uuid, event text);
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_lock_order(p uuid) returns void language sql as $f$ select $f$;
  create function public.helpr_task_photo_ok(a uuid, b uuid, c text) returns boolean language sql stable as $f$ select c is not null $f$;
  create function public.helpr_task_source_event(p_task uuid, p_event text, p_by text) returns jsonb language sql as
    $f$ insert into public.source_events values (p_task, p_event); select '{}'::jsonb $f$;
  create table public.profiles (user_id uuid primary key, full_name text);
  create function public.member_display_name(p_full text, p_x text) returns text language sql immutable as $f$ select p_full $f$;
  create function public.helpr_task_assert_helpr() returns uuid language sql stable as $f$ select auth.uid() $f$;
  create function public.helpr_task_vehicle_fits(p_user uuid, p_size text) returns boolean language sql stable as $f$ select true $f$;
  create function public.are_users_blocked(a uuid, b uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.helpr_task_same_stripe_mode(a uuid, b uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.helpr_task_source_require_feature(p_kind text) returns void language sql as $f$ select $f$;
  create table public.declutter_items (id uuid primary key, title text not null, porch_ok boolean not null default true, status text not null default 'sold');
  create table public.declutter_item_photos (item_id uuid, storage_path text, position smallint);
  create table public.declutter_cart_items (id uuid primary key, item_id uuid, order_id uuid);
`);
for (const fn of ["helpr_task_distance_m", "helpr_task_log", "helpr_task_source_held", "helpr_task_lock", "helpr_payout_round_down_cents",
  "helpr_task_dropoff_shows_at", "helpr_route_leg_miles", "helpr_route_plan", "helpr_task_items",
  // The definitions this migration restates, at their newest before it (what prod runs today).
  "helpr_task_picked_up", "helpr_task_view", "helpr_my_route"]) {
  await db.exec(newest(fn));
}
if (skip) {
  console.log("NEW_MIGRATION=skip: the definitions before 20261030012018 (expect FAILs)");
  await db.exec(`alter table public.helpr_tasks add column handed_over_at timestamptz, add column handed_over_to uuid`);
} else {
  for (let i = 0; i < 3; i++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${i + 1} of 3)`); }
    catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
  }
}

const iso = (mins) => new Date(Date.now() + mins * 60_000).toISOString();
const T = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
const O = (n) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function task(n, status, helpr, slotMins) {
  await db.exec(`insert into public.helpr_tasks (id, source_id, status, title, customer_id, pickup_contact_id, helpr_id, pickup_slot_start, accepted_at)
    values ('${T(n)}', '${O(n)}', '${status}', 'Item ${n}', '${BUYER}', '${SELLER}', ${helpr ? `'${helpr}'` : "null"},
            ${slotMins == null ? "null" : `'${iso(slotMins)}'`}, now())`);
}
async function as(uid, sql) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try { return { ok: true, rows: (await db.query(sql)).rows }; }
  catch (e) { return { ok: false, err: String(e.message) }; }
}
const pickUp = (uid, n) => as(uid, `select public.helpr_task_picked_up('${T(n)}', 'p/${n}.jpg', 30.45, -91.15) as r`);
const handOver = (uid, n) => as(uid, `select public.helpr_task_handed_over('${T(n)}') as r`);
const statusOf = async (n) => (await db.query(`select status from public.helpr_tasks where id = '${T(n)}'`)).rows[0]?.status;
const view = async (uid, n) => { const r = await as(uid, `select public.helpr_task_view('${T(n)}') as v`); return r.ok ? r.rows[0].v : null; };

// 1. The time gate (report 1c #1: picked up at 8:09 PM Thursday for a Sat 9:00 AM pickup).
await task(1, "accepted", H1, 60 * 37);
let r = await pickUp(H1, 1);
check(!r.ok && /too_early/.test(r.err), `"Picked up" 37 hours before the pickup: too_early${r.ok ? " (it went through)" : ` (${r.err})`}`);
check(await statusOf(1) === "accepted", "  and the task is still accepted");
await task(2, "accepted", H1, 31);
r = await pickUp(H1, 2);
check(!r.ok && /too_early/.test(r.err), `31 minutes before: still too_early${r.ok ? " (it went through)" : ""}`);
await task(3, "accepted", H1, 29);
r = await pickUp(H1, 3);
check(r.ok && r.rows[0].r.result === "picked_up", `29 minutes before: picked up${r.ok ? "" : ` (${r.err})`}`);
await task(4, "accepted", H1, -10);
r = await pickUp(H1, 4);
check(r.ok && r.rows[0].r.result === "picked_up", `10 minutes after the slot start: picked up${r.ok ? "" : ` (${r.err})`}`);

// 2. The seller's "Handed over".
await task(5, "accepted", H1, 60 * 24);
r = await handOver(BUYER, 5);
check(!r.ok && /task_not_found/.test(r.err), `the buyer cannot tap Handed over${r.ok ? " (it went through)" : ""}`);
r = await handOver(H1, 5);
check(!r.ok && /task_not_found/.test(r.err), `the Helpr cannot tap it for themselves${r.ok ? " (it went through)" : ""}`);
r = await handOver(OTHER, 5);
check(!r.ok && /task_not_found/.test(r.err), "a stranger cannot tap it");
r = await handOver(SELLER, 5);
check(r.ok && r.rows[0].r.result === "handed_over", `the seller taps Handed over${r.ok ? "" : ` (${r.err})`}`);
check(await statusOf(5) === "accepted", "  the tap changes no status (the Helpr still takes the photo)");
const ev = (await db.query(`select count(*)::int n from public.helpr_task_events where task_id = '${T(5)}' and task_event = 'handed_over' and actor_id = '${SELLER}'`)).rows[0]?.n;
check(ev === 1, `  one 'handed_over' event by the seller (got ${ev})`);
r = await handOver(SELLER, 5);
const ev2 = (await db.query(`select count(*)::int n from public.helpr_task_events where task_id = '${T(5)}' and task_event = 'handed_over'`)).rows[0]?.n;
check(r.ok && r.rows[0].r.result === "already_handed_over" && ev2 === 1, `  a second tap: already_handed_over, no second event (events ${ev2})`);
r = await pickUp(H1, 5);
check(r.ok && r.rows[0].r.result === "picked_up", `after the seller's tap, the Helpr picks up a day early${r.ok ? "" : ` (${r.err})`}`);
// The confirmation was for H1; the task reopened to H2 never inherits it.
await task(6, "accepted", H1, 60 * 24);
await handOver(SELLER, 6);
await db.exec(`update public.helpr_tasks set helpr_id = '${H2}' where id = '${T(6)}'`);
r = await pickUp(H2, 6);
check(!r.ok && /too_early/.test(r.err), `a seller's tap for another Helpr does not let this one pick up early${r.ok ? " (it went through)" : ""}`);
const v6 = await view(H2, 6);
check(v6 && v6.handed_over_at == null, "  and the view shows no handover to the new Helpr");
// Not while open, delivered or held.
await task(7, "open", null, null);
r = await handOver(SELLER, 7);
check(!r.ok && /task_not_active/.test(r.err), `an open task (no Helpr yet): task_not_active${r.ok ? " (it went through)" : ""}`);
await task(8, "accepted", H1, 60 * 24);
await db.exec(`insert into public.declutter_problems (order_id, status) values ('${O(8)}', 'open')`);
r = await handOver(SELLER, 8);
check(!r.ok && /problem_open/.test(r.err), `a sale held by a problem: problem_open${r.ok ? " (it went through)" : ""}`);

// 3. helpr_task_view: handed_over_at and problem_open (report 1c #4).
const v5s = await view(SELLER, 5);
check(v5s && typeof v5s.handed_over_at === "string", "the seller's view carries handed_over_at");
const v8 = await view(H1, 8);
check(v8 && v8.problem_open === true, "the Helpr's view of a held task: problem_open true");
const v1 = await view(H1, 1);
check(v1 && v1.problem_open === false, "an unheld task: problem_open false");
const v8b = await view(BUYER, 8);
check(v8b && v8b.problem_open === true, "the buyer reads problem_open too");
await task(9, "open", null, null);
await db.exec(`insert into public.declutter_problems (order_id, status) values ('${O(9)}', 'open')`);
const v9 = await view(OTHER, 9);
check(v9 && v9.role === "candidate" && !("problem_open" in v9 && v9.problem_open !== null) && v9.handed_over_at == null,
  `a candidate reads neither (role ${v9?.role}, problem_open ${JSON.stringify(v9?.problem_open)})`);

// 4. helpr_my_route: a held pickup is no stop; a held item already in the car keeps its drop-off.
await db.exec(`update public.helpr_tasks set status = 'confirmed' where helpr_id = '${H1}' and id <> '${T(8)}'`);
await task(10, "picked_up", H1, -60);
await db.exec(`insert into public.declutter_problems (order_id, status) values ('${O(10)}', 'open')`);
await task(11, "accepted", H1, 120);
r = await as(H1, "select public.helpr_my_route(30.45, -91.15) as r");
const keys = r.ok ? (r.rows[0].r.stops ?? []).map((s) => `${Number(s.task_id.slice(-12))}:${s.kind}`) : [];
check(r.ok, `H1 reads their route${r.ok ? "" : ` (${r.err})`}`);
check(!keys.some((k) => k.startsWith("8:")), `the held pickup (task 8) is not on the route (stops: ${keys.join(", ")})`);
check(keys.includes("10:dropoff"), "a held item already picked up keeps its drop-off");
check(keys.includes("11:pickup") && keys.includes("11:dropoff"), "an unheld delivery keeps both stops");

console.log(`\n${skip ? "PROD's definitions (NEW_MIGRATION=skip)" : MUTANT ? `MUTANT=${MUTANT}` : "WITH the migration (3x)"}: ${passes} pass, ${failures} fail`);
process.exit(failures ? 1 : 0);
